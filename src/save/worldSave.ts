import { SimObject } from "projector";
import type { Drops, SavedDrop } from "../drops.js";
import type { Chunk } from "../chunk.js";
import type { ChunkSupply, SkipChunk } from "../chunkSupply.js";
import type { ScheduledTick, WorldTicks } from "../ticks.js";
import { VoxelWorld } from "../world.js";
import { chunkRecord, readChunkRecord, snapshotChunk, type ChunkSnapshot } from "./codec.js";
import { FORMAT_VERSION, type GuestRecord, type PlayerRecord, type WorldMeta } from "./format.js";
import type { WorldStore } from "./store.js";

/** Seconds between autosaves. */
const AUTOSAVE = 30;
/** Unloaded chunks waiting to be written that make a save come early. */
const UNLOADED_BATCH = 32;
/** Saved chunks being read at once at most. */
const READS = 8;

/** The player as a save keeps it (the record without its bookkeeping fields). */
export type PlayerState = Omit<PlayerRecord, "format" | "world">;

export interface WorldSaveOptions {
  store: WorldStore;
  meta: WorldMeta;
  world: VoxelWorld;
  ticks: WorldTicks;
  /** Makes the chunks that were never saved. */
  generator: ChunkSupply;
  /** The positions of the chunks already saved (WorldStore.chunkKeys). */
  savedChunks: ReadonlyArray<[number, number]>;
  /** The player now, for every save. */
  player: () => PlayerState;
  /** The guests to save (those playing and those who left since the last save), without their bookkeeping fields. */
  guests?: () => Array<Omit<GuestRecord, "format" | "world">>;
  /** The items lying about, saved with the chunks they are in. */
  drops?: Drops;
}

/**
 * Keeps a world saved while it is played. Chunks come from the store when they were saved before and from
 * the generator otherwise; every new or changed chunk is written, in one transaction with the player and
 * the world's metadata, every AUTOSAVE seconds and on save(). Chunks unloaded before they were written
 * wait here (and come back from here if needed again) until the next save.
 */
export class WorldSave extends SimObject implements ChunkSupply {
  /** The world's metadata as last saved. */
  meta: WorldMeta;
  /** Seconds between autosaves. */
  interval: number = AUTOSAVE;
  /** When the last save finished (performance.now()), or null before the first. */
  lastSaved: number | null = null;
  /** Called after every save with whether it worked. */
  onSaved: ((ok: boolean, error?: unknown) => void) | null = null;
  private readonly store: WorldStore;
  private readonly world: VoxelWorld;
  private readonly ticks: WorldTicks;
  private readonly generator: ChunkSupply;
  private readonly player: () => PlayerState;
  private readonly guests: () => Array<Omit<GuestRecord, "format" | "world">>;
  private readonly saved: Set<number>;
  /** Stored size of the chunks read or written this session, to keep meta.bytes right. */
  private readonly sizes: Map<number, number> = new Map();
  private readonly unloaded: Map<number, { chunk: Chunk; ticks: ScheduledTick[]; drops: SavedDrop[] }> = new Map();
  private readonly drops: Drops | null;
  private readonly reading: Set<number> = new Set();
  private readonly skip: SkipChunk;
  private elapsed: number = 0;
  private running: Promise<void> | null = null;
  private again: boolean = false;
  private askedToPersist: boolean = false;

  constructor(options: WorldSaveOptions) {
    super();
    this.store = options.store;
    this.meta = options.meta;
    this.world = options.world;
    this.ticks = options.ticks;
    this.generator = options.generator;
    this.player = options.player;
    this.guests = options.guests ?? (() => []);
    this.drops = options.drops ?? null;
    this.saved = new Set(options.savedChunks.map(([cx, cz]) => VoxelWorld.key(cx, cz)));
    this.skip = (cx, cz) => {
      const key = VoxelWorld.key(cx, cz);
      return this.saved.has(key) || this.unloaded.has(key);
    };
  }

  /** Chunks unloaded but not written yet. */
  get waiting(): number {
    return this.unloaded.size;
  }

  requestAround(world: VoxelWorld, x: number, z: number, radius: number): void {
    for (const [cx, cz] of world.missingAround(x, z, radius)) {
      const key = VoxelWorld.key(cx, cz);
      const back = this.unloaded.get(key);
      if (back) {
        this.unloaded.delete(key);
        world.insert(back.chunk);
        this.ticks.restore(back.ticks);
        this.drops?.restore(back.drops);
      } else if (this.saved.has(key) && !this.reading.has(key) && this.reading.size < READS) {
        void this.read(cx, cz);
      }
    }
    this.generator.requestAround(world, x, z, radius, this.skip);
  }

  /** Loads the chunks within `radius` chunks of block (x, z) right away: saved ones read, others generated. */
  async loadNow(x: number, z: number, radius: number): Promise<void> {
    const reads: Promise<void>[] = [];
    for (const [cx, cz] of [...this.world.missingAround(x, z, radius)]) {
      if (this.saved.has(VoxelWorld.key(cx, cz))) reads.push(this.read(cx, cz));
      else this.world.load(cx, cz);
    }
    await Promise.all(reads);
  }

  /** For Terrain.onUnload: a chunk with something unsaved (or items lying in it) waits for the next save. */
  unload(chunk: Chunk): void {
    const ticks = this.ticks.takeChunk(chunk.cx, chunk.cz);
    const drops = this.drops?.inChunk(chunk.cx, chunk.cz, true) ?? [];
    if (chunk.unsaved || ticks.length > 0 || drops.length > 0) this.unloaded.set(VoxelWorld.key(chunk.cx, chunk.cz), { chunk, ticks, drops });
  }

  override update(dt: number): void {
    this.elapsed += dt;
    if (this.running) return;
    if (this.elapsed >= this.interval || this.unloaded.size >= UNLOADED_BATCH) void this.save().catch(() => {});
  }

  /**
   * Writes every new or changed chunk, the player and the metadata, in one transaction. A save asked for
   * while one is running follows it. Rejects if the write failed; the chunks stay unsaved then.
   */
  save(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.elapsed = 0;
    this.running = this.write().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        void this.save().catch(() => {});
      }
    });
    return this.running;
  }

  private async write(): Promise<void> {
    // Taken all at once, so edits made while this save runs belong to the next one
    const snaps: ChunkSnapshot[] = [];
    const loaded: Chunk[] = [];
    for (const chunk of this.world.chunks.values()) {
      if (!chunk.unsaved) continue;
      snaps.push(snapshotChunk(chunk, this.ticks.inChunk(chunk.cx, chunk.cz), this.drops?.inChunk(chunk.cx, chunk.cz, false)));
      chunk.unsaved = false;
      loaded.push(chunk);
    }
    const leaving = [...this.unloaded];
    for (const [, { chunk, ticks, drops }] of leaving) snaps.push(snapshotChunk(chunk, ticks, drops));
    const player: PlayerRecord = { format: FORMAT_VERSION, world: this.meta.id, ...this.player() };
    const guests: GuestRecord[] = this.guests().map((g) => ({ format: FORMAT_VERSION, world: this.meta.id, ...g }));
    try {
      const chunks = await Promise.all(snaps.map((s) => chunkRecord(this.meta.id, s)));
      let bytes = this.meta.bytes;
      let count = this.meta.chunks;
      for (const c of chunks) {
        const key = VoxelWorld.key(c.cx, c.cz);
        bytes += c.blocks.length - (this.sizes.get(key) ?? 0);
        if (!this.saved.has(key)) count++;
      }
      const meta: WorldMeta = { ...this.meta, time: this.ticks.time, lastPlayed: Date.now(), bytes, chunks: count };
      await this.store.save({ meta, player, chunks, guests });
      this.meta = meta;
      for (const c of chunks) {
        const key = VoxelWorld.key(c.cx, c.cz);
        this.saved.add(key);
        this.sizes.set(key, c.blocks.length);
      }
      // Unless the chunk came back (and may have changed) meanwhile
      for (const [key, entry] of leaving) if (this.unloaded.get(key) === entry) this.unloaded.delete(key);
      this.lastSaved = performance.now();
      // So the browser doesn't clear the world away when space runs low
      if (!this.askedToPersist) {
        this.askedToPersist = true;
        void globalThis.navigator?.storage?.persist?.();
      }
      this.onSaved?.(true);
    } catch (e) {
      for (const chunk of loaded) chunk.unsaved = true;
      console.error("Craft: saving failed", e);
      this.onSaved?.(false, e);
      throw e;
    }
  }

  private async read(cx: number, cz: number): Promise<void> {
    const key = VoxelWorld.key(cx, cz);
    this.reading.add(key);
    try {
      const record = await this.store.getChunk(this.meta.id, cx, cz);
      if (!record) throw new Error("it isn't in the store");
      this.sizes.set(key, record.blocks.length);
      const { chunk, ticks, drops } = await readChunkRecord(record);
      if (!this.world.chunk(cx, cz)) {
        this.world.insert(chunk);
        this.ticks.restore(ticks);
        this.drops?.restore(drops);
      }
    } catch (e) {
      // Made anew instead (and saved over the damaged one)
      console.error(`Craft: couldn't read chunk ${cx}, ${cz}; generating it again.`, e);
      this.saved.delete(key);
    } finally {
      this.reading.delete(key);
    }
  }
}

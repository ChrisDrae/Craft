import { SimObject, type Vec3 } from "projector";
import { REACH, perform, touched, type Action } from "../actions.js";
import { saveEntity } from "../blockEntities.js";
import { BLOCKS, HOTBAR, PLACEABLE } from "../blocks.js";
import { CHUNK_SIZE } from "../chunk.js";
import type { Drops } from "../drops.js";
import { PLAYER_SLOTS } from "../inventory.js";
import { loadStack, saveStack, type SavedStack } from "../items.js";
import { dropsOf } from "../mining.js";
import { EYE_HEIGHT } from "../player.js";
import type { GameMode } from "../save/format.js";
import { compress, snapshotChunk } from "../save/codec.js";
import type { WorldTicks } from "../ticks.js";
import { VoxelWorld } from "../world.js";
import type { Connection } from "./connection.js";
import { PROTOCOL_VERSION, REGISTRY, decode, encode, type DropView, type GuestState, type PlayerView, type ToGuest, type ToHost } from "./protocol.js";

/** Chunks sent to a guest per frame at most, and only while less than this many bytes wait to go out. */
const CHUNKS_PER_FRAME = 6;
const BACKLOG = 1 << 20;
/** Seconds between player position updates, and between clock updates. */
const POSITIONS = 0.1;
const CLOCK = 5;
/** The farthest a guest may see, in chunks (they ask for their render distance). */
const MAX_VIEW = 12;

/** A guest in the host's world. */
export interface Guest {
  readonly id: string;
  readonly name: string;
  readonly state: GuestState;
}

interface Visitor extends Guest {
  conn: Connection;
  view: number;
  /** Chunks sent or on their way (by VoxelWorld.key). */
  sent: Set<number>;
  /** Frames go out in order through this, chunks compressing on the way included. */
  outbox: Promise<void>;
  /** The chest or furnace the guest has open, and what they were last sent of it. */
  open: { x: number; y: number; z: number; sent: string } | null;
}

export interface HostOptions {
  world: VoxelWorld;
  ticks: WorldTicks;
  worldName: string;
  mode: GameMode;
  /** The items lying about, which guests see, pick up and throw. */
  drops: Drops;
  /** The host's own player, as the guests see them. */
  host: () => PlayerView;
  /** Where a newcomer starts. */
  spawn: () => Vec3;
  /** A guest's state from an earlier visit (from the save), or null for a newcomer. */
  saved: (id: string) => Promise<GuestState | null> | GuestState | null;
  /** Called when a guest leaves, with their last state (for the save). */
  onLeave?: (guest: Guest) => void;
  /** Called when the guests come or go (for the game menu's list). */
  onGuests?: () => void;
}

/** Ids and names: short and plain. */
const ID = /^[a-z0-9-]{4,40}$/;
const finite = (...v: number[]): boolean => v.every(Number.isFinite);

/**
 * The host's side of a shared world. The host's game runs as always (it owns the world: generation,
 * ticks, block updates, the save); this sends each guest the chunks around them as they move, every block
 * change in those chunks, the other players and the time, and does the guests' actions by the same rules
 * as the host's own, after checking they could reach.
 */
export class HostSession extends SimObject {
  private readonly options: HostOptions;
  private readonly visitors: Map<Connection, Visitor> = new Map();
  /** Blocks changed since the last frame, as "x,y,z", and the same as numbers. */
  private readonly changedKeys: Set<string> = new Set();
  private readonly changes: number[] = [];
  private positionTimer: number = 0;
  private clockTimer: number = 0;
  private readonly offsets: Map<number, Array<[number, number]>> = new Map();

  constructor(options: HostOptions) {
    super();
    this.options = options;
  }

  /** The guests playing now. */
  get guests(): Guest[] {
    return [...this.visitors.values()];
  }

  /** The feet of every guest, whom blocks aren't placed into. */
  standing(): Vec3[] {
    return this.guests.map((g) => g.state.position);
  }

  /** Where chunks must be loaded for the guests: around each, as far as they see. */
  focuses(): Array<{ x: number; z: number; radius: number }> {
    return [...this.visitors.values()].map((v) => ({ x: v.state.position.x, z: v.state.position.z, radius: v.view }));
  }

  /** Takes a new connection; it becomes a guest when it says hello and is welcome. */
  accept(conn: Connection): void {
    conn.onMessage = (frame) => {
      let msg: ToHost;
      try {
        msg = decode<ToHost>(frame).message;
      } catch {
        conn.close();
        return;
      }
      const visitor = this.visitors.get(conn);
      if (visitor) this.handle(visitor, msg);
      else if (msg.t === "hello") void this.greet(conn, msg);
    };
    conn.onClose = () => this.leave(conn);
  }

  /** For world.onChanged: a block changed, to be sent to the guests that have its chunk. */
  changed(x: number, y: number, z: number): void {
    const key = `${x},${y},${z}`;
    if (this.changedKeys.has(key)) return;
    this.changedKeys.add(key);
    this.changes.push(x, y, z);
  }

  /** Says goodbye to every guest. */
  close(reason: string = "The host closed the world."): void {
    for (const v of [...this.visitors.values()]) {
      this.send(v, { t: "bye", reason });
      void v.outbox.then(() => v.conn.close());
    }
  }

  private async greet(conn: Connection, hello: Extract<ToHost, { t: "hello" }>): Promise<void> {
    const refuse = (reason: string): void => {
      conn.send(encode({ t: "refused", reason }));
      setTimeout(() => conn.close(), 100);
    };
    if (hello.protocol !== PROTOCOL_VERSION || hello.registry !== REGISTRY) return refuse("Your Craft is a different version from the host's. Reload the page, or ask the host to.");
    if (typeof hello.id !== "string" || !ID.test(hello.id)) return refuse("That isn't a player id.");
    if ([...this.visitors.values()].some((v) => v.id === hello.id)) return refuse("You are already playing in this world.");
    const name = String(hello.name ?? "").trim().slice(0, 24) || "Guest";
    const saved = await this.options.saved(hello.id);
    if (!conn.open) return;
    const spawn = this.options.spawn();
    // A newcomer starts with nothing, or in creative with the usual blocks at hand
    const inventory: (SavedStack | null)[] = new Array(PLAYER_SLOTS).fill(null);
    if (this.options.mode === "creative") HOTBAR.forEach((b, i) => (inventory[i] = { item: BLOCKS[b].name, count: 1 }));
    const state: GuestState = saved ?? { position: { x: spawn.x, y: spawn.y, z: spawn.z }, yaw: 0, pitch: 0, selected: 0, inventory };
    const view = Math.max(2, Math.min(MAX_VIEW, Math.floor(Number(hello.view) || 6)));
    const visitor: Visitor = { id: hello.id, name, state, conn, view, sent: new Set(), outbox: Promise.resolve(), open: null };
    this.visitors.set(conn, visitor);
    this.send(visitor, { t: "welcome", id: hello.id, world: this.options.worldName, time: this.options.ticks.time, mode: this.options.mode, you: state });
    this.options.onGuests?.();
  }

  private leave(conn: Connection): void {
    const v = this.visitors.get(conn);
    if (!v) return;
    this.visitors.delete(conn);
    this.options.onLeave?.(v);
    this.options.onGuests?.();
  }

  private handle(v: Visitor, msg: ToHost): void {
    switch (msg.t) {
      case "move":
        if (!finite(msg.x, msg.y, msg.z, msg.yaw, msg.pitch)) return;
        Object.assign(v.state.position, { x: msg.x, y: msg.y, z: msg.z });
        v.state.yaw = msg.yaw;
        v.state.pitch = msg.pitch;
        return;
      case "act":
        this.act(v, msg);
        return;
      case "inventory":
        if (!Array.isArray(msg.inventory)) return;
        v.state.inventory = Array.from({ length: PLAYER_SLOTS }, (_, i) => saveStack(loadStack(msg.inventory[i])));
        v.state.selected = Math.max(0, Math.min(8, Math.floor(Number(msg.selected) || 0)));
        return;
      case "take": {
        // Only what lies within reach
        const item = this.options.drops.items.get(Number(msg.id));
        if (!item || this.distance(v, item.position) > 3) return;
        const got = this.options.drops.give(item.id, { position: v.state.position, take: () => null }, Math.max(1, Math.floor(Number(msg.max) || 0)));
        if (got) this.send(v, { t: "given", item: saveStack(got)! });
        return;
      }
      case "throw": {
        const s = loadStack(msg.item);
        if (!s || !finite(msg.x, msg.y, msg.z, msg.vx, msg.vy, msg.vz) || this.distance(v, msg) > 3) return;
        const clamp = (n: number): number => Math.max(-20, Math.min(20, n));
        this.options.drops.spawn(msg.x, msg.y, msg.z, s, { x: clamp(msg.vx), y: clamp(msg.vy), z: clamp(msg.vz) }, 2);
        return;
      }
      case "open": {
        const e = this.options.world.blockEntity(msg.x | 0, msg.y | 0, msg.z | 0);
        if (!e || this.distance(v, { x: msg.x + 0.5, y: msg.y, z: msg.z + 0.5 }) > REACH + 2) return;
        v.open = { x: msg.x | 0, y: msg.y | 0, z: msg.z | 0, sent: "" };
        this.sendContainer(v);
        return;
      }
      case "slots": {
        const o = v.open;
        if (!o || o.x !== msg.x || o.y !== msg.y || o.z !== msg.z || !Array.isArray(msg.slots)) return;
        const e = this.options.world.blockEntity(o.x, o.y, o.z);
        if (!e) return;
        for (const [i, s] of msg.slots) if (Number.isInteger(i) && i >= 0 && i < e.items.length) e.items[i] = loadStack(s);
        const chunk = this.options.world.chunk(o.x >> 4, o.z >> 4);
        if (chunk) chunk.unsaved = true;
        // What they did is what they have: don't send it back
        o.sent = JSON.stringify(saveEntity(0, 0, 0, e));
        return;
      }
      case "close":
        v.open = null;
        return;
      case "dropped":
        for (const [cx, cz] of Array.isArray(msg.chunks) ? msg.chunks : []) v.sent.delete(VoxelWorld.key(cx, cz));
        return;
    }
  }

  private distance(v: Visitor, p: { x: number; y: number; z: number }): number {
    const q = v.state.position;
    return Math.hypot(p.x - q.x, p.y - (q.y + 1), p.z - q.z);
  }

  /** Sends a guest their open chest's or furnace's contents, if they changed (or that it is gone). */
  private sendContainer(v: Visitor): void {
    const o = v.open!;
    const e = this.options.world.blockEntity(o.x, o.y, o.z);
    if (!e) {
      this.send(v, { t: "container", x: o.x, y: o.y, z: o.z, entity: null });
      v.open = null;
      return;
    }
    const entity = saveEntity(0, 0, 0, e);
    const text = JSON.stringify(entity);
    if (text === o.sent) return;
    o.sent = text;
    this.send(v, { t: "container", x: o.x, y: o.y, z: o.z, entity });
  }

  /**
   * A guest's action: done if they could do it from where they stand (dropping what a block drops in
   * survival, for the tool they held); put right on their side if not.
   */
  private act(v: Visitor, msg: Action & { held?: SavedStack | null }): void {
    const a: Action = { act: msg.act, x: msg.x | 0, y: msg.y | 0, z: msg.z | 0, nx: msg.nx | 0, ny: msg.ny | 0, nz: msg.nz | 0, hy: Number(msg.hy) || 0, block: msg.block | 0, yaw: Number(msg.yaw) || 0 };
    const p = v.state.position;
    const reach = Math.hypot(a.x + 0.5 - p.x, a.y + 0.5 - (p.y + EYE_HEIGHT), a.z + 0.5 - p.z) <= REACH + 1.5;
    const known = a.act !== "place" || PLACEABLE.includes(a.block);
    const unit = Math.abs(a.nx) + Math.abs(a.ny) + Math.abs(a.nz) === 1;
    const standing = [this.options.host(), ...this.standing()];
    const before = this.options.world.get(a.x, a.y, a.z);
    if (reach && known && unit && perform(this.options.world, a, standing)) {
      if (a.act === "break" && this.options.mode === "survival") this.options.drops.spill(a.x, a.y, a.z, dropsOf(before, loadStack(msg.held), Math.random));
      return;
    }
    // The guest already did it on their side: show them what is really there
    const changes: number[] = [];
    for (const [x, y, z] of touched(a)) changes.push(x, y, z, this.options.world.get(x, y, z));
    this.send(v, { t: "blocks", changes });
  }

  override update(dt: number): void {
    this.flushChanges();
    for (const v of this.visitors.values()) this.sendChunks(v);
    this.positionTimer += dt;
    if (this.positionTimer >= POSITIONS) {
      this.positionTimer = 0;
      const host = this.options.host();
      for (const v of this.visitors.values()) {
        const players: PlayerView[] = [host];
        for (const other of this.visitors.values()) {
          if (other === v) continue;
          const { position: p, yaw, pitch } = other.state;
          players.push({ id: other.id, name: other.name, x: p.x, y: p.y, z: p.z, yaw, pitch });
        }
        this.send(v, { t: "players", players });
        this.send(v, { t: "drops", drops: this.dropsNear(v) });
      }
    }
    for (const v of this.visitors.values()) if (v.open) this.sendContainer(v);
    this.clockTimer += dt;
    if (this.clockTimer >= CLOCK) {
      this.clockTimer = 0;
      for (const v of this.visitors.values()) this.send(v, { t: "time", time: this.options.ticks.time });
    }
  }

  /** The items lying within a guest's sight. */
  private dropsNear(v: Visitor): DropView[] {
    const out: DropView[] = [];
    const range = v.view * CHUNK_SIZE;
    const p = v.state.position;
    for (const d of this.options.drops.items.values()) {
      const q = d.position;
      if (Math.abs(q.x - p.x) > range || Math.abs(q.z - p.z) > range) continue;
      out.push([d.id, Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100, Math.round(q.z * 100) / 100, d.stack.item, d.stack.count]);
    }
    return out;
  }

  /** Sends the blocks that changed to the guests that have their chunks. */
  private flushChanges(): void {
    if (this.changes.length === 0) return;
    const world = this.options.world;
    for (const v of this.visitors.values()) {
      const out: number[] = [];
      for (let i = 0; i < this.changes.length; i += 3) {
        const x = this.changes[i];
        const y = this.changes[i + 1];
        const z = this.changes[i + 2];
        if (v.sent.has(VoxelWorld.key(x >> 4, z >> 4))) out.push(x, y, z, world.get(x, y, z));
      }
      if (out.length > 0) this.send(v, { t: "blocks", changes: out });
    }
    this.changes.length = 0;
    this.changedKeys.clear();
  }

  /** Sends a guest the nearest chunks around them they don't have, a few per frame. */
  private sendChunks(v: Visitor): void {
    if (v.conn.buffered > BACKLOG) return;
    const ccx = Math.floor(v.state.position.x / CHUNK_SIZE);
    const ccz = Math.floor(v.state.position.z / CHUNK_SIZE);
    let budget = CHUNKS_PER_FRAME;
    for (const [dx, dz] of this.ring(v.view)) {
      const key = VoxelWorld.key(ccx + dx, ccz + dz);
      if (v.sent.has(key)) continue;
      const chunk = this.options.world.chunk(ccx + dx, ccz + dz);
      if (!chunk) continue;
      // Taken now: changes from here on follow it through the outbox
      const snap = snapshotChunk(chunk, []);
      v.sent.add(key);
      const header: ToGuest = { t: "chunk", cx: chunk.cx, cz: chunk.cz, palette: snap.palette, biomes: snap.biomes, generator: snap.generator };
      const blocks = snap.compressed ? Promise.resolve(snap.compressed) : compress(snap.raw!);
      this.enqueue(v, blocks.then((b) => encode(header, b)));
      if (--budget === 0) return;
    }
  }

  /** Chunk offsets within a radius, nearest first. */
  private ring(radius: number): Array<[number, number]> {
    let list = this.offsets.get(radius);
    if (!list) {
      list = [];
      for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) if (dx * dx + dz * dz <= (radius + 0.5) ** 2) list.push([dx, dz]);
      list.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2));
      this.offsets.set(radius, list);
    }
    return list;
  }

  private send(v: Visitor, msg: ToGuest): void {
    this.enqueue(v, Promise.resolve(encode(msg)));
  }

  /** Sends a frame after everything before it, even one still being made. */
  private enqueue(v: Visitor, frame: Promise<Uint8Array>): void {
    v.outbox = v.outbox.then(async () => v.conn.send(await frame)).catch(() => {});
  }
}

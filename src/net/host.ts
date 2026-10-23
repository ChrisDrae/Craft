import { SimObject, type Vec3 } from "projector";
import { REACH, perform, touched, type Action } from "../actions.js";
import { FURNACE_OUTPUT, saveEntity, takeXp } from "../blockEntities.js";
import { BLOCKS, HOTBAR, PLACEABLE } from "../blocks.js";
import { CHUNK_SIZE } from "../chunk.js";
import type { Collector, Drops } from "../drops.js";
import { PLAYER_SLOTS } from "../inventory.js";
import { ITEMS, loadStack, saveStack, type SavedStack } from "../items.js";
import { dropsOf, xpOf } from "../mining.js";
import { EYE_HEIGHT } from "../player.js";
import type { GameMode, Position } from "../save/format.js";
import { compress, snapshotChunk } from "../save/codec.js";
import type { WorldTicks } from "../ticks.js";
import type { Mobs } from "../mobs/mobs.js";
import { DEATH_MESSAGES, FRESH_VITALS, Vitals, deathMessage, type DamageSource, type Difficulty } from "../vitals.js";
import { VoxelWorld } from "../world.js";
import type { Connection } from "./connection.js";
import { ORB, PROTOCOL_VERSION, REGISTRY, decode, encode, type DropView, type GuestState, type PlayerView, type ToGuest, type ToHost } from "./protocol.js";

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
  /** Lying in a bed. */
  asleep: boolean;
}

export interface HostOptions {
  world: VoxelWorld;
  ticks: WorldTicks;
  worldName: string;
  mode: GameMode;
  /** The difficulty now, and whether the world is hardcore. */
  difficulty: () => Difficulty;
  hardcore: boolean;
  /** The items lying about, which guests see, pick up and throw. */
  drops: Drops;
  /** The mobs, which guests see and fight. */
  mobs?: Mobs;
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
  /** Called with what everyone is told (a guest died), for the host's own screen. */
  onNotice?: (text: string) => void;
}

/** A position that came from a guest, if it is one. */
function position(p: unknown): Position | null {
  const q = p as Position | null;
  return q && finite(q.x, q.y, q.z) ? { x: Number(q.x), y: Number(q.y), z: Number(q.z) } : null;
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

  /** Whether every guest is asleep (the host's player must be too for the night to pass). */
  get allAsleep(): boolean {
    return [...this.visitors.values()].every((v) => v.asleep);
  }

  /** The guests as collectors of experience: orbs fly to them, and the points are sent. */
  collectors(): Collector[] {
    return [...this.visitors.values()]
      .filter((v) => !v.state.spectating)
      .map((v) => ({ position: v.state.position, take: (s) => s, xp: (points: number) => this.send(v, { t: "given", xp: points }) }));
  }

  /** Tells every guest something (and the host's screen). */
  announce(text: string): void {
    for (const v of this.visitors.values()) this.send(v, { t: "notice", text });
    this.options.onNotice?.(text);
  }

  /** Hurts a guest (a mob, an arrow, an explosion did): they take it on their side. */
  hurt(id: string, amount: number, source: DamageSource, by: string, push: { x: number; y: number; z: number }): void {
    const v = [...this.visitors.values()].find((g) => g.id === id);
    if (v) this.send(v, { t: "hurt", amount, source, by, push });
  }

  /** Tells the guests near an explosion (for its sound and smoke). */
  exploded(x: number, y: number, z: number, power: number): void {
    for (const v of this.visitors.values()) {
      const p = v.state.position;
      if (Math.hypot(p.x - x, p.z - z) < 64) this.send(v, { t: "explosion", x, y, z, power });
    }
  }

  /** Gives a guest an item (an arrow picked up). */
  give(id: string, item: SavedStack): boolean {
    const v = [...this.visitors.values()].find((g) => g.id === id);
    if (!v) return false;
    this.send(v, { t: "given", item });
    return true;
  }

  /** Tells the guests the difficulty changed. */
  rulesChanged(): void {
    for (const v of this.visitors.values()) this.send(v, { t: "rules", difficulty: this.options.difficulty() });
  }

  /** Morning: the guests wake, and get the time. */
  wake(): void {
    for (const v of this.visitors.values()) {
      v.asleep = false;
      this.send(v, { t: "wake" });
      this.send(v, { t: "time", time: this.options.ticks.time });
    }
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
    const state: GuestState = saved ?? {
      position: { x: spawn.x, y: spawn.y, z: spawn.z },
      yaw: 0,
      pitch: 0,
      selected: 0,
      inventory,
      vitals: { ...FRESH_VITALS },
      bed: null,
      spectating: false,
      flying: false,
    };
    const view = Math.max(2, Math.min(MAX_VIEW, Math.floor(Number(hello.view) || 6)));
    const visitor: Visitor = { id: hello.id, name, state, conn, view, sent: new Set(), outbox: Promise.resolve(), open: null, asleep: false };
    this.visitors.set(conn, visitor);
    const o = this.options;
    this.send(visitor, { t: "welcome", id: hello.id, world: o.worldName, time: o.ticks.time, mode: o.mode, difficulty: o.difficulty(), hardcore: o.hardcore, spawn: { x: spawn.x, y: spawn.y, z: spawn.z }, you: state });
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
      case "life": {
        const vitals = new Vitals();
        vitals.load(msg.vitals);
        Object.assign(v.state, { vitals: vitals.save(), bed: position(msg.bed), spectating: msg.spectating === true, flying: msg.flying === true });
        return;
      }
      case "died": {
        const cause = msg.cause in DEATH_MESSAGES ? (msg.cause as DamageSource) : null;
        const killer = typeof msg.killer === "string" ? msg.killer.slice(0, 24) : null;
        if (cause) this.announce(`${v.name} ${deathMessage(cause, killer)}`);
        const xp = Math.max(0, Math.min(100, Math.floor(Number(msg.xp) || 0)));
        const p = v.state.position;
        if (xp > 0) this.options.drops.spawnXp(p.x, p.y + 0.5, p.z, xp);
        return;
      }
      case "sleep":
        v.asleep = msg.asleep === true;
        return;
      case "attack": {
        // Only what they could reach, no harder than the best weapon with a critical hit
        const mob = this.options.mobs?.mobs.get(Number(msg.id));
        if (!mob || this.distance(v, { x: mob.position.x, y: mob.position.y + mob.height / 2 - 1, z: mob.position.z }) > 7) return;
        const damage = Math.max(0, Math.min(15, Number(msg.damage) || 0));
        const knockback = Math.max(0, Math.min(20, Number(msg.knockback) || 0));
        this.options.mobs!.strike(mob, damage, { id: v.id, position: v.state.position, targetable: true, held: null }, knockback);
        return;
      }
      case "shoot": {
        if (!finite(msg.x, msg.y, msg.z, msg.vx, msg.vy, msg.vz) || this.distance(v, msg) > 3 || Math.hypot(msg.vx, msg.vy, msg.vz) > 61) return;
        this.options.mobs?.shoot({ x: msg.x, y: msg.y, z: msg.z }, { x: msg.vx, y: msg.vy, z: msg.vz }, { player: v.id }, msg.crit === true, this.options.mode === "survival");
        return;
      }
      case "useMob": {
        const mob = this.options.mobs?.mobs.get(Number(msg.id));
        const held = loadStack(msg.held);
        if (mob && held && ITEMS[held.item].name === "shears" && this.distance(v, mob.position) < 7) this.options.mobs!.shear(mob);
        return;
      }
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
        const before = e.kind === "furnace" ? (e.items[FURNACE_OUTPUT]?.count ?? 0) : 0;
        for (const [i, s] of msg.slots) if (Number.isInteger(i) && i >= 0 && i < e.items.length) e.items[i] = loadStack(s);
        // Taking a furnace's output takes the experience it kept
        if (e.kind === "furnace" && (e.items[FURNACE_OUTPUT]?.count ?? 0) < before) {
          const xp = takeXp(e, Math.random);
          const p = v.state.position;
          if (xp > 0) this.options.drops.spawnXp(p.x, p.y + 1, p.z, xp);
        }
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
      if (a.act === "break" && this.options.mode === "survival") {
        const held = loadStack(msg.held);
        this.options.drops.spill(a.x, a.y, a.z, dropsOf(before, held, Math.random));
        const xp = xpOf(before, held, Math.random);
        if (xp > 0) this.options.drops.spawnXp(a.x + 0.5, a.y + 0.5, a.z + 0.5, xp);
      }
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
        const mobs = this.options.mobs;
        if (mobs) this.send(v, { t: "mobs", mobs: mobs.views(v.state.position.x, v.state.position.z, v.view * CHUNK_SIZE) });
      }
    }
    for (const v of this.visitors.values()) if (v.open) this.sendContainer(v);
    this.clockTimer += dt;
    if (this.clockTimer >= CLOCK) {
      this.clockTimer = 0;
      for (const v of this.visitors.values()) this.send(v, { t: "time", time: this.options.ticks.time });
    }
  }

  /** The items and orbs lying within a guest's sight. */
  private dropsNear(v: Visitor): DropView[] {
    const out: DropView[] = [];
    const range = v.view * CHUNK_SIZE;
    const p = v.state.position;
    const round = (n: number): number => Math.round(n * 100) / 100;
    const near = (q: Vec3): boolean => Math.abs(q.x - p.x) <= range && Math.abs(q.z - p.z) <= range;
    const drops = this.options.drops;
    for (const d of drops.items.values()) if (near(d.position)) out.push([d.id, round(d.position.x), round(d.position.y), round(d.position.z), d.stack.item, d.stack.count]);
    for (const o of drops.orbs.values()) if (near(o.position)) out.push([o.id, round(o.position.x), round(o.position.y), round(o.position.z), ORB, o.xp]);
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

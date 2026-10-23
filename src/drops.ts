import { SimObject, type Vec3 } from "projector";
import { CHUNK_SIZE } from "./chunk.js";
import { Entity } from "./entity.js";
import { ITEMS, loadStack, saveStack, stacksWith, type ItemStack, type SavedStack } from "./items.js";
import type { VoxelWorld } from "./world.js";

/** Items on the ground: how long they stay, how near they're picked up, how soon after they're dropped. */
const LIFETIME = 300;
const PICKUP_RANGE = 1.5;
const PICKUP_DELAY = 0.5;
/** Dropped items of the same kind this close together become one. */
const MERGE_RANGE = 0.6;
/** Experience orbs: how near a player draws them in, how near they are taken, and how fast they fly. */
const ORB_PULL = 8;
const ORB_TAKE = 1.25;
const ORB_SPEED = 12;
/** Orb sizes, as Minecraft splits experience into orbs: the largest that fits, again and again. */
const ORB_SIZES = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];
const GRAVITY = 16;
const MAX_FALL = 40;

/** An item lying (or flying) about: a small entity with a stack. */
export class DroppedItem extends Entity {
  stack: ItemStack;
  /** Seconds since it was dropped. */
  age: number = 0;
  /** Seconds until it can be picked up. */
  delay: number;
  readonly id: number;

  constructor(world: VoxelWorld, id: number, position: Vec3, stack: ItemStack, delay: number = PICKUP_DELAY) {
    super(world, position, 0.125, 0.25);
    this.id = id;
    this.stack = stack;
    this.delay = delay;
  }

  /** Falls, slides to a stop, and stays put where it lands. */
  step(dt: number): void {
    this.age += dt;
    this.delay = Math.max(0, this.delay - dt);
    if (!this.active) return;
    const v = this.velocity;
    v.y = Math.max(-MAX_FALL, v.y - GRAVITY * dt);
    // Friction on the ground, air drag otherwise
    const drag = Math.exp(-(this.onGround ? 10 : 1) * dt);
    v.x *= drag;
    v.z *= drag;
    this.move(dt);
  }
}

/** An orb of experience: drifts, then flies to a player near it, who takes its points. */
export class Orb extends Entity {
  readonly xp: number;
  readonly id: number;
  age: number = 0;

  constructor(world: VoxelWorld, id: number, position: Vec3, xp: number) {
    super(world, position, 0.125, 0.25);
    this.id = id;
    this.xp = xp;
  }

  /** Falls and slides like an item, or flies toward a point (a player's middle). */
  step(dt: number, toward: Vec3 | null): void {
    this.age += dt;
    if (!this.active) return;
    const v = this.velocity;
    if (toward) {
      const dx = toward.x - this.position.x;
      const dy = toward.y - this.position.y;
      const dz = toward.z - this.position.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const k = Math.min(1, 6 * dt);
      v.x += ((dx / d) * ORB_SPEED - v.x) * k;
      v.y += ((dy / d) * ORB_SPEED - v.y) * k;
      v.z += ((dz / d) * ORB_SPEED - v.z) * k;
    } else {
      v.y = Math.max(-MAX_FALL, v.y - GRAVITY * dt);
      const drag = Math.exp(-(this.onGround ? 10 : 1) * dt);
      v.x *= drag;
      v.z *= drag;
    }
    this.move(dt);
  }
}

/**
 * Someone who picks things up: where they stand, taking a stack (returns what didn't fit, or null), and
 * taking experience (players who can).
 */
export interface Collector {
  position: Vec3;
  take(stack: ItemStack): ItemStack | null;
  xp?(points: number): void;
}

/** A dropped item or an orb of experience as saves keep it. */
export interface SavedDrop {
  x: number;
  y: number;
  z: number;
  item?: SavedStack;
  xp?: number;
  age: number;
}

/**
 * The items dropped in the world: from broken blocks and chests, thrown out of the inventory. They fall,
 * merge with others of their kind nearby, are picked up by whoever comes close (after a moment, so a
 * thrown item isn't picked straight back up) and disappear after five minutes. Orbs of experience too,
 * which fly to a player near them. Runs where the world does (alone, or the host); a guest only sees them
 * (see the host's messages).
 */
export class Drops extends SimObject {
  readonly items: Map<number, DroppedItem> = new Map();
  readonly orbs: Map<number, Orb> = new Map();
  /** Who picks items up. */
  collectors: () => readonly Collector[] = () => [];
  private nextId: number = 1;
  private mergeTimer: number = 0;

  constructor(private readonly world: VoxelWorld) {
    super();
  }

  /** Drops a stack at a point, flying off a little (or with the velocity given: thrown). */
  spawn(x: number, y: number, z: number, stack: ItemStack, velocity: Vec3 | null = null, delay: number = PICKUP_DELAY): DroppedItem {
    const item = new DroppedItem(this.world, this.nextId++, { x, y, z }, { ...stack }, delay);
    const v = velocity ?? { x: (Math.random() - 0.5) * 2, y: 3, z: (Math.random() - 0.5) * 2 };
    Object.assign(item.velocity, v);
    this.items.set(item.id, item);
    return item;
  }

  /** Experience at a point, in orbs (the largest sizes that make it up), flying off a little. */
  spawnXp(x: number, y: number, z: number, points: number): void {
    let left = Math.floor(points);
    while (left > 0) {
      const size = ORB_SIZES.find((s) => s <= left)!;
      left -= size;
      const orb = new Orb(this.world, this.nextId++, { x, y, z }, size);
      Object.assign(orb.velocity, { x: (Math.random() - 0.5) * 3, y: 2 + Math.random() * 2, z: (Math.random() - 0.5) * 3 });
      this.orbs.set(orb.id, orb);
    }
  }

  /** Drops stacks out of a block, as breaking it or the chest it was does. */
  spill(x: number, y: number, z: number, stacks: readonly (ItemStack | null)[]): void {
    for (const s of stacks) if (s) this.spawn(x + 0.25 + Math.random() * 0.5, y + 0.25 + Math.random() * 0.5, z + 0.25 + Math.random() * 0.5, s);
  }

  override update(dt: number): void {
    if (this.sim?.paused) return;
    for (const item of this.items.values()) {
      item.step(dt);
      if (item.age > LIFETIME || item.position.y < -64) this.items.delete(item.id);
    }
    this.mergeTimer += dt;
    if (this.mergeTimer > 0.5) {
      this.mergeTimer = 0;
      this.merge();
    }
    const collectors = this.collectors();
    for (const c of collectors) this.collect(c);
    this.moveOrbs(dt, collectors);
  }

  /** Orbs fly to the nearest player that takes experience within reach, who takes them on arrival. */
  private moveOrbs(dt: number, collectors: readonly Collector[]): void {
    for (const orb of this.orbs.values()) {
      let nearest: Collector | null = null;
      let best = ORB_PULL;
      const p = orb.position;
      for (const c of collectors) {
        if (!c.xp) continue;
        const d = Math.hypot(c.position.x - p.x, c.position.y + 0.9 - p.y, c.position.z - p.z);
        if (d < best) {
          best = d;
          nearest = c;
        }
      }
      if (nearest && best < ORB_TAKE) {
        this.orbs.delete(orb.id);
        nearest.xp!(orb.xp);
        continue;
      }
      orb.step(dt, nearest ? { x: nearest.position.x, y: nearest.position.y + 0.9, z: nearest.position.z } : null);
      if (orb.age > LIFETIME || orb.position.y < -64) this.orbs.delete(orb.id);
    }
  }

  /** Hands an orb to a collector (a guest asking for it). Returns its points, or 0 if it's gone. */
  giveOrb(id: number, c: Collector): number {
    const orb = this.orbs.get(id);
    if (!orb || !c.xp) return 0;
    this.orbs.delete(id);
    c.xp(orb.xp);
    return orb.xp;
  }

  /** Items of a kind lying close together become one stack (as far as stacks go). */
  private merge(): void {
    const list = [...this.items.values()];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!this.items.has(a.id)) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!this.items.has(b.id) || !stacksWith(a.stack, b.stack)) continue;
        const p = a.position;
        const q = b.position;
        if (Math.abs(p.x - q.x) > MERGE_RANGE || Math.abs(p.y - q.y) > MERGE_RANGE || Math.abs(p.z - q.z) > MERGE_RANGE) continue;
        const room = ITEMS[a.stack.item].maxStack - a.stack.count;
        if (room <= 0) break;
        const n = Math.min(room, b.stack.count);
        a.stack = { ...a.stack, count: a.stack.count + n };
        a.age = Math.min(a.age, b.age);
        if (n === b.stack.count) this.items.delete(b.id);
        else b.stack = { ...b.stack, count: b.stack.count - n };
      }
    }
  }

  /** Gives a collector the items near them, as much as they can take. */
  private collect(c: Collector): void {
    const p = c.position;
    for (const item of this.items.values()) {
      if (item.delay > 0) continue;
      const q = item.position;
      if (Math.abs(q.x - p.x) > PICKUP_RANGE || Math.abs(q.z - p.z) > PICKUP_RANGE || q.y < p.y - 0.75 || q.y > p.y + 2.5) continue;
      this.give(item.id, c);
    }
  }

  /** Hands a dropped item to a collector; what they can't take stays on the ground. Returns what they got. */
  give(id: number, c: Collector, max: number = Infinity): ItemStack | null {
    const item = this.items.get(id);
    if (!item || item.delay > 0) return null;
    const offered = { ...item.stack, count: Math.min(item.stack.count, max) };
    const left = c.take(offered);
    const taken = offered.count - (left?.count ?? 0);
    if (taken <= 0) return null;
    if (taken === item.stack.count) this.items.delete(id);
    else item.stack = { ...item.stack, count: item.stack.count - taken };
    return { ...offered, count: taken };
  }

  /** The dropped items and orbs in a chunk, taken out (it is being unloaded) or not (saved). */
  inChunk(cx: number, cz: number, take: boolean): SavedDrop[] {
    const out: SavedDrop[] = [];
    const inside = (p: Vec3): boolean => Math.floor(p.x / CHUNK_SIZE) === cx && Math.floor(p.z / CHUNK_SIZE) === cz;
    for (const item of this.items.values()) {
      const p = item.position;
      if (!inside(p)) continue;
      out.push({ x: p.x, y: p.y, z: p.z, item: saveStack(item.stack)!, age: item.age });
      if (take) this.items.delete(item.id);
    }
    for (const orb of this.orbs.values()) {
      const p = orb.position;
      if (!inside(p)) continue;
      out.push({ x: p.x, y: p.y, z: p.z, xp: orb.xp, age: orb.age });
      if (take) this.orbs.delete(orb.id);
    }
    return out;
  }

  /** Puts saved items and orbs back (their chunk was read). */
  restore(saved: readonly SavedDrop[]): void {
    for (const d of saved) {
      const age = Math.max(0, Number(d.age) || 0);
      const xp = Math.floor(Number(d.xp) || 0);
      if (xp > 0) {
        const orb = new Orb(this.world, this.nextId++, { x: d.x, y: d.y, z: d.z }, xp);
        orb.age = age;
        this.orbs.set(orb.id, orb);
        continue;
      }
      const s = loadStack(d.item);
      if (!s) continue;
      const item = this.spawn(d.x, d.y, d.z, s, { x: 0, y: 0, z: 0 }, 0);
      item.age = age;
    }
  }
}

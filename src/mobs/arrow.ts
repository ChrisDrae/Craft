import type { Vec3 } from "projector";
import { raycastVoxels } from "../raycast.js";
import { COLLISION } from "../shapes.js";
import type { VoxelWorld } from "../world.js";

/** Blocks a second squared an arrow falls by, and its drag per tick (Minecraft's 0.05 and 0.99). */
const GRAVITY = 20;
const DRAG = 0.99;
/** Ticks a stuck arrow stays. */
const STUCK_LIFE = 1200;

/** What shot an arrow: a player (by id) or a mob (by id). */
export type Shooter = { player: string } | { mob: number };

/**
 * An arrow in flight or stuck in a block, as Minecraft's: it falls and slows, does damage by how fast it
 * goes (twice its blocks per tick), and stays a minute where it sticks; a player's arrow can be picked up
 * again from there.
 */
export class Arrow {
  readonly position: Vec3;
  readonly velocity: Vec3;
  /** Where it was at the last tick, for drawing between ticks. */
  readonly prev: Vec3;
  stuck: boolean = false;
  age: number = 0;
  /** Whether a player can take it back once stuck (shot by a player in survival). */
  pickup: boolean;

  constructor(
    readonly id: number,
    position: Vec3,
    velocity: Vec3,
    readonly shooter: Shooter,
    readonly crit: boolean,
    pickup: boolean,
  ) {
    this.position = { ...position };
    this.prev = { ...position };
    this.velocity = { ...velocity };
    this.pickup = pickup;
  }

  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z);
  }

  /** The damage it does on hitting now: twice its blocks per tick, rounded up, more when critical. */
  damage(random: () => number): number {
    const base = Math.ceil((this.speed / 20) * 2);
    return this.crit ? base + Math.floor(random() * (base / 2 + 2)) : base;
  }

  /** Its yaw and pitch along its flight, for drawing. */
  get yaw(): number {
    return Math.atan2(this.velocity.x, this.velocity.z);
  }

  get pitch(): number {
    return Math.atan2(this.velocity.y, Math.hypot(this.velocity.x, this.velocity.z));
  }

  /**
   * One tick of flight: falls and slows, and stops in the first block it meets. Returns the segment flown
   * (from, to) for hitting bodies, or null when it is stuck. `expired` when a stuck arrow's time is up.
   */
  step(world: VoxelWorld, dt: number): { from: Vec3; to: Vec3 } | null {
    this.age++;
    Object.assign(this.prev, this.position);
    if (this.stuck) return null;
    const v = this.velocity;
    const from = { ...this.position };
    const dx = v.x * dt;
    const dy = v.y * dt;
    const dz = v.z * dt;
    const len = Math.hypot(dx, dy, dz);
    if (len > 0) {
      const hit = raycastVoxels((x, y, z) => world.get(x, y, z), (s) => COLLISION[s], from.x, from.y, from.z, dx / len, dy / len, dz / len, len);
      if (hit) {
        // Stuck where it met the block
        this.position.x = from.x + (dx / len) * hit.distance;
        this.position.y = from.y + (dy / len) * hit.distance;
        this.position.z = from.z + (dz / len) * hit.distance;
        this.stuck = true;
        this.age = 0;
        return { from, to: { ...this.position } };
      }
    }
    this.position.x += dx;
    this.position.y += dy;
    this.position.z += dz;
    v.x *= DRAG;
    v.y = v.y * DRAG - GRAVITY * dt;
    v.z *= DRAG;
    return { from, to: { ...this.position } };
  }

  get expired(): boolean {
    return (this.stuck && this.age > STUCK_LIFE) || this.position.y < -64 || (!this.stuck && this.age > 600);
  }
}

/** Where a segment from `a` to `b` first enters a box (min, max), as a fraction of the way, or null. */
export function segmentHitsBox(a: Vec3, b: Vec3, min: Vec3, max: Vec3): number | null {
  let t0 = 0;
  let t1 = 1;
  for (const axis of ["x", "y", "z"] as const) {
    const d = b[axis] - a[axis];
    if (Math.abs(d) < 1e-9) {
      if (a[axis] < min[axis] || a[axis] > max[axis]) return null;
      continue;
    }
    let lo = (min[axis] - a[axis]) / d;
    let hi = (max[axis] - a[axis]) / d;
    if (lo > hi) [lo, hi] = [hi, lo];
    t0 = Math.max(t0, lo);
    t1 = Math.min(t1, hi);
    if (t0 > t1) return null;
  }
  return t0;
}

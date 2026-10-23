import type { Vec3 } from "projector";
import { FLUID } from "../blocks.js";
import { Entity } from "../entity.js";
import type { VoxelWorld } from "../world.js";
import { MOBS, type MobInfo, type MobKind } from "./kinds.js";
import type { PathNode } from "./path.js";

const GRAVITY = 32;
const MAX_FALL = 60;
const JUMP_SPEED = 8.4;
/** A chicken flaps: it falls no faster than this. */
const FLUTTER = 3;

/** Who a mob is after or running from: a player by id, at a place. */
export interface Target {
  id: string;
  position: Vec3;
}

/**
 * A mob: a body that moves through the world like the player's (falls, swims up in water, jumps up a
 * block when its way is blocked, a spider climbs), with health, burning, a walk to animate and what its
 * mind is on. Ticked at 20 a second by Mobs; drawn between ticks from where it was and is.
 */
export class Mob extends Entity {
  readonly id: number;
  readonly kind: MobKind;
  readonly info: MobInfo;
  health: number;
  /** Radians, as the player's: the body's way, and the head's (and its pitch, up positive). */
  yaw: number = 0;
  headYaw: number = 0;
  pitch: number = 0;
  /** Ticks alive; ticks of the red flash after a hit (10 down); ticks into dying (0 alive). */
  age: number = 0;
  hurt: number = 0;
  dying: number = 0;
  /** Ticks of the hit window (from 20; hits land again below 10), and the last hit's damage. */
  invulnerable: number = 0;
  lastHurt: number = 0;
  /** Ticks of burning left. */
  fire: number = 0;
  fallDistance: number = 0;
  /** The walk, for the legs: how far it has walked, and how fast it walks now (0-1). */
  limbSwing: number = 0;
  limbAmount: number = 0;
  /** Where it was at the last tick, for drawing between ticks. */
  readonly prev: Vec3;
  prevYaw: number = 0;
  // What its mind is on
  /** Where it means to go this tick (blocks a second along x and z), and whether to jump. */
  readonly want = { x: 0, z: 0, jump: false };
  path: PathNode[] = [];
  pathAge: number = 0;
  goal: PathNode | null = null;
  target: Target | null = null;
  /** Ticks left of running away after a hit, and from where. */
  panic: number = 0;
  panicFrom: Vec3 | null = null;
  /** Ticks until it may strike (or shoot) again. */
  cooldown: number = 0;
  /** A creeper's fuse (ticks lit, 30 explodes), and its swelling to draw. */
  fuse: number = 0;
  /** A sheep's wool: its color (COLORS index) and whether it was sheared. */
  color: number = 0;
  sheared: boolean = false;
  /** A chicken's ticks until it lays an egg. */
  eggTime: number = 6000;
  /** Ticks left in love (fed its food: it looks for a partner), until it may breed again, until a baby grows up. */
  love: number = 0;
  breedCooldown: number = 0;
  growUp: number = 0;
  /** The tick (age) a player last hit it: it leaves experience if killed within 5 seconds of that. */
  hitByPlayer: number = -1000;
  /** Ticks with no player near (monsters go away after a while), and a stuck counter for paths. */
  idle: number = 0;
  stuck: number = 0;
  /** Was blocked sideways at the last move (a spider climbs then). */
  blocked: boolean = false;
  inWater: boolean = false;
  inLava: boolean = false;
  /** A slime's size (1, 2 or 4; 1 for the rest): its box, health and hits grow with it. */
  readonly size: number;
  /** Ticks until a slime hops again. */
  jumpDelay: number = 0;

  constructor(world: VoxelWorld, id: number, kind: MobKind, position: Vec3, size: number = 1) {
    const info = MOBS[kind];
    super(world, position, (info.width * size) / 2, info.height * size);
    this.id = id;
    this.kind = kind;
    this.info = info;
    this.size = size;
    this.health = info.health * size * size;
    this.prev = { ...position };
  }

  get alive(): boolean {
    return this.dying === 0;
  }

  get baby(): boolean {
    return this.growUp > 0;
  }

  get eyeY(): number {
    return this.position.y + this.info.eyeHeight * this.size;
  }

  /** One tick of moving: toward what it wants, with gravity, water and walls. Returns the distance walked. */
  step(dt: number): number {
    Object.assign(this.prev, this.position);
    this.prevYaw = this.yaw;
    if (!this.active) return 0;
    const v = this.velocity;
    const fluid = this.fluidAt(0.4);
    this.inWater = fluid !== 0;
    this.inLava = fluid === 2;
    const grip = this.onGround || this.inWater ? 12 : 2;
    const k = Math.min(1, grip * dt);
    const slow = this.inWater ? 0.5 : 1;
    v.x += (this.want.x * slow - v.x) * k;
    v.z += (this.want.z * slow - v.z) * k;
    if (this.inWater) {
      // Swims up: mobs keep their heads above water
      v.y = Math.min(v.y + 20 * dt, 2.5);
    } else {
      v.y = Math.max(-MAX_FALL, v.y - GRAVITY * dt);
      if (this.kind === "chicken" && v.y < -FLUTTER) v.y = -FLUTTER;
    }
    if (this.want.jump && this.onGround) v.y = JUMP_SPEED;
    this.want.jump = false;
    // A spider climbs the wall it runs into
    if (this.kind === "spider" && this.blocked && (this.want.x !== 0 || this.want.z !== 0)) v.y = 4;
    const x = this.position.x;
    const y = this.position.y;
    const z = this.position.z;
    this.blocked = this.move(dt);
    // Into a wall on the ground: jump to get over it
    if (this.blocked && this.onGround && (this.want.x !== 0 || this.want.z !== 0)) this.want.jump = true;
    const walked = Math.hypot(this.position.x - x, this.position.z - z);
    if (this.inWater || this.onGround || this.kind === "chicken") this.fallDistance = 0;
    else if (y > this.position.y) this.fallDistance += y - this.position.y;
    this.limbAmount += (Math.min(1, (walked / dt) / 4) - this.limbAmount) * 0.4;
    this.limbSwing += walked * 2.5;
    return walked;
  }

  /** Turns toward a yaw, at most `max` radians. */
  turnTo(yaw: number, max: number = 0.5): void {
    let d = yaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += Math.max(-max, Math.min(max, d));
  }

  /** Looks at a point: the head turns (within a quarter turn of the body) and tilts. */
  lookAt(p: Vec3, eye: number = 1.5): void {
    const dx = p.x - this.position.x;
    const dz = p.z - this.position.z;
    const yaw = Math.atan2(dx, dz);
    let d = Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw));
    d = Math.max(-1.3, Math.min(1.3, d));
    this.headYaw = this.yaw + d;
    this.pitch = Math.atan2(p.y + eye - this.eyeY, Math.hypot(dx, dz));
  }

  /** Whether lava or fire is around it. */
  get inFire(): boolean {
    return this.inLava || FLUID[this.blockAt(0.05)] === 2;
  }
}

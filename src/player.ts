import type { Vec3 } from "projector";
import { DIR_X, DIR_Z, FLUID, SHAPE, SOLID } from "./blocks.js";
import { DEFAULT_KEYS, type KeyAction } from "./settings.js";
import { Entity } from "./entity.js";
import { fluidLevel, isFalling } from "./fluids.js";
import type { VoxelWorld } from "./world.js";

export const PLAYER_HALF_WIDTH = 0.3;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;
/** Sneaking, the eyes are this high (Minecraft's 1.27). */
export const SNEAK_EYE_HEIGHT = 1.27;
const GRAVITY = 28;
const JUMP_SPEED = 8.4;
const WALK_SPEED = 4.3;
const SPRINT_SPEED = 5.6;
const SWIM_SPEED = 2.2;
/** Holding Space in water rises toward this speed. */
const SWIM_UP_SPEED = 3.5;
/** Water slows vertical motion by this factor per second (exponential drag). */
const WATER_DRAG = 2;
/**
 * At the surface, pushing against the shore with Space held pushes the player up at this speed (like
 * Minecraft), enough to get out onto a bank one block above the water.
 */
const CLIMB_SPEED = 9;
const MAX_FALL_SPEED = 50;
/** Lava is thicker than water: slower to move in, harder to rise through. */
const LAVA_SPEED = 1.2;
const LAVA_DRAG = 5;
/** Climbing a ladder, and the fastest sliding down one. */
const LADDER_UP = 2.4;
const LADDER_DOWN = 2.5;
/** How hard flowing water pushes, in blocks per second squared. */
const CURRENT = 5;
/** How quickly the horizontal velocity follows the keys, per second (on the ground, in the air). */
const GROUND_GRIP = 14;
const AIR_GRIP = 3;
const MAX_PITCH = Math.PI / 2 - 0.01;
/** Flying (creative and spectators): across, up and down, and how quickly it follows the keys. */
const FLY_SPEED = 10.9;
const FLY_VERTICAL = 7.5;
const FLY_GRIP = 8;
/** Seconds between two presses of Space that make a double tap (flying on and off). */
const DOUBLE_TAP = 0.3;

/** What the player is asked to do: -1..1 along forward and right, and the held keys. */
export interface PlayerInput {
  forward: number;
  strafe: number;
  jump: boolean;
  sprint: boolean;
  /** Down while flying (Shift). */
  descend: boolean;
  sneak: boolean;
}

/** How far the player moved, by way of moving, since it was last taken (for hunger). */
export interface Exertion {
  sprinted: number;
  swum: number;
  jumps: number;
  sprintJumps: number;
}

/** Where a sleeping player lies: the bed's head, and the way the bed faces. */
export interface Bed {
  x: number;
  y: number;
  z: number;
  facing: string;
}

/**
 * The first-person player: an upright 0.6 x 1.8 entity walking on the voxel world. Mouse look turns it,
 * WASD moves it, Space jumps (and swims up), Shift sprints. Where it may fly (creative), a double tap of
 * Space takes off and lands, Space rises and Shift sinks; a spectator flies through blocks. Movement runs
 * in fixed physics steps and the camera follows its eyes (low on the pillow while asleep).
 */
export class Player extends Entity {
  /** Read every physics step; filled from the keyboard each frame (set directly when there is none). */
  readonly input: PlayerInput = { forward: 0, strafe: 0, jump: false, sprint: false, descend: false, sneak: false };
  /** The keys for moving (the settings'). */
  keys: Readonly<Record<KeyAction, string>> = DEFAULT_KEYS;
  /** How high the eyes are over the feet now (lower sneaking). */
  eyeHeight: number = EYE_HEIGHT;
  /** Radians; yaw 0 looks along +z and grows to the right, pitch grows looking up. */
  yaw: number = 0;
  pitch: number = 0;
  /** In water or lava over the knees. */
  inWater: boolean = false;
  inLava: boolean = false;
  /** In a ladder's block. */
  onLadder: boolean = false;
  eyeInWater: boolean = false;
  /** Keys move the player only while this is set (the pointer is locked). */
  controls: boolean = false;
  /** Radians per pixel of mouse movement. */
  sensitivity: number = 0.0025;
  /** Whether it may fly (creative), flies now, and goes through blocks (a spectator). */
  mayFly: boolean = false;
  flying: boolean = false;
  noClip: boolean = false;
  /** Sprinting is allowed (not when too hungry). */
  maySprint: boolean = true;
  /** Blocks fallen since last on the ground (or in water, or on a ladder). */
  fallDistance: number = 0;
  /** Called on landing after a fall, with its height and the block landed on. */
  onLand: ((distance: number, below: number) => void) | null = null;
  /** The bed slept in, or null. */
  asleep: Bed | null = null;
  /** Movement since taken (takeExertion). */
  private exertion: Exertion = { sprinted: 0, swum: 0, jumps: 0, sprintJumps: 0 };
  private pushingWall: boolean = false;
  private spaceWasDown: boolean = false;
  private lastSpace: number = -1;
  private clock: number = 0;

  constructor(world: VoxelWorld, spawn: Vec3) {
    super(world, spawn, PLAYER_HALF_WIDTH, PLAYER_HEIGHT);
  }

  get eyeY(): number {
    return this.position.y + this.eyeHeight;
  }

  /** Sneaking: on foot, holding the sneak key. */
  get sneaking(): boolean {
    return this.input.sneak && !this.flying && !this.noClip;
  }

  look(dx: number, dy: number): void {
    this.yaw += dx * this.sensitivity;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - dy * this.sensitivity));
  }

  /** Whether it sprints now: holding Shift, moving forward on foot, not too hungry. */
  get sprinting(): boolean {
    return this.input.sprint && this.input.forward > 0 && this.maySprint && !this.flying && !this.inWater;
  }

  /** The movement since the last call, for hunger. */
  takeExertion(): Exertion {
    const e = this.exertion;
    this.exertion = { sprinted: 0, swum: 0, jumps: 0, sprintJumps: 0 };
    return e;
  }

  override update(dt: number): void {
    this.clock += dt;
    const kb = this.sim?.keyboard;
    // Without a keyboard (headless) the input is set directly
    if (!kb) return;
    const i = this.input;
    const on = this.controls && !this.asleep;
    const k = this.keys;
    i.forward = on ? kb.axis(k.back, k.forward) : 0;
    i.strafe = on ? kb.axis(k.left, k.right) : 0;
    i.jump = on && kb.isDown(k.jump);
    i.sprint = on && kb.isDown(k.sprint);
    i.sneak = on && kb.isDown(k.sneak);
    i.descend = i.sprint || i.sneak;
    this.tapSpace(i.jump);
    // The eyes lower smoothly when sneaking
    const eye = this.sneaking ? SNEAK_EYE_HEIGHT : EYE_HEIGHT;
    this.eyeHeight += (eye - this.eyeHeight) * Math.min(1, dt * 12);
  }

  /** A double tap of Space starts or stops flying, where flying is allowed. */
  tapSpace(down: boolean): void {
    if (down && !this.spaceWasDown) {
      if (this.mayFly && !this.noClip && this.clock - this.lastSpace < DOUBLE_TAP) {
        this.flying = !this.flying;
        this.lastSpace = -1;
      } else {
        this.lastSpace = this.clock;
      }
    }
    this.spaceWasDown = down;
  }

  override fixedUpdate(dt: number): void {
    if (this.asleep) {
      this.velocity.x = this.velocity.y = this.velocity.z = 0;
      this.fallDistance = 0;
      return;
    }
    if (!this.active && !this.noClip) return;
    if (this.flying || this.noClip) {
      this.fly(dt);
      return;
    }
    const vel = this.velocity;
    const { forward: forwardInput, strafe: strafeInput, jump } = this.input;
    const sprint = this.sprinting;

    // Swimming once the water (or lava) reaches above the knees; wading while the feet are in it at all
    const fluid = this.fluidAt(0.4);
    this.inWater = fluid !== 0;
    this.inLava = fluid === 2;
    const wading = this.inWater || this.fluidAt(0.05) !== 0;
    const headOut = this.fluidAt(EYE_HEIGHT) === 0;
    const climbable = (s: number): boolean => SHAPE[s] === "ladder" || SHAPE[s] === "vine";
    this.onLadder = climbable(this.blockAt(0.1)) || climbable(this.blockAt(1));

    // Forward is (sin yaw, cos yaw) and right is (cos yaw, -sin yaw) on the ground plane
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let wx = sin * forwardInput + cos * strafeInput;
    let wz = cos * forwardInput - sin * strafeInput;
    const len = Math.hypot(wx, wz);
    if (len > 0) {
      wx /= len;
      wz /= len;
    }
    const speed = this.inLava ? LAVA_SPEED : this.inWater ? SWIM_SPEED : sprint ? SPRINT_SPEED : this.sneaking ? WALK_SPEED * 0.3 : WALK_SPEED;
    const grip = this.onGround || this.inWater ? GROUND_GRIP : AIR_GRIP;
    const k = Math.min(1, grip * dt);
    vel.x += (wx * speed - vel.x) * k;
    vel.z += (wz * speed - vel.z) * k;

    if (this.inWater) {
      // Sink slowly; Space swims up (without braking a faster jump or climb)
      vel.y -= GRAVITY * 0.3 * dt;
      vel.y *= Math.exp(-(this.inLava ? LAVA_DRAG : WATER_DRAG) * dt);
      const up = this.inLava ? SWIM_UP_SPEED / 2 : SWIM_UP_SPEED;
      if (jump && vel.y < up) vel.y = Math.min(vel.y + 20 * dt, up);
      this.drift(dt);
    } else {
      vel.y -= GRAVITY * dt;
    }
    // On a ladder: up while pushing into it or holding Space, holding on while sneaking, slowly down otherwise
    if (this.onLadder) {
      if (jump || this.pushingWall) vel.y = LADDER_UP;
      else if (this.sneaking) vel.y = Math.max(vel.y, 0);
      else vel.y = Math.max(vel.y, -LADDER_DOWN);
    }
    // Sneaking on the ground: no stepping off an edge
    if (this.sneaking && this.onGround && !this.inWater) {
      if (!this.standsAt(this.position.x + vel.x * dt, this.position.z)) vel.x = 0;
      if (!this.standsAt(this.position.x, this.position.z + vel.z * dt)) vel.z = 0;
    }
    // Jumping works from any ground, the bottom of shallow water too
    if (jump && this.onGround) {
      vel.y = JUMP_SPEED;
      if (!this.inWater) this.exertion[sprint ? "sprintJumps" : "jumps"]++;
    }
    // At the surface against the shore, Space pushes up over the edge while the feet are still wet
    if (jump && wading && headOut && this.pushingWall) vel.y = Math.max(vel.y, CLIMB_SPEED);
    if (vel.y < -MAX_FALL_SPEED) vel.y = -MAX_FALL_SPEED;

    const before = { x: this.position.x, y: this.position.y, z: this.position.z };
    this.pushingWall = this.move(dt) && len > 0;
    const moved = Math.hypot(this.position.x - before.x, this.position.z - before.z);
    if (this.inWater) this.exertion.swum += Math.hypot(moved, this.position.y - before.y);
    else if (sprint) this.exertion.sprinted += moved;
    this.fall(before.y - this.position.y);
  }

  /** Whether the player would have ground under some part of their feet at (x, z). */
  private standsAt(x: number, z: number): boolean {
    const w = this.halfWidth;
    const y = Math.floor(this.position.y - 0.6);
    for (const [dx, dz] of [
      [-w, -w],
      [w, -w],
      [-w, w],
      [w, w],
    ]) {
      for (let yy = Math.floor(this.position.y - 0.01); yy >= y; yy--) if (SOLID[this.world.get(Math.floor(x + dx), yy, Math.floor(z + dz))]) return true;
    }
    return false;
  }

  /** Counts a fall's height, and lands it: water and ladders catch the player. */
  private fall(dropped: number): void {
    if (this.inWater || this.onLadder || this.fluidAt(0.05) === 1) {
      this.fallDistance = 0;
    } else if (this.onGround) {
      if (this.fallDistance > 0) this.onLand?.(this.fallDistance, this.blockAt(-0.01));
      this.fallDistance = 0;
    } else if (dropped > 0) {
      this.fallDistance += dropped;
    }
  }

  /** Flying: no gravity, Space up and Shift down; touching the ground lands (spectators go through it). */
  private fly(dt: number): void {
    const vel = this.velocity;
    const { forward, strafe, jump, descend } = this.input;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let wx = sin * forward + cos * strafe;
    let wz = cos * forward - sin * strafe;
    const len = Math.hypot(wx, wz);
    if (len > 0) {
      wx /= len;
      wz /= len;
    }
    const k = Math.min(1, FLY_GRIP * dt);
    vel.x += (wx * FLY_SPEED - vel.x) * k;
    vel.z += (wz * FLY_SPEED - vel.z) * k;
    vel.y += (((jump ? 1 : 0) - (descend ? 1 : 0)) * FLY_VERTICAL - vel.y) * k;
    this.fallDistance = 0;
    if (this.noClip) {
      this.position.x += vel.x * dt;
      this.position.y += vel.y * dt;
      this.position.z += vel.z * dt;
      this.onGround = false;
      return;
    }
    this.move(dt);
    if (this.onGround) this.flying = false;
  }

  override sync(): void {
    const camera = this.sim?.camera;
    if (!camera) return;
    const bed = this.asleep;
    if (bed) {
      // Lying with the head on the pillow, looking up past the foot of the bed
      camera.position.x = bed.x + 0.5;
      camera.position.y = bed.y + 0.75;
      camera.position.z = bed.z + 0.5;
      const toFoot: Record<string, number> = { north: 0, south: Math.PI, east: -Math.PI / 2, west: Math.PI / 2 };
      camera.setYawPitch(toFoot[bed.facing] ?? 0, 0.5);
      this.eyeInWater = false;
      return;
    }
    camera.position.x = this.position.x;
    camera.position.y = this.eyeY;
    camera.position.z = this.position.z;
    camera.setYawPitch(this.yaw, this.pitch);
    this.eyeInWater = this.fluidAt(EYE_HEIGHT) !== 0;
  }

  /** Flowing water pushes downstream: toward neighbors whose surface is lower. */
  private drift(dt: number): void {
    const state = this.blockAt(0.4);
    if (FLUID[state] !== 1) return;
    const own = isFalling(state) ? 0 : fluidLevel(state);
    const p = this.position;
    const y = Math.floor(p.y + 0.4);
    let fx = 0;
    let fz = 0;
    for (const d of [0, 1, 4, 5]) {
      const n = this.world.get(Math.floor(p.x) + DIR_X[d], y, Math.floor(p.z) + DIR_Z[d]);
      if (FLUID[n] !== 1 || isFalling(n)) continue;
      const diff = fluidLevel(n) - own;
      fx += DIR_X[d] * diff;
      fz += DIR_Z[d] * diff;
    }
    const len = Math.hypot(fx, fz);
    if (len === 0) return;
    this.velocity.x += (fx / len) * CURRENT * dt;
    this.velocity.z += (fz / len) * CURRENT * dt;
  }
}

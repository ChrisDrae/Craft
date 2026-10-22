import type { Vec3 } from "projector";
import { DIR_X, DIR_Z, FLUID, SHAPE } from "./blocks.js";
import { Entity } from "./entity.js";
import { fluidLevel, isFalling } from "./fluids.js";
import type { VoxelWorld } from "./world.js";

export const PLAYER_HALF_WIDTH = 0.3;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;
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

/** What the player is asked to do: -1..1 along forward and right, and the held keys. */
export interface PlayerInput {
  forward: number;
  strafe: number;
  jump: boolean;
  sprint: boolean;
}

/**
 * The first-person player: an upright 0.6 x 1.8 entity walking on the voxel world. Mouse look turns it,
 * WASD moves it, Space jumps (and swims up), Shift sprints. Movement runs in fixed physics steps and
 * the camera follows its eyes.
 */
export class Player extends Entity {
  /** Read every physics step; filled from the keyboard each frame (set directly when there is none). */
  readonly input: PlayerInput = { forward: 0, strafe: 0, jump: false, sprint: false };
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
  private pushingWall: boolean = false;

  constructor(world: VoxelWorld, spawn: Vec3) {
    super(world, spawn, PLAYER_HALF_WIDTH, PLAYER_HEIGHT);
  }

  get eyeY(): number {
    return this.position.y + EYE_HEIGHT;
  }

  look(dx: number, dy: number): void {
    this.yaw += dx * this.sensitivity;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - dy * this.sensitivity));
  }

  override update(): void {
    const kb = this.sim?.keyboard;
    // Without a keyboard (headless) the input is set directly
    if (!kb) return;
    const i = this.input;
    const on = this.controls;
    i.forward = on ? kb.axis("KeyS", "KeyW") : 0;
    i.strafe = on ? kb.axis("KeyA", "KeyD") : 0;
    i.jump = on && kb.isDown("Space");
    i.sprint = on && (kb.isDown("ShiftLeft") || kb.isDown("ShiftRight"));
  }

  override fixedUpdate(dt: number): void {
    if (!this.active) return;
    const vel = this.velocity;
    const { forward: forwardInput, strafe: strafeInput, jump, sprint } = this.input;

    // Swimming once the water (or lava) reaches above the knees; wading while the feet are in it at all
    const fluid = this.fluidAt(0.4);
    this.inWater = fluid !== 0;
    this.inLava = fluid === 2;
    const wading = this.inWater || this.fluidAt(0.05) !== 0;
    const headOut = this.fluidAt(EYE_HEIGHT) === 0;
    this.onLadder = SHAPE[this.blockAt(0.1)] === "ladder" || SHAPE[this.blockAt(1)] === "ladder";

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
    const speed = this.inLava ? LAVA_SPEED : this.inWater ? SWIM_SPEED : sprint && forwardInput > 0 ? SPRINT_SPEED : WALK_SPEED;
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
    // On a ladder: up while pushing into it or holding Space, slowly down otherwise
    if (this.onLadder) {
      if (jump || this.pushingWall) vel.y = LADDER_UP;
      else vel.y = Math.max(vel.y, -LADDER_DOWN);
    }
    // Jumping works from any ground, the bottom of shallow water too
    if (jump && this.onGround) vel.y = JUMP_SPEED;
    // At the surface against the shore, Space pushes up over the edge while the feet are still wet
    if (jump && wading && headOut && this.pushingWall) vel.y = Math.max(vel.y, CLIMB_SPEED);
    if (vel.y < -MAX_FALL_SPEED) vel.y = -MAX_FALL_SPEED;

    this.pushingWall = this.move(dt) && len > 0;
  }

  override sync(): void {
    const camera = this.sim?.camera;
    if (!camera) return;
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

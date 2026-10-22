import { SimObject, type Vec3 } from "projector";
import { Block } from "./blocks.js";
import { moveAxis } from "./collision.js";
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
 * The first-person player: an upright 0.6 x 1.8 box walking on the voxel world. Mouse look turns it,
 * WASD moves it, Space jumps (and swims up), Shift sprints. Movement runs in fixed physics steps and
 * the camera follows its eyes.
 */
export class Player extends SimObject {
  /** Feet, at the center of the box's bottom. */
  readonly position: Vec3;
  readonly velocity: Vec3 = { x: 0, y: 0, z: 0 };
  /** Read every physics step; filled from the keyboard each frame (set directly when there is none). */
  readonly input: PlayerInput = { forward: 0, strafe: 0, jump: false, sprint: false };
  /** Radians; yaw 0 looks along +z and grows to the right, pitch grows looking up. */
  yaw: number = 0;
  pitch: number = 0;
  onGround: boolean = false;
  inWater: boolean = false;
  eyeInWater: boolean = false;
  /** Keys move the player only while this is set (the pointer is locked). */
  controls: boolean = false;
  /** Radians per pixel of mouse movement. */
  sensitivity: number = 0.0025;
  private readonly world: VoxelWorld;
  private pushingWall: boolean = false;

  constructor(world: VoxelWorld, spawn: Vec3) {
    super();
    this.world = world;
    this.position = { x: spawn.x, y: spawn.y, z: spawn.z };
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
    const p = this.position;
    const vel = this.velocity;
    const { forward: forwardInput, strafe: strafeInput, jump, sprint } = this.input;

    const w = this.world;
    const bx = Math.floor(p.x);
    const bz = Math.floor(p.z);
    // Swimming once the water reaches above the knees; wading while the feet are in it at all
    this.inWater = w.get(bx, Math.floor(p.y + 0.4), bz) === Block.Water;
    const wading = this.inWater || w.get(bx, Math.floor(p.y + 0.05), bz) === Block.Water;
    const headOut = w.get(bx, Math.floor(p.y + EYE_HEIGHT), bz) !== Block.Water;

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
    const speed = this.inWater ? SWIM_SPEED : sprint && forwardInput > 0 ? SPRINT_SPEED : WALK_SPEED;
    const grip = this.onGround || this.inWater ? GROUND_GRIP : AIR_GRIP;
    const k = Math.min(1, grip * dt);
    vel.x += (wx * speed - vel.x) * k;
    vel.z += (wz * speed - vel.z) * k;

    if (this.inWater) {
      // Sink slowly; Space swims up (without braking a faster jump or climb)
      vel.y -= GRAVITY * 0.3 * dt;
      vel.y *= Math.exp(-WATER_DRAG * dt);
      if (jump && vel.y < SWIM_UP_SPEED) vel.y = Math.min(vel.y + 20 * dt, SWIM_UP_SPEED);
    } else {
      vel.y -= GRAVITY * dt;
    }
    // Jumping works from any ground, the bottom of shallow water too
    if (jump && this.onGround) vel.y = JUMP_SPEED;
    // At the surface against the shore, Space pushes up over the edge while the feet are still wet
    if (jump && wading && headOut && this.pushingWall) vel.y = Math.max(vel.y, CLIMB_SPEED);
    if (vel.y < -MAX_FALL_SPEED) vel.y = -MAX_FALL_SPEED;

    const hitX = moveAxis(w, p, PLAYER_HALF_WIDTH, PLAYER_HEIGHT, 0, vel.x * dt);
    if (hitX) vel.x = 0;
    const hitZ = moveAxis(w, p, PLAYER_HALF_WIDTH, PLAYER_HEIGHT, 2, vel.z * dt);
    if (hitZ) vel.z = 0;
    this.pushingWall = (hitX || hitZ) && len > 0;
    const falling = vel.y < 0;
    this.onGround = false;
    // Gravity pulls every step, so standing still on the ground is a hit every step too
    if (moveAxis(w, p, PLAYER_HALF_WIDTH, PLAYER_HEIGHT, 1, vel.y * dt)) {
      if (falling) this.onGround = true;
      vel.y = 0;
    }
  }

  override sync(): void {
    const camera = this.sim?.camera;
    if (!camera) return;
    camera.position.x = this.position.x;
    camera.position.y = this.eyeY;
    camera.position.z = this.position.z;
    camera.setYawPitch(this.yaw, this.pitch);
    this.eyeInWater = this.world.get(Math.floor(this.position.x), Math.floor(this.eyeY), Math.floor(this.position.z)) === Block.Water;
  }
}

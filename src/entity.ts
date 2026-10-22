import { SimObject, type Vec3 } from "projector";
import { FLUID } from "./blocks.js";
import { moveAxis } from "./collision.js";
import type { VoxelWorld } from "./world.js";

/**
 * Something that moves through the voxel world as an upright box: the player, and later dropped items,
 * falling blocks and mobs. It is centered on `position` in x and z, `halfWidth` to each side, and reaches
 * from `position.y` (its feet) up to `position.y + height`.
 */
export class Entity extends SimObject {
  readonly position: Vec3;
  readonly velocity: Vec3 = { x: 0, y: 0, z: 0 };
  readonly halfWidth: number;
  readonly height: number;
  onGround: boolean = false;
  protected readonly world: VoxelWorld;

  constructor(world: VoxelWorld, position: Vec3, halfWidth: number, height: number) {
    super();
    this.world = world;
    this.position = { x: position.x, y: position.y, z: position.z };
    this.halfWidth = halfWidth;
    this.height = height;
  }

  /** Whether the chunk under the entity is loaded. Until it is, its ground may be missing, so it waits. */
  get active(): boolean {
    return this.world.isLoaded(this.position.x, this.position.z);
  }

  /** The block at a height above the feet. */
  blockAt(dy: number): number {
    const p = this.position;
    return this.world.get(Math.floor(p.x), Math.floor(p.y + dy), Math.floor(p.z));
  }

  /** The fluid at a height above the feet: 0 none, 1 water, 2 lava. */
  fluidAt(dy: number): number {
    return FLUID[this.blockAt(dy)];
  }

  /**
   * Moves by velocity * dt, x and z first, then y, stopping at block shapes; zeroes the velocity along the
   * axes that hit and sets onGround. Returns whether a horizontal axis hit.
   */
  protected move(dt: number): boolean {
    const w = this.world;
    const p = this.position;
    const vel = this.velocity;
    const hitX = moveAxis(w, p, this.halfWidth, this.height, 0, vel.x * dt);
    if (hitX) vel.x = 0;
    const hitZ = moveAxis(w, p, this.halfWidth, this.height, 2, vel.z * dt);
    if (hitZ) vel.z = 0;
    const falling = vel.y < 0;
    this.onGround = false;
    // Gravity pulls every step, so standing still on the ground is a hit every step too
    if (moveAxis(w, p, this.halfWidth, this.height, 1, vel.y * dt)) {
      if (falling) this.onGround = true;
      vel.y = 0;
    }
    return hitX || hitZ;
  }
}

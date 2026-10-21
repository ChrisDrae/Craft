import { SimObject, type Scene, type Vec3 } from "projector";
import { CHUNK_SIZE } from "./chunk.js";
import { VoxelNode } from "./voxelNode.js";
import type { VoxelWorld } from "./world.js";

/** The voxel world in the simulation: generates chunks around a point as it moves and draws them. */
export class Terrain extends SimObject {
  readonly world: VoxelWorld;
  readonly node: VoxelNode;
  /** Chunks generated per frame at most, so walking into new land doesn't stall a frame. */
  budget: number = 2;
  private readonly focus: Vec3;

  /** `focus` is read every frame, e.g. the player's position. */
  constructor(world: VoxelWorld, scene: Scene, focus: Vec3) {
    super();
    this.world = world;
    this.focus = focus;
    this.node = this.addNode(new VoxelNode(world, scene));
  }

  /** Chunks kept loaded around the focus: the render distance plus one. */
  get radius(): number {
    return Math.ceil(this.node.renderDistance / CHUNK_SIZE) + 1;
  }

  /** Generates everything within the radius at once (before the first frame). */
  loadAll(): void {
    this.world.loadAround(this.focus.x, this.focus.z, this.radius, Infinity);
  }

  override update(): void {
    this.world.loadAround(this.focus.x, this.focus.z, this.radius, this.budget);
  }
}

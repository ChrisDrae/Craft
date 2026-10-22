import { LineSet, Material, MeshNode, SimObject, Transform, type Mesh, type Scene, type Texture, type Vec3 } from "projector";
import { CHUNK_SIZE, FACE_CORNERS as CORNERS, type Chunk } from "./chunk.js";
import { buildChunkMeshes, type FaceUVs } from "./chunkMesh.js";
import type { VoxelHit } from "./raycast.js";
import { VoxelNode } from "./voxelNode.js";
import type { VoxelWorld } from "./world.js";

/** Block textures for the meshed renderer: the atlas and each block face's place in it. */
export interface TerrainTextures {
  texture: Texture;
  uvs: FaceUVs;
}

/** The scene nodes of one chunk, while it is near enough to be drawn. */
interface ChunkNodes {
  solid: MeshNode | null;
  water: MeshNode | null;
  /** The meshes need building: new, or the chunk's faces changed. */
  stale: boolean;
}

/** How far outside the render distance chunk meshes are kept, in chunks, so turning back is free. */
const KEEP_MARGIN = 2;

/**
 * The voxel world in the simulation: generates chunks around a point as it moves and draws them, in one
 * of two ways. Without textures, one VoxelNode emits flat-colored faces into the software pipeline (for
 * Canvas 2D). With textures, every chunk is a textured mesh of its own, solid and water apart (for WebGL,
 * whose depth buffer needs no sorting).
 */
export class Terrain extends SimObject {
  readonly world: VoxelWorld;
  /** Chunks generated per frame at most, so walking into new land doesn't stall a frame. */
  budget: number = 2;
  /** Chunk meshes built per frame at most, nearest first, so the chunk being edited updates at once. */
  meshBudget: number = 4;
  /** Faces farther than this (in blocks) are not drawn. */
  renderDistance: number = 48;
  /** The flat-colored renderer, or null when chunks are meshes. */
  readonly node: VoxelNode | null;
  private readonly scene: Scene;
  private readonly focus: Vec3;
  private readonly textures: TerrainTextures | null;
  private readonly solidMaterial: Material | null;
  private readonly waterMaterial: Material | null;
  private readonly chunkNodes: Map<Chunk, ChunkNodes> = new Map();
  private readonly outline: LineSet | null;
  private readonly building: Chunk[] = [];
  private targetBlock: VoxelHit | null = null;

  /** `focus` is read every frame, e.g. the player's position. */
  constructor(world: VoxelWorld, scene: Scene, focus: Vec3, textures: TerrainTextures | null = null) {
    super();
    this.world = world;
    this.scene = scene;
    this.focus = focus;
    this.textures = textures;
    if (textures) {
      // Leaves get see-through holes, so they can't hide what is behind them
      world.fancyLeaves = true;
      this.node = null;
      const map = textures.texture;
      this.solidMaterial = new Material({ color: "#ffffff", shading: "flat", map, alphaTest: 0.5 });
      this.waterMaterial = new Material({ color: "#ffffff", shading: "flat", map, opacity: 0.7, side: "double" });
      this.outline = this.addNode(new LineSet(12, { color: "#141414", opacity: 0.85 }), false);
      this.outline.visible = false;
    } else {
      this.node = this.addNode(new VoxelNode(world, scene));
      this.solidMaterial = null;
      this.waterMaterial = null;
      this.outline = null;
    }
  }

  /** The block to outline, if any. */
  get target(): VoxelHit | null {
    return this.targetBlock;
  }

  set target(t: VoxelHit | null) {
    this.targetBlock = t;
    if (this.node) this.node.target = t;
    if (this.outline) {
      this.outline.visible = t !== null;
      if (t) outlineBlock(this.outline, t);
    }
  }

  /** Chunks kept loaded around the focus: the render distance plus one. */
  get radius(): number {
    return Math.ceil(this.renderDistance / CHUNK_SIZE) + 1;
  }

  /** Generates everything within the radius at once (before the first frame). */
  loadAll(): void {
    this.world.loadAround(this.focus.x, this.focus.z, this.radius, Infinity);
  }

  override update(): void {
    this.world.loadAround(this.focus.x, this.focus.z, this.radius, this.budget);
  }

  /** After everything that edits blocks this frame: bring the chunk meshes up to date. */
  override sync(): void {
    if (this.node) {
      this.node.renderDistance = this.renderDistance;
      return;
    }
    this.updateMeshes();
  }

  /**
   * Shows the meshes of chunks within the render distance and rebuilds those whose faces changed, nearest
   * first and at most meshBudget per frame. Meshes of chunks left well behind are dropped.
   */
  private updateMeshes(): void {
    const fog = this.scene.fog;
    const range = fog ? Math.min(this.renderDistance, fog.far) : this.renderDistance;
    const keep = range + KEEP_MARGIN * CHUNK_SIZE;
    const fx = this.focus.x;
    const fz = this.focus.z;
    const half = CHUNK_SIZE / 2;
    const building = this.building;
    building.length = 0;

    for (const chunk of this.world.chunks.values()) {
      // Distance from the focus to the nearest point of the chunk's column
      const gx = Math.max(Math.abs(chunk.cx * CHUNK_SIZE + half - fx) - half, 0);
      const gz = Math.max(Math.abs(chunk.cz * CHUNK_SIZE + half - fz) - half, 0);
      const gap = Math.hypot(gx, gz);
      let nodes = this.chunkNodes.get(chunk);
      if (gap > keep) {
        if (nodes) this.dropNodes(chunk, nodes);
        continue;
      }
      const visible = gap <= range;
      if (!nodes) {
        if (!visible) continue;
        nodes = { solid: null, water: null, stale: true };
        this.chunkNodes.set(chunk, nodes);
      }
      if (chunk.dirty) nodes.stale = true;
      if (nodes.stale && visible) building.push(chunk);
      if (nodes.solid) nodes.solid.visible = visible;
      if (nodes.water) nodes.water.visible = visible;
    }

    if (building.length > this.meshBudget) {
      const distance = (c: Chunk): number => (c.cx * CHUNK_SIZE + half - fx) ** 2 + (c.cz * CHUNK_SIZE + half - fz) ** 2;
      building.sort((a, b) => distance(a) - distance(b));
    }
    for (let i = 0; i < building.length && i < this.meshBudget; i++) this.buildNodes(building[i]);
  }

  private buildNodes(chunk: Chunk): void {
    const nodes = this.chunkNodes.get(chunk)!;
    if (chunk.dirty) this.world.buildFaces(chunk);
    const meshes = buildChunkMeshes(chunk, this.textures!.uvs);
    nodes.solid = this.place(chunk, nodes.solid, meshes.solid, this.solidMaterial!);
    nodes.water = this.place(chunk, nodes.water, meshes.water, this.waterMaterial!);
    nodes.stale = false;
  }

  /** Puts a new mesh into the chunk's node (made on first use); a chunk without such faces drops it. */
  private place(chunk: Chunk, node: MeshNode | null, mesh: Mesh | null, material: Material): MeshNode | null {
    if (!mesh) {
      if (node) this.removeResource(node);
      return null;
    }
    if (node) {
      node.mesh = mesh;
      node.visible = true;
      return node;
    }
    const corner = new Transform({ x: chunk.cx * CHUNK_SIZE, y: 0, z: chunk.cz * CHUNK_SIZE });
    return this.addNode(new MeshNode(mesh, material, corner), false);
  }

  private dropNodes(chunk: Chunk, nodes: ChunkNodes): void {
    if (nodes.solid) this.removeResource(nodes.solid);
    if (nodes.water) this.removeResource(nodes.water);
    this.chunkNodes.delete(chunk);
  }
}

/** The 12 edges of a block, a little outside it so the faces don't cover them. */
function outlineBlock(lines: LineSet, t: VoxelHit): void {
  const grow = 0.002;
  const s = 1 + 2 * grow;
  let i = 0;
  // The edges of the four side faces: all eight horizontal ones, and the vertical ones of +x and -x (the
  // other two sides share them)
  for (const d of [0, 1, 4, 5]) {
    for (let k = 0; k < 4; k++) {
      const a = d * 12 + k * 3;
      const b = d * 12 + ((k + 1) % 4) * 3;
      if (d >= 4 && CORNERS[a + 1] !== CORNERS[b + 1]) continue;
      lines.setSegment(
        i++,
        t.x + CORNERS[a] * s - grow,
        t.y + CORNERS[a + 1] * s - grow,
        t.z + CORNERS[a + 2] * s - grow,
        t.x + CORNERS[b] * s - grow,
        t.y + CORNERS[b + 1] * s - grow,
        t.z + CORNERS[b + 2] * s - grow,
      );
    }
  }
  lines.count = i;
}

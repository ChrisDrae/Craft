import { Material, Mesh, MeshNode, SimObject, Transform, quat, type Texture, type Vec3 } from "projector";
import { Biome, tintColor } from "./biomes.js";
import { BLOCKS, FACE_TILE, FACE_TINT, Face, Tint } from "./blocks.js";
import { FACE_CORNERS as CORNERS } from "./chunk.js";
import type { TileUVs } from "./chunkMesh.js";
import { ITEMS, type Item } from "./items.js";
import type { LightMap } from "./lightmap.js";
import { SELECTION, cornerUV } from "./shapes.js";
import { atlasIndex } from "./textures.js";
import type { VoxelWorld } from "./world.js";

/** An item to draw lying about: which, and where. */
export interface ShownDrop {
  id: number;
  item: Item;
  count: number;
  position: Vec3;
}

/** Block items drawn as cubes (the rest flat), and how big. */
const CUBES: ReadonlySet<string> = new Set(["cube", "cactus", "stairs", "chest", "slab"]);
const CUBE_SIZE = 0.25;
const FLAT_SIZE = 0.4;

/** A mesh of quads with their own corners: corners (x, y, z) and texture coordinates (u, v) per corner. */
function quadMesh(quads: Array<{ corners: number[]; uvs: number[]; color: readonly number[] }>): Mesh {
  const positions = new Float32Array(quads.length * 12);
  const uvs = new Float32Array(quads.length * 8);
  const colors = new Float32Array(quads.length * 16);
  const faces: number[][] = [];
  quads.forEach((q, i) => {
    positions.set(q.corners, i * 12);
    uvs.set(q.uvs, i * 8);
    for (let k = 0; k < 4; k++) colors.set([q.color[0], q.color[1], q.color[2], 1], (i * 4 + k) * 4);
    faces.push([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 3]);
  });
  const mesh = new Mesh(positions, faces, [], uvs);
  mesh.colors = colors;
  return mesh;
}

/** A tile's rectangle in the atlas, and a point (u, v) in 0-1 within it. */
function inTile(uvs: TileUVs, tile: number, u: number, v: number): [number, number] {
  const r = tile * 4;
  return [uvs[r] + (uvs[r + 2] - uvs[r]) * u, uvs[r + 1] + (uvs[r + 3] - uvs[r + 1]) * v];
}

/**
 * The items lying about, drawn as Minecraft does: block items as small spinning cubes with their faces'
 * textures, other items as their picture, turning and bobbing; as bright as the light where they lie.
 * Also the cracks over the block being broken. Without textures (Canvas 2D) items are colored boxes and
 * there are no cracks.
 */
export class ItemView extends SimObject {
  /** The items to draw. */
  drops: () => Iterable<ShownDrop> = () => [];
  /** The block being broken and how far (0-1), or null. */
  cracking: () => { x: number; y: number; z: number; state: number; progress: number } | null = () => null;
  private readonly nodes: Map<number, { node: MeshNode; brightness: number; spin: number }> = new Map();
  private readonly meshes: Map<Item, Mesh> = new Map();
  private crack: MeshNode | null = null;
  private crackKey = "";
  private time = 0;

  constructor(
    private readonly world: VoxelWorld,
    private readonly lightMap: LightMap,
    private readonly atlas: { texture: Texture; uvs: TileUVs } | null,
  ) {
    super();
  }

  /** The mesh an item is drawn with, centered on the origin (made once per item). */
  private meshOf(item: Item): Mesh {
    let mesh = this.meshes.get(item);
    if (mesh) return mesh;
    const info = ITEMS[item];
    const block = info.block;
    const atlas = this.atlas;
    if (!atlas) {
      mesh = Mesh.box(CUBE_SIZE);
    } else if (block !== null && CUBES.has(BLOCKS[block].shape)) {
      const quads = [0, 1, 2, 3, 4, 5].map((d) => {
        const corners: number[] = [];
        const uvs: number[] = [];
        for (let k = 0; k < 4; k++) {
          const c = d * 12 + k * 3;
          corners.push((CORNERS[c] - 0.5) * CUBE_SIZE, (CORNERS[c + 1] - 0.5) * CUBE_SIZE, (CORNERS[c + 2] - 0.5) * CUBE_SIZE);
          const [u, v] = cornerUV(d, CORNERS[c], CORNERS[c + 1], CORNERS[c + 2]);
          uvs.push(...inTile(atlas.uvs, FACE_TILE[block * 6 + d], u, v));
        }
        const tint = FACE_TINT[block * 6 + d];
        const color = tint === Tint.None ? [255, 255, 255] : tintColor(tint, Biome.Plains);
        return { corners, uvs, color: color.map((c) => c / 255) };
      });
      mesh = quadMesh(quads);
    } else {
      // A picture standing up, seen from both sides
      const name = block !== null ? BLOCKS[block].textures[BLOCKS[block].shape === "tall" ? Face.Top : Face.Side] : `item_${info.texture}`;
      const tile = atlasIndex(name);
      const s = FLAT_SIZE / 2;
      const tint = block !== null ? BLOCKS[block].tint : Tint.None;
      const color = (tint === Tint.None ? [255, 255, 255] : tintColor(tint, Biome.Plains)).map((c) => c / 255);
      const uv = [...inTile(atlas.uvs, tile, 0, 1), ...inTile(atlas.uvs, tile, 1, 1), ...inTile(atlas.uvs, tile, 1, 0), ...inTile(atlas.uvs, tile, 0, 0)];
      mesh = quadMesh([
        { corners: [-s, -s, 0, s, -s, 0, s, s, 0, -s, s, 0], uvs: uv, color },
        { corners: [s, -s, 0, -s, -s, 0, -s, s, 0, s, s, 0], uvs: uv, color },
      ]);
    }
    this.meshes.set(item, mesh);
    return mesh;
  }

  private material(item: Item): Material {
    if (!this.atlas) return new Material({ color: ITEMS[item].color, shading: "flat" });
    return new Material({ color: "#ffffff", shading: "unlit", map: this.atlas.texture, alphaTest: 0.5, side: "double" });
  }

  override update(dt: number): void {
    this.time += dt;
    const seen = new Set<number>();
    for (const d of this.drops()) {
      seen.add(d.id);
      let entry = this.nodes.get(d.id);
      if (!entry || entry.node.mesh !== this.meshOf(d.item)) {
        if (entry) this.removeResource(entry.node);
        const node = this.addNode(new MeshNode(this.meshOf(d.item), this.material(d.item), new Transform()), false);
        entry = { node, brightness: -1, spin: (d.id * 2.39996) % (Math.PI * 2) };
        this.nodes.set(d.id, entry);
      }
      const t = entry.node.transform;
      const cube = ITEMS[d.item].block !== null && CUBES.has(BLOCKS[ITEMS[d.item].block!].shape);
      const lift = (cube ? CUBE_SIZE : FLAT_SIZE) / 2 + 0.05 + Math.sin(this.time * 2 + entry.spin) * 0.05;
      t.position = { x: d.position.x, y: d.position.y + lift, z: d.position.z };
      quat.setAxisAngle(t.rotation, { x: 0, y: 1, z: 0 }, this.time * 1.2 + entry.spin);
      // As bright as where it lies
      const light = this.world.getLight(Math.floor(d.position.x), Math.floor(d.position.y + 0.2), Math.floor(d.position.z));
      const b = Math.round(Math.max(0.1, this.lightMap.brightness(light)) * 20) / 20;
      if (b !== entry.brightness && this.atlas) {
        entry.brightness = b;
        const v = Math.round(b * 255);
        entry.node.material.color = `rgb(${v},${v},${v})`;
      }
    }
    for (const [id, entry] of this.nodes) {
      if (seen.has(id)) continue;
      this.removeResource(entry.node);
      this.nodes.delete(id);
    }
    this.updateCracks();
  }

  /** The cracks over the block being broken: a box a little larger than its outline, the stage's texture. */
  private updateCracks(): void {
    const c = this.atlas ? this.cracking() : null;
    const stage = c ? Math.min(9, Math.floor(c.progress * 10)) : -1;
    const key = c ? `${c.x},${c.y},${c.z},${c.state},${stage}` : "";
    if (key === this.crackKey) return;
    this.crackKey = key;
    if (this.crack) {
      this.removeResource(this.crack);
      this.crack = null;
    }
    if (!c || !this.atlas) return;
    const box = SELECTION[c.state];
    if (box.length < 6) return;
    const grow = 0.003;
    const [x0, y0, z0, x1, y1, z1] = [box[0] - grow, box[1] - grow, box[2] - grow, box[3] + grow, box[4] + grow, box[5] + grow];
    const tile = atlasIndex(`destroy_stage_${stage}`);
    const quads = [0, 1, 2, 3, 4, 5].map((d) => {
      const corners: number[] = [];
      const uvs: number[] = [];
      for (let k = 0; k < 4; k++) {
        const o = d * 12 + k * 3;
        const x = x0 + CORNERS[o] * (x1 - x0);
        const y = y0 + CORNERS[o + 1] * (y1 - y0);
        const z = z0 + CORNERS[o + 2] * (z1 - z0);
        corners.push(x, y, z);
        const [u, v] = cornerUV(d, Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)), Math.min(1, Math.max(0, z)));
        uvs.push(...inTile(this.atlas!.uvs, tile, u, v));
      }
      return { corners, uvs, color: [1, 1, 1] };
    });
    const material = new Material({ color: "#ffffff", shading: "unlit", map: this.atlas.texture, alphaTest: 0.1 });
    this.crack = this.addNode(new MeshNode(quadMesh(quads), material, new Transform({ x: c.x, y: c.y, z: c.z })), false);
  }
}

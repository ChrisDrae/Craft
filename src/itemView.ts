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

/** An orb of experience to draw: which, its points, and where. */
export interface ShownOrb {
  id: number;
  xp: number;
  position: Vec3;
}

/** Block items drawn as cubes (the rest flat), and how big; orbs. */
const CUBES: ReadonlySet<string> = new Set(["cube", "cactus", "stairs", "chest", "slab", "bed", "plate", "button", "repeater", "farmland"]);
const CUBE_SIZE = 0.25;
const FLAT_SIZE = 0.4;
const ORB_SIZE = 0.35;
/** The points from which an orb looks the next size larger (Minecraft's). */
const ORB_STEPS = [3, 7, 17, 37, 73, 149, 307, 617, 1237, 2477];

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
 * The mesh an item is drawn with, centered on the origin: a block item as a small cube with its faces'
 * textures, another as its picture standing up, seen from both sides; a box without textures (Canvas 2D).
 */
export function itemMesh(item: Item, atlas: { texture: Texture; uvs: TileUVs } | null): Mesh {
  let mesh: Mesh;
  const info = ITEMS[item];
  const block = info.block;
  if (!atlas) {
    return Mesh.box(CUBE_SIZE);
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
  return mesh;
}

/**
 * The items lying about, drawn as Minecraft does: block items as small spinning cubes with their faces'
 * textures, other items as their picture, turning and bobbing; as bright as the light where they lie.
 * Orbs of experience face the camera, glowing green and yellow by turns. Also the cracks over the block
 * being broken. Without textures (Canvas 2D) items and orbs are colored boxes and there are no cracks.
 */
export class ItemView extends SimObject {
  /** The items to draw. */
  drops: () => Iterable<ShownDrop> = () => [];
  /** The orbs of experience to draw. */
  orbs: () => Iterable<ShownOrb> = () => [];
  /** The block being broken and how far (0-1), or null. */
  cracking: () => { x: number; y: number; z: number; state: number; progress: number } | null = () => null;
  private readonly nodes: Map<number, { node: MeshNode; brightness: number; spin: number }> = new Map();
  private readonly orbNodes: Map<number, { node: MeshNode; size: number; phase: number }> = new Map();
  private readonly orbMeshes: Map<number, Mesh> = new Map();
  private readonly forward: Vec3 = { x: 0, y: 0, z: 1 };
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

  /** The mesh an item is drawn with (made once per item). */
  private meshOf(item: Item): Mesh {
    let mesh = this.meshes.get(item);
    if (!mesh) {
      mesh = itemMesh(item, this.atlas);
      this.meshes.set(item, mesh);
    }
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
    this.updateOrbs();
    this.updateCracks();
  }

  /** An orb's picture by size (0-10), standing up in the xy plane. */
  private orbMesh(size: number): Mesh {
    let mesh = this.orbMeshes.get(size);
    if (mesh) return mesh;
    if (!this.atlas) {
      mesh = Mesh.box(0.1 + size * 0.015);
    } else {
      const tile = atlasIndex(`experience_orb_${size}`);
      const s = ORB_SIZE / 2;
      const uv = [...inTile(this.atlas.uvs, tile, 0, 1), ...inTile(this.atlas.uvs, tile, 1, 1), ...inTile(this.atlas.uvs, tile, 1, 0), ...inTile(this.atlas.uvs, tile, 0, 0)];
      mesh = quadMesh([{ corners: [-s, -s, 0, s, -s, 0, s, s, 0, -s, s, 0], uvs: uv, color: [1, 1, 1] }]);
    }
    this.orbMeshes.set(size, mesh);
    return mesh;
  }

  /** The orbs, turned to the camera, their color swinging between green and yellow. */
  private updateOrbs(): void {
    const camera = this.sim?.camera;
    const f = camera ? camera.getForward(this.forward) : this.forward;
    const yaw = Math.atan2(f.x, f.z);
    const seen = new Set<number>();
    for (const o of this.orbs()) {
      seen.add(o.id);
      const size = ORB_STEPS.filter((n) => o.xp >= n).length;
      let entry = this.orbNodes.get(o.id);
      if (!entry || entry.size !== size) {
        if (entry) this.removeResource(entry.node);
        const material = this.atlas
          ? new Material({ color: "#80ff20", shading: "unlit", map: this.atlas.texture, alphaTest: 0.1, side: "double" })
          : new Material({ color: "#80ff20", shading: "flat" });
        entry = { node: this.addNode(new MeshNode(this.orbMesh(size), material, new Transform()), false), size, phase: (o.id * 1.7) % (Math.PI * 2) };
        this.orbNodes.set(o.id, entry);
      }
      const t = entry.node.transform;
      t.position = { x: o.position.x, y: o.position.y + ORB_SIZE / 2 + 0.05, z: o.position.z };
      quat.setAxisAngle(t.rotation, { x: 0, y: 1, z: 0 }, yaw);
      const swing = (Math.sin(this.time * 3 + entry.phase) + 1) / 2;
      entry.node.material.color = `rgb(${Math.round(128 + swing * 127)},255,${Math.round(swing * 40)})`;
    }
    for (const [id, entry] of this.orbNodes) {
      if (seen.has(id)) continue;
      this.removeResource(entry.node);
      this.orbNodes.delete(id);
    }
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

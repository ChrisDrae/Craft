import { Material, Mesh, MeshNode, SimObject, Transform, type Texture } from "projector";
import { Biome, tintColor } from "./biomes.js";
import { DIR_X, DIR_Y, DIR_Z, FACE_TILE, FACE_TINT, FACE_TURN, Tint } from "./blocks.js";
import { FACE_CORNERS as CORNERS } from "./chunk.js";
import type { TileUVs } from "./chunkMesh.js";
import type { LightMap } from "./lightmap.js";
import { MODELS, cornerUV } from "./shapes.js";
import type { VoxelWorld } from "./world.js";

/** A block on its way somewhere: where it is going, what it is, the way it goes (Dir), how far it has come (0-1). */
export interface ShownMove {
  x: number;
  y: number;
  z: number;
  state: number;
  dir: number;
  progress: number;
}

/** How bright a face is by the way it faces (Dir), as the world's: tops full, sides 0.8 and 0.6, bottoms half. */
const SHADE = [0.6, 0.6, 1, 0.5, 0.8, 0.8];

/** A tile's rectangle in the atlas, and a point (u, v) in 0-1 within it. */
function inTile(uvs: TileUVs, tile: number, u: number, v: number): [number, number] {
  const r = tile * 4;
  return [uvs[r] + (uvs[r + 2] - uvs[r]) * u, uvs[r + 1] + (uvs[r + 3] - uvs[r + 1]) * v];
}

/** A mesh of `n` quads, its corners, texture coordinates and colors rewritten as they change. */
function quadMesh(n: number): Mesh {
  const faces: number[][] = [];
  for (let i = 0; i < n; i++) faces.push([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 3]);
  const mesh = new Mesh(new Float32Array(n * 12), faces, [], new Float32Array(n * 8));
  mesh.colors = new Float32Array(n * 16).fill(1);
  return mesh;
}

/**
 * Blocks that pistons are moving, drawn on their way (the world shows nothing in their place meanwhile):
 * cubes with their faces' textures, models with their quads, as bright as the light where they go. One
 * mesh for all of them, rewritten every frame while anything moves. WebGL only.
 */
export class MovingBlocks extends SimObject {
  /** The blocks moving now. */
  moves: () => Iterable<ShownMove> = () => [];
  private mesh: Mesh | null = null;
  private node: MeshNode | null = null;
  private capacity = 0;
  private readonly material: Material;

  constructor(
    private readonly world: VoxelWorld,
    private readonly lightMap: LightMap,
    private readonly atlas: { texture: Texture; uvs: TileUVs },
  ) {
    super();
    this.material = new Material({ color: "#ffffff", shading: "unlit", map: atlas.texture, alphaTest: 0.5 });
  }

  /** A mesh for at least `n` quads (made larger as needed). */
  private meshFor(n: number): Mesh {
    if (this.mesh && n <= this.capacity) return this.mesh;
    if (this.node) this.removeResource(this.node);
    this.capacity = Math.max(64, n * 2);
    this.mesh = quadMesh(this.capacity);
    this.node = this.addNode(new MeshNode(this.mesh, this.material, new Transform()), false);
    return this.mesh;
  }

  override sync(): void {
    const quads: Array<{ corners: number[]; uvs: number[]; color: [number, number, number] }> = [];
    for (const m of this.moves()) {
      const back = 1 - m.progress;
      const [ox, oy, oz] = [m.x - DIR_X[m.dir] * back, m.y - DIR_Y[m.dir] * back, m.z - DIR_Z[m.dir] * back];
      const light = Math.max(0.1, this.lightMap.brightness(this.world.getLight(m.x, m.y, m.z)));
      const tinted = (tint: number, shade: number): [number, number, number] => {
        const c = tint === Tint.None ? [255, 255, 255] : tintColor(tint, Biome.Plains);
        return [(c[0] / 255) * light * shade, (c[1] / 255) * light * shade, (c[2] / 255) * light * shade];
      };
      const model = MODELS[m.state];
      if (model) {
        for (const q of model) {
          const corners: number[] = [];
          const uvs: number[] = [];
          for (let k = 0; k < 4; k++) {
            corners.push(ox + q.corners[k * 3], oy + q.corners[k * 3 + 1], oz + q.corners[k * 3 + 2]);
            uvs.push(...inTile(this.atlas.uvs, q.tile, q.uvs[k * 2], q.uvs[k * 2 + 1]));
          }
          quads.push({ corners, uvs, color: tinted(q.tint, q.dir >= 0 ? SHADE[q.dir] : 1) });
        }
        continue;
      }
      for (let d = 0; d < 6; d++) {
        const corners: number[] = [];
        const uvs: number[] = [];
        for (let k = 0; k < 4; k++) {
          const c = d * 12 + k * 3;
          corners.push(ox + CORNERS[c], oy + CORNERS[c + 1], oz + CORNERS[c + 2]);
          let [u, v] = cornerUV(d, CORNERS[c], CORNERS[c + 1], CORNERS[c + 2]);
          for (let t = FACE_TURN[m.state * 6 + d]; t > 0; t--) [u, v] = [v, 1 - u];
          uvs.push(...inTile(this.atlas.uvs, FACE_TILE[m.state * 6 + d], u, v));
        }
        quads.push({ corners, uvs, color: tinted(FACE_TINT[m.state * 6 + d], SHADE[d]) });
      }
    }
    if (quads.length === 0) {
      if (this.node) this.node.visible = false;
      return;
    }
    const mesh = this.meshFor(quads.length);
    quads.forEach((q, i) => {
      mesh.positions.set(q.corners, i * 12);
      mesh.uvs!.set(q.uvs, i * 8);
      for (let k = 0; k < 4; k++) mesh.colors!.set([q.color[0], q.color[1], q.color[2], 1], (i * 4 + k) * 4);
    });
    mesh.positions.fill(0, quads.length * 12);
    mesh.markDirty();
    this.node!.visible = true;
  }
}

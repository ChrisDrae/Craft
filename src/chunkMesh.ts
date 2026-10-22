import { Mesh } from "projector";
import { FACE_TILE, FACE_TURN, FLUID, OPAQUE, TRANSLUCENT } from "./blocks.js";
import { CHUNK_SIZE, FACE_CORNERS as CORNERS, MODEL_FACE, SECTIONS, WORLD_HEIGHT, type Chunk } from "./chunk.js";
import { ownHeight } from "./fluids.js";
import { chunkLight } from "./light.js";
import { COVERS, MODELS, cornerUV } from "./shapes.js";

/** Texture rectangle (u0, v0, u1, v1) of every texture in the atlas: at TILE_NAMES index * 4. */
export type TileUVs = Float32Array;

/** What meshing needs of the world: the chunks next to the one being meshed. */
export interface ChunkSource {
  chunk(cx: number, cz: number): Chunk | undefined;
}

/** A chunk's faces as meshes, in coordinates relative to the chunk's corner (x and z 0..16). */
export interface ChunkMeshes {
  /** Opaque and cut-out blocks (leaves). Null without faces. */
  solid: Mesh | null;
  /** Translucent blocks (water), drawn after everything else. Null without faces. */
  water: Mesh | null;
}

const CORNER_UVS: Float32Array = Float32Array.from(
  Array.from({ length: 24 }, (_, i) => cornerUV(Math.floor(i / 4), CORNERS[i * 3], CORNERS[i * 3 + 1], CORNERS[i * 3 + 2])).flat(),
);

/** How dark each face direction is drawn, as in Minecraft: tops full, bottoms half, the sides between. */
export const SHADE = [0.6, 0.6, 1, 0.5, 0.8, 0.8];
/** Brightness at a corner with 0-3 of its neighbors blocking (ambient occlusion). */
const OCCLUDED = [1, 0.8, 0.62, 0.45];
/** For each direction, the two axes along the face (0 x, 1 y, 2 z): the corner's position on them picks its neighbors. */
const ALONG: readonly (readonly [number, number])[] = [
  [2, 1],
  [2, 1],
  [0, 2],
  [0, 2],
  [0, 1],
  [0, 1],
];
const STEP = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const DIR = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** The blocks around a chunk being meshed, one block beyond on every side: state, light, whether opaque. */
const PAD = CHUNK_SIZE + 2;
let stateAround = new Uint16Array(PAD * PAD * WORLD_HEIGHT);
let lightAround = new Uint8Array(PAD * PAD * WORLD_HEIGHT);
let opaqueAround = new Uint8Array(PAD * PAD * WORLD_HEIGHT);
let gatheredFrom = 0;
let gatheredTo = -1;

/** Fills the arrays around for y from y0 to y1 (inclusive); index ((y - y0) * PAD + z + 1) * PAD + x + 1. */
function gather(world: ChunkSource, chunk: Chunk, y0: number, y1: number): void {
  const size = PAD * PAD * (y1 - y0 + 1);
  if (lightAround.length < size) {
    stateAround = new Uint16Array(size);
    lightAround = new Uint8Array(size);
    opaqueAround = new Uint8Array(size);
  }
  gatheredFrom = y0;
  gatheredTo = y1;
  for (let pz = 0; pz < PAD; pz++) {
    for (let px = 0; px < PAD; px++) {
      const ox = px === 0 ? -1 : px === PAD - 1 ? 1 : 0;
      const oz = pz === 0 ? -1 : pz === PAD - 1 ? 1 : 0;
      const c = ox === 0 && oz === 0 ? chunk : world.chunk(chunk.cx + ox, chunk.cz + oz);
      const lx = (px + 15) & 15;
      const lz = (pz + 15) & 15;
      for (let y = y0; y <= y1; y++) {
        const i = ((y - y0) * PAD + pz) * PAD + px;
        const s = c ? c.get(lx, y, lz) : 0;
        stateAround[i] = s;
        lightAround[i] = c ? chunkLight(c, lx, y, lz) : 0;
        opaqueAround[i] = OPAQUE[s];
      }
    }
  }
}

const at = (x: number, y: number, z: number): number => ((y - gatheredFrom) * PAD + z + 1) * PAD + x + 1;

/**
 * The height of a fluid's surface at a corner of its cell (cx, cz the corner, y the cell's height), as
 * Minecraft averages it over the four cells around the corner: full where any of them has the fluid
 * above it; otherwise sources and nearly full cells weigh ten times as much, open cells pull it down, and
 * solid ones don't count.
 */
function cornerHeight(cx: number, y: number, cz: number, fluid: number): number {
  let sum = 0;
  let weight = 0;
  for (const [x, z] of [
    [cx - 1, cz - 1],
    [cx, cz - 1],
    [cx - 1, cz],
    [cx, cz],
  ]) {
    if (y + 1 <= gatheredTo && FLUID[stateAround[at(x, y + 1, z)]] === fluid) return 1;
    const s = stateAround[at(x, y, z)];
    if (FLUID[s] === fluid) {
      const h = ownHeight(s);
      const w = h >= 0.8 ? 10 : 1;
      sum += h * w;
      weight += w;
    } else if (COVERS[s * 6 + 2] === 0) {
      weight += 1;
    }
  }
  return weight > 0 ? sum / weight : 0;
}

/**
 * Builds the meshes of a chunk from its sections' face lists (which must be up to date). Every quad has
 * four corners of its own, carrying:
 * - its texture's coordinates in the atlas (`tiles`);
 * - a color: the face direction's shade times the corner's ambient occlusion;
 * - second texture coordinates with the light at the corner (block light along u, sky light along v, in
 *   sixteenths), for the light map: the average of the blocks in front of the face around the corner.
 * Fluids slope from corner to corner (cornerHeight). Model quads take the light of the block they face
 * (their own block's if that one is opaque, or for plants), without occlusion, and are left out where the
 * neighbor covers the side they lie on.
 */
export function buildChunkMeshes(world: ChunkSource, chunk: Chunk, tiles: TileUVs): ChunkMeshes {
  let translucent = 0;
  let total = 0;
  let lo = WORLD_HEIGHT;
  let hi = -1;
  for (let s = 0; s < SECTIONS; s++) {
    const section = chunk.sections[s];
    const faces = section.faces;
    if (section.faceCount === 0) continue;
    lo = Math.min(lo, s * CHUNK_SIZE);
    hi = Math.max(hi, s * CHUNK_SIZE + CHUNK_SIZE - 1);
    for (let i = 0; i < section.faceCount; i++) {
      const f = faces[i];
      const state = f >>> 16;
      const quads = ((f >> 12) & 7) === MODEL_FACE ? MODELS[state]!.length : 1;
      total += quads;
      if (TRANSLUCENT[state]) translucent += quads;
    }
  }
  if (total === 0) return { solid: null, water: null };
  gather(world, chunk, Math.max(0, lo - 1), Math.min(WORLD_HEIGHT - 1, hi + 1));
  return {
    solid: build(chunk, tiles, false, total - translucent),
    water: build(chunk, tiles, true, translucent),
  };
}

const corners = new Float64Array(12);
const cornerU = new Float64Array(4);
const cornerV = new Float64Array(4);
const lightU = new Float32Array(4);
const lightV = new Float32Array(4);
const occlusion = new Int32Array(4);

/** A mesh being filled with quads, at most `capacity` of them. */
class QuadBuilder {
  readonly positions: Float32Array;
  readonly texcoords: Float32Array;
  readonly colors: Float32Array;
  readonly light: Float32Array;
  readonly order: Uint32Array;
  count: number = 0;

  constructor(capacity: number) {
    this.positions = new Float32Array(capacity * 12);
    this.texcoords = new Float32Array(capacity * 8);
    this.colors = new Float32Array(capacity * 16);
    this.light = new Float32Array(capacity * 8);
    this.order = new Uint32Array(capacity * 4);
  }

  /**
   * Adds a quad: block position (x, y, z), corners relative to it (`corners`), texture coordinates within
   * the tile (`cornerU`, `cornerV`), the tile rectangle starting at r in `tiles`, brightness `shade` with
   * the corners' occlusion and light (lightU, lightV), starting at corner `first` (to pick the diagonal).
   */
  add(x: number, y: number, z: number, tiles: TileUVs, r: number, shade: number, first: number): void {
    const n = this.count++;
    const u0 = tiles[r];
    const v0 = tiles[r + 1];
    const du = tiles[r + 2] - u0;
    const dv = tiles[r + 3] - v0;
    for (let j = 0; j < 4; j++) {
      const k = (j + first) & 3;
      const o = n * 4 + j;
      this.positions[o * 3] = x + corners[k * 3];
      this.positions[o * 3 + 1] = y + corners[k * 3 + 1];
      this.positions[o * 3 + 2] = z + corners[k * 3 + 2];
      this.texcoords[o * 2] = u0 + cornerU[k] * du;
      this.texcoords[o * 2 + 1] = v0 + cornerV[k] * dv;
      const b = shade * OCCLUDED[occlusion[k]];
      this.colors[o * 4] = b;
      this.colors[o * 4 + 1] = b;
      this.colors[o * 4 + 2] = b;
      this.colors[o * 4 + 3] = 1;
      this.light[o * 2] = lightU[k];
      this.light[o * 2 + 1] = lightV[k];
      this.order[o] = o;
    }
  }

  mesh(): Mesh | null {
    const n = this.count;
    if (n === 0) return null;
    const quads: Uint32Array[] = [];
    for (let i = 0; i < n; i++) quads.push(this.order.subarray(i * 4, i * 4 + 4));
    // No edges: they are never drawn, and finding them is the slowest part of building a mesh
    const mesh = new Mesh(this.positions.subarray(0, n * 12), quads, [], this.texcoords.subarray(0, n * 8));
    mesh.colors = this.colors.subarray(0, n * 16);
    mesh.uvs2 = this.light.subarray(0, n * 8);
    return mesh;
  }
}

/** Light of one block for all four corners. */
function flatLight(cell: number): void {
  const l = lightAround[cell];
  lightU.fill(((l & 15) + 0.5) / 16);
  lightV.fill(((l >> 4) + 0.5) / 16);
}

/** Smooth light and occlusion at the corners of a cube face in direction d of block (x, y, z). */
function cubeCorners(x: number, y: number, z: number, d: number, occlude: boolean): void {
  const [ua, va] = ALONG[d];
  const fx = x + DIR[d][0];
  // Above the top of the world, the top layer's light stands in
  const fy = Math.min(y + DIR[d][1], WORLD_HEIGHT - 1);
  const fz = z + DIR[d][2];
  const front = at(fx, fy, fz);
  for (let k = 0; k < 4; k++) {
    const c = d * 12 + k * 3;
    const su = CORNERS[c + ua] > 0 ? 1 : -1;
    const sv = CORNERS[c + va] > 0 ? 1 : -1;
    const u = at(fx + STEP[ua][0] * su, fy + STEP[ua][1] * su, fz + STEP[ua][2] * su);
    const v = at(fx + STEP[va][0] * sv, fy + STEP[va][1] * sv, fz + STEP[va][2] * sv);
    const uv = u + v - front;
    const ou = opaqueAround[u];
    const ov = opaqueAround[v];
    // A corner closed in on both sides doesn't see the block diagonally across
    const ouv = ou && ov ? 1 : opaqueAround[uv];
    occlusion[k] = !occlude ? 0 : ou && ov ? 3 : ou + ov + ouv;
    // The average over the front block and the open ones of the three around the corner
    let block = lightAround[front] & 15;
    let sky = lightAround[front] >> 4;
    let samples = 1;
    if (!ou) {
      block += lightAround[u] & 15;
      sky += lightAround[u] >> 4;
      samples++;
    }
    if (!ov) {
      block += lightAround[v] & 15;
      sky += lightAround[v] >> 4;
      samples++;
    }
    if (!ouv) {
      block += lightAround[uv] & 15;
      sky += lightAround[uv] >> 4;
      samples++;
    }
    lightU[k] = (block / samples + 0.5) / 16;
    lightV[k] = (sky / samples + 0.5) / 16;
  }
}

function build(chunk: Chunk, tiles: TileUVs, translucent: boolean, capacity: number): Mesh | null {
  if (capacity === 0) return null;
  const out = new QuadBuilder(capacity);
  const want = translucent ? 1 : 0;
  for (let sy = 0; sy < SECTIONS; sy++) {
    const section = chunk.sections[sy];
    const faces = section.faces;
    for (let i = 0; i < section.faceCount; i++) {
      const f = faces[i];
      const state = f >>> 16;
      if (TRANSLUCENT[state] !== want) continue;
      const x = f & 15;
      const z = (f >> 4) & 15;
      const y = sy * CHUNK_SIZE + ((f >> 8) & 15);
      const d = (f >> 12) & 7;
      if (d === MODEL_FACE) {
        addModel(out, x, y, z, state, tiles);
        continue;
      }

      const fluid = FLUID[state];
      cubeCorners(x, y, z, d, fluid === 0);
      // A fluid's surface slopes with the corners' heights, and its sides follow it
      let neighborTop = 0;
      if (fluid !== 0 && d !== 3) {
        const n = stateAround[at(x + DIR[d][0], y, z + DIR[d][2])];
        if (d !== 2 && FLUID[n] === fluid) neighborTop = ownHeight(n);
      }
      for (let k = 0; k < 4; k++) {
        const c = d * 12 + k * 3;
        let cy = CORNERS[c + 1];
        if (fluid !== 0) cy = cy > 0 ? cornerHeight(x + CORNERS[c], y, z + CORNERS[c + 2], fluid) : d === 3 ? 0 : neighborTop;
        corners[k * 3] = CORNERS[c];
        corners[k * 3 + 1] = cy;
        corners[k * 3 + 2] = CORNERS[c + 2];
        // Sides show the part of the texture as high as they are, not squeezed
        const u = CORNER_UVS[(d * 4 + k) * 2];
        const v = d === 2 || d === 3 ? CORNER_UVS[(d * 4 + k) * 2 + 1] : 1 - cy;
        const turned = FACE_TURN[state * 6 + d] === 1;
        cornerU[k] = turned ? v : u;
        cornerV[k] = turned ? 1 - u : v;
      }
      // Split the quad along the diagonal whose corners are least alike in occlusion, so it shades evenly
      const first = occlusion[0] + occlusion[2] > occlusion[1] + occlusion[3] ? 1 : 0;
      out.add(x, y, z, tiles, FACE_TILE[state * 6 + d] * 4, SHADE[d], first);
    }
  }
  return out.mesh();
}

/** A model's quads, each unless the neighbor covers the side it lies on. */
function addModel(out: QuadBuilder, x: number, y: number, z: number, state: number, tiles: TileUVs): void {
  const own = at(x, y, z);
  occlusion.fill(0);
  for (const q of MODELS[state]!) {
    if (q.cull >= 0) {
      const n = stateAround[at(x + DIR[q.cull][0], Math.min(y + DIR[q.cull][1], WORLD_HEIGHT - 1), z + DIR[q.cull][2])];
      if (COVERS[n * 6 + (q.cull ^ 1)] === 1) continue;
    }
    // Lit by the block it faces, unless that one is solid (a torch's back against its wall)
    let cell = own;
    if (q.dir >= 0) {
      const facing = at(x + DIR[q.dir][0], Math.min(Math.max(y + DIR[q.dir][1], gatheredFrom), gatheredTo), z + DIR[q.dir][2]);
      if (!opaqueAround[facing]) cell = facing;
    }
    flatLight(cell);
    corners.set(q.corners);
    for (let k = 0; k < 4; k++) {
      cornerU[k] = q.uvs[k * 2];
      cornerV[k] = q.uvs[k * 2 + 1];
    }
    out.add(x, y, z, tiles, q.tile * 4, q.dir >= 0 ? SHADE[q.dir] : 1, 0);
  }
}

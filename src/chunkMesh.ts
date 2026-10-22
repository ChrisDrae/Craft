import { Mesh } from "projector";
import { FACE_TURN, MODELS, OPAQUE, TRANSLUCENT } from "./blocks.js";
import { CHUNK_SIZE, FACE_CORNERS as CORNERS, SECTIONS, WATER_TOP, WORLD_HEIGHT, type Chunk } from "./chunk.js";
import { chunkLight } from "./light.js";

/** Texture rectangle (u0, v0, u1, v1) of every block state's faces: at (state * 6 + dir) * 4. */
export type FaceUVs = Float32Array;

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

/**
 * Where corner k (0..3) of a face in direction d (Dir) lies on its texture, as (u, v) in 0..1 with v down:
 * sides upright and not mirrored seen from outside, tops with u along x and v along z (the same layout as
 * Projector's Mesh.box). (x, y, z) is the corner's place in the block, 0..1 on each axis.
 */
function cornerUV(d: number, x: number, y: number, z: number): [number, number] {
  switch (d) {
    case 0:
      return [z, 1 - y];
    case 1:
      return [1 - z, 1 - y];
    case 2:
      return [x, z];
    case 3:
      return [x, 1 - z];
    case 4:
      return [1 - x, 1 - y];
    default:
      return [x, 1 - y];
  }
}

const CORNER_UVS: Float32Array = Float32Array.from(
  Array.from({ length: 24 }, (_, i) => cornerUV(Math.floor(i / 4), CORNERS[i * 3], CORNERS[i * 3 + 1], CORNERS[i * 3 + 2])).flat(),
);

/**
 * The corners of a face in direction d of a block in the given state, relative to the block's minimum
 * corner, into `out` (12 numbers): the cube's face, lowered to `top` for water, or the face of the state's
 * model box (torches).
 */
export function faceCorners(state: number, d: number, top: number, out: Float64Array): Float64Array {
  const model = MODELS[state];
  for (let k = 0; k < 12; k += 3) {
    const c = d * 12 + k;
    if (model) {
      const b = model.box;
      out[k] = b[0] + CORNERS[c] * (b[3] - b[0]);
      out[k + 1] = b[1] + CORNERS[c + 1] * (b[4] - b[1]);
      out[k + 2] = b[2] + CORNERS[c + 2] * (b[5] - b[2]);
    } else {
      out[k] = CORNERS[c];
      out[k + 1] = CORNERS[c + 1] * top;
      out[k + 2] = CORNERS[c + 2];
    }
  }
  return out;
}

/** How dark each face direction is drawn, as in Minecraft: tops full, bottoms half, the sides between. */
const SHADE = [0.6, 0.6, 1, 0.5, 0.8, 0.8];
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

/** The blocks around a chunk being meshed, one block beyond on every side: light and whether opaque. */
const PAD = CHUNK_SIZE + 2;
let lightAround = new Uint8Array(PAD * PAD * WORLD_HEIGHT);
let opaqueAround = new Uint8Array(PAD * PAD * WORLD_HEIGHT);

/** Fills lightAround and opaqueAround for y from y0 to y1 (inclusive); index ((y - y0) * PAD + z + 1) * PAD + x + 1. */
function gather(world: ChunkSource, chunk: Chunk, y0: number, y1: number): void {
  const size = PAD * PAD * (y1 - y0 + 1);
  if (lightAround.length < size) {
    lightAround = new Uint8Array(size);
    opaqueAround = new Uint8Array(size);
  }
  for (let pz = 0; pz < PAD; pz++) {
    for (let px = 0; px < PAD; px++) {
      const ox = px === 0 ? -1 : px === PAD - 1 ? 1 : 0;
      const oz = pz === 0 ? -1 : pz === PAD - 1 ? 1 : 0;
      const c = ox === 0 && oz === 0 ? chunk : world.chunk(chunk.cx + ox, chunk.cz + oz);
      const lx = (px + 15) & 15;
      const lz = (pz + 15) & 15;
      for (let y = y0; y <= y1; y++) {
        const i = ((y - y0) * PAD + pz) * PAD + px;
        lightAround[i] = c ? chunkLight(c, lx, y, lz) : 0;
        opaqueAround[i] = c ? OPAQUE[c.get(lx, y, lz)] : 0;
      }
    }
  }
}

/**
 * Builds the meshes of a chunk from its sections' face lists (which must be up to date). Every face is its
 * own quad with four corners of its own, carrying:
 * - its tile's texture coordinates (a lowered water face, the top layer, shows the matching part of it);
 * - a color: the face direction's shade times the corner's ambient occlusion;
 * - second texture coordinates with the light at the corner (block light along u, sky light along v,
 *   in sixteenths), for the light map: the average of the blocks in front of the face around the corner.
 * Blocks drawn as model boxes (torches) take the light of their own block, without occlusion.
 */
export function buildChunkMeshes(world: ChunkSource, chunk: Chunk, uvs: FaceUVs): ChunkMeshes {
  let translucent = 0;
  let total = 0;
  let lo = WORLD_HEIGHT;
  let hi = -1;
  for (let s = 0; s < SECTIONS; s++) {
    const section = chunk.sections[s];
    const faces = section.faces;
    if (section.faceCount === 0) continue;
    total += section.faceCount;
    lo = Math.min(lo, s * CHUNK_SIZE);
    hi = Math.max(hi, s * CHUNK_SIZE + CHUNK_SIZE - 1);
    for (let i = 0; i < section.faceCount; i++) translucent += TRANSLUCENT[faces[i] >>> 16];
  }
  if (total === 0) return { solid: null, water: null };
  const y0 = Math.max(0, lo - 1);
  const y1 = Math.min(WORLD_HEIGHT - 1, hi + 1);
  gather(world, chunk, y0, y1);
  return {
    solid: build(chunk, uvs, false, total - translucent, y0),
    water: build(chunk, uvs, true, translucent, y0),
  };
}

const corners = new Float64Array(12);
const lightU = new Float32Array(4);
const lightV = new Float32Array(4);
const occlusion = new Int32Array(4);

function build(chunk: Chunk, uvs: FaceUVs, translucent: boolean, count: number, y0: number): Mesh | null {
  if (count === 0) return null;
  const positions = new Float32Array(count * 12);
  const texcoords = new Float32Array(count * 8);
  const colors = new Float32Array(count * 16);
  const light = new Float32Array(count * 8);
  const quads: Uint32Array[] = [];
  const order = new Uint32Array(count * 4);
  const want = translucent ? 1 : 0;
  const index = (x: number, y: number, z: number): number => ((y - y0) * PAD + z + 1) * PAD + x + 1;
  let n = 0;
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
      const top = (f >> 15) & 1 ? WATER_TOP : 1;
      faceCorners(state, d, top, corners);
      const model = MODELS[state];

      // Light and occlusion at the four corners
      if (model) {
        const own = lightAround[index(x, y, z)];
        lightU.fill(((own & 15) + 0.5) / 16);
        lightV.fill(((own >> 4) + 0.5) / 16);
        occlusion.fill(0);
      } else {
        const [ua, va] = ALONG[d];
        const fx = x + DIR[d][0];
        // Above the top of the world, the top layer's light stands in
        const fy = Math.min(y + DIR[d][1], WORLD_HEIGHT - 1);
        const fz = z + DIR[d][2];
        const front = index(fx, fy, fz);
        for (let k = 0; k < 4; k++) {
          const c = d * 12 + k * 3;
          const su = CORNERS[c + ua] > 0 ? 1 : -1;
          const sv = CORNERS[c + va] > 0 ? 1 : -1;
          const u = index(fx + STEP[ua][0] * su, fy + STEP[ua][1] * su, fz + STEP[ua][2] * su);
          const v = index(fx + STEP[va][0] * sv, fy + STEP[va][1] * sv, fz + STEP[va][2] * sv);
          const uv = u + v - front;
          const ou = opaqueAround[u];
          const ov = opaqueAround[v];
          // A corner closed in on both sides doesn't see the block diagonally across
          const ouv = ou && ov ? 1 : opaqueAround[uv];
          occlusion[k] = translucent ? 0 : ou && ov ? 3 : ou + ov + ouv;
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

      const r = (state * 6 + d) * 4;
      const u0 = uvs[r];
      const v0 = uvs[r + 1];
      const du = uvs[r + 2] - u0;
      const dv = uvs[r + 3] - v0;
      const turned = FACE_TURN[state * 6 + d] === 1;
      const shade = SHADE[d];
      // Split the quad along the diagonal whose corners are least alike in occlusion, so it shades evenly
      const flip = occlusion[0] + occlusion[2] > occlusion[1] + occlusion[3] ? 1 : 0;
      for (let j = 0; j < 4; j++) {
        const k = (j + flip) & 3;
        const o = n * 4 + j;
        const c = d * 12 + k * 3;
        positions[o * 3] = x + corners[k * 3];
        positions[o * 3 + 1] = y + corners[k * 3 + 1];
        positions[o * 3 + 2] = z + corners[k * 3 + 2];
        // A model's texture comes from its uv box; a cube's from the corner, sides of lowered water cut off at the top
        let u: number;
        let v: number;
        if (model) {
          const b = model.uv;
          [u, v] = cornerUV(d, b[0] + CORNERS[c] * (b[3] - b[0]), b[1] + CORNERS[c + 1] * (b[4] - b[1]), b[2] + CORNERS[c + 2] * (b[5] - b[2]));
        } else {
          u = CORNER_UVS[(d * 4 + k) * 2];
          v = d === 2 || d === 3 ? CORNER_UVS[(d * 4 + k) * 2 + 1] : 1 - corners[k * 3 + 1];
        }
        texcoords[o * 2] = u0 + (turned ? v : u) * du;
        texcoords[o * 2 + 1] = v0 + (turned ? 1 - u : v) * dv;
        const b = shade * OCCLUDED[occlusion[k]];
        colors[o * 4] = b;
        colors[o * 4 + 1] = b;
        colors[o * 4 + 2] = b;
        colors[o * 4 + 3] = 1;
        light[o * 2] = lightU[k];
        light[o * 2 + 1] = lightV[k];
        order[o] = o;
      }
      quads.push(order.subarray(n * 4, n * 4 + 4));
      n++;
    }
  }
  // No edges: they are never drawn, and finding them is the slowest part of building a mesh
  const mesh = new Mesh(positions, quads, [], texcoords);
  mesh.colors = colors;
  mesh.uvs2 = light;
  return mesh;
}

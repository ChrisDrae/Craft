import { Mesh } from "projector";
import { FACE_TURN, TRANSLUCENT } from "./blocks.js";
import { CHUNK_SIZE, FACE_CORNERS as CORNERS, SECTIONS, WATER_TOP, type Chunk } from "./chunk.js";

/** Texture rectangle (u0, v0, u1, v1) of every block state's faces: at (state * 6 + dir) * 4. */
export type FaceUVs = Float32Array;

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
 * Projector's Mesh.box).
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
 * Builds the meshes of a chunk from its sections' face lists (which must be up to date). Every face is its
 * own quad with four corners of its own, so each can carry its tile's texture coordinates. A lowered water
 * face (the top layer) has its top edge at WATER_TOP and shows the matching part of the tile.
 */
export function buildChunkMeshes(chunk: Chunk, uvs: FaceUVs): ChunkMeshes {
  let translucent = 0;
  let total = 0;
  for (const section of chunk.sections) {
    const faces = section.faces;
    total += section.faceCount;
    for (let i = 0; i < section.faceCount; i++) translucent += TRANSLUCENT[faces[i] >>> 16];
  }
  return {
    solid: build(chunk, uvs, false, total - translucent),
    water: build(chunk, uvs, true, translucent),
  };
}

function build(chunk: Chunk, uvs: FaceUVs, translucent: boolean, count: number): Mesh | null {
  if (count === 0) return null;
  const positions = new Float32Array(count * 12);
  const texcoords = new Float32Array(count * 8);
  const quads: Uint32Array[] = [];
  const corners = new Uint32Array(count * 4);
  const want = translucent ? 1 : 0;
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
      const r = (state * 6 + d) * 4;
      const u0 = uvs[r];
      const v0 = uvs[r + 1];
      const du = uvs[r + 2] - u0;
      const dv = uvs[r + 3] - v0;
      const turned = FACE_TURN[state * 6 + d] === 1;
      for (let k = 0; k < 4; k++) {
        const c = d * 12 + k * 3;
        const cy = CORNERS[c + 1] * top;
        const p = (n * 4 + k) * 3;
        positions[p] = x + CORNERS[c];
        positions[p + 1] = y + cy;
        positions[p + 2] = z + CORNERS[c + 2];
        const t = (d * 4 + k) * 2;
        // Sides of lowered water are cut off at the top, not squeezed
        const u = CORNER_UVS[t];
        const v = d === 2 || d === 3 ? CORNER_UVS[t + 1] : 1 - cy;
        texcoords[(n * 4 + k) * 2] = u0 + (turned ? v : u) * du;
        texcoords[(n * 4 + k) * 2 + 1] = v0 + (turned ? 1 - u : v) * dv;
        corners[n * 4 + k] = n * 4 + k;
      }
      quads.push(corners.subarray(n * 4, n * 4 + 4));
      n++;
    }
  }
  // No edges: they are never drawn, and finding them is the slowest part of building a mesh
  return new Mesh(positions, quads, [], texcoords);
}

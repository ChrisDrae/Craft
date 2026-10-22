import { describe, expect, it } from "vitest";
import { Mesh } from "projector";
import { Block, DIR_X, DIR_Y, DIR_Z } from "../src/blocks.js";
import { WATER_TOP, type Chunk, type ChunkGenerator } from "../src/chunk.js";
import { buildChunkMeshes } from "../src/chunkMesh.js";
import { VoxelWorld } from "../src/world.js";

/** Places the given blocks in chunk (0, 0); everything else is air. */
class BlocksGenerator implements ChunkGenerator {
  constructor(private readonly blocks: Array<[number, number, number, number]>) {}

  generate(chunk: Chunk): void {
    if (chunk.cx !== 0 || chunk.cz !== 0) return;
    for (const [x, y, z, b] of this.blocks) chunk.set(x, y, z, b);
  }
}

/** Every block face gets its own made-up rectangle, so tests can tell them apart. */
function testUVs(): Float32Array {
  const uvs = new Float32Array(256 * 6 * 4);
  for (let i = 0; i < 256 * 6; i++) uvs.set([i * 0.001, i * 0.002, i * 0.001 + 0.0005, i * 0.002 + 0.001], i * 4);
  return uvs;
}

function meshesOf(blocks: Array<[number, number, number, number]>, fancyLeaves = false): ReturnType<typeof buildChunkMeshes> {
  const world = new VoxelWorld(new BlocksGenerator(blocks));
  world.fancyLeaves = fancyLeaves;
  const chunk = world.load(0, 0);
  world.buildFaces(chunk);
  return buildChunkMeshes(chunk, testUVs());
}

interface Quad {
  normal: [number, number, number];
  corners: Array<{ p: [number, number, number]; uv: [number, number] }>;
}

function quads(mesh: Mesh): Quad[] {
  const out: Quad[] = [];
  for (let f = 0; f < mesh.faceCount; f++) {
    const corners: Quad["corners"] = [];
    for (let k = mesh.faceStart[f]; k < mesh.faceStart[f + 1]; k++) {
      const v = mesh.faceIndices[k] * 3;
      const p = mesh.positions;
      corners.push({ p: [p[v], p[v + 1], p[v + 2]], uv: [mesh.uvs![k * 2], mesh.uvs![k * 2 + 1]] });
    }
    const n = mesh.faceNormals;
    out.push({ normal: [Math.round(n[f * 3]), Math.round(n[f * 3 + 1]), Math.round(n[f * 3 + 2])], corners });
  }
  return out;
}

const dirOf = (n: [number, number, number]): number => [0, 1, 2, 3, 4, 5].find((d) => DIR_X[d] === n[0] && DIR_Y[d] === n[1] && DIR_Z[d] === n[2])!;

describe("chunk meshes", () => {
  it("makes a quad per exposed face, wound so its normal points out of the block", () => {
    const { solid, water } = meshesOf([[3, 5, 7, Block.Stone]]);
    expect(water).toBeNull();
    const qs = quads(solid!);
    expect(qs).toHaveLength(6);
    expect(new Set(qs.map((q) => dirOf(q.normal)))).toEqual(new Set([0, 1, 2, 3, 4, 5]));
    for (const q of qs) {
      // The face lies on the side of the block its normal points to
      const c = [0, 1, 2].map((a) => q.corners.reduce((s, k) => s + k.p[a], 0) / 4);
      expect(c[0] - 3.5).toBeCloseTo(q.normal[0] / 2);
      expect(c[1] - 5.5).toBeCloseTo(q.normal[1] / 2);
      expect(c[2] - 7.5).toBeCloseTo(q.normal[2] / 2);
    }
  });

  it("maps each face onto its own tile, laid out like the faces of Projector's Mesh.box", () => {
    const uvs = testUVs();
    const box = quads(Mesh.box(1));
    for (const q of quads(meshesOf([[0, 0, 0, Block.Grass]]).solid!)) {
      const d = dirOf(q.normal);
      const r = (Block.Grass * 6 + d) * 4;
      const reference = box.find((b) => dirOf(b.normal) === d)!;
      for (const { p, uv } of q.corners) {
        // Back to 0..1 within the tile, and the box corner at the same place (the box is centered)
        const u = (uv[0] - uvs[r]) / (uvs[r + 2] - uvs[r]);
        const v = (uv[1] - uvs[r + 1]) / (uvs[r + 3] - uvs[r + 1]);
        const same = reference.corners.find((k) => k.p.every((x, a) => Math.abs(x + 0.5 - p[a]) < 1e-6))!;
        expect(u).toBeCloseTo(same.uv[0], 5);
        expect(v).toBeCloseTo(same.uv[1], 5);
      }
    }
  });

  it("puts water in a mesh of its own, the top layer lowered and its sides cut off rather than squeezed", () => {
    const { solid, water } = meshesOf([
      [0, 0, 0, Block.Stone],
      [0, 1, 0, Block.Water],
      [0, 2, 0, Block.Water],
    ]);
    // Water doesn't count as solid: the stone's top (under the water) is in the solid mesh, not the water's
    expect(quads(solid!).every((q) => q.corners.every((k) => k.p[1] <= 1))).toBe(true);
    const qs = quads(water!);
    const top = Math.max(...qs.flatMap((q) => q.corners.map((k) => k.p[1])));
    expect(top).toBeCloseTo(2 + WATER_TOP, 5);
    const uvs = testUVs();
    const side = qs.find((q) => dirOf(q.normal) === 0 && q.corners.some((k) => k.p[1] > 2.5))!;
    const r = (Block.Water * 6 + 0) * 4;
    const vs = side.corners.map((k) => (k.uv[1] - uvs[r + 1]) / (uvs[r + 3] - uvs[r + 1]));
    expect(Math.min(...vs)).toBeCloseTo(1 - WATER_TOP, 5);
    expect(Math.max(...vs)).toBeCloseTo(1, 5);
  });

  it("keeps the faces between leaves with fancy leaves, for see-through textures", () => {
    const pair: Array<[number, number, number, number]> = [
      [4, 4, 4, Block.Leaves],
      [5, 4, 4, Block.Leaves],
    ];
    expect(quads(meshesOf(pair).solid!)).toHaveLength(10);
    expect(quads(meshesOf(pair, true).solid!)).toHaveLength(12);
  });

  it("has no meshes for an empty chunk", () => {
    const { solid, water } = meshesOf([]);
    expect(solid).toBeNull();
    expect(water).toBeNull();
  });
});

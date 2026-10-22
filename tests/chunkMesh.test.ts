import { describe, expect, it } from "vitest";
import { Mesh } from "projector";
import { BIOMES, Biome } from "../src/biomes.js";
import { Block, DIR_X, DIR_Y, DIR_Z, FACE_TILE, TILE_NAMES, stateOf, tileIndex } from "../src/blocks.js";
import { type Chunk, type ChunkGenerator } from "../src/chunk.js";
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

/** Every texture gets its own made-up rectangle, so tests can tell them apart. */
function testUVs(): Float32Array {
  const uvs = new Float32Array(TILE_NAMES.length * 4);
  for (let i = 0; i < TILE_NAMES.length; i++) uvs.set([i * 0.001, i * 0.002, i * 0.001 + 0.0005, i * 0.002 + 0.001], i * 4);
  return uvs;
}

function meshesOf(blocks: Array<[number, number, number, number]>, fancyLeaves = false): ReturnType<typeof buildChunkMeshes> {
  const world = new VoxelWorld(new BlocksGenerator(blocks));
  world.fancyLeaves = fancyLeaves;
  const chunk = world.load(0, 0);
  world.buildFaces(chunk);
  return buildChunkMeshes(world, chunk, testUVs());
}

interface Quad {
  normal: [number, number, number];
  corners: Array<{ p: [number, number, number]; uv: [number, number]; color: [number, number, number] }>;
}

function quads(mesh: Mesh): Quad[] {
  const out: Quad[] = [];
  for (let f = 0; f < mesh.faceCount; f++) {
    const corners: Quad["corners"] = [];
    for (let k = mesh.faceStart[f]; k < mesh.faceStart[f + 1]; k++) {
      const v = mesh.faceIndices[k] * 3;
      const p = mesh.positions;
      const c = mesh.colors!;
      const i = mesh.faceIndices[k] * 4;
      corners.push({ p: [p[v], p[v + 1], p[v + 2]], uv: [mesh.uvs![k * 2], mesh.uvs![k * 2 + 1]], color: c ? [c[i], c[i + 1], c[i + 2]] : [1, 1, 1] });
    }
    const n = mesh.faceNormals;
    out.push({ normal: [Math.round(n[f * 3]), Math.round(n[f * 3 + 1]), Math.round(n[f * 3 + 2])], corners });
  }
  return out;
}

const dirOf = (n: [number, number, number]): number => [0, 1, 2, 3, 4, 5].find((d) => DIR_X[d] === n[0] && DIR_Y[d] === n[1] && DIR_Z[d] === n[2])!;

/** A biome color as 0-1, as meshes carry it. */
const unit = (rgb: readonly number[]): number[] => rgb.map((v) => v / 255);

describe("chunk meshes", () => {
  it("colors grass by biome, blended across borders, and lays the tinted grass over its sides", () => {
    // A row of grass along x, in jungle on the west half of the chunk and desert on the east
    const world = new VoxelWorld(new BlocksGenerator(Array.from({ length: 16 }, (_, x): [number, number, number, number] => [x, 5, 8, Block.Grass])));
    const chunk = world.load(0, 0);
    for (let i = 0; i < 256; i++) chunk.biomes[i] = (i & 15) < 8 ? Biome.Jungle : Biome.Desert;
    world.buildFaces(chunk);
    const qs = quads(buildChunkMeshes(world, chunk, testUVs()).solid!);
    const tops = qs.filter((q) => dirOf(q.normal) === 2);
    const colorAt = (x: number): number[] => tops.flatMap((q) => q.corners).find((k) => k.p[0] === x)!.color;
    const jungle = unit(BIOMES[Biome.Jungle].grass);
    const desert = unit(BIOMES[Biome.Desert].grass);
    for (let c = 0; c < 3; c++) {
      expect(colorAt(0)[c]).toBeCloseTo(jungle[c], 4);
      expect(colorAt(16)[c]).toBeCloseTo(desert[c], 4);
      // On the border, half and half
      expect(colorAt(8)[c]).toBeCloseTo((jungle[c] + desert[c]) / 2, 4);
    }
    // Each side twice: the dirt side as it is, then the grass over it, tinted (and shaded like the side)
    const north = qs.filter((q) => dirOf(q.normal) === 5 && q.corners.every((k) => k.p[0] <= 1));
    expect(north).toHaveLength(2);
    const tile = (q: Quad): number => Math.round(Math.min(...q.corners.map((k) => k.uv[0])) / 0.001);
    expect(tile(north[0])).toBe(tileIndex("grass_block_side"));
    expect(tile(north[1])).toBe(tileIndex("grass_block_side_overlay"));
    for (const k of north[0].corners) k.color.forEach((v) => expect(v).toBeCloseTo(0.8, 5));
    for (const k of north[1].corners) k.color.forEach((v, c) => expect(v).toBeCloseTo(0.8 * jungle[c], 4));
  });

  it("colors birch and spruce leaves the same everywhere", () => {
    const world = new VoxelWorld(new BlocksGenerator([[2, 5, 2, Block.BirchLeaves]]));
    const chunk = world.load(0, 0);
    chunk.biomes.fill(Biome.Swamp);
    world.buildFaces(chunk);
    const top = quads(buildChunkMeshes(world, chunk, testUVs()).solid!).find((q) => dirOf(q.normal) === 2)!;
    for (const k of top.corners) k.color.forEach((v, c) => expect(v).toBeCloseTo([0x80, 0xa7, 0x55][c] / 255, 4));
  });

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
    for (const q of quads(meshesOf([[0, 0, 0, Block.Sandstone]]).solid!)) {
      const d = dirOf(q.normal);
      const r = FACE_TILE[Block.Sandstone * 6 + d] * 4;
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

  it("puts water in a mesh of its own, its surface below the shore and its sides cut off rather than squeezed", () => {
    // A 3 x 3 pool of sources on a stone floor
    const blocks: Array<[number, number, number, number]> = [];
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) blocks.push([x, 0, z, Block.Stone], [x, 1, z, Block.Water]);
    const { solid, water } = meshesOf(blocks);
    // Water doesn't count as solid: the stone's top (under the water) is in the solid mesh, not the water's
    expect(quads(solid!).every((q) => q.corners.every((k) => k.p[1] <= 1))).toBe(true);
    const qs = quads(water!);
    // In the middle the surface is a source's height, 8/9
    const middle = qs.find((q) => dirOf(q.normal) === 2 && q.corners.every((k) => k.p[0] >= 1 && k.p[0] <= 2 && k.p[2] >= 1 && k.p[2] <= 2))!;
    for (const k of middle.corners) expect(k.p[1]).toBeCloseTo(1 + 8 / 9, 5);
    // At the edge it slopes down toward the air beside, and the side shows as much texture as it is high
    const uvs = testUVs();
    const side = qs.find((q) => dirOf(q.normal) === 0 && q.corners.every((k) => k.p[2] >= 1 && k.p[2] <= 2))!;
    const height = Math.max(...side.corners.map((k) => k.p[1])) - 1;
    expect(height).toBeLessThan(8 / 9);
    expect(height).toBeGreaterThan(0.5);
    const r = FACE_TILE[Block.Water * 6] * 4;
    const vs = side.corners.map((k) => (k.uv[1] - uvs[r + 1]) / (uvs[r + 3] - uvs[r + 1]));
    expect(Math.min(...vs)).toBeCloseTo(1 - height, 5);
    expect(Math.max(...vs)).toBeCloseTo(1, 5);
  });

  it("leaves out the faces a slab covers, and draws the ones it leaves open", () => {
    const slab = stateOf(Block.StoneSlab, { type: "bottom" });
    // A bottom slab on stone, and stone beside it
    const { solid } = meshesOf([
      [4, 3, 4, Block.Stone],
      [4, 4, 4, slab],
      [5, 4, 4, Block.Stone],
    ]);
    const qs = quads(solid!);
    const at = (x: number, y: number, z: number, dir: number): number =>
      qs.filter((q) => dirOf(q.normal) === dir && q.corners.every((k) => k.p[0] >= x && k.p[0] <= x + 1 && k.p[1] >= y && k.p[1] <= y + 1 && k.p[2] >= z && k.p[2] <= z + 1)).length;
    // The stone under the slab: its top is covered by the slab's bottom, and the slab's bottom by the stone
    expect(at(4, 3, 4, 2)).toBe(0);
    expect(at(4, 4, 4, 3)).toBe(0);
    // The slab's top, half way up its cell, shows, and so does the side of the stone beside it
    expect(at(4, 4, 4, 2)).toBe(1);
    expect(at(5, 4, 4, 1)).toBe(1);
    // The slab's side against that stone is covered
    expect(at(4, 4, 4, 0)).toBe(0);
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

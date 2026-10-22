import { describe, expect, it } from "vitest";
import { Block, DIR_X, DIR_Y, DIR_Z, Dir } from "../src/blocks.js";
import { CHUNK_SIZE, WORLD_HEIGHT, type Chunk } from "../src/chunk.js";
import { VoxelWorld } from "../src/world.js";
import { flatWorld } from "./helpers.js";

interface Face {
  x: number;
  y: number;
  z: number;
  dir: number;
  block: number;
}

function facesOf(world: VoxelWorld, chunk: Chunk): Face[] {
  if (chunk.dirty) world.buildFaces(chunk);
  const out: Face[] = [];
  chunk.sections.forEach((section, s) => {
    for (let i = 0; i < section.faceCount; i++) {
      const f = section.faces[i];
      out.push({
        x: chunk.cx * CHUNK_SIZE + (f & 15),
        y: s * CHUNK_SIZE + ((f >> 8) & 15),
        z: chunk.cz * CHUNK_SIZE + ((f >> 4) & 15),
        dir: (f >> 12) & 7,
        block: f >>> 16,
      });
    }
  });
  return out;
}

const at = (faces: Face[], x: number, y: number, z: number): Face[] => faces.filter((f) => f.x === x && f.y === y && f.z === z);

describe("VoxelWorld faces", () => {
  it("shows only the top of a flat world, and the sides at the edge of what is loaded stay hidden", () => {
    const world = flatWorld(10, 0);
    const faces = facesOf(world, world.chunk(0, 0)!);
    expect(faces).toHaveLength(CHUNK_SIZE * CHUNK_SIZE);
    expect(faces.every((f) => f.dir === Dir.Up && f.y === 9)).toBe(true);
  });

  it("exposes the faces around a dug hole and across chunk borders", () => {
    const world = flatWorld(10, 1);
    world.set(0, 9, 0, Block.Air);
    const here = facesOf(world, world.chunk(0, 0)!);
    // The floor of the hole and three walls in this chunk; the -x wall belongs to the chunk next door
    expect(at(here, 0, 8, 0).map((f) => f.dir)).toEqual([Dir.Up]);
    expect(at(here, 1, 9, 0).map((f) => f.dir).sort()).toEqual([Dir.NegX, Dir.Up].sort());
    expect(world.chunk(-1, 0)!.dirty).toBe(true);
    const west = facesOf(world, world.chunk(-1, 0)!);
    expect(at(west, -1, 9, 0).map((f) => f.dir).sort()).toEqual([Dir.PosX, Dir.Up].sort());
  });

  it("draws solid faces under water, but not water faces against solid blocks", () => {
    const world = flatWorld(10, 0);
    world.set(4, 10, 4, Block.Water);
    world.set(5, 10, 4, Block.Water);
    const faces = facesOf(world, world.chunk(0, 0)!);
    // The stone under the water keeps its top
    expect(at(faces, 4, 9, 4).map((f) => f.dir)).toEqual([Dir.Up]);
    // Water shows its top (air above) and its sides toward air, not the side toward the other water
    const water = at(faces, 4, 10, 4);
    expect(water.map((f) => f.dir).sort()).toEqual([Dir.NegX, Dir.Up, Dir.PosZ, Dir.NegZ].sort());
    expect(water.every((f) => f.block === Block.Water)).toBe(true);
  });
});

describe("chunks of sections", () => {
  it("stores blocks in 16-high sections and frees a section when its last block goes", () => {
    const world = flatWorld(10, 0);
    const chunk = world.chunk(0, 0)!;
    expect(chunk.sections[0].count).toBe(CHUNK_SIZE * CHUNK_SIZE * 10);
    expect(chunk.sections[1].blocks).toBeNull();
    expect(world.set(3, 16, 4, Block.Planks)).toBe(true);
    expect(world.get(3, 16, 4)).toBe(Block.Planks);
    expect(chunk.sections[1].count).toBe(1);
    world.set(3, 16, 4, Block.Air);
    expect(chunk.sections[1].blocks).toBeNull();
    expect(chunk.sections[1].count).toBe(0);
    // The top of the world is 255
    expect(world.set(0, WORLD_HEIGHT - 1, 0, Block.Stone)).toBe(true);
    expect(world.set(0, WORLD_HEIGHT, 0, Block.Stone)).toBe(false);
  });

  it("rebuilds the sections on both sides of a section border", () => {
    const world = flatWorld(16, 0);
    const chunk = world.chunk(0, 0)!;
    world.buildFaces(chunk);
    // The stone's top is at y 15, the top of section 0; a block on it lies in section 1
    world.set(5, 16, 5, Block.Stone);
    expect(chunk.sections[0].dirty).toBe(true);
    expect(chunk.sections[1].dirty).toBe(true);
    expect(chunk.sections[2].dirty).toBe(false);
    const faces = facesOf(world, chunk);
    // Covered: no top face under the new block, and the new block has no bottom face
    expect(at(faces, 5, 15, 5)).toEqual([]);
    expect(at(faces, 5, 16, 5).map((f) => f.dir).sort()).toEqual([Dir.PosX, Dir.NegX, Dir.Up, Dir.PosZ, Dir.NegZ].sort());
  });

  it("finds missing chunks nearest first, and unloads the far ones", () => {
    const world = flatWorld(4, 0);
    const missing = [...world.missingAround(8, 8, 1)];
    expect(missing).toHaveLength(8);
    expect(missing.some(([cx, cz]) => cx === 0 && cz === 0)).toBe(false);
    world.loadAround(8, 8, 3, Infinity);
    const loaded = world.chunks.size;
    const dropped = world.unloadOutside(8, 8, 1);
    expect(dropped.length + world.chunks.size).toBe(loaded);
    expect(world.chunks.size).toBe(9);
    expect(dropped.every((c) => Math.max(Math.abs(c.cx), Math.abs(c.cz)) > 1)).toBe(true);
    expect(world.get(40, 2, 0)).toBe(Block.Air);
  });

  it("shows the faces toward a neighbor that arrives later", () => {
    const world = flatWorld(10, 0);
    world.set(15, 9, 0, Block.Air);
    const here = world.chunk(0, 0)!;
    facesOf(world, here);
    // The hole's +x wall belongs to the chunk next door, which comes later and draws it
    world.load(1, 0);
    expect(here.dirty).toBe(true);
    expect(at(facesOf(world, world.chunk(1, 0)!), 16, 9, 0).map((f) => f.dir).sort()).toEqual([Dir.NegX, Dir.Up].sort());
  });
});

describe("solid sections", () => {
  it("finds every face of a section of nothing but opaque blocks on its outer layer alone", () => {
    const world = flatWorld(48, 1);
    // Holes next to section 1 (y 16-31) of chunk (0, 0) but not in it: above, below and in the chunks beside
    for (const [x, y, z] of [[5, 32, 5], [0, 15, 9], [-1, 20, 3], [16, 31, 15], [4, 25, -1]]) world.set(x, y, z, Block.Air);
    const chunk = world.chunk(0, 0)!;
    expect(chunk.sections[1].opaque).toBe(4096);
    const key = (f: { x: number; y: number; z: number; dir: number }): string => `${f.x},${f.y},${f.z},${f.dir}`;
    // Every face, the slow way: each block of the chunk next to air in a loaded chunk
    const expected: string[] = [];
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          if (world.get(x, y, z) === Block.Air) continue;
          for (let dir = 0; dir < 6; dir++) {
            const [nx, ny, nz] = [x + DIR_X[dir], y + DIR_Y[dir], z + DIR_Z[dir]];
            if (ny < 0 || !world.chunk(nx >> 4, nz >> 4) || world.get(nx, ny, nz) !== Block.Air) continue;
            expected.push(key({ x, y, z, dir }));
          }
        }
      }
    }
    expect(facesOf(world, chunk).map(key).sort()).toEqual(expected.sort());
    // One face of section 1 toward each hole
    expect(expected.filter((k) => /^\d+,(1[6-9]|2\d|3[01]),/.test(k))).toHaveLength(5);
  });
});

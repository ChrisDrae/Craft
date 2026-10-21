import { describe, expect, it } from "vitest";
import { Block, Dir } from "../src/blocks.js";
import { CHUNK_SIZE, WORLD_HEIGHT, type Chunk } from "../src/chunk.js";
import { SEA_LEVEL, TerrainGenerator } from "../src/generator.js";
import { VoxelWorld } from "../src/world.js";
import { flatWorld } from "./helpers.js";

interface Face {
  x: number;
  y: number;
  z: number;
  dir: number;
  block: number;
  lowered: boolean;
}

function facesOf(world: VoxelWorld, chunk: Chunk): Face[] {
  if (chunk.dirty) world.buildFaces(chunk);
  const out: Face[] = [];
  for (let i = 0; i < chunk.faceCount; i++) {
    const f = chunk.faces[i];
    out.push({
      x: chunk.cx * CHUNK_SIZE + (f & 15),
      y: (f >> 8) & 63,
      z: chunk.cz * CHUNK_SIZE + ((f >> 4) & 15),
      dir: (f >> 14) & 7,
      block: (f >> 17) & 255,
      lowered: ((f >> 25) & 1) === 1,
    });
  }
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
    // Water shows its top (lowered, air above) and its sides toward air, not the side toward the other water
    const water = at(faces, 4, 10, 4);
    expect(water.map((f) => f.dir).sort()).toEqual([Dir.NegX, Dir.Up, Dir.PosZ, Dir.NegZ].sort());
    expect(water.every((f) => f.block === Block.Water && f.lowered)).toBe(true);
  });
});

describe("TerrainGenerator", () => {
  it("makes the same terrain for the same seed", () => {
    const a = new VoxelWorld(new TerrainGenerator("test")).load(3, -2);
    const b = new VoxelWorld(new TerrainGenerator("test")).load(3, -2);
    const c = new VoxelWorld(new TerrainGenerator("other")).load(3, -2);
    expect(a.blocks).toEqual(b.blocks);
    expect(a.blocks).not.toEqual(c.blocks);
  });

  it("has bedrock at the bottom, water up to sea level and the expected blocks", () => {
    const world = new VoxelWorld(new TerrainGenerator("test"));
    world.loadAround(0, 0, 6, Infinity);
    const counts = new Map<number, number>();
    for (const chunk of world.chunks.values()) {
      for (const b of chunk.blocks) counts.set(b, (counts.get(b) ?? 0) + 1);
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          expect(chunk.get(x, 0, z)).toBe(Block.Bedrock);
          expect(chunk.get(x, SEA_LEVEL + 1, z)).not.toBe(Block.Water);
          expect(chunk.get(x, WORLD_HEIGHT - 1, z)).toBe(Block.Air);
        }
      }
    }
    for (const b of [Block.Grass, Block.Dirt, Block.Stone, Block.Sand, Block.Water, Block.Log, Block.Leaves, Block.CoalOre, Block.IronOre]) {
      expect(counts.get(b) ?? 0, `block ${b}`).toBeGreaterThan(0);
    }
  });

  it("grows trees across chunk borders without cutting them off", () => {
    const world = new VoxelWorld(new TerrainGenerator("test"));
    world.loadAround(0, 0, 4, Infinity);
    // Every log with air above it must carry leaves on top, wherever its chunk border is
    let trees = 0;
    for (const chunk of world.chunks.values()) {
      for (let y = 1; y < WORLD_HEIGHT - 1; y++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          for (let x = 0; x < CHUNK_SIZE; x++) {
            if (chunk.get(x, y, z) !== Block.Log || chunk.get(x, y + 1, z) === Block.Log) continue;
            trees++;
            expect(chunk.get(x, y + 1, z)).toBe(Block.Leaves);
          }
        }
      }
    }
    expect(trees).toBeGreaterThan(3);
  });
});

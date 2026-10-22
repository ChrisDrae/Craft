import { describe, expect, it } from "vitest";
import { Random } from "projector";
import { Block, stateOf } from "../src/blocks.js";
import { CHUNK_SIZE, Chunk, type ChunkGenerator } from "../src/chunk.js";
import { lightChunk } from "../src/light.js";
import { VoxelWorld } from "../src/world.js";
import { flatWorld } from "./helpers.js";

const sky = (world: VoxelWorld, x: number, y: number, z: number): number => world.getLight(x, y, z) >> 4;
const glow = (world: VoxelWorld, x: number, y: number, z: number): number => world.getLight(x, y, z) & 15;

/** Stone up to y 20, with a tunnel along x at y 5, z 5 through every chunk. */
class TunnelGenerator implements ChunkGenerator {
  generate(chunk: Chunk): void {
    for (let y = 0; y < 20; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) if (!(y === 5 && z === 5)) chunk.set(x, y, z, Block.Stone);
      }
    }
  }
}

describe("light", () => {
  it("is full sky light above the ground and none in it", () => {
    const world = flatWorld(10, 1);
    expect(sky(world, 5, 10, 5)).toBe(15);
    expect(sky(world, 5, 200, 5)).toBe(15);
    expect(world.getLight(5, 9, 5)).toBe(0);
    expect(world.getLight(5, 2, 5)).toBe(0);
  });

  it("dims under a roof, one level per block from where the sky is open", () => {
    const world = flatWorld(10, 1);
    for (let x = 0; x < 10; x++) for (let z = 0; z < 10; z++) world.set(x, 13, z, Block.Planks);
    // The open sky beyond x = -1 (and z = -1) is five blocks from (4, *, 4)
    expect(sky(world, 4, 12, 4)).toBe(10);
    expect(sky(world, 4, 10, 4)).toBe(10);
    expect(sky(world, 0, 10, 0)).toBe(14);
    // Above the roof the sky is open as before
    expect(sky(world, 4, 14, 4)).toBe(15);
  });

  it("is restored when the block that cut it off goes", () => {
    const world = flatWorld(10, 1);
    world.set(5, 20, 5, Block.Stone);
    expect(sky(world, 5, 15, 5)).toBe(14);
    world.set(5, 20, 5, Block.Air);
    expect(sky(world, 5, 15, 5)).toBe(15);
    expect(sky(world, 5, 10, 5)).toBe(15);
  });

  it("spreads from a torch in a sealed room, one level less per block, and goes with it", () => {
    const world = flatWorld(40, 1);
    for (let x = 2; x <= 12; x++) for (let z = 2; z <= 12; z++) for (let y = 20; y <= 24; y++) world.set(x, y, z, Block.Air);
    const torch = stateOf(Block.Torch, { facing: "up" });
    world.set(7, 20, 7, torch);
    expect(glow(world, 7, 20, 7)).toBe(14);
    expect(glow(world, 8, 20, 7)).toBe(13);
    expect(glow(world, 9, 21, 7)).toBe(11);
    expect(glow(world, 12, 24, 12)).toBe(14 - 5 - 4 - 5);
    // Stone stops it, and no sky gets in
    expect(glow(world, 13, 20, 7)).toBe(0);
    expect(sky(world, 7, 22, 7)).toBe(0);
    world.set(7, 20, 7, Block.Air);
    for (const [x, y, z] of [[7, 20, 7], [8, 20, 7], [12, 24, 12]]) expect(glow(world, x, y, z)).toBe(0);
  });

  it("crosses chunk borders, also into a chunk that arrives later", () => {
    const world = new VoxelWorld(new TunnelGenerator());
    world.load(0, 0);
    world.set(13, 5, 5, Block.Glowstone);
    expect(glow(world, 15, 5, 5)).toBe(13);
    // The next chunk's tunnel was lit on its own (dark): joining brings the light in
    world.load(1, 0);
    expect(glow(world, 16, 5, 5)).toBe(12);
    expect(glow(world, 20, 5, 5)).toBe(8);
    // And an edit next door reaches back
    world.set(18, 5, 5, Block.Stone);
    expect(glow(world, 20, 5, 5)).toBe(0);
    expect(glow(world, 17, 5, 5)).toBe(11);
  });

  it("gets into slabs and stairs but not through them", () => {
    const world = flatWorld(40, 1);
    for (let x = 2; x <= 12; x++) for (let z = 2; z <= 12; z++) for (let y = 20; y <= 24; y++) world.set(x, y, z, Block.Air);
    // A slab in the open has full sky light; a slab roof over a room lets none in
    world.set(5, 40, 5, Block.StoneSlab);
    expect(sky(world, 5, 40, 5)).toBe(15);
    expect(sky(world, 5, 39, 5)).toBe(0);
    for (let x = 2; x <= 12; x++) for (let z = 2; z <= 12; z++) world.set(x, 25, z, stateOf(Block.StoneSlab, { type: "top" }));
    expect(sky(world, 7, 24, 7)).toBe(0);
    // A torch lights the stairs beside it, a level less, and nothing behind them: a wall of stairs and stone
    world.set(7, 20, 7, stateOf(Block.Torch, { facing: "up" }));
    for (let z = 2; z <= 12; z++) {
      world.set(8, 20, z, Block.OakStairs);
      for (let y = 21; y <= 24; y++) world.set(8, y, z, Block.Stone);
    }
    expect(glow(world, 8, 20, 7)).toBe(13);
    expect(glow(world, 8, 20, 5)).toBe(11);
    expect(glow(world, 9, 20, 7)).toBe(0);
  });

  it("after any edits equals the light of the same blocks lit from scratch", () => {
    const world = flatWorld(30, 1);
    const rnd = new Random("edits");
    const pick = (n: number): number => Math.floor(rnd.next() * n);
    const blocks = [Block.Air, Block.Air, Block.Air, Block.Stone, Block.Leaves, Block.Water, Block.Glowstone, stateOf(Block.Torch, { facing: "up" }), Block.StoneSlab, Block.OakStairs];
    for (let i = 0; i < 400; i++) world.set(pick(40) - 20, 20 + pick(16), pick(40) - 20, blocks[pick(blocks.length)]);

    // The same blocks, each chunk lit on its own and joined as chunks are when they arrive
    const fresh = new VoxelWorld(world.generator);
    for (const chunk of world.chunks.values()) {
      const copy = new Chunk(chunk.cx, chunk.cz);
      for (let y = 0; y < 64; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) copy.set(x, y, z, chunk.get(x, y, z));
      lightChunk(copy);
      fresh.insert(copy);
    }
    let checked = 0;
    for (let y = 0; y < 64; y++) {
      for (let z = -16; z < 32; z++) {
        for (let x = -16; x < 32; x++) {
          if (world.getLight(x, y, z) !== fresh.getLight(x, y, z)) expect({ x, y, z, light: world.getLight(x, y, z) }).toEqual({ x, y, z, light: fresh.getLight(x, y, z) });
          checked++;
        }
      }
    }
    expect(checked).toBe(64 * 48 * 48);
  });
});

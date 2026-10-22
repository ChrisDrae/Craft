import { describe, expect, it } from "vitest";
import { assembleChunk, generateChunk } from "../src/generation.js";
import { TerrainGenerator } from "../src/generator.js";
import { VoxelWorld } from "../src/world.js";

describe("generation in a worker", () => {
  it("makes the same chunks as generating on the main thread", () => {
    const direct = new VoxelWorld(new TerrainGenerator("same")).load(-3, 5);
    const posted = generateChunk(new TerrainGenerator("same"), -3, 5);
    // Through structured cloning, as postMessage does
    const chunk = assembleChunk(structuredClone(posted));
    expect([chunk.cx, chunk.cz]).toEqual([-3, 5]);
    for (let s = 0; s < chunk.sections.length; s++) {
      expect(chunk.sections[s].blocks).toEqual(direct.sections[s].blocks);
      expect(chunk.sections[s].count).toBe(direct.sections[s].count);
    }
    // Empty sections travel as nothing
    expect(posted.sections.at(-1)).toBeNull();
  });

  it("puts a chunk from the worker into the world like a generated one", () => {
    const world = new VoxelWorld(new TerrainGenerator("same"));
    const west = world.load(-1, 0);
    world.buildFaces(west);
    world.insert(assembleChunk(generateChunk(new TerrainGenerator("same"), 0, 0)));
    expect(world.chunk(0, 0)).toBeDefined();
    // The neighbor shows the faces it hid while this chunk was missing
    expect(west.dirty).toBe(true);
  });
});

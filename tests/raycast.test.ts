import { describe, expect, it } from "vitest";
import { Block } from "../src/blocks.js";
import { raycastVoxels } from "../src/raycast.js";
import { flatWorld } from "./helpers.js";

const solid = (b: number): boolean => b !== Block.Air && b !== Block.Water;

describe("raycastVoxels", () => {
  const world = flatWorld(10);
  const blockAt = (x: number, y: number, z: number): number => world.get(x, y, z);

  it("hits the ground below with an upward normal", () => {
    const hit = raycastVoxels(blockAt, solid, 0.5, 11.6, 0.5, 0, -1, 0, 6);
    expect(hit).toMatchObject({ x: 0, y: 9, z: 0, nx: 0, ny: 1, nz: 0, block: Block.Stone });
    expect(hit!.distance).toBeCloseTo(1.6);
  });

  it("hits a wall face on the side it came from", () => {
    world.set(3, 10, 0, Block.Planks);
    const hit = raycastVoxels(blockAt, solid, 0.5, 10.5, 0.5, 1, 0, 0, 6);
    expect(hit).toMatchObject({ x: 3, y: 10, z: 0, nx: -1, ny: 0, nz: 0, block: Block.Planks });
    const back = raycastVoxels(blockAt, solid, 6.5, 10.5, 0.5, -1, 0, 0, 6);
    expect(back).toMatchObject({ x: 3, nx: 1 });
    world.set(3, 10, 0, Block.Air);
  });

  it("works with negative coordinates and diagonal rays", () => {
    const d = Math.SQRT1_2;
    const hit = raycastVoxels(blockAt, solid, -3.5, 10.5, -3.2, 0, -d, -d, 6);
    expect(hit).toMatchObject({ x: -4, y: 9, z: -4, ny: 1 });
    // Starting in cell z = -5 close to its edge, the ray crosses into z = -6 before reaching the ground
    const far = raycastVoxels(blockAt, solid, -3.5, 10.2, -4.9, 0, -d, -d, 6);
    expect(far).toMatchObject({ x: -4, y: 9, z: -6, ny: 1 });
  });

  it("misses beyond its reach", () => {
    expect(raycastVoxels(blockAt, solid, 0.5, 20.5, 0.5, 0, -1, 0, 6)).toBeNull();
  });

  it("goes through water", () => {
    world.set(1, 10, 1, Block.Water);
    const hit = raycastVoxels(blockAt, solid, 1.5, 11.5, 1.5, 0, -1, 0, 6);
    expect(hit).toMatchObject({ x: 1, y: 9, z: 1, block: Block.Stone });
    world.set(1, 10, 1, Block.Air);
  });
});

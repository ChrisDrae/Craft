import { describe, expect, it } from "vitest";
import { Block, Dir, propertyOf, stateOf } from "../src/blocks.js";
import { Chunk, type ChunkGenerator } from "../src/chunk.js";
import { buildChunkMeshes } from "../src/chunkMesh.js";
import { assembleChunk, generateChunk } from "../src/generation.js";
import { TerrainGenerator } from "../src/generator.js";
import { BlockInteraction } from "../src/interaction.js";
import { levelBrightness, lightMapColors } from "../src/lightmap.js";
import { lightChunk } from "../src/light.js";
import { placementState } from "../src/placement.js";
import { Player } from "../src/player.js";
import { SUPPORT } from "../src/shapes.js";
import { WorldTicks } from "../src/ticks.js";
import { BlockUpdates } from "../src/updates.js";
import { DAY, celestialAngle, daylightAt } from "../src/sky.js";
import type { Terrain } from "../src/terrain.js";
import { VoxelWorld } from "../src/world.js";
import { flatWorld } from "./helpers.js";

/** Places the given blocks in chunk (0, 0) on a stone floor at y 0-9. */
class RoomGenerator implements ChunkGenerator {
  constructor(private readonly blocks: Array<[number, number, number, number]> = []) {}

  generate(chunk: Chunk): void {
    for (let y = 0; y < 10; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk.set(x, y, z, Block.Stone);
    if (chunk.cx === 0 && chunk.cz === 0) for (const [x, y, z, b] of this.blocks) chunk.set(x, y, z, b);
  }
}

/**
 * The corners at a point of the top faces in a chunk's solid mesh: brightness (color) and light (uvs2) per
 * corner.
 */
function cornersAt(world: VoxelWorld, x: number, y: number, z: number): Array<{ color: number; block: number; sky: number }> {
  const chunk = world.chunk(0, 0)!;
  world.buildFaces(chunk);
  const mesh = buildChunkMeshes(world, chunk, new Float32Array(256 * 6 * 4)).solid!;
  const out = [];
  for (let f = 0; f < mesh.faceCount; f++) {
    if (mesh.faceNormals[f * 3 + 1] < 0.5) continue;
    for (let k = mesh.faceStart[f]; k < mesh.faceStart[f + 1]; k++) {
      const v = mesh.faceIndices[k] * 3;
      if (mesh.positions[v] !== x || mesh.positions[v + 1] !== y || mesh.positions[v + 2] !== z) continue;
      out.push({ color: mesh.colors![k * 4], block: mesh.uvs2![k * 2] * 16 - 0.5, sky: mesh.uvs2![k * 2 + 1] * 16 - 0.5 });
    }
  }
  return out;
}

describe("smooth lighting", () => {
  it("lights a top face in the open fully, and shades corners next to a block", () => {
    const world = new VoxelWorld(new RoomGenerator([[5, 10, 5, Block.Stone]]));
    world.loadAround(8, 8, 1, Infinity);
    // The floor corner far from anything: full sky light, no occlusion, tops unshaded
    for (const c of cornersAt(world, 12, 10, 12)) expect(c).toEqual({ color: 1, block: 0, sky: 15 });
    // The floor corners at the foot of the block: occluded by it on one side
    const foot = cornersAt(world, 6, 10, 6);
    expect(foot).toHaveLength(3);
    for (const c of foot) expect(c.color).toBeCloseTo(0.8, 6);
  });

  it("takes a corner's light from the blocks around it, a torch's included", () => {
    const torch = stateOf(Block.Torch, { facing: "up" });
    const blocks: Array<[number, number, number, number]> = [];
    // A closed stone box at y 10-14 around x, z 2-8 with a torch inside
    for (let y = 10; y <= 14; y++) for (let z = 1; z <= 9; z++) for (let x = 1; x <= 9; x++) if (x === 1 || x === 9 || z === 1 || z === 9 || y === 14) blocks.push([x, y, z, Block.Stone]);
    blocks.push([5, 10, 5, torch]);
    const world = new VoxelWorld(new RoomGenerator(blocks));
    world.loadAround(8, 8, 1, Infinity);
    const near = cornersAt(world, 6, 10, 6);
    expect(near.length).toBeGreaterThan(0);
    for (const c of near) {
      expect(c.sky).toBe(0);
      expect(c.block).toBeGreaterThan(11);
    }
    // Farther from the torch is darker
    const far = cornersAt(world, 3, 10, 3);
    expect(Math.max(...far.map((c) => c.block))).toBeLessThan(Math.min(...near.map((c) => c.block)));
  });
});

describe("torches", () => {
  it("stand on floors and hang on walls, never on ceilings", () => {
    const on = (nx: number, ny: number, nz: number): number | null => placementState(Block.Torch, { nx, ny, nz, hy: 0.5 }, 0);
    expect(propertyOf(on(0, 1, 0)!, "facing")).toBe("up");
    expect(propertyOf(on(1, 0, 0)!, "facing")).toBe("east");
    expect(propertyOf(on(0, 0, -1)!, "facing")).toBe("north");
    expect(on(0, -1, 0)).toBeNull();
    // Each hangs on the block it was placed against
    expect(SUPPORT[on(1, 0, 0)!]).toBe(Dir.NegX);
    expect(SUPPORT[on(0, 1, 0)!]).toBe(Dir.Down);
  });

  it("are placed against a block, light up, and come off when it breaks", () => {
    const world = flatWorld(10, 1);
    const updates = new BlockUpdates(world, new WorldTicks(world));
    world.onChanged = (x, y, z) => updates.changed(x, y, z);
    world.set(4, 10, 4, Block.Stone);
    const player = new Player(world, { x: 0.5, y: 10, z: 0.5 });
    const interaction = new BlockInteraction(world, player, { target: null } as unknown as Terrain);
    interaction.select(7);
    expect(interaction.selectedBlock).toBe(Block.Torch);
    // Against the east side of the stone block
    interaction.target = { x: 4, y: 10, z: 4, nx: 1, ny: 0, nz: 0, block: Block.Stone, distance: 3 };
    expect(interaction.placeAtTarget()).toBe(true);
    expect(world.get(5, 10, 4)).toBe(stateOf(Block.Torch, { facing: "east" }));
    expect(world.getLight(5, 10, 4) & 15).toBe(14);
    // Not under a ceiling, not against a torch
    interaction.target = { x: 4, y: 10, z: 4, nx: 0, ny: -1, nz: 0, block: Block.Stone, distance: 3 };
    expect(interaction.placeAtTarget()).toBe(false);
    interaction.target = { x: 5, y: 10, z: 4, nx: 1, ny: 0, nz: 0, block: world.get(5, 10, 4), distance: 3 };
    expect(interaction.placeAtTarget()).toBe(false);
    // Breaking the stone takes the torch with it, and its light
    interaction.target = { x: 4, y: 10, z: 4, nx: 0, ny: 1, nz: 0, block: Block.Stone, distance: 3 };
    expect(interaction.breakTarget()).toBe(true);
    expect(world.get(5, 10, 4)).toBe(Block.Air);
    expect(world.getLight(5, 10, 4) & 15).toBe(0);
  });
});

describe("the light map", () => {
  it("brightens with the light level, from black at 0 to full at 15", () => {
    for (let l = 1; l < 16; l++) expect(levelBrightness(l)).toBeGreaterThan(levelBrightness(l - 1));
    expect(levelBrightness(0)).toBe(0);
    expect(levelBrightness(15)).toBe(1);
  });

  it("dims the sky at night but not torches, and keeps caves nearly black", () => {
    const day = lightMapColors(1);
    const night = lightMapColors(0);
    const at = (c: Float32Array, sky: number, block: number): number => c[(sky * 16 + block) * 3 + 1];
    expect(at(day, 15, 0)).toBeGreaterThan(0.95);
    expect(at(night, 15, 0)).toBeLessThan(0.35);
    expect(at(night, 15, 0)).toBeGreaterThan(at(night, 0, 0));
    expect(Math.abs(at(night, 0, 14) - at(day, 0, 14))).toBeLessThan(0.01);
    expect(at(day, 0, 0)).toBeLessThan(0.1);
    // Moonlight is bluish; torchlight warm
    expect(night[(15 * 16) * 3 + 2]).toBeGreaterThan(night[(15 * 16) * 3]);
    expect(day[14 * 3]).toBeGreaterThan(day[14 * 3 + 2]);
  });
});

describe("the day", () => {
  it("starts at sunrise, with noon a quarter day later and midnight three quarters", () => {
    expect(celestialAngle(0)).toBeGreaterThan(0.75);
    expect(celestialAngle(0)).toBeLessThan(0.8);
    expect(celestialAngle(6000)).toBeCloseTo(0, 6);
    expect(celestialAngle(18000)).toBeCloseTo(0.5, 6);
    expect(celestialAngle(6000 + DAY)).toBeCloseTo(0, 6);
  });

  it("has full daylight at noon, none at midnight, and some at sunrise and sunset", () => {
    expect(daylightAt(celestialAngle(6000))).toBe(1);
    expect(daylightAt(celestialAngle(18000))).toBe(0);
    for (const t of [0, 12500]) {
      const d = daylightAt(celestialAngle(t));
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(1);
    }
  });
});

describe("light from the worker", () => {
  it("is the light of the chunk lit where it's put together", () => {
    const direct = new Chunk(4, -2);
    new TerrainGenerator("lit").generate(direct);
    lightChunk(direct);
    const posted = assembleChunk(structuredClone(generateChunk(new TerrainGenerator("lit"), 4, -2)));
    for (let s = 0; s < 16; s++) {
      expect(posted.sections[s].light).toEqual(direct.sections[s].light);
      expect(posted.sections[s].lightFill).toBe(direct.sections[s].lightFill);
    }
    // Open sky over the top sections, darkness deep down
    expect(posted.sections[15].light).toBeNull();
    expect(posted.sections[15].lightFill).toBe(0xf0);
    expect(posted.sections[0].lightFill).toBe(0);
  });
});

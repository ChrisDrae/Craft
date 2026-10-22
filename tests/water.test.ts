import { describe, expect, it } from "vitest";
import { Simulation } from "projector";
import { Block } from "../src/blocks.js";
import { CHUNK_SIZE, type Chunk, type ChunkGenerator } from "../src/chunk.js";
import { Player } from "../src/player.js";
import { VoxelWorld } from "../src/world.js";

/** The highest water block; the water's top is at WATER + 1. */
const WATER = 12;
/** Where the bank starts (x). */
const SHORE = 10;

/**
 * A pool along x < SHORE, `depth` blocks of water over a stone floor, and a stone bank from SHORE on whose
 * top is at `bankTop`.
 */
class PoolGenerator implements ChunkGenerator {
  constructor(
    private readonly depth: number,
    private readonly bankTop: number,
  ) {}

  generate(chunk: Chunk): void {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = chunk.cx * CHUNK_SIZE + x;
        const top = wx < SHORE ? WATER + 1 - this.depth : this.bankTop;
        for (let y = 0; y < top; y++) chunk.set(x, y, z, Block.Stone);
        if (wx < SHORE) for (let y = top; y <= WATER; y++) chunk.set(x, y, z, Block.Water);
      }
    }
  }
}

/** A player in the pool facing the bank (+x), with W and Space held unless told otherwise. */
function setup(depth: number, bankTop: number, start: { x: number; y: number }): { sim: Simulation; player: Player } {
  const world = new VoxelWorld(new PoolGenerator(depth, bankTop));
  world.loadAround(0, 0, 2, Infinity);
  const sim = new Simulation();
  const player = sim.add(new Player(world, { x: start.x, y: start.y, z: 0.5 }));
  player.yaw = Math.PI / 2;
  player.input.forward = 1;
  player.input.jump = true;
  return { sim, player };
}

function run(sim: Simulation, seconds: number, each?: () => void): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    sim.frame(1 / 60);
    each?.();
  }
}

/** Holds W and Space until the player is well onto the bank (or time runs out), then lets go and settles. */
function climbOut(sim: Simulation, player: Player, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 60) && player.position.x < SHORE + 0.5; i++) sim.frame(1 / 60);
  player.input.forward = 0;
  player.input.jump = false;
  run(sim, 1);
}

describe("getting out of the water", () => {
  it("climbs from deep water onto a bank one block above the water", () => {
    const { sim, player } = setup(4, WATER + 2, { x: 7.5, y: 10 });
    climbOut(sim, player, 4);
    expect(player.position.x).toBeGreaterThan(SHORE);
    expect(player.position.y).toBeCloseTo(WATER + 2, 2);
    expect(player.onGround).toBe(true);
  });

  it("climbs from deep water onto a bank level with the water", () => {
    const { sim, player } = setup(4, WATER + 1, { x: 7.5, y: 10 });
    climbOut(sim, player, 4);
    expect(player.position.x).toBeGreaterThan(SHORE);
    expect(player.position.y).toBeCloseTo(WATER + 1, 2);
  });

  it("jumps from the bottom of shallow water onto the bank", () => {
    // Shallow water with a bank one block above its floor
    const { sim, player } = setup(1, WATER + 1, { x: 8.5, y: WATER });
    player.input.jump = false;
    player.input.forward = 0;
    run(sim, 0.5);
    expect(player.onGround).toBe(true);
    expect(player.inWater).toBe(true);
    player.input.jump = true;
    player.input.forward = 1;
    climbOut(sim, player, 3);
    expect(player.position.x).toBeGreaterThan(SHORE);
    expect(player.position.y).toBeCloseTo(WATER + 1, 2);
  });

  it("floats at the surface in open water without leaving it", () => {
    const { sim, player } = setup(4, WATER + 2, { x: 3.5, y: 10 });
    player.input.forward = 0;
    run(sim, 2);
    let low = Infinity;
    let high = -Infinity;
    run(sim, 2, () => {
      low = Math.min(low, player.position.y);
      high = Math.max(high, player.position.y);
    });
    // The feet stay in the top water block, bobbing just under the water's top
    expect(low).toBeGreaterThan(WATER);
    expect(high).toBeLessThan(WATER + 1);
  });

  it("can't climb a wall two blocks above the water", () => {
    const { sim, player } = setup(4, WATER + 3, { x: 7.5, y: 10 });
    run(sim, 4);
    expect(player.position.x).toBeLessThan(SHORE);
  });
});

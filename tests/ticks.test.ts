import { describe, expect, it } from "vitest";
import { Block } from "../src/blocks.js";
import { RANDOM_TICKS, TICKS_PER_SECOND, WorldTicks, type TickBehavior } from "../src/ticks.js";
import { flatWorld } from "./helpers.js";

describe("WorldTicks", () => {
  it("runs scheduled ticks when due, earlier-scheduled first, once per block", () => {
    const world = flatWorld(4, 0);
    world.set(1, 4, 1, Block.Sand);
    world.set(2, 4, 1, Block.Sand);
    const ran: string[] = [];
    const sand: TickBehavior = { scheduled: (_w, x, _y, _z, _s, t) => ran.push(`${x}@${t.time}`) };
    const ticks = new WorldTicks(world, new Map([[Block.Sand, sand]]));
    ticks.schedule(2, 4, 1, Block.Sand, 2);
    ticks.schedule(1, 4, 1, Block.Sand, 2);
    // Asking again for a block that is already waiting changes nothing
    ticks.schedule(2, 4, 1, Block.Sand, 1);
    ticks.tick();
    expect(ran).toEqual([]);
    ticks.tick();
    expect(ran).toEqual(["2@2", "1@2"]);
    expect(ticks.scheduledCount).toBe(0);
  });

  it("drops a scheduled tick when the block was replaced, and lets a tick schedule the next one", () => {
    const world = flatWorld(4, 0);
    world.set(1, 4, 1, Block.Sand);
    world.set(3, 4, 3, Block.Sand);
    let runs = 0;
    const sand: TickBehavior = {
      scheduled: (_w, x, y, z, _s, t) => {
        runs++;
        if (runs < 3) t.schedule(x, y, z, Block.Sand, 5);
      },
    };
    const ticks = new WorldTicks(world, new Map([[Block.Sand, sand]]));
    ticks.schedule(1, 4, 1, Block.Sand, 1);
    ticks.schedule(3, 4, 3, Block.Sand, 1);
    world.set(3, 4, 3, Block.Air);
    for (let i = 0; i < 20; i++) ticks.tick();
    expect(runs).toBe(3);
  });

  it("gives every section RANDOM_TICKS random blocks per tick, the same for the same seed", () => {
    const world = flatWorld(16, 0);
    const counted = (seed: string): number[] => {
      const hits: number[] = [];
      const stone: TickBehavior = { random: (_w, x, y, z) => hits.push(x + y * 16 + z * 256) };
      const ticks = new WorldTicks(world, new Map([[Block.Stone, stone]]), seed);
      for (let i = 0; i < 100; i++) ticks.tick();
      return hits;
    };
    // Section 0 is all stone; the other 15 are empty
    expect(counted("a")).toHaveLength(100 * RANDOM_TICKS);
    expect(counted("a")).toEqual(counted("a"));
    expect(counted("a")).not.toEqual(counted("b"));
  });

  it("hands over a chunk's scheduled ticks when it unloads", () => {
    const world = flatWorld(4, 1);
    const ticks = new WorldTicks(world, new Map());
    ticks.schedule(-3, 4, 2, Block.Sand, 10);
    ticks.schedule(5, 4, 2, Block.Sand, 10);
    const taken = ticks.takeChunk(-1, 0);
    expect(taken).toEqual([{ x: -3, y: 4, z: 2, block: Block.Sand, due: 10 }]);
    expect(ticks.scheduledCount).toBe(1);
  });

  it("ticks 20 times per second of frames", () => {
    const ticks = new WorldTicks(flatWorld(4, 0));
    for (let i = 0; i < 60; i++) ticks.update(1 / 60);
    expect(ticks.time).toBeGreaterThanOrEqual(TICKS_PER_SECOND - 1);
    expect(ticks.time).toBeLessThanOrEqual(TICKS_PER_SECOND);
  });
});

import { describe, expect, it } from "vitest";
import { Block, FLUID } from "../src/blocks.js";
import { blockBehaviors, fluidLevel, isFalling, isSource } from "../src/fluids.js";
import { WorldTicks } from "../src/ticks.js";
import { BlockUpdates } from "../src/updates.js";
import { flatWorld } from "./helpers.js";

/** A stone floor (top at y 9) with block updates and the fluid and falling ticks running. */
function playground(radius: number = 1) {
  const world = flatWorld(10, radius);
  const ticks = new WorldTicks(world, blockBehaviors());
  const updates = new BlockUpdates(world, ticks);
  world.onChanged = (x, y, z) => updates.changed(x, y, z);
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) ticks.tick();
  };
  return { world, ticks, run };
}

/** "air", "water 3", "water falling", "lava 0"... for readable expectations. */
function what(state: number): string {
  if (FLUID[state] === 0) return state === Block.Air ? "air" : `block ${state}`;
  return `${FLUID[state] === 1 ? "water" : "lava"} ${isFalling(state) ? "falling" : fluidLevel(state)}`;
}

describe("water", () => {
  it("spreads seven blocks from a source, a level weaker each block", () => {
    const { world, run } = playground();
    world.set(0, 10, 0, Block.Water);
    run(200);
    expect(Array.from({ length: 9 }, (_, k) => what(world.get(k, 10, 0)))).toEqual(["water 0", "water 1", "water 2", "water 3", "water 4", "water 5", "water 6", "water 7", "air"]);
    expect(what(world.get(-3, 10, 0))).toBe("water 3");
    expect(what(world.get(2, 10, 2))).toBe("water 4");
  });

  it("falls as a column and spreads where it lands", () => {
    const { world, run } = playground();
    world.set(0, 15, 0, Block.Water);
    run(200);
    for (let y = 10; y < 15; y++) expect(what(world.get(0, y, 0))).toBe("water falling");
    // A source in the air spreads a block to each side, which falls too: a plus-shaped waterfall
    expect(what(world.get(1, 15, 0))).toBe("water 1");
    expect(what(world.get(2, 15, 0))).toBe("air");
    expect(what(world.get(1, 12, 0))).toBe("water falling");
    // Only the landing spreads further: the columns' sides stay dry
    expect(what(world.get(2, 12, 0))).toBe("air");
    expect(what(world.get(2, 10, 0))).toBe("water 1");
    expect(what(world.get(3, 10, 0))).toBe("water 2");
  });

  it("dries up when its source is taken away", () => {
    const { world, run } = playground();
    world.set(0, 10, 0, Block.Water);
    run(200);
    world.set(0, 10, 0, Block.Air);
    run(200);
    for (let k = -8; k <= 8; k++) expect(what(world.get(k, 10, 0))).toBe("air");
  });

  it("makes a new source between two sources", () => {
    const { world, run } = playground();
    world.set(0, 10, 0, Block.Water);
    world.set(2, 10, 0, Block.Water);
    run(100);
    expect(isSource(world.get(1, 10, 0))).toBe(true);
  });

  it("runs toward the nearest drop within four blocks", () => {
    const { world, run } = playground();
    // A hole in the floor two blocks east
    world.set(2, 9, 0, Block.Air);
    world.set(0, 10, 0, Block.Water);
    run(200);
    expect(what(world.get(1, 10, 0))).toBe("water 1");
    // Not west or sideways: the way to the drop is east
    expect(what(world.get(-1, 10, 0))).toBe("air");
    expect(what(world.get(0, 10, 1))).toBe("air");
    expect(what(world.get(2, 9, 0))).toBe("water falling");
  });

  it("flows into a hole dug next to it", () => {
    const { world, run } = playground();
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) world.set(x, 9, z, Block.Water);
    run(20);
    world.set(3, 9, 1, Block.Air);
    run(40);
    expect(FLUID[world.get(3, 9, 1)]).toBe(1);
  });
});

describe("lava", () => {
  it("flows three blocks and hardens where it meets water", () => {
    const { world, run } = playground();
    world.set(0, 10, 0, Block.Lava);
    run(600);
    expect(["lava 2", "lava 4", "lava 6", "air"].map((_, k) => what(world.get(k + 1, 10, 0)))).toEqual(["lava 2", "lava 4", "lava 6", "air"]);
    // Water on a flow of lava turns it to cobblestone, next to the source to obsidian
    world.set(1, 11, 0, Block.Water);
    run(60);
    expect(world.get(1, 10, 0)).toBe(Block.Cobblestone);
    world.set(-1, 10, 0, Block.Water);
    run(60);
    expect(world.get(0, 10, 0)).toBe(Block.Obsidian);
  });

  it("turns water it falls into to stone", () => {
    const { world, run } = playground();
    world.set(5, 10, 5, Block.Water);
    run(5);
    world.set(5, 14, 5, Block.Lava);
    run(300);
    expect(world.get(5, 10, 5)).toBe(Block.Stone);
  });
});

describe("falling blocks", () => {
  it("drop until something holds them up, and fall again when it goes", () => {
    const { world, run } = playground();
    world.set(0, 15, 0, Block.Sand);
    run(20);
    expect(world.get(0, 10, 0)).toBe(Block.Sand);
    expect(world.get(0, 15, 0)).toBe(Block.Air);
    world.set(0, 11, 0, Block.Gravel);
    world.set(0, 9, 0, Block.Air);
    world.set(0, 8, 0, Block.Air);
    run(20);
    expect(world.get(0, 8, 0)).toBe(Block.Sand);
    expect(world.get(0, 9, 0)).toBe(Block.Gravel);
  });
});

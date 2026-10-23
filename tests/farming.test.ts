import { describe, expect, it } from "vitest";
import { useBlock } from "../src/actions.js";
import { Block, STATE_BLOCK, propertyOf, stateName, stateOf } from "../src/blocks.js";
import { Drops } from "../src/drops.js";
import { blockBehaviors } from "../src/fluids.js";
import { canFertilize, growSapling, growthBehaviors } from "../src/growth.js";
import type { ItemStack } from "../src/items.js";
import { Mobs } from "../src/mobs/mobs.js";
import { WorldTicks } from "../src/ticks.js";
import { BlockUpdates } from "../src/updates.js";
import { Weather } from "../src/weather.js";
import { flatWorld } from "./helpers.js";

/** A small seeded random number generator (mulberry32), so growth goes the same way every run. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A stone floor (top at y 9) with block updates, and growth's random ticks given to chosen blocks directly
 * (a random tick reaches a given block only about once a minute).
 */
function farm() {
  const world = flatWorld(10, 1);
  const weather = new Weather(() => 0.5);
  const dropped: Array<{ x: number; y: number; z: number; stacks: ItemStack[] }> = [];
  const growth = growthBehaviors({ weather: () => weather, drop: (x, y, z, stacks) => dropped.push({ x, y, z, stacks }), random: seeded(7) });
  const ticks = new WorldTicks(world, new Map([...blockBehaviors(), ...growth]));
  const updates = new BlockUpdates(world, ticks);
  world.onChanged = (x, y, z, old) => updates.changed(x, y, z, old);
  /** `n` random ticks for the block at (x, y, z), whatever it is by then. */
  const grow = (x: number, y: number, z: number, n: number = 1): void => {
    for (let i = 0; i < n; i++) {
      const s = world.get(x, y, z);
      growth.get(STATE_BLOCK[s])?.random?.(world, x, y, z, s, ticks);
    }
  };
  const name = (x: number, y: number, z: number): string => stateName(world.get(x, y, z));
  const age = (x: number, y: number, z: number): number => Number(propertyOf(world.get(x, y, z), "age"));
  return { world, weather, ticks, dropped, grow, name, age };
}

describe("farmland", () => {
  it("is tilled with a hoe from grass or dirt with nothing on it, and trampled back to dirt", () => {
    const { world, name } = farm();
    world.set(0, 9, 0, Block.Grass);
    world.set(1, 9, 0, Block.Dirt);
    world.set(2, 9, 0, Block.Dirt);
    world.set(2, 10, 0, Block.Stone);
    expect(useBlock(world, { x: 0, y: 9, z: 0, use: "till" })).toBe(true);
    expect(useBlock(world, { x: 1, y: 9, z: 0, use: "till" })).toBe(true);
    expect(useBlock(world, { x: 2, y: 9, z: 0, use: "till" })).toBe(false);
    expect(useBlock(world, { x: 3, y: 9, z: 0, use: "till" })).toBe(false); // Stone
    expect([name(0, 9, 0), name(1, 9, 0)]).toEqual(["farmland[moisture=0]", "farmland[moisture=0]"]);
    expect(useBlock(world, { x: 0, y: 9, z: 0, use: "trample" })).toBe(true);
    expect(name(0, 9, 0)).toBe("dirt");
    expect(useBlock(world, { x: 0, y: 9, z: 0, use: "trample" })).toBe(false);
  });

  it("is wet near water or in the rain, dries out without, and turns to dirt dry and bare", () => {
    const { world, weather, grow, name } = farm();
    world.set(0, 9, 0, Block.Farmland);
    world.set(4, 9, 0, Block.Water);
    grow(0, 9, 0);
    expect(name(0, 9, 0)).toBe("farmland[moisture=7]");
    // Five away is too far
    world.set(10, 9, 0, stateOf(Block.Farmland, { moisture: "7" }));
    world.set(15, 9, 0, Block.Water);
    grow(10, 9, 0, 7);
    expect(name(10, 9, 0)).toBe("farmland[moisture=0]");
    // Dry, it stays farmland only with something growing on it
    world.set(9, 9, 0, Block.Farmland);
    world.set(9, 10, 0, Block.Wheat);
    grow(10, 9, 0);
    grow(9, 9, 0, 3);
    expect([name(10, 9, 0), name(9, 9, 0)]).toEqual(["dirt", "farmland[moisture=0]"]);
    // Rain wets what is open to the sky, not what is under a roof
    world.set(20, 9, 0, Block.Farmland);
    world.set(22, 9, 0, Block.Farmland);
    world.set(22, 12, 0, Block.Stone);
    weather.show(true, false);
    grow(20, 9, 0);
    grow(22, 9, 0);
    expect([name(20, 9, 0), name(22, 9, 0)]).toEqual(["farmland[moisture=7]", "dirt"]);
  });

  it("covered by a solid block turns to dirt, and what grew on it breaks", () => {
    const { world, name } = farm();
    world.set(0, 9, 0, Block.Farmland);
    world.set(0, 10, 0, Block.Stone);
    expect(name(0, 9, 0)).toBe("dirt");
    world.set(1, 9, 0, Block.Farmland);
    world.set(1, 10, 0, Block.Carrots);
    world.set(1, 9, 0, Block.Dirt);
    expect(name(1, 10, 0)).toBe("air");
  });
});

describe("crops", () => {
  it("grow up stage by stage in the light, faster on wet farmland, and stop when grown", () => {
    const { world, grow, age } = farm();
    // A row of ten on wet farmland (by water) and one on dry
    for (let x = 0; x < 10; x++) {
      world.set(x, 9, 0, stateOf(Block.Farmland, { moisture: "7" }));
      world.set(x, 9, 1, Block.Water);
      world.set(x, 9, 10, Block.Farmland);
      for (const z of [0, 10]) world.set(x, 10, z, Block.Wheat);
    }
    const total = (z: number): number => Array.from({ length: 10 }, (_, x) => age(x, 10, z)).reduce((a, b) => a + b);
    for (let i = 0; i < 30; i++) for (let x = 0; x < 10; x++) for (const z of [0, 10]) grow(x, 10, z);
    expect(total(0)).toBeGreaterThan(total(10) * 1.4);
    for (let i = 0; i < 400; i++) grow(0, 10, 0);
    expect(age(0, 10, 0)).toBe(7);
    // Nothing more to grow, and no bone meal to waste on it
    expect(canFertilize(world.get(0, 10, 0))).toBe(false);
  });

  it("don't grow in the dark", () => {
    const { world, grow, age } = farm();
    world.set(0, 9, 0, stateOf(Block.Farmland, { moisture: "7" }));
    world.set(0, 10, 0, Block.Potatoes);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) world.set(dx, 10, dz, Block.Stone);
    world.set(0, 11, 0, Block.Stone);
    grow(0, 10, 0, 400);
    expect(age(0, 10, 0)).toBe(0);
  });

  it("grow two to five stages with bone meal", () => {
    const { world, age } = farm();
    world.set(0, 9, 0, Block.Farmland);
    world.set(0, 10, 0, Block.Wheat);
    expect(useBlock(world, { x: 0, y: 10, z: 0, use: "fertilize" })).toBe(true);
    expect(age(0, 10, 0)).toBeGreaterThanOrEqual(2);
    expect(age(0, 10, 0)).toBeLessThanOrEqual(5);
    while (canFertilize(world.get(0, 10, 0))) useBlock(world, { x: 0, y: 10, z: 0, use: "fertilize" });
    expect(age(0, 10, 0)).toBe(7);
    expect(useBlock(world, { x: 0, y: 10, z: 0, use: "fertilize" })).toBe(false);
  });

  it("a grown stem puts a pumpkin beside it on ground, and goes back to a stem when it is taken", () => {
    const { world, grow, name } = farm();
    world.set(0, 9, 0, stateOf(Block.Farmland, { moisture: "7" }));
    world.set(0, 10, 0, stateOf(Block.PumpkinStem, { age: "7" }));
    world.set(1, 9, 0, Block.Dirt); // Only east is ground
    for (let i = 0; i < 400 && STATE_BLOCK[world.get(0, 10, 0)] === Block.PumpkinStem; i++) grow(0, 10, 0);
    expect(name(1, 10, 0)).toBe("pumpkin");
    expect(name(0, 10, 0)).toBe("attached_pumpkin_stem[facing=east]");
    world.set(1, 10, 0, Block.Air);
    expect(name(0, 10, 0)).toBe("pumpkin_stem[age=7]");
  });
});

describe("trees and plants", () => {
  it("saplings grow into trees where there is room, with bone meal too", () => {
    const { world } = farm();
    world.set(0, 9, 0, Block.Grass);
    world.set(0, 10, 0, Block.OakSapling);
    expect(growSapling(world, 0, 10, 0, seeded(1))).toBe(true);
    expect(STATE_BLOCK[world.get(0, 10, 0)]).toBe(Block.Log);
    expect(STATE_BLOCK[world.get(0, 13, 0)]).toBe(Block.Log);
    // Not under a roof
    world.set(5, 9, 5, Block.Grass);
    world.set(5, 10, 5, Block.OakSapling);
    world.set(5, 13, 5, Block.Stone);
    expect(growSapling(world, 5, 10, 5, seeded(1))).toBe(false);
    expect(STATE_BLOCK[world.get(5, 10, 5)]).toBe(Block.OakSapling);
    world.set(5, 13, 5, Block.Air);
    for (let i = 0; i < 40 && STATE_BLOCK[world.get(5, 10, 5)] === Block.OakSapling; i++) useBlock(world, { x: 5, y: 10, z: 5, use: "fertilize" });
    expect(STATE_BLOCK[world.get(5, 10, 5)]).toBe(Block.Log);
  });

  it("leaves away from any log decay and drop, unless a player put them there", () => {
    const { world, grow, dropped } = farm();
    world.set(0, 10, 0, Block.Log);
    for (let x = 1; x <= 8; x++) world.set(x, 10, 0, Block.Leaves);
    world.set(0, 11, 0, stateOf(Block.Leaves, { persistent: "true" }));
    grow(6, 10, 0);
    grow(7, 10, 0);
    expect(STATE_BLOCK[world.get(6, 10, 0)]).toBe(Block.Leaves); // Six from the log
    expect(world.get(7, 10, 0)).toBe(Block.Air);
    expect(dropped.map((d) => [d.x, d.y, d.z])).toEqual([[7, 10, 0]]);
    world.set(0, 10, 0, Block.Air);
    grow(1, 10, 0);
    grow(0, 11, 0);
    expect(world.get(1, 10, 0)).toBe(Block.Air);
    expect(STATE_BLOCK[world.get(0, 11, 0)]).toBe(Block.Leaves);
  });

  it("grass spreads over dirt in the light, and dies under a solid block", () => {
    const { world, ticks, grow } = farm();
    for (let x = -8; x < 8; x++) for (let z = -8; z < 8; z++) world.set(x, 9, z, Block.Dirt);
    world.set(0, 9, 0, Block.Grass);
    for (let i = 0; i < 20000; i++) ticks.tick();
    let grass = 0;
    for (let x = -8; x < 8; x++) for (let z = -8; z < 8; z++) if (world.get(x, 9, z) === Block.Grass) grass++;
    expect(grass).toBeGreaterThan(3);
    world.set(20, 9, 0, Block.Grass);
    world.set(20, 10, 0, Block.Stone);
    grow(20, 9, 0);
    expect(world.get(20, 9, 0)).toBe(Block.Dirt);
  });

  it("cacti grow three high", () => {
    const { world, grow } = farm();
    world.set(0, 9, 0, Block.Sand);
    world.set(0, 10, 0, Block.Cactus);
    for (let i = 0; i < 400; i++) for (let y = 10; y < 14; y++) grow(0, y, 0);
    expect([10, 11, 12, 13].map((y) => world.get(0, y, 0))).toEqual([Block.Cactus, Block.Cactus, Block.Cactus, Block.Air]);
  });

  it("ice melts by a torch", () => {
    const { world, grow } = farm();
    world.set(0, 10, 0, Block.Ice);
    world.set(1, 10, 0, stateOf(Block.Torch, { facing: "up" }));
    world.set(9, 10, 9, Block.Ice);
    grow(0, 10, 0);
    grow(9, 10, 9);
    expect([STATE_BLOCK[world.get(0, 10, 0)], world.get(9, 10, 9)]).toEqual([Block.Water, Block.Ice]);
  });
});

describe("breeding", () => {
  /** A meadow with animals and a player close by (animals far from everyone stand still). */
  function meadow() {
    const world = flatWorld(10, 2);
    const drops = new Drops(world);
    const mobs = new Mobs({
      world,
      drops,
      players: () => [{ id: "host", position: { x: 8, y: 10, z: 8 }, targetable: true, held: null }],
      difficulty: () => "peaceful",
      time: () => 6000,
      onHurtPlayer: () => {},
      random: seeded(3),
    });
    const run = (n: number): void => {
      for (let i = 0; i < n; i++) mobs.tick();
    };
    return { world, drops, mobs, run };
  }

  it("two animals fed their food fall in love and have a baby, which grows up", () => {
    const { mobs, drops, run } = meadow();
    const a = mobs.spawn("cow", 0.5, 10, 0.5);
    const b = mobs.spawn("cow", 1.5, 10, 0.5);
    expect(mobs.feed(a, "carrot")).toBe(false); // Not a cow's food
    expect(mobs.feed(a, "wheat")).toBe(true);
    expect(mobs.feed(a, "wheat")).toBe(false); // Already in love
    expect(mobs.feed(b, "wheat")).toBe(true);
    run(40);
    const babies = [...mobs.mobs.values()].filter((m) => m.baby);
    expect(babies.map((m) => m.kind)).toEqual(["cow"]);
    expect([a.love, b.love]).toEqual([0, 0]);
    expect(a.breedCooldown).toBeGreaterThan(0);
    expect(mobs.feed(a, "wheat")).toBe(false); // Not again for a while
    expect(drops.orbs.size).toBe(1);
    // Food makes a baby grow up sooner; it is grown in twenty minutes
    const baby = babies[0];
    const before = baby.growUp;
    expect(mobs.feed(baby, "wheat")).toBe(true);
    expect(before - baby.growUp).toBe(2400);
    run(baby.growUp);
    expect(baby.baby).toBe(false);
  });

  it("babies are kept with their chunk, and a lamb has no wool to shear", () => {
    const { mobs } = meadow();
    const lamb = mobs.spawn("sheep", 4.5, 10, 4.5);
    lamb.growUp = 5000;
    expect(mobs.shear(lamb)).toBe(false);
    const saved = mobs.inChunk(0, 0, true);
    expect(saved).toEqual([expect.objectContaining({ kind: "sheep", growUp: 5000 })]);
    mobs.restore(saved);
    expect([...mobs.mobs.values()].map((m) => m.growUp)).toEqual([5000]);
  });
});

import { describe, expect, it } from "vitest";
import { Block, propertyOf, stateOf } from "../src/blocks.js";
import { useBlock } from "../src/actions.js";
import { WorldTicks } from "../src/ticks.js";
import { BlockUpdates } from "../src/updates.js";
import { flatWorld } from "./helpers.js";

/** A stone floor (top at y 9) with block updates and redstone's delays running, tick by tick. */
function bench() {
  const world = flatWorld(10, 2);
  const ticks = new WorldTicks(world);
  const updates = new BlockUpdates(world, ticks);
  world.onChanged = (x, y, z, old) => updates.changed(x, y, z, old);
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) ticks.tick();
  };
  /** Ticks until `done` holds (at most `max`), and how many it took. */
  const ticksUntil = (done: () => boolean, max: number = 100): number => {
    for (let n = 0; n <= max; n++) {
      if (done()) return n;
      ticks.tick();
    }
    return -1;
  };
  const on = (x: number, y: number, z: number, name: string): boolean => propertyOf(world.get(x, y, z), name) === "true";
  const power = (x: number, y: number, z: number): number => Number(propertyOf(world.get(x, y, z), "power"));
  const lever = (x: number, y: number, z: number): void => {
    world.set(x, y, z, stateOf(Block.Lever, { face: "floor", facing: "north" }));
  };
  const flip = (x: number, y: number, z: number): boolean => useBlock(world, { x, y, z });
  return { world, ticks, updates, run, ticksUntil, on, power, lever, flip };
}

describe("redstone dust", () => {
  it("carries a lever's power fifteen blocks, a level weaker each block, and lights a lamp at the end", () => {
    const { world, run, on, power, lever, flip } = bench();
    lever(0, 10, 0);
    for (let x = 1; x <= 15; x++) world.set(x, 10, 0, Block.RedstoneWire);
    world.set(16, 10, 0, Block.RedstoneLamp);
    expect(power(1, 10, 0)).toBe(0);
    flip(0, 10, 0);
    expect(Array.from({ length: 15 }, (_, i) => power(i + 1, 10, 0))).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    // The last dust runs on toward the lamp (a line, not a stub) and powers it
    expect(on(15, 10, 0, "east")).toBe(true);
    expect(on(16, 10, 0, "lit")).toBe(true);
    // Off again: all of it goes dark, and the lamp a moment later
    flip(0, 10, 0);
    expect(Array.from({ length: 15 }, (_, i) => power(i + 1, 10, 0)).every((p) => p === 0)).toBe(true);
    expect(on(16, 10, 0, "lit")).toBe(true);
    run(4);
    expect(on(16, 10, 0, "lit")).toBe(false);
  });

  it("goes no further than fifteen blocks", () => {
    const { world, on, power, lever, flip } = bench();
    lever(0, 10, 0);
    for (let x = 1; x <= 16; x++) world.set(x, 10, 0, Block.RedstoneWire);
    world.set(17, 10, 0, Block.RedstoneLamp);
    flip(0, 10, 0);
    expect(power(16, 10, 0)).toBe(0);
    expect(on(17, 10, 0, "lit")).toBe(false);
  });

  it("climbs onto a block beside it, and connects round corners", () => {
    const { world, power, lever, flip, on } = bench();
    lever(0, 10, 0);
    world.set(1, 10, 0, Block.RedstoneWire);
    world.set(2, 10, 0, Block.Stone);
    world.set(2, 11, 0, Block.RedstoneWire);
    world.set(1, 10, 1, Block.RedstoneWire);
    flip(0, 10, 0);
    expect(power(2, 11, 0)).toBe(14);
    expect(power(1, 10, 1)).toBe(14);
    expect(on(1, 10, 0, "east") && on(1, 10, 0, "south") && on(1, 10, 0, "west")).toBe(true);
  });
});

describe("redstone torches", () => {
  it("are lit unless the block they are on is powered, two ticks to turn: an inverter", () => {
    const { world, ticksUntil, on, flip } = bench();
    // A lever on the west side of a stone block, a torch on top, a lamp over the torch
    world.set(0, 10, 0, Block.Stone);
    world.set(-1, 10, 0, stateOf(Block.Lever, { face: "wall", facing: "west" }));
    world.set(0, 11, 0, stateOf(Block.RedstoneTorch, { facing: "up", lit: "false" }));
    world.set(0, 12, 0, Block.RedstoneLamp);
    expect(ticksUntil(() => on(0, 11, 0, "lit"))).toBe(2);
    expect(on(0, 12, 0, "lit")).toBe(true);
    flip(-1, 10, 0);
    expect(ticksUntil(() => !on(0, 11, 0, "lit"))).toBe(2);
    expect(ticksUntil(() => !on(0, 12, 0, "lit"))).toBe(4);
    flip(-1, 10, 0);
    expect(ticksUntil(() => on(0, 11, 0, "lit"))).toBe(2);
  });

  it("make a clock, turned back on their own block through a repeater: on and off every four ticks", () => {
    const { world, ticks, run, on } = bench();
    // A torch on the east side of a stone block, its power round through dust into a repeater facing the block
    world.set(0, 10, 0, Block.Stone);
    world.set(1, 10, 0, stateOf(Block.RedstoneTorch, { facing: "east", lit: "false" }));
    for (const [x, z] of [[1, 1], [1, 2], [0, 2]]) world.set(x, 10, z, Block.RedstoneWire);
    world.set(0, 10, 1, stateOf(Block.Repeater, { facing: "north", delay: "1" }));
    run(20);
    const turns: number[] = [];
    let lit = on(1, 10, 0, "lit");
    for (let i = 0; i < 80; i++) {
      ticks.tick();
      if (on(1, 10, 0, "lit") !== lit) {
        lit = !lit;
        turns.push(i);
      }
    }
    expect(turns.length).toBe(20);
    expect(new Set(turns.slice(1).map((t, i) => t - turns[i]))).toEqual(new Set([4]));
  });

  it("power dust beside them, but not the block they hang on", () => {
    const { world, run, power } = bench();
    world.set(0, 10, 0, Block.Stone);
    world.set(0, 11, 0, stateOf(Block.RedstoneTorch, { facing: "up", lit: "false" }));
    world.set(1, 11, 0, Block.RedstoneWire);
    world.set(1, 10, 0, Block.Stone);
    run(3);
    expect(power(1, 11, 0)).toBe(15);
  });
});

describe("repeaters", () => {
  it("pass power on at full strength after their delay, which using one cycles", () => {
    const { world, ticksUntil, on, power, lever, flip } = bench();
    lever(0, 10, 0);
    for (let x = 1; x <= 14; x++) world.set(x, 10, 0, Block.RedstoneWire);
    world.set(15, 10, 0, stateOf(Block.Repeater, { facing: "east", delay: "1" }));
    for (let x = 16; x <= 20; x++) world.set(x, 10, 0, Block.RedstoneWire);
    flip(0, 10, 0);
    expect(power(14, 10, 0)).toBe(2);
    expect(ticksUntil(() => on(15, 10, 0, "powered"))).toBe(2);
    expect(power(16, 10, 0)).toBe(15);
    expect(power(20, 10, 0)).toBe(11);
    flip(0, 10, 0);
    expect(ticksUntil(() => !on(15, 10, 0, "powered"))).toBe(2);
    expect(power(16, 10, 0)).toBe(0);
    // Four clicks round to delay 4 (eight ticks), and the fifth back to 1
    for (let i = 0; i < 3; i++) useBlock(world, { x: 15, y: 10, z: 0 });
    expect(propertyOf(world.get(15, 10, 0), "delay")).toBe("4");
    flip(0, 10, 0);
    expect(ticksUntil(() => on(15, 10, 0, "powered"))).toBe(8);
    useBlock(world, { x: 15, y: 10, z: 0 });
    expect(propertyOf(world.get(15, 10, 0), "delay")).toBe("1");
  });

  it("only take power from behind, and give it only ahead", () => {
    const { world, run, on, lever, flip } = bench();
    // Facing west, with the lever's dust at its front: nothing passes back
    lever(0, 10, 0);
    world.set(1, 10, 0, Block.RedstoneWire);
    world.set(2, 10, 0, stateOf(Block.Repeater, { facing: "west", delay: "1" }));
    world.set(3, 10, 0, Block.RedstoneLamp);
    flip(0, 10, 0);
    run(10);
    expect(on(2, 10, 0, "powered")).toBe(false);
    expect(on(3, 10, 0, "lit")).toBe(false);
  });
});

describe("buttons and pressure plates", () => {
  it("buttons stay pressed a second (stone) or a second and a half (wood), then pop out", () => {
    const { world, ticksUntil, on } = bench();
    world.set(0, 10, 0, stateOf(Block.StoneButton, { face: "floor", facing: "north" }));
    world.set(1, 10, 0, Block.RedstoneLamp);
    world.set(4, 10, 0, stateOf(Block.OakButton, { face: "floor", facing: "north" }));
    expect(useBlock(world, { x: 0, y: 10, z: 0 })).toBe(true);
    expect(useBlock(world, { x: 0, y: 10, z: 0 })).toBe(false); // Already in
    useBlock(world, { x: 4, y: 10, z: 0 });
    expect(on(1, 10, 0, "lit")).toBe(true);
    expect(ticksUntil(() => !on(0, 10, 0, "powered"))).toBe(20);
    expect(ticksUntil(() => !on(1, 10, 0, "lit"))).toBe(4);
    expect(ticksUntil(() => !on(4, 10, 0, "powered"))).toBe(6);
  });

  it("plates go down under what stands on them and come up a second after it leaves", () => {
    const { world, updates, run, on } = bench();
    world.set(0, 10, 0, Block.StonePressurePlate);
    world.set(1, 10, 0, Block.RedstoneLamp);
    let standing = true;
    updates.redstone.occupied = (x, y, z) => standing && x === 0 && y === 10 && z === 0;
    updates.redstone.step(0, 10, 0);
    expect(on(0, 10, 0, "powered")).toBe(true);
    expect(on(1, 10, 0, "lit")).toBe(true);
    run(60);
    expect(on(0, 10, 0, "powered")).toBe(true);
    standing = false;
    run(20);
    expect(on(0, 10, 0, "powered")).toBe(false);
    run(4);
    expect(on(1, 10, 0, "lit")).toBe(false);
  });
});

describe("what redstone works", () => {
  it("opens a door (both halves) and a trapdoor while powered", () => {
    const { world, run, on, lever, flip } = bench();
    world.set(1, 10, 0, stateOf(Block.OakDoor, { facing: "north", half: "lower" }));
    world.set(1, 11, 0, stateOf(Block.OakDoor, { facing: "north", half: "upper" }));
    lever(0, 10, 0);
    world.set(-1, 10, 0, stateOf(Block.OakTrapdoor, { facing: "north" }));
    flip(0, 10, 0);
    expect([on(1, 10, 0, "open"), on(1, 11, 0, "open"), on(-1, 10, 0, "open")]).toEqual([true, true, true]);
    flip(0, 10, 0);
    run(1);
    expect([on(1, 10, 0, "open"), on(1, 11, 0, "open"), on(-1, 10, 0, "open")]).toEqual([false, false, false]);
  });

  it("powers solid blocks: a lever on a block lights a lamp on the block's other side", () => {
    const { world, on, flip } = bench();
    world.set(0, 10, 0, Block.Stone);
    world.set(-1, 10, 0, stateOf(Block.Lever, { face: "wall", facing: "west" }));
    world.set(1, 10, 0, Block.RedstoneLamp);
    flip(-1, 10, 0);
    expect(on(1, 10, 0, "lit")).toBe(true);
  });

  it("lamps and lit torches give light", () => {
    const { world, run, lever, flip } = bench();
    lever(0, 10, 0);
    world.set(1, 10, 0, Block.RedstoneLamp);
    world.set(5, 10, 5, stateOf(Block.RedstoneTorch, { facing: "up", lit: "false" }));
    flip(0, 10, 0);
    run(3);
    expect(world.getLight(2, 10, 0) & 15).toBe(14);
    expect(world.getLight(5, 11, 5) & 15).toBe(6);
  });
});

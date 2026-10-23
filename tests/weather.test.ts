import { describe, expect, it } from "vitest";
import { Biome } from "../src/biomes.js";
import { Block } from "../src/blocks.js";
import { runCommand, type CommandContext } from "../src/commands.js";
import { precipitationTick } from "../src/growth.js";
import { Weather, lightningStrikes, precipitationAt, rainTop, rainsOn } from "../src/weather.js";
import type { VoxelWorld } from "../src/world.js";
import { flatWorld } from "./helpers.js";

/** Every column of the loaded chunks in one biome. */
function biomeAll(world: VoxelWorld, biome: Biome): void {
  for (const chunk of world.chunks.values()) chunk.biomes.fill(biome);
}

/** Ticks a weather until `done` holds (at most `max` ticks), and how many it took. */
function ticksUntil(w: Weather, done: () => boolean, max: number = 400000): number {
  for (let n = 0; n <= max; n++) {
    if (done()) return n;
    w.tick();
  }
  return -1;
}

describe("the weather", () => {
  it("is clear for 10 to 150 minutes, then rains 10 to 20, fading in and out", () => {
    const w = new Weather(() => 0.5);
    expect(w.raining).toBe(false);
    expect(w.rainTime).toBe(12000 + 84000);
    let changes = 0;
    w.onChange = () => changes++;
    expect(ticksUntil(w, () => w.raining)).toBe(96000);
    expect(changes).toBe(2); // With the same odds, thunder comes on the same tick: this rain is a storm
    expect(w.rainTime).toBe(18000);
    expect(w.rain).toBeLessThan(0.1);
    expect(ticksUntil(w, () => w.rain === 1)).toBeLessThanOrEqual(100);
    expect(ticksUntil(w, () => !w.raining)).toBeLessThan(18000);
    expect(ticksUntil(w, () => w.rain === 0)).toBeLessThanOrEqual(100);
  });

  it("storms only while it rains: dark enough for lightning, and for sleeping", () => {
    const w = new Weather(() => 0.5);
    w.set("thunder");
    expect([w.raining, w.thundering, w.storm]).toEqual([true, true, false]);
    ticksUntil(w, () => w.thunder === 1);
    expect(w.storm).toBe(true);
    w.set("clear");
    expect(ticksUntil(w, () => !w.storm)).toBeLessThan(20);
    // Thunder's timer alone darkens nothing
    w.raining = false;
    w.thundering = true;
    for (let i = 0; i < 200; i++) w.fade();
    expect(w.thunder).toBe(0);
  });

  it("clears up after a night's sleep, for a fresh clear spell", () => {
    const w = new Weather(() => 0.5);
    w.set("rain", 100000);
    let changed = false;
    w.onChange = () => (changed = true);
    w.clearUp();
    expect([w.raining, w.thundering, changed, w.rainTime]).toEqual([false, false, true, 96000]);
  });

  it("is saved and loaded, as it is, without fading in again", () => {
    const w = new Weather(() => 0.5);
    w.set("thunder", 3000);
    const saved = w.save();
    expect(saved).toEqual({ raining: true, thundering: true, rainTime: 3000, thunderTime: 3000 });
    const back = new Weather(() => 0.1);
    back.load(saved);
    expect([back.raining, back.thundering, back.rainTime, back.rain, back.storm]).toEqual([true, true, 3000, 1, true]);
    // Nothing saved (a world from before weather): it is as it was made
    const fresh = new Weather(() => 0.1);
    fresh.load(null);
    expect(fresh.raining).toBe(false);
  });

  it("is set by /weather", () => {
    const w = new Weather();
    const said: string[] = [];
    const ctx = { position: { x: 0, y: 0, z: 0 }, say: (t: string) => said.push(t), weather: (k: "clear" | "rain" | "thunder") => (w.set(k), true) } as unknown as CommandContext;
    runCommand("/weather thunder", ctx);
    expect([w.raining, w.thundering]).toEqual([true, true]);
    runCommand("/weather snow", ctx);
    expect(said).toEqual(["Set the weather to thunder", "Usage: /weather clear|rain|thunder"]);
  });
});

describe("where it rains", () => {
  it("rains in most biomes, snows where it is cold or high up, and nothing falls in deserts", () => {
    expect(precipitationAt(Biome.Plains, 70)).toBe("rain");
    expect(precipitationAt(Biome.SnowyPlains, 70)).toBe("snow");
    expect(precipitationAt(Biome.Plains, 200)).toBe("snow");
    expect(precipitationAt(Biome.Desert, 70)).toBe("none");
  });

  it("falls on what is open to the sky, not under a roof, leaves or water", () => {
    const world = flatWorld(10, 1);
    const w = new Weather();
    w.show(true, false);
    expect(rainTop(world, 0, 0)).toBe(9);
    expect(rainsOn(world, w, 0, 10, 0)).toBe(true);
    world.set(0, 20, 0, Block.Stone);
    world.set(1, 20, 0, Block.Leaves);
    world.set(2, 12, 0, Block.Water);
    expect([0, 1, 2].map((x) => rainsOn(world, w, x, 10, 0))).toEqual([false, false, false]);
    expect(rainTop(world, 0, 0)).toBe(20);
    biomeAll(world, Biome.Desert);
    expect(rainsOn(world, w, 3, 10, 0)).toBe(false);
    biomeAll(world, Biome.Plains);
    w.show(false, false);
    expect(rainsOn(world, w, 3, 10, 0)).toBe(false);
  });

  it("freezes still water and lays snow where it snows", () => {
    const world = flatWorld(10, 1);
    biomeAll(world, Biome.SnowyPlains);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) world.set(x, 9, z, (x + z) % 2 === 0 ? Block.Water : Block.Stone);
    const w = new Weather();
    w.show(true, false);
    for (let i = 0; i < 2000; i++) precipitationTick(world, w);
    let ice = 0;
    let snow = 0;
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        if (world.get(x, 9, z) === Block.Ice) ice++;
        if (world.get(x, 10, z) === Block.Snow) snow++;
      }
    }
    expect(ice).toBeGreaterThan(10);
    expect(snow).toBeGreaterThan(10);
  });

  it("strikes lightning in thunderstorms only, on top of a column where it rains", () => {
    const world = flatWorld(10, 0);
    const w = new Weather();
    w.show(true, true);
    world.set(0, 15, 0, Block.Stone);
    // A random number that always strikes, in the chunk's first column
    expect(lightningStrikes(world, w, () => 0)).toEqual([{ x: 0, y: 16, z: 0 }]);
    expect(lightningStrikes(world, w, () => 0.5)).toEqual([]);
    w.show(true, false);
    expect(lightningStrikes(world, w, () => 0)).toEqual([]);
  });
});

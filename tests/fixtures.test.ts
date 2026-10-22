import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Biome, encodeBiomes } from "../src/biomes.js";
import { BLOCKS, Block, HOTBAR, stateName, stateOf } from "../src/blocks.js";
import { readWorldFile } from "../src/save/worldFile.js";
import { loadSettings, saveSettings } from "../src/settings.js";
import { freshStore, openWorld } from "./saveHelpers.js";

/**
 * Worlds saved by earlier versions of Craft, one per save format (tests/fixtures/format-N.craftworld). They
 * must keep opening as they were: a format change comes with a migration and a fixture of its own.
 */
describe("saves from earlier versions", () => {
  it("opens a world saved in format 1", async () => {
    const data = readWorldFile(new Uint8Array(readFileSync(new URL("./fixtures/format-1.craftworld", import.meta.url))));
    expect(data.meta).toMatchObject({ id: "fixture-world", name: "Fixture", seed: "fixture", time: 500, chunks: 9 });
    expect(data.player).toMatchObject({ position: { x: 1.5, y: 80, z: 2.5 }, yaw: 0.5, selected: 3 });

    const store = await freshStore();
    await store.writeWorld(data);
    const { world, ticks, save } = await openWorld(store, (await store.getWorld("fixture-world"))!);
    await save.loadNow(8, 8, 1);
    expect(world.get(3, 100, 3)).toBe(stateOf(Block.Log, { axis: "x" }));
    expect(world.get(4, 100, 4)).toBe(Block.Bricks);
    expect(world.get(-5, 90, 20)).toBe(Block.GoldOre);
    expect(ticks.inChunk(0, 0)).toEqual([{ x: 5, y: 100, z: 5, block: Block.Sand, due: 540 }]);
    // Format 1 had no hotbar to save: the player gets the default one
    expect(data.player!.hotbar).toEqual(HOTBAR.map((b) => BLOCKS[b].name));
  });

  it("opens a world saved in format 2: block shapes, fluid levels and the hotbar", async () => {
    const data = readWorldFile(new Uint8Array(readFileSync(new URL("./fixtures/format-2.craftworld", import.meta.url))));
    expect(data.player).toMatchObject({ selected: 3, hotbar: ["stone", "oak_planks", "glass", "oak_stairs", "torch", "oak_door", "white_wool", "water", "lava"] });

    const store = await freshStore();
    await store.writeWorld(data);
    const { world, ticks, save } = await openWorld(store, (await store.getWorld("fixture-world-2"))!);
    await save.loadNow(8, 8, 1);
    expect(stateName(world.get(3, 100, 3))).toBe("oak_stairs[facing=east,half=top,shape=inner_left]");
    expect(stateName(world.get(4, 100, 4))).toBe("oak_door[facing=west,half=lower,open=true,hinge=right]");
    expect(stateName(world.get(4, 101, 4))).toBe("oak_door[facing=west,half=upper,open=true,hinge=right]");
    expect(stateName(world.get(5, 100, 3))).toBe("stone_slab[type=double]");
    expect(stateName(world.get(-5, 90, 20))).toBe("red_wool");
    expect(stateName(world.get(6, 100, 6))).toBe("water[level=3,falling=false]");
    expect(ticks.inChunk(0, 0)).toEqual([{ x: 6, y: 100, z: 6, block: Block.Water, due: 505 }]);
    // Format 2 had no biomes: its chunks were made like plains, and are plains now
    expect(world.chunk(0, 0)!.biomes.every((b) => b === Biome.Plains)).toBe(true);
    expect(world.chunk(0, 0)!.generator).toBe(1);
  });

  it("opens a world saved in format 3: biomes per column, the new blocks", async () => {
    const data = readWorldFile(new Uint8Array(readFileSync(new URL("./fixtures/format-3.craftworld", import.meta.url))));
    const store = await freshStore();
    await store.writeWorld(data);
    const { world, save } = await openWorld(store, (await store.getWorld("fixture-world-3"))!);
    await save.loadNow(8, 8, 1);
    expect(stateName(world.get(3, 120, 3))).toBe("birch_log[axis=z]");
    expect(stateName(world.get(4, 121, 4))).toBe("tall_grass[half=upper]");
    expect(stateName(world.get(5, 120, 5))).toBe("grass_block[snowy=true]");
    expect(world.get(-5, 120, 20)).toBe(Block.DiamondOre);
    const chunk = world.chunk(0, 0)!;
    expect(chunk.generator).toBe(2);
    expect(Array.from(chunk.biomes.subarray(98, 102))).toEqual([Biome.Jungle, Biome.Jungle, Biome.Desert, Biome.Desert]);
    // And they are written back the same
    expect(encodeBiomes(chunk.biomes)).toBe("jungle 100,desert 156");
    // Format 3 had no guests
    expect(data.guests).toEqual([]);
  });

  it("opens a world saved in format 4: the guests who played in it", async () => {
    const data = readWorldFile(new Uint8Array(readFileSync(new URL("./fixtures/format-4.craftworld", import.meta.url))));
    const store = await freshStore();
    await store.writeWorld(data);
    expect(await store.getGuest("fixture-world-4", "p-0123456789abcdef")).toMatchObject({
      name: "Alex",
      position: { x: 20.5, y: 70, z: -3.5 },
      selected: 4,
      hotbar: ["glass", "oak_door", "birch_log"],
    });
    const { world, save } = await openWorld(store, (await store.getWorld("fixture-world-4"))!);
    await save.loadNow(8, 8, 0);
    expect(world.get(8, 120, 8)).toBe(Block.Glowstone);
  });
});

describe("settings", () => {
  it("come back as saved, with defaults for anything missing, damaged or out of range", () => {
    const kept = new Map<string, string>();
    const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
    expect(loadSettings(storage)).toEqual({ renderer: "webgl", view: null, fov: 70, sensitivity: 1, name: "" });
    saveSettings({ renderer: "canvas", view: 64, fov: 90, sensitivity: 1.5, name: "  Alex  " }, storage);
    expect(loadSettings(storage)).toEqual({ renderer: "canvas", view: 64, fov: 90, sensitivity: 1.5, name: "Alex" });
    kept.set("craft.settings", JSON.stringify({ renderer: "vulkan", view: 9999, fov: "wide", sensitivity: -1 }));
    expect(loadSettings(storage)).toEqual({ renderer: "webgl", view: 160, fov: 70, sensitivity: 0.25, name: "" });
    kept.set("craft.settings", "{not json");
    expect(loadSettings(storage).fov).toBe(70);
    expect(loadSettings(null).renderer).toBe("webgl");
  });
});

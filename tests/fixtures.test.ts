import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Biome, encodeBiomes } from "../src/biomes.js";
import { BLOCKS, Block, HOTBAR, stateName, stateOf } from "../src/blocks.js";
import type { ChestEntity, FurnaceEntity } from "../src/blockEntities.js";
import { itemByName } from "../src/items.js";
import { readWorldFile } from "../src/save/worldFile.js";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../src/settings.js";
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
    // Format 1 had no hotbar to save: the player gets the default one, as their inventory since format 5;
    // the world was played with every block at hand
    expect(data.player!.inventory.slice(0, 9)).toEqual(HOTBAR.map((b) => ({ item: BLOCKS[b].name, count: 1 })));
    expect(data.player!.inventory).toHaveLength(41);
    expect(data.meta.mode).toBe("creative");
  });

  it("opens a world saved in format 2: block shapes, fluid levels and the hotbar", async () => {
    const data = readWorldFile(new Uint8Array(readFileSync(new URL("./fixtures/format-2.craftworld", import.meta.url))));
    expect(data.player!.selected).toBe(3);
    expect(data.player!.inventory.slice(0, 9).map((s) => s?.item)).toEqual(["stone", "oak_planks", "glass", "oak_stairs", "torch", "oak_door", "white_wool", "water", "lava"]);

    const store = await freshStore();
    await store.writeWorld(data);
    const { world, ticks, save } = await openWorld(store, (await store.getWorld("fixture-world-2"))!);
    await save.loadNow(8, 8, 1);
    expect(stateName(world.get(3, 100, 3))).toBe("oak_stairs[facing=east,half=top,shape=inner_left]");
    expect(stateName(world.get(4, 100, 4))).toBe("oak_door[facing=west,half=lower,open=true,hinge=right,powered=false]");
    expect(stateName(world.get(4, 101, 4))).toBe("oak_door[facing=west,half=upper,open=true,hinge=right,powered=false]");
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
      inventory: [{ item: "glass", count: 1 }, { item: "oak_door", count: 1 }, { item: "birch_log", count: 1 }, ...new Array(38).fill(null)],
    });
    const { world, save } = await openWorld(store, (await store.getWorld("fixture-world-4"))!);
    await save.loadNow(8, 8, 0);
    expect(world.get(8, 120, 8)).toBe(Block.Glowstone);
  });
});

describe("saves from earlier versions, items", () => {
  it("opens a world saved in format 5: survival, the inventory, a chest's contents, items lying about", async () => {
    const data = readWorldFile(new Uint8Array(readFileSync(new URL("./fixtures/format-5.craftworld", import.meta.url))));
    expect(data.meta.mode).toBe("survival");
    expect(data.player!.selected).toBe(1);
    expect(data.player!.inventory.slice(0, 2)).toEqual([{ item: "iron_pickaxe", count: 1, damage: 17 }, { item: "torch", count: 23 }]);
    expect(data.player!.inventory[36]).toEqual({ item: "diamond", count: 1 });
    const store = await freshStore();
    await store.writeWorld(data);
    const { world, save } = await openWorld(store, (await store.getWorld("fixture-world-5"))!);
    await save.loadNow(8, 8, 0);
    const chest = world.blockEntity(5, 120, 5) as ChestEntity;
    expect(chest.items[13]).toEqual({ item: itemByName("iron_ingot"), count: 9, damage: 0 });
    const record = await store.getChunk("fixture-world-5", 0, 0);
    expect(record!.drops.map((d) => d.item)).toEqual([{ item: "cobblestone", count: 3 }]);
    // Format 5 had no survival: the player is alive and well, the world normal
    expect(data.meta).toMatchObject({ difficulty: "normal", hardcore: false });
    expect(data.player).toMatchObject({ vitals: { health: 20, food: 20, xp: 0 }, bed: null, spectating: false, flying: false });
  });
});

describe("saves from earlier versions, survival", () => {
  it("opens a world saved in format 6: hardcore, vitals and a bed, a guest looking on, orbs and a furnace's experience", async () => {
    const data = readWorldFile(new Uint8Array(readFileSync(new URL("./fixtures/format-6.craftworld", import.meta.url))));
    expect(data.meta).toMatchObject({ mode: "survival", difficulty: "hard", hardcore: true });
    expect(data.player).toMatchObject({ vitals: { health: 7.5, food: 12, saturation: 1.5, air: 120, fire: 40, xp: 120 }, bed: { x: 4, y: 120, z: 4 } });
    expect(data.guests?.[0]).toMatchObject({ name: "Alex", spectating: true, flying: true });
    const store = await freshStore();
    await store.writeWorld(data);
    const { world, save } = await openWorld(store, (await store.getWorld("fixture-world-6"))!);
    await save.loadNow(8, 8, 0);
    expect(stateName(world.get(4, 120, 4))).toBe("red_bed[facing=north,part=head]");
    expect(stateName(world.get(4, 120, 5))).toBe("red_bed[facing=north,part=foot]");
    expect(world.get(8, 120, 8)).toBe(Block.Melon);
    expect(world.get(9, 120, 9)).toBe(Block.BrownMushroom);
    expect((world.blockEntity(6, 120, 6) as FurnaceEntity).xp).toBeCloseTo(1.4);
    const record = await store.getChunk("fixture-world-6", 0, 0);
    expect(record!.drops.map((d) => d.xp ?? d.item)).toEqual([{ item: "mushroom_stew", count: 1 }, 17]);
  });
});

describe("saves from earlier versions, mobs", () => {
  it("opens a world saved in format 7: the animals in a chunk, not its monsters", async () => {
    const data = readWorldFile(new Uint8Array(readFileSync(new URL("./fixtures/format-7.craftworld", import.meta.url))));
    const store = await freshStore();
    await store.writeWorld(data);
    const record = await store.getChunk("fixture-world-7", 0, 0);
    expect(record!.mobs).toEqual([
      { kind: "sheep", x: 4.5, y: 130, z: 4.5, yaw: 1, health: 8, color: 14, sheared: true },
      { kind: "cow", x: 9.5, y: 130, z: 9.5, yaw: 2, health: 6 },
    ]);
    // Older chunks come without animals
    const old = readWorldFile(new Uint8Array(readFileSync(new URL("./fixtures/format-6.craftworld", import.meta.url))));
    await store.writeWorld(old);
    expect((await store.getChunk("fixture-world-6", 0, 0))!.mobs).toEqual([]);
  });
});

describe("saves from earlier versions, commands", () => {
  it("opens a world saved in format 8: a player's own game mode and spawn point", async () => {
    const data = readWorldFile(new Uint8Array(readFileSync(new URL("./fixtures/format-8.craftworld", import.meta.url))));
    expect(data.player).toMatchObject({ mode: "creative", spawn: { x: 100.5, y: 80, z: -20.5 } });
    expect(data.guests?.[0]).toMatchObject({ name: "Alex", mode: "spectator", spawn: null });
    // Players from before commands play the world's way
    const old = readWorldFile(new Uint8Array(readFileSync(new URL("./fixtures/format-7.craftworld", import.meta.url))));
    expect(old.player).toMatchObject({ mode: null, spawn: null });
  });
});

describe("saves from earlier versions, farms and weather", () => {
  it("opens a world saved in format 9: its weather, a baby animal, a farm and redstone", async () => {
    const data = readWorldFile(new Uint8Array(readFileSync(new URL("./fixtures/format-9.craftworld", import.meta.url))));
    expect(data.meta.weather).toEqual({ raining: true, thundering: true, rainTime: 4000, thunderTime: 3000 });
    const store = await freshStore();
    await store.writeWorld(data);
    expect((await store.getChunk("fixture-world-9", 0, 0))!.mobs).toEqual([{ kind: "cow", x: 6.5, y: 130, z: 6.5, yaw: 0, health: 10, growUp: 12000 }]);
    const { world, save } = await openWorld(store, (await store.getWorld("fixture-world-9"))!);
    await save.loadNow(8, 8, 1);
    expect([2, 4, 5, 6].map((x) => stateName(world.get(x, 129, x === 2 ? 2 : 4)))).toEqual([
      "wheat[age=5]",
      "lever[face=floor,facing=north,powered=true]",
      "redstone_wire[power=14,north=false,east=true,south=false,west=true]",
      "redstone_lamp[lit=true]",
    ]);
    expect(stateName(world.get(2, 128, 2))).toBe("farmland[moisture=7]");
    // Worlds from before weather have theirs decided when opened
    const old = readWorldFile(new Uint8Array(readFileSync(new URL("./fixtures/format-8.craftworld", import.meta.url))));
    expect(old.meta.weather).toBeNull();
  });
});

describe("saves from earlier versions, pistons and hoppers", () => {
  it("opens a world saved in format 10: a hopper's items, a piston pushed out, a block on its way", async () => {
    const data = readWorldFile(new Uint8Array(readFileSync(new URL("./fixtures/format-10.craftworld", import.meta.url))));
    const store = await freshStore();
    await store.writeWorld(data);
    const record = await store.getChunk("fixture-world-10", 0, 0);
    expect(record!.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "hopper", x: 2, y: 128, z: 2, items: [{ item: "coal", count: 5 }, null, null, null, { item: "cobblestone", count: 64 }], cooldown: 0 }),
        expect.objectContaining({ kind: "moving", x: 8, y: 128, z: 4, state: "oak_log[axis=x]", dir: 0, progress: 0.5, extending: true, head: false }),
      ]),
    );
    const { world, save } = await openWorld(store, (await store.getWorld("fixture-world-10"))!);
    await save.loadNow(8, 8, 1);
    expect([5, 6, 8, 10, 12].map((x) => stateName(world.get(x, 128, x === 2 ? 2 : 4)))).toEqual([
      "sticky_piston[facing=east,extended=true]",
      "piston_head[facing=east,type=sticky]",
      "moving_piston",
      "comparator[facing=east,mode=subtract,power=7]",
      "observer[facing=up,powered=false]",
    ]);
    expect(world.blockEntity(2, 128, 2)?.items[0]).toMatchObject({ item: itemByName("coal"), count: 5 });
    expect(world.blockEntity(8, 128, 4)).toMatchObject({ kind: "moving", state: stateOf(Block.Log, { axis: "x" }), progress: 0.5 });
  });
});

describe("saves from earlier versions, the industry", () => {
  it("opens a world saved in format 11: machines with their energy, slots and work, a battery's charge", async () => {
    const data = readWorldFile(new Uint8Array(readFileSync(new URL("./fixtures/format-11.craftworld", import.meta.url))));
    const store = await freshStore();
    await store.writeWorld(data);
    const { world, save } = await openWorld(store, (await store.getWorld("fixture-world-11"))!);
    await save.loadNow(8, 8, 1);
    expect([2, 4, 6, 8, 10].map((x) => stateName(world.get(x, 128, 2)))).toEqual([
      "generator[facing=south,active=true]",
      "tin_cable[north=false,east=true,south=false,west=true,up=false,down=false]",
      "macerator[facing=north,active=true]",
      "battery_box[facing=up]",
      "rubber_log[axis=y,resin=wet,facing=east]",
    ]);
    expect(world.blockEntity(2, 128, 2)).toMatchObject({ kind: "machine", energy: 1234.5, burn: 150, burnTotal: 400, items: [{ item: itemByName("coal"), count: 7 }, null] });
    expect(world.blockEntity(6, 128, 2)).toMatchObject({ energy: 300, progress: 120, items: [{ item: itemByName("raw_tin"), count: 5 }, null, { item: itemByName("tin_dust"), count: 4 }] });
    expect(world.blockEntity(8, 128, 2)).toMatchObject({ energy: 20000, items: [{ item: itemByName("battery"), count: 1, damage: 5000 }, null] });
  });
});

describe("settings", () => {
  it("come back as saved, with defaults for anything missing, damaged or out of range", () => {
    const kept = new Map<string, string>();
    const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    const keys = { ...DEFAULT_SETTINGS.keys, sneak: "ShiftLeft", sprint: "KeyR" };
    saveSettings({ ...DEFAULT_SETTINGS, renderer: "canvas", view: 64, fov: 90, sensitivity: 1.5, name: "  Alex  ", volume: { ...DEFAULT_SETTINGS.volume, music: 0 }, keys, particles: "minimal" }, storage);
    expect(loadSettings(storage)).toEqual({ ...DEFAULT_SETTINGS, renderer: "canvas", view: 64, fov: 90, sensitivity: 1.5, name: "Alex", volume: { ...DEFAULT_SETTINGS.volume, music: 0 }, keys, particles: "minimal" });
    kept.set("craft.settings", JSON.stringify({ renderer: "vulkan", view: 9999, fov: "wide", sensitivity: -1, volume: { master: 7 }, keys: { jump: "<script>" }, guiScale: "huge" }));
    expect(loadSettings(storage)).toEqual({ ...DEFAULT_SETTINGS, renderer: "webgl", view: 160, fov: 70, sensitivity: 0.25, name: "", volume: { ...DEFAULT_SETTINGS.volume, master: 1 } });
    kept.set("craft.settings", "{not json");
    expect(loadSettings(storage).fov).toBe(70);
    expect(loadSettings(null).renderer).toBe("webgl");
  });
});

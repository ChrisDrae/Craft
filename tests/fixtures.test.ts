import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Block, stateOf } from "../src/blocks.js";
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
  });
});

describe("settings", () => {
  it("come back as saved, with defaults for anything missing, damaged or out of range", () => {
    const kept = new Map<string, string>();
    const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
    expect(loadSettings(storage)).toEqual({ renderer: "webgl", view: null, fov: 70, sensitivity: 1 });
    saveSettings({ renderer: "canvas", view: 64, fov: 90, sensitivity: 1.5 }, storage);
    expect(loadSettings(storage)).toEqual({ renderer: "canvas", view: 64, fov: 90, sensitivity: 1.5 });
    kept.set("craft.settings", JSON.stringify({ renderer: "vulkan", view: 9999, fov: "wide", sensitivity: -1 }));
    expect(loadSettings(storage)).toEqual({ renderer: "webgl", view: 160, fov: 70, sensitivity: 0.25 });
    kept.set("craft.settings", "{not json");
    expect(loadSettings(storage).fov).toBe(70);
    expect(loadSettings(null).renderer).toBe("webgl");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TILE } from "../src/atlas.js";
import { BLOCKS, Block } from "../src/blocks.js";
import { TILES, iconPixels, minecraftTiles, overlay, proceduralTiles, tint } from "../src/textures.js";

/** A tile of one color. */
function solid(r: number, g: number, b: number, a: number = 255): Uint8ClampedArray<ArrayBuffer> {
  const t = new Uint8ClampedArray(TILE * TILE * 4);
  for (let i = 0; i < t.length; i += 4) t.set([r, g, b, a], i);
  return t;
}

const first = (t: Uint8ClampedArray): number[] => Array.from(t.subarray(0, 4));

describe("procedural textures", () => {
  it("has pixels for every tile, cut out only in textures of see-through blocks", () => {
    const tiles = proceduralTiles();
    // Opaque blocks need every pixel; cut-out ones (leaves, glass, plants, doors) may have holes
    const solid = new Set(BLOCKS.filter((b) => b.opacity === "opaque" && b.id !== Block.Air).flatMap((b) => b.textures));
    for (const name of TILES) {
      const t = tiles.get(name)!;
      expect(t).toHaveLength(TILE * TILE * 4);
      let holes = 0;
      for (let i = 3; i < t.length; i += 4) if (t[i] === 0) holes++;
      if (solid.has(name)) expect(holes, name).toBe(0);
    }
    for (const name of ["oak_leaves", "torch", "glass", "ladder", "dandelion", "oak_door_top"]) {
      expect(tiles.get(name)!.some((v, i) => i % 4 === 3 && v === 0), name).toBe(true);
    }
  });
});

describe("Minecraft textures", () => {
  it("multiplies a tint into the colors and keeps the alpha", () => {
    const t = tint(solid(200, 100, 255, 180), [128, 255, 0]);
    expect(first(t)).toEqual([100, 100, 0, 180]);
  });

  it("lays an overlay over a tile by its alpha", () => {
    const base = solid(0, 0, 0);
    const top = solid(200, 100, 50, 0);
    top.set([200, 100, 50, 255], 0);
    top.set([200, 100, 50, 128], 4);
    const out = overlay(base, top);
    expect(first(out)).toEqual([200, 100, 50, 255]);
    expect(Array.from(out.subarray(4, 8))).toEqual([100, 50, 25, 255]);
    expect(Array.from(out.subarray(8, 12))).toEqual([0, 0, 0, 255]);
  });

  it("keeps Minecraft's gray grass, leaves and water for the mesh to color by biome, and makes water opaque", () => {
    const gray = solid(255, 255, 255);
    const files = new Map([
      ["grass_block_top", gray],
      ["oak_leaves", solid(255, 255, 255, 0)],
      ["water_still", solid(255, 255, 255, 180)],
      ["grass_block_side", solid(10, 20, 30)],
      ["grass_block_side_overlay", solid(255, 255, 255, 255)],
      ["stone", solid(90, 90, 90)],
    ]);
    const tiles = minecraftTiles(files);
    expect(first(tiles.get("grass_block_top")!)).toEqual([255, 255, 255, 255]);
    expect(first(tiles.get("oak_leaves")!)).toEqual([255, 255, 255, 0]);
    expect(first(tiles.get("water_still")!)).toEqual([255, 255, 255, 255]);
    expect(first(tiles.get("grass_block_side")!)).toEqual([10, 20, 30, 255]);
    expect(first(tiles.get("grass_block_side_overlay")!)).toEqual([255, 255, 255, 255]);
    expect(first(tiles.get("stone")!)).toEqual([90, 90, 90, 255]);
    // Icons show them as they look in plains, the grass laid over a grass block's side
    expect(first(iconPixels(tiles, Block.Grass)!)).toEqual([0x91, 0xbd, 0x59, 255]);
    expect(first(iconPixels(tiles, Block.Leaves)!)).toEqual([0x77, 0xab, 0x2f, 0]);
    expect(first(iconPixels(tiles, Block.Stone)!)).toEqual([90, 90, 90, 255]);
    // Only what was there; the files themselves are left alone
    expect(tiles.has("dirt")).toBe(false);
    expect(first(gray)).toEqual([255, 255, 255, 255]);
  });
});

describe("the texture importer", () => {
  it("knows every texture Craft uses", () => {
    const script = new TextDecoder().decode(readFileSync(new URL("../scripts/import-textures.mjs", import.meta.url)));
    // Wool and beds are listed by color, tools and armor by material; the chest comes from its model's
    // texture, the orbs from their sheet
    for (const name of TILES) {
      if (name.endsWith("_wool") || name.startsWith("chest_") || /^[a-z_]+_bed_(head|foot)_[a-z]+$/.test(name) || name.startsWith("experience_orb_") || name.startsWith("particle_") || /_stage\d$/.test(name)) continue;
      const item = name.replace(/^item_/, "");
      if (/_(pickaxe|axe|shovel|hoe|sword|helmet|chestplate|leggings|boots)$/.test(item)) continue;
      expect(script, name).toContain(`"${item}"`);
    }
    expect(script).toContain("_wool`");
    expect(script).toContain("_bed_${f}`");
    expect(script).toContain("entity/chest/normal.png");
    expect(script).toContain("entity/experience/experience_orb.png");
    expect(script).toContain("[`particle_${n}`, [`particle/${n}.png`]]");
    expect(script).toContain("`wheat_stage${i}`");
    expect(script).toContain("`carrots_stage${i}`, `potatoes_stage${i}`");
  });
});

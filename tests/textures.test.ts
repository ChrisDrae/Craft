import { describe, expect, it } from "vitest";
import { TILE } from "../src/atlas.js";
import { TILES, minecraftTiles, overlay, proceduralTiles, tint } from "../src/textures.js";

/** A tile of one color. */
function solid(r: number, g: number, b: number, a: number = 255): Uint8ClampedArray<ArrayBuffer> {
  const t = new Uint8ClampedArray(TILE * TILE * 4);
  for (let i = 0; i < t.length; i += 4) t.set([r, g, b, a], i);
  return t;
}

const first = (t: Uint8ClampedArray): number[] => Array.from(t.subarray(0, 4));

describe("procedural textures", () => {
  it("has pixels for every tile, cut out only in the leaves and the torch", () => {
    const tiles = proceduralTiles();
    for (const name of TILES) {
      const t = tiles.get(name)!;
      expect(t).toHaveLength(TILE * TILE * 4);
      let holes = 0;
      for (let i = 3; i < t.length; i += 4) if (t[i] === 0) holes++;
      if (name === "oak_leaves" || name === "torch") expect(holes).toBeGreaterThan(0);
      else expect(holes).toBe(0);
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

  it("tints grass, leaves and water like plains, puts the fringe on grass sides and makes water opaque", () => {
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
    expect(first(tiles.get("grass_block_top")!)).toEqual([0x91, 0xbd, 0x59, 255]);
    expect(first(tiles.get("oak_leaves")!)).toEqual([0x77, 0xab, 0x2f, 0]);
    expect(first(tiles.get("water_still")!)).toEqual([0x3f, 0x76, 0xe4, 255]);
    expect(first(tiles.get("grass_block_side")!)).toEqual([0x91, 0xbd, 0x59, 255]);
    expect(first(tiles.get("stone")!)).toEqual([90, 90, 90, 255]);
    // Only what was there; the files themselves are left alone
    expect(tiles.has("dirt")).toBe(false);
    expect(first(gray)).toEqual([255, 255, 255, 255]);
  });
});

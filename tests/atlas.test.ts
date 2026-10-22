import { describe, expect, it } from "vitest";
import { Atlas, GUTTER, TILE } from "../src/atlas.js";
import { BLOCKS, Block, Dir } from "../src/blocks.js";
import { TILES, blockAtlas, proceduralTiles, tileFor } from "../src/textures.js";

/** A tile whose every pixel encodes its own position: (x, y, tile number, 255). */
function marked(n: number): Uint8ClampedArray<ArrayBuffer> {
  const t = new Uint8ClampedArray(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) t.set([x, y, n, 255], (y * TILE + x) * 4);
  }
  return t;
}

function pixel(atlas: Atlas, x: number, y: number): number[] {
  const o = (y * atlas.width + x) * 4;
  return Array.from(atlas.pixels.subarray(o, o + 4));
}

describe("Atlas", () => {
  it("places each tile in its slot, with a gutter repeating its edge pixels", () => {
    const atlas = new Atlas(5);
    for (let i = 0; i < 5; i++) atlas.put(i, marked(i));
    const [u0, v0, u1, v1] = atlas.rect(4);
    const x0 = Math.round(u0 * atlas.width);
    const y0 = Math.round(v0 * atlas.height);
    expect(Math.round(u1 * atlas.width) - x0).toBe(TILE);
    expect(Math.round(v1 * atlas.height) - y0).toBe(TILE);
    // The tile itself, pixel for pixel
    expect(pixel(atlas, x0, y0)).toEqual([0, 0, 4, 255]);
    expect(pixel(atlas, x0 + 15, y0 + 9)).toEqual([15, 9, 4, 255]);
    // The gutter: edges repeated outward, corners filled with the corner pixel
    expect(pixel(atlas, x0 - GUTTER, y0 + 9)).toEqual([0, 9, 4, 255]);
    expect(pixel(atlas, x0 + TILE + GUTTER - 1, y0 + 3)).toEqual([15, 3, 4, 255]);
    expect(pixel(atlas, x0 - 1, y0 - GUTTER)).toEqual([0, 0, 4, 255]);
    expect(pixel(atlas, x0 + TILE, y0 + TILE + GUTTER - 1)).toEqual([15, 15, 4, 255]);
  });

  it("gives every block face the rectangle of its tile", () => {
    const { atlas, uvs } = blockAtlas(proceduralTiles());
    const rect = (block: number, dir: number): number[] => Array.from(uvs.subarray((block * 6 + dir) * 4, (block * 6 + dir) * 4 + 4));
    for (let block = 1; block < BLOCKS.length; block++) {
      for (let dir = 0; dir < 6; dir++) expect(rect(block, dir)).toEqual(Array.from(atlas.rect(TILES.indexOf(tileFor(block, dir)))));
    }
    expect(rect(Block.Grass, Dir.Up)).not.toEqual(rect(Block.Grass, Dir.PosX));
    expect(rect(Block.Grass, Dir.Down)).toEqual(rect(Block.Dirt, Dir.Up));
  });
});

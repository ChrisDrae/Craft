import { describe, expect, it } from "vitest";
import { Block, stateOf } from "../src/blocks.js";
import { SECTIONS, SECTION_VOLUME } from "../src/chunk.js";
import { TerrainGenerator } from "../src/generator.js";
import { chunkRecord, compress, decodeBlocks, decompress, encodeBlocks, readChunkRecord, snapshotChunk } from "../src/save/codec.js";
import { VoxelWorld } from "../src/world.js";

function generated(): VoxelWorld {
  const world = new VoxelWorld(new TerrainGenerator("codec"));
  world.load(0, 0);
  return world;
}

describe("chunk encoding", () => {
  it("gives back the same blocks, counts and opaque counts", () => {
    const world = generated();
    world.set(3, 120, 4, stateOf(Block.Log, { axis: "z" }));
    const chunk = world.chunk(0, 0)!;
    const { palette, raw } = encodeBlocks(chunk);
    expect(palette).toContain("oak_log[axis=z]");
    expect(raw[0]).toBe(1);
    const { chunk: back, unknown } = decodeBlocks(0, 0, palette, raw);
    expect(unknown).toBe(0);
    for (let s = 0; s < SECTIONS; s++) {
      expect(back.sections[s].blocks).toEqual(chunk.sections[s].blocks);
      expect(back.sections[s].count).toBe(chunk.sections[s].count);
      expect(back.sections[s].opaque).toBe(chunk.sections[s].opaque);
    }
    expect(back.get(3, 120, 4)).toBe(stateOf(Block.Log, { axis: "z" }));
  });

  it("reads two-byte indices, for palettes of more than 256 states", () => {
    const raw = new Uint8Array(3 + SECTION_VOLUME * 2);
    raw[0] = 2;
    raw[1] = 1 << 2;
    // Section 2, block 5 is palette entry 257
    raw[3 + 5 * 2] = 1;
    raw[3 + 5 * 2 + 1] = 1;
    const palette: string[] = Array.from({ length: 258 }, (_, i) => (i === 257 ? "bricks" : "stone"));
    palette[0] = "air";
    const { chunk } = decodeBlocks(0, 0, palette, raw);
    expect(chunk.get(5, 32, 0)).toBe(Block.Bricks);
    expect(chunk.sections[2].count).toBe(1);
  });

  it("turns states it doesn't know into air", () => {
    const world = generated();
    const { palette, raw } = encodeBlocks(world.chunk(0, 0)!);
    const stone = palette.indexOf("stone");
    palette[stone] = "diamond_block";
    const { chunk, unknown } = decodeBlocks(0, 0, palette, raw);
    expect(unknown).toBeGreaterThan(1000);
    expect(chunk.get(8, 10, 8)).not.toBe(Block.Stone);
  });

  it("compresses and decompresses losslessly", async () => {
    const bytes = encodeBlocks(generated().chunk(0, 0)!).raw;
    const small = await compress(bytes);
    expect(small.length).toBeLessThan(bytes.length / 4);
    expect(await decompress(small)).toEqual(bytes);
  });

  it("keeps a chunk's scheduled ticks by block name, and marks a read chunk saved", async () => {
    const world = generated();
    const ticks = [{ x: 2, y: 70, z: 3, block: Block.Sand, due: 41 }];
    const record = await chunkRecord("w", snapshotChunk(world.chunk(0, 0)!, ticks));
    expect(record.ticks).toEqual([{ x: 2, y: 70, z: 3, block: "sand", due: 41 }]);
    const back = await readChunkRecord(record);
    expect(back.ticks).toEqual(ticks);
    expect(back.chunk.unsaved).toBe(false);
  });
});

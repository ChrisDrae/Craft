import { Chunk, type ChunkGenerator, type PackedBlocks } from "./chunk.js";
import { compress, encodeBlocks } from "./save/codec.js";

/** A request to the generation worker. */
export interface GenerateRequest {
  seed: string;
  cx: number;
  cz: number;
}

/**
 * A generated chunk from the worker: its sections' blocks (null when empty) and their counts, and the
 * blocks encoded for saving.
 */
export interface GeneratedChunk {
  cx: number;
  cz: number;
  sections: (Uint16Array | null)[];
  counts: number[];
  opaque: number[];
  packed: PackedBlocks | null;
}

function takeApart(chunk: Chunk, packed: PackedBlocks | null): GeneratedChunk {
  const sections = chunk.sections;
  return { cx: chunk.cx, cz: chunk.cz, sections: sections.map((s) => s.blocks), counts: sections.map((s) => s.count), opaque: sections.map((s) => s.opaque), packed };
}

/** Generates a chunk and takes it apart for posting. */
export function generateChunk(generator: ChunkGenerator, cx: number, cz: number): GeneratedChunk {
  const chunk = new Chunk(cx, cz);
  generator.generate(chunk);
  return takeApart(chunk, null);
}

/** What the worker does for every request: generateChunk, with the blocks encoded and compressed for saving. */
export async function generatePackedChunk(generator: ChunkGenerator, cx: number, cz: number): Promise<GeneratedChunk> {
  const chunk = new Chunk(cx, cz);
  generator.generate(chunk);
  const { palette, raw } = encodeBlocks(chunk);
  return takeApart(chunk, { palette, blocks: await compress(raw) });
}

/** Puts a chunk from the worker back together. */
export function assembleChunk(data: GeneratedChunk): Chunk {
  const chunk = new Chunk(data.cx, data.cz);
  chunk.sections.forEach((s, i) => {
    s.blocks = data.sections[i];
    s.count = data.counts[i];
    s.opaque = data.opaque[i];
  });
  chunk.packed = data.packed;
  return chunk;
}

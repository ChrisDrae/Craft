import { Chunk, type ChunkGenerator, type PackedBlocks } from "./chunk.js";
import { lightChunk } from "./light.js";
import { compress, encodeBlocks } from "./save/codec.js";

/** A request to the generation worker. */
export interface GenerateRequest {
  seed: string;
  cx: number;
  cz: number;
}

/**
 * A chunk from the worker: its sections' blocks (null when empty) and their counts, their light (null
 * where a section has one level throughout, `lightFill`), and the blocks encoded for saving.
 */
export interface GeneratedChunk {
  cx: number;
  cz: number;
  sections: (Uint16Array | null)[];
  counts: number[];
  opaque: number[];
  light: (Uint8Array | null)[];
  lightFill: number[];
  packed: PackedBlocks | null;
  biomes: Uint8Array;
  generator: number;
}

/** A lit chunk taken apart for posting. */
export function takeApart(chunk: Chunk, packed: PackedBlocks | null): GeneratedChunk {
  const s = chunk.sections;
  return {
    cx: chunk.cx,
    cz: chunk.cz,
    sections: s.map((x) => x.blocks),
    counts: s.map((x) => x.count),
    opaque: s.map((x) => x.opaque),
    light: s.map((x) => x.light),
    lightFill: s.map((x) => x.lightFill),
    packed,
    biomes: chunk.biomes,
    generator: chunk.generator,
  };
}

/** The arrays a chunk taken apart can hand over to another thread without copying. */
export function transferables(data: GeneratedChunk): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const a of [...data.sections, ...data.light]) if (a) out.push(a.buffer as ArrayBuffer);
  if (data.packed) out.push(data.packed.blocks.buffer as ArrayBuffer);
  out.push(data.biomes.buffer as ArrayBuffer);
  return out;
}

/** Generates and lights a chunk and takes it apart for posting. */
export function generateChunk(generator: ChunkGenerator, cx: number, cz: number): GeneratedChunk {
  const chunk = new Chunk(cx, cz);
  generator.generate(chunk);
  lightChunk(chunk);
  return takeApart(chunk, null);
}

/** What the worker does for every new chunk: generateChunk, with the blocks encoded and compressed for saving. */
export async function generatePackedChunk(generator: ChunkGenerator, cx: number, cz: number): Promise<GeneratedChunk> {
  const chunk = new Chunk(cx, cz);
  generator.generate(chunk);
  lightChunk(chunk);
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
    s.light = data.light[i];
    s.lightFill = data.lightFill[i];
  });
  chunk.packed = data.packed;
  chunk.biomes = data.biomes;
  chunk.generator = data.generator;
  return chunk;
}

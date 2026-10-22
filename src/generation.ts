import { Chunk, type ChunkGenerator } from "./chunk.js";

/** A request to the generation worker. */
export interface GenerateRequest {
  seed: string;
  cx: number;
  cz: number;
}

/** A generated chunk from the worker: its sections' blocks (null when empty) and their counts. */
export interface GeneratedChunk {
  cx: number;
  cz: number;
  sections: (Uint16Array | null)[];
  counts: number[];
  opaque: number[];
}

/** Generates a chunk and takes it apart for posting (what the worker does for every request). */
export function generateChunk(generator: ChunkGenerator, cx: number, cz: number): GeneratedChunk {
  const chunk = new Chunk(cx, cz);
  generator.generate(chunk);
  const sections = chunk.sections;
  return { cx, cz, sections: sections.map((s) => s.blocks), counts: sections.map((s) => s.count), opaque: sections.map((s) => s.opaque) };
}

/** Puts a chunk from the worker back together. */
export function assembleChunk(data: GeneratedChunk): Chunk {
  const chunk = new Chunk(data.cx, data.cz);
  chunk.sections.forEach((s, i) => {
    s.blocks = data.sections[i];
    s.count = data.counts[i];
    s.opaque = data.opaque[i];
  });
  return chunk;
}

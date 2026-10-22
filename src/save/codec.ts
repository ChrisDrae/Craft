import { BLOCKS, OPAQUE, STATE_COUNT, blockByName, stateByName, stateName } from "../blocks.js";
import { Chunk, SECTIONS, SECTION_VOLUME } from "../chunk.js";
import type { ScheduledTick } from "../ticks.js";
import { lightChunk } from "../light.js";
import { FORMAT_VERSION, upgrade, type ChunkRecord } from "./format.js";

/**
 * A chunk's blocks as bytes, before compression: one byte giving the bytes per block (1 for palettes up to
 * 256 states, 2 above), two bytes (little-endian) with a bit per non-empty section, then each such
 * section's 4096 palette indices in section order.
 */
export function encodeBlocks(chunk: Chunk): { palette: string[]; raw: Uint8Array } {
  const index = new Int32Array(STATE_COUNT).fill(-1);
  const states: number[] = [];
  let mask = 0;
  for (let s = 0; s < SECTIONS; s++) {
    const blocks = chunk.sections[s].blocks;
    if (!blocks) continue;
    mask |= 1 << s;
    for (let i = 0; i < SECTION_VOLUME; i++) {
      const b = blocks[i];
      if (index[b] < 0) {
        index[b] = states.length;
        states.push(b);
      }
    }
  }
  const width = states.length > 256 ? 2 : 1;
  let filled = 0;
  for (let s = 0; s < SECTIONS; s++) if (mask & (1 << s)) filled++;
  const raw = new Uint8Array(3 + filled * SECTION_VOLUME * width);
  raw[0] = width;
  raw[1] = mask & 255;
  raw[2] = mask >> 8;
  let o = 3;
  for (let s = 0; s < SECTIONS; s++) {
    const blocks = chunk.sections[s].blocks;
    if (!blocks) continue;
    for (let i = 0; i < SECTION_VOLUME; i++) {
      const v = index[blocks[i]];
      raw[o++] = v & 255;
      if (width === 2) raw[o++] = v >> 8;
    }
  }
  return { palette: states.map(stateName), raw };
}

/**
 * Builds a chunk from encodeBlocks' output. States this version doesn't know (from a newer Craft, or a
 * block since removed) become air; `unknown` counts them.
 */
export function decodeBlocks(cx: number, cz: number, palette: readonly string[], raw: Uint8Array): { chunk: Chunk; unknown: number } {
  const states = palette.map((name) => stateByName(name));
  const chunk = new Chunk(cx, cz);
  const width = raw[0];
  const mask = raw[1] | (raw[2] << 8);
  let o = 3;
  let unknown = 0;
  for (let s = 0; s < SECTIONS; s++) {
    if (!(mask & (1 << s))) continue;
    const blocks = new Uint16Array(SECTION_VOLUME);
    let count = 0;
    let opaque = 0;
    for (let i = 0; i < SECTION_VOLUME; i++) {
      const v = width === 2 ? raw[o] | (raw[o + 1] << 8) : raw[o];
      o += width;
      const state = states[v] ?? null;
      if (state === null) {
        unknown++;
        continue;
      }
      blocks[i] = state;
      if (state !== 0) count++;
      opaque += OPAQUE[state];
    }
    const section = chunk.sections[s];
    if (count > 0) section.blocks = blocks;
    section.count = count;
    section.opaque = opaque;
  }
  return { chunk, unknown };
}

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function compress(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new CompressionStream("deflate-raw"));
}

export function decompress(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new DecompressionStream("deflate-raw"));
}

/**
 * A chunk as it is taken apart for saving: taken at once, so later edits don't leak in. The blocks are
 * encoded (`raw`, compressed later), or already compressed when the chunk came packed from the worker.
 */
export interface ChunkSnapshot {
  cx: number;
  cz: number;
  generator: number;
  palette: string[];
  raw: Uint8Array | null;
  compressed: Uint8Array | null;
  ticks: ScheduledTick[];
}

export function snapshotChunk(chunk: Chunk, generator: number, ticks: readonly ScheduledTick[]): ChunkSnapshot {
  const base = { cx: chunk.cx, cz: chunk.cz, generator, ticks: [...ticks] };
  if (chunk.packed) return { ...base, palette: chunk.packed.palette, raw: null, compressed: chunk.packed.blocks };
  const { palette, raw } = encodeBlocks(chunk);
  return { ...base, palette, raw, compressed: null };
}

export async function chunkRecord(world: string, snap: ChunkSnapshot): Promise<ChunkRecord> {
  return {
    format: FORMAT_VERSION,
    world,
    cx: snap.cx,
    cz: snap.cz,
    generator: snap.generator,
    palette: snap.palette,
    blocks: snap.compressed ?? (await compress(snap.raw!)),
    ticks: snap.ticks.map((t) => ({ x: t.x, y: t.y, z: t.z, block: BLOCKS[t.block].name, due: t.due })),
  };
}

/**
 * A saved chunk back in one piece and lit on its own (saves don't keep light: it follows from the blocks),
 * with its scheduled ticks (those of unknown blocks dropped).
 */
export async function readChunkRecord(record: ChunkRecord): Promise<{ chunk: Chunk; ticks: ScheduledTick[] }> {
  const r = upgrade("chunk", record);
  const { chunk, unknown } = decodeBlocks(r.cx, r.cz, r.palette, await decompress(r.blocks));
  if (unknown > 0) console.warn(`Craft: chunk ${r.cx}, ${r.cz} had ${unknown} blocks this version doesn't know; they are air now.`);
  lightChunk(chunk);
  chunk.unsaved = false;
  const ticks: ScheduledTick[] = [];
  for (const t of r.ticks) {
    const block = blockByName(t.block);
    if (block !== null) ticks.push({ x: t.x, y: t.y, z: t.z, block, due: t.due });
  }
  return { chunk, ticks };
}

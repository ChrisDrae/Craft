import { BLOCKS, HOTBAR } from "../blocks.js";

/**
 * Version of the save format. Every record carries the version that wrote it: older records are migrated
 * as they're read, newer ones refused. tests/fixtures holds a world of every version, which must keep
 * opening.
 *
 * 1. The first.
 * 2. The player's hotbar (block names).
 * 3. Chunks keep their biomes.
 */
export const FORMAT_VERSION = 3;

export interface Position {
  x: number;
  y: number;
  z: number;
}

/** A world in the world list. */
export interface WorldMeta {
  format: number;
  id: string;
  name: string;
  seed: string;
  /** The terrain generator's version when the world was made (GENERATOR_VERSION). */
  generator: number;
  /** Milliseconds since 1970. */
  created: number;
  lastPlayed: number;
  /** Game ticks since the world began. */
  time: number;
  /** Where a new player starts, once the world has been played. */
  spawn: Position | null;
  /** Saved chunks and the bytes they take. */
  chunks: number;
  bytes: number;
}

export interface PlayerRecord {
  format: number;
  /** The world's id. */
  world: string;
  position: Position;
  velocity: Position;
  yaw: number;
  pitch: number;
  /** Hotbar slot, 0-8. */
  selected: number;
  /** The blocks in the hotbar's slots, by name. */
  hotbar: string[];
}

/** A scheduled tick waiting in a chunk, with its block by name. */
export interface SavedTick {
  x: number;
  y: number;
  z: number;
  block: string;
  due: number;
}

export interface ChunkRecord {
  format: number;
  /** The world's id. */
  world: string;
  cx: number;
  cz: number;
  /** The terrain generator's version that made the chunk. */
  generator: number;
  /** Block states by name (stateName); the blocks are indices into it. */
  palette: string[];
  /** The blocks, compressed (see encodeBlocks). */
  blocks: Uint8Array;
  /** The biome of every column (encodeBiomes); empty for plains throughout. */
  biomes: string;
  ticks: SavedTick[];
}

/** A save written by a newer Craft than this one. */
export class NewerFormatError extends Error {
  constructor(format: number) {
    super(`It was saved by a newer version of Craft (save format ${format}, this one reads up to ${FORMAT_VERSION}).`);
  }
}

type Migration<T> = (record: T) => T;
const next = (r: { format: number }): { format: number } => ({ ...r, format: r.format + 1 });
/** Migrations from each older format to the next, per kind of record (index 0 upgrades format 1). */
const MIGRATIONS: Record<"world" | "player" | "chunk", Migration<{ format: number }>[]> = {
  world: [next, next],
  // Players from before the hotbar could change get the hotbar it had
  player: [(r) => ({ ...next(r), hotbar: HOTBAR.map((b) => BLOCKS[b].name) }), next],
  // Chunks from before biomes were all made like plains
  chunk: [next, (r) => ({ ...next(r), biomes: "" })],
};

/** Brings a record read from storage or a file up to FORMAT_VERSION. */
export function upgrade<T extends { format: number }>(kind: "world" | "player" | "chunk", record: T): T {
  if (record.format > FORMAT_VERSION) throw new NewerFormatError(record.format);
  let r: { format: number } = record;
  while (r.format < FORMAT_VERSION) {
    const step = MIGRATIONS[kind][r.format - 1];
    if (!step) throw new Error(`No migration for ${kind} records from format ${r.format}.`);
    r = step(r);
  }
  return r as T;
}

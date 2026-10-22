import type { SavedEntity } from "../blockEntities.js";
import { BLOCKS, HOTBAR } from "../blocks.js";
import type { SavedDrop } from "../drops.js";
import type { SavedStack } from "../items.js";

/**
 * Version of the save format. Every record carries the version that wrote it: older records are migrated
 * as they're read, newer ones refused. tests/fixtures holds a world of every version, which must keep
 * opening.
 *
 * 1. The first.
 * 2. The player's hotbar (block names).
 * 3. Chunks keep their biomes.
 * 4. Guests: the players who joined the world from elsewhere, each by their id.
 * 5. Items: worlds have a game mode, players and guests an inventory (instead of a hotbar of block
 *    names), chunks their chests' and furnaces' contents and the items lying in them.
 */
export const FORMAT_VERSION = 5;

/** How a world is played: gathering and crafting, or with every block at hand. */
export type GameMode = "survival" | "creative";

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
  mode: GameMode;
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
  /** What the player carries: hotbar, inventory, armor, off-hand (see Inventory). */
  inventory: (SavedStack | null)[];
}

/** A player who joined the world from another browser, kept for when they come back. */
export interface GuestRecord {
  format: number;
  /** The world's id. */
  world: string;
  /** The guest's id, kept in their browser. */
  id: string;
  name: string;
  position: Position;
  yaw: number;
  pitch: number;
  selected: number;
  inventory: (SavedStack | null)[];
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
  /** What its chests and furnaces hold. */
  entities: SavedEntity[];
  /** The items lying in it. */
  drops: SavedDrop[];
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
/** A hotbar of block names as an inventory: one of each in the first slots. */
function hotbarInventory(r: { format: number; hotbar?: string[] }): { format: number; inventory: (SavedStack | null)[] } {
  const { hotbar, ...rest } = r;
  const inventory: (SavedStack | null)[] = new Array(41).fill(null);
  (hotbar ?? []).forEach((name, i) => {
    if (i < 9 && name !== "air") inventory[i] = { item: name, count: 1 };
  });
  return { ...next(rest), inventory };
}

const MIGRATIONS: Record<RecordKind, Migration<{ format: number }>[]> = {
  // Worlds from before game modes were played with every block at hand
  world: [next, next, next, (r) => ({ ...next(r), mode: "creative" })],
  // Players from before the hotbar could change get the hotbar it had; their hotbar becomes their inventory
  player: [(r) => ({ ...next(r), hotbar: HOTBAR.map((b) => BLOCKS[b].name) }), next, next, hotbarInventory],
  // Chunks from before biomes were all made like plains; from before items they hold none
  chunk: [next, (r) => ({ ...next(r), biomes: "" }), next, (r) => ({ ...next(r), entities: [], drops: [] })],
  // Guests came with format 4
  guest: [next, next, next, hotbarInventory],
};

export type RecordKind = "world" | "player" | "chunk" | "guest";

/** Brings a record read from storage or a file up to FORMAT_VERSION. */
export function upgrade<T extends { format: number }>(kind: RecordKind, record: T): T {
  if (record.format > FORMAT_VERSION) throw new NewerFormatError(record.format);
  let r: { format: number } = record;
  while (r.format < FORMAT_VERSION) {
    const step = MIGRATIONS[kind][r.format - 1];
    if (!step) throw new Error(`No migration for ${kind} records from format ${r.format}.`);
    r = step(r);
  }
  return r as T;
}

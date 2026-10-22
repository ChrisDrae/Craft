import { upgrade, type ChunkRecord, type GuestRecord, type PlayerRecord, type WorldMeta } from "./format.js";
import type { WorldData } from "./store.js";

/** The first bytes of a .craftworld file. */
const MAGIC = "CRAFTWLD";
/** Version of the file layout (the records inside carry the save format's version). */
const FILE_VERSION = 1;

/** A chunk in the file's header: its record without the blocks, which follow the header. */
type ChunkEntry = Omit<ChunkRecord, "blocks" | "world"> & { length: number };

interface Header {
  meta: WorldMeta;
  player: Omit<PlayerRecord, "world"> | null;
  chunks: ChunkEntry[];
  /** Missing in files from before guests (format 4). */
  guests?: Array<Omit<GuestRecord, "world">>;
}

/**
 * A world as one file: "CRAFTWLD", the file version (uint32, little-endian), the length of a JSON header
 * (uint32) and the header (metadata, player and the chunks without their blocks), then every chunk's
 * compressed blocks one after another, in the header's order.
 */
export function writeWorldFile(data: WorldData): Uint8Array {
  let player: Header["player"] = null;
  if (data.player) {
    const { world: _, ...rest } = data.player;
    player = rest;
  }
  const header: Header = {
    meta: data.meta,
    player,
    chunks: data.chunks.map(({ blocks, world: _, ...rest }) => ({ ...rest, length: blocks.length })),
    guests: (data.guests ?? []).map(({ world: _, ...rest }) => rest),
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const body = data.chunks.reduce((n, c) => n + c.blocks.length, 0);
  const out = new Uint8Array(MAGIC.length + 8 + json.length + body);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(MAGIC), 0);
  view.setUint32(MAGIC.length, FILE_VERSION, true);
  view.setUint32(MAGIC.length + 4, json.length, true);
  out.set(json, MAGIC.length + 8);
  let o = MAGIC.length + 8 + json.length;
  for (const c of data.chunks) {
    out.set(c.blocks, o);
    o += c.blocks.length;
  }
  return out;
}

/** Reads a .craftworld file, upgrading its records. Throws on anything that isn't one. */
export function readWorldFile(bytes: Uint8Array): WorldData {
  const fail = (why: string): never => {
    throw new Error(`Not a Craft world file: ${why}.`);
  };
  if (bytes.length < MAGIC.length + 8 || new TextDecoder().decode(bytes.subarray(0, MAGIC.length)) !== MAGIC) fail("it doesn't start like one");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(MAGIC.length, true);
  if (version > FILE_VERSION) fail(`it has file version ${version}, this Craft reads up to ${FILE_VERSION}`);
  const length = view.getUint32(MAGIC.length + 4, true);
  const start = MAGIC.length + 8;
  if (start + length > bytes.length) fail("it is cut short");
  let header: Header;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + length)));
  } catch {
    return fail("its header is damaged");
  }
  const meta = upgrade("world", header.meta);
  let o = start + length;
  const chunks: ChunkRecord[] = header.chunks.map(({ length: n, ...entry }) => {
    if (o + n > bytes.length) fail("it is cut short");
    const blocks = bytes.slice(o, o + n);
    o += n;
    return upgrade("chunk", { ...entry, world: meta.id, blocks });
  });
  const player = header.player ? upgrade("player", { ...header.player, world: meta.id }) : null;
  const guests = (header.guests ?? []).map((g) => upgrade("guest", { ...g, world: meta.id }));
  return { meta, player, chunks, guests };
}

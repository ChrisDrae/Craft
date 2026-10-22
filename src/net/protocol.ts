import type { Action } from "../actions.js";
import { STATE_COUNT, stateName } from "../blocks.js";

/**
 * What host and guests say to each other. Every message is one binary frame: the length of a JSON header
 * (uint32, little-endian), the header, and for chunks the compressed blocks after it.
 */

/** Bumped whenever the messages change; host and guest must speak the same version. */
export const PROTOCOL_VERSION = 1;

/**
 * A fingerprint of the block states: blocks travel as state ids, which only mean the same to a host and a
 * guest running the same version of Craft.
 */
export const REGISTRY: number = (() => {
  let h = 2166136261 >>> 0;
  for (let s = 0; s < STATE_COUNT; s++) {
    const name = stateName(s);
    for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  }
  return h >>> 0;
})();

/** A player as the others see them. */
export interface PlayerView {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** A guest as the host keeps them between visits. */
export interface GuestState {
  position: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  selected: number;
  hotbar: string[];
}

export type ToHost =
  /** First thing a guest says: who they are, what they run, how far they see (in chunks). */
  | { t: "hello"; protocol: number; registry: number; id: string; name: string; view: number }
  | { t: "move"; x: number; y: number; z: number; yaw: number; pitch: number }
  | ({ t: "act" } & Action)
  | { t: "hotbar"; hotbar: string[]; selected: number }
  /** Chunks the guest let go of (too far away): the host sends them again when needed. */
  | { t: "dropped"; chunks: Array<[number, number]> };

export type ToGuest =
  | { t: "welcome"; id: string; world: string; time: number; you: GuestState }
  | { t: "refused"; reason: string }
  /** A chunk, its compressed blocks after the header (see encodeBlocks). */
  | { t: "chunk"; cx: number; cz: number; palette: string[]; biomes: string; generator: number }
  /** Blocks as they are now: x, y, z, state, x, y, z, state... */
  | { t: "blocks"; changes: number[] }
  | { t: "players"; players: PlayerView[] }
  | { t: "time"; time: number }
  | { t: "bye"; reason: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A message as a frame, with an optional binary payload. */
export function encode(message: ToHost | ToGuest, payload: Uint8Array | null = null): Uint8Array {
  const json = encoder.encode(JSON.stringify(message));
  const out = new Uint8Array(4 + json.length + (payload?.length ?? 0));
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 4);
  if (payload) out.set(payload, 4 + json.length);
  return out;
}

/** A frame back into its message and payload (empty without one). Throws on a frame that isn't one. */
export function decode<T extends ToHost | ToGuest>(frame: Uint8Array): { message: T; payload: Uint8Array } {
  if (frame.length < 4) throw new Error("Frame too short");
  const length = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(0, true);
  if (4 + length > frame.length) throw new Error("Frame cut short");
  const message = JSON.parse(decoder.decode(frame.subarray(4, 4 + length))) as T;
  if (typeof message !== "object" || message === null || typeof (message as { t?: unknown }).t !== "string") throw new Error("Not a message");
  return { message, payload: frame.subarray(4 + length) };
}

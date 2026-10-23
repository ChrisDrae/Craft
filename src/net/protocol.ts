import type { Action } from "../actions.js";
import type { SavedEntity } from "../blockEntities.js";
import { STATE_COUNT, stateName } from "../blocks.js";
import { ITEMS, type SavedStack } from "../items.js";
import type { GameMode, PlayerLife } from "../save/format.js";
import type { MobView } from "../mobs/mobs.js";
import type { DamageSource, Difficulty } from "../vitals.js";

/**
 * What host and guests say to each other. Every message is one binary frame: the length of a JSON header
 * (uint32, little-endian), the header, and for chunks the compressed blocks after it.
 */

/** Bumped whenever the messages change; host and guest must speak the same version. */
export const PROTOCOL_VERSION = 6;

/**
 * A fingerprint of the block states and items: they travel as ids, which only mean the same to a host and
 * a guest running the same version of Craft.
 */
export const REGISTRY: number = (() => {
  let h = 2166136261 >>> 0;
  const names = [...Array.from({ length: STATE_COUNT }, (_, s) => stateName(s)), ...ITEMS.map((i) => i.name)];
  for (const name of names) for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
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

/** A guest as the host keeps them between visits: where, what they carry, and how they are. */
export interface GuestState extends PlayerLife {
  position: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  selected: number;
  inventory: (SavedStack | null)[];
}

/** An item lying about, as guests see it: id, where, what and how many; an orb of experience has item -1 and its points. */
export type DropView = [id: number, x: number, y: number, z: number, item: number, count: number];
/** The item of an orb of experience in a DropView. */
export const ORB = -1;

export type ToHost =
  /** First thing a guest says: who they are, what they run, how far they see (in chunks). */
  | { t: "hello"; protocol: number; registry: number; id: string; name: string; view: number }
  | { t: "move"; x: number; y: number; z: number; yaw: number; pitch: number }
  /** An action done on the guest's side, with what the guest held (the tool that decides drops). */
  | ({ t: "act"; held: SavedStack | null } & Action)
  | { t: "inventory"; inventory: (SavedStack | null)[]; selected: number }
  /** How the guest is (health, hunger, experience, bed), for keeping. */
  | ({ t: "life" } & PlayerLife)
  /** The guest died: everyone is told how (and by what), and the experience they leave lies where they died. */
  | { t: "died"; cause: DamageSource; killer: string | null; xp: number }
  /** Hitting a mob: its id, the damage (the guest worked out with its weapon and timing), crit, knockback. */
  | { t: "attack"; id: number; damage: number; crit: boolean; knockback: number }
  /** Loosing an arrow from (x, y, z) at that velocity. */
  | { t: "shoot"; x: number; y: number; z: number; vx: number; vy: number; vz: number; crit: boolean }
  /** Using the held item on a mob (shears on a sheep). */
  | { t: "useMob"; id: number; held: SavedStack | null }
  /** A line of chat, for everyone. */
  | { t: "chat"; text: string }
  /** Lying in a bed, or up again. The night passes when every player sleeps. */
  | { t: "sleep"; asleep: boolean }
  /** Picking up an item lying about: as much as fits, at most `max`. */
  | { t: "take"; id: number; max: number }
  /** Throwing a stack out, from (x, y, z) with that velocity. */
  | { t: "throw"; item: SavedStack; x: number; y: number; z: number; vx: number; vy: number; vz: number }
  /** Opening, changing and closing a chest or furnace. */
  | { t: "open"; x: number; y: number; z: number }
  | { t: "slots"; x: number; y: number; z: number; slots: Array<[number, SavedStack | null]> }
  | { t: "close"; x: number; y: number; z: number }
  /** Chunks the guest let go of (too far away): the host sends them again when needed. */
  | { t: "dropped"; chunks: Array<[number, number]> };

export type ToGuest =
  | { t: "welcome"; id: string; world: string; time: number; mode: GameMode; difficulty: Difficulty; hardcore: boolean; spawn: { x: number; y: number; z: number }; weather: { rain: boolean; thunder: boolean }; you: GuestState }
  | { t: "refused"; reason: string }
  /** A chunk, its compressed blocks after the header (see encodeBlocks). */
  | { t: "chunk"; cx: number; cz: number; palette: string[]; biomes: string; generator: number }
  /** Blocks as they are now: x, y, z, state, x, y, z, state... */
  | { t: "blocks"; changes: number[] }
  | { t: "players"; players: PlayerView[] }
  | { t: "time"; time: number }
  /** The items lying near the guest. */
  | { t: "drops"; drops: DropView[] }
  /** What the guest picked up: an item, or experience. */
  | { t: "given"; item?: SavedStack; xp?: number }
  /** Something everyone is told: who died and how. */
  | { t: "notice"; text: string }
  /** The world's difficulty changed. */
  | { t: "rules"; difficulty: Difficulty }
  /** Morning: the night passed while everyone slept. */
  | { t: "wake" }
  /** The mobs and arrows near the guest. */
  | { t: "mobs"; mobs: MobView[] }
  /** The guest was hurt (by difficulty already): how much, by what, pushed how. */
  | { t: "hurt"; amount: number; source: DamageSource; by: string; push: { x: number; y: number; z: number } }
  /** Something blew up there. */
  | { t: "explosion"; x: number; y: number; z: number; power: number }
  /** A sound there (Minecraft's event name), of a kind (its volume setting). */
  | { t: "sound"; event: string; x: number; y: number; z: number; category: string }
  /** Someone broke, placed or used a block there (what it was or is), or made it grow (bone meal): its pieces and sound. */
  | { t: "effect"; kind: "break" | "place" | "use" | "grow"; x: number; y: number; z: number; state: number }
  /** It started or stopped raining or storming. */
  | { t: "weather"; rain: boolean; thunder: boolean }
  /** Lightning struck there. */
  | { t: "lightning"; x: number; y: number; z: number }
  /** A chest's or furnace's contents, when opened and whenever they change; null when it is gone. */
  | { t: "container"; x: number; y: number; z: number; entity: SavedEntity | null }
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

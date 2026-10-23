/** What the player can set in Options, kept in this browser. */
export interface Settings {
  /** "webgl" draws textured blocks; "canvas" flat colors with Canvas 2D (and WebGL's fallback). */
  renderer: "webgl" | "canvas";
  /** View distance in blocks, or null for the renderer's own (96 on WebGL, 48 on Canvas 2D). */
  view: number | null;
  /** Vertical field of view in degrees. */
  fov: number;
  /** Mouse sensitivity, 1 being the usual. */
  sensitivity: number;
  /** The name other players see, empty until chosen. */
  name: string;
  /** Volumes, 0 to 1: of everything, and by kind of sound. */
  volume: Record<SoundKind, number>;
  /** How big the hotbar and status bar are. */
  guiScale: number;
  /** The view bobs with each step; the view widens when sprinting and tilts when hurt. */
  bobbing: boolean;
  fovEffects: boolean;
  /** Light blended smoothly across faces with shading in corners (as Minecraft's), or a light per face. */
  smoothLighting: boolean;
  particles: "all" | "decreased" | "minimal";
  /** The key for each action (KeyboardEvent.code). */
  keys: Record<KeyAction, string>;
}

/** Kinds of sound with a volume of their own, "master" for all of them. */
export const SOUND_KINDS = ["master", "music", "blocks", "hostile", "friendly", "players", "ambient"] as const;
export type SoundKind = (typeof SOUND_KINDS)[number];

/** Actions with a key of their own. */
export const KEY_ACTIONS = ["forward", "back", "left", "right", "jump", "sprint", "sneak", "inventory", "drop", "chat", "command", "perspective", "debug"] as const;
export type KeyAction = (typeof KEY_ACTIONS)[number];
export const DEFAULT_KEYS: Readonly<Record<KeyAction, string>> = {
  forward: "KeyW",
  back: "KeyS",
  left: "KeyA",
  right: "KeyD",
  jump: "Space",
  sprint: "ShiftLeft",
  sneak: "KeyC",
  inventory: "KeyE",
  drop: "KeyQ",
  chat: "KeyT",
  command: "Slash",
  perspective: "F5",
  debug: "F3",
};

export const VIEW_RANGE: readonly [number, number] = [16, 160];
export const FOV_RANGE: readonly [number, number] = [50, 110];
export const SENSITIVITY_RANGE: readonly [number, number] = [0.25, 3];
export const GUI_SCALE_RANGE: readonly [number, number] = [0.75, 1.5];
export const DEFAULT_SETTINGS: Readonly<Settings> = {
  renderer: "webgl",
  view: null,
  fov: 70,
  sensitivity: 1,
  name: "",
  volume: { master: 1, music: 0.5, blocks: 1, hostile: 1, friendly: 1, players: 1, ambient: 1 },
  guiScale: 1,
  bobbing: true,
  fovEffects: true,
  smoothLighting: true,
  particles: "all",
  keys: { ...DEFAULT_KEYS },
};
/** Names are this long at most. */
export const NAME_LENGTH = 24;

const KEY = "craft.settings";

function clamp(v: unknown, [lo, hi]: readonly [number, number], fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

/** The view distance in blocks for a renderer: the setting, or the renderer's own. */
export function viewDistance(settings: Settings, textured: boolean): number {
  return settings.view ?? (textured ? 96 : 48);
}

/** The saved settings, with defaults for anything missing or out of range (and when storage is blocked). */
export function loadSettings(storage: Pick<Storage, "getItem"> | null = globalThis.localStorage ?? null): Settings {
  let saved: Partial<Settings> = {};
  try {
    saved = JSON.parse(storage?.getItem(KEY) ?? "{}") ?? {};
  } catch {
    // Unreadable: the defaults
  }
  const volume = (saved.volume ?? {}) as Partial<Record<SoundKind, unknown>>;
  const keys = (saved.keys ?? {}) as Partial<Record<KeyAction, unknown>>;
  const flag = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
  return {
    renderer: saved.renderer === "canvas" ? "canvas" : "webgl",
    view: saved.view === null || saved.view === undefined ? null : clamp(saved.view, VIEW_RANGE, 96),
    fov: clamp(saved.fov, FOV_RANGE, DEFAULT_SETTINGS.fov),
    sensitivity: clamp(saved.sensitivity, SENSITIVITY_RANGE, DEFAULT_SETTINGS.sensitivity),
    name: typeof saved.name === "string" ? saved.name.trim().slice(0, NAME_LENGTH) : "",
    volume: Object.fromEntries(SOUND_KINDS.map((k) => [k, clamp(volume[k], [0, 1], DEFAULT_SETTINGS.volume[k])])) as Record<SoundKind, number>,
    guiScale: clamp(saved.guiScale, GUI_SCALE_RANGE, 1),
    bobbing: flag(saved.bobbing, true),
    fovEffects: flag(saved.fovEffects, true),
    smoothLighting: flag(saved.smoothLighting, true),
    particles: saved.particles === "decreased" || saved.particles === "minimal" ? saved.particles : "all",
    keys: Object.fromEntries(KEY_ACTIONS.map((a) => [a, typeof keys[a] === "string" && /^[A-Za-z0-9]{1,24}$/.test(keys[a] as string) ? keys[a] : DEFAULT_KEYS[a]])) as Record<KeyAction, string>,
  };
}

/**
 * Who this browser is when it joins other players' worlds: an id made once and kept, so a host knows a
 * returning guest (and where they left off).
 */
export function playerId(storage: Pick<Storage, "getItem" | "setItem"> | null = globalThis.localStorage ?? null): string {
  const key = "craft.player";
  try {
    const kept = storage?.getItem(key);
    if (kept && /^[a-z0-9-]{4,40}$/.test(kept)) return kept;
  } catch {
    // Storage blocked: a new id each time
  }
  const id = `p-${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  try {
    storage?.setItem(key, id);
  } catch {
    // As above
  }
  return id;
}

export function saveSettings(settings: Settings, storage: Pick<Storage, "setItem"> | null = globalThis.localStorage ?? null): void {
  try {
    storage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked: the settings last until the page closes
  }
}

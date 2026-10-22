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
}

export const VIEW_RANGE: readonly [number, number] = [16, 160];
export const FOV_RANGE: readonly [number, number] = [50, 110];
export const SENSITIVITY_RANGE: readonly [number, number] = [0.25, 3];
export const DEFAULT_SETTINGS: Readonly<Settings> = { renderer: "webgl", view: null, fov: 70, sensitivity: 1, name: "" };
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
  return {
    renderer: saved.renderer === "canvas" ? "canvas" : "webgl",
    view: saved.view === null || saved.view === undefined ? null : clamp(saved.view, VIEW_RANGE, 96),
    fov: clamp(saved.fov, FOV_RANGE, DEFAULT_SETTINGS.fov),
    sensitivity: clamp(saved.sensitivity, SENSITIVITY_RANGE, DEFAULT_SETTINGS.sensitivity),
    name: typeof saved.name === "string" ? saved.name.trim().slice(0, NAME_LENGTH) : "",
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

import {
  DEFAULT_KEYS,
  FOV_RANGE,
  GUI_SCALE_RANGE,
  KEY_ACTIONS,
  NAME_LENGTH,
  SENSITIVITY_RANGE,
  SOUND_KINDS,
  VIEW_RANGE,
  saveSettings,
  viewDistance,
  type KeyAction,
  type Settings,
  type SoundKind,
} from "../settings.js";
import { h } from "./dom.js";

/** A labelled slider whose label shows its value. */
function slider(label: (v: number) => string, value: number, [min, max]: readonly [number, number], step: number, set: (v: number) => void): HTMLElement {
  const text = h("span", {}, label(value));
  const input = h("input", {
    type: "range",
    min,
    max,
    step,
    value: String(value),
    oninput: () => {
      const v = Number(input.value);
      text.textContent = label(v);
      set(v);
    },
  });
  return h("label", { class: "slider" }, text, input);
}

/** A button that turns a setting on and off, saying which. */
function toggle(label: string, value: boolean, set: (v: boolean) => void): HTMLElement {
  let on = value;
  const button = h("button", { type: "button" }, `${label}: ${on ? "on" : "off"}`);
  button.onclick = () => {
    on = !on;
    button.textContent = `${label}: ${on ? "on" : "off"}`;
    set(on);
  };
  return button;
}

const SOUND_LABELS: Readonly<Record<SoundKind, string>> = { master: "Master volume", music: "Music", weather: "Weather", blocks: "Blocks", hostile: "Monsters", friendly: "Animals", players: "Players", ambient: "Ambient" };
const KEY_LABELS: Readonly<Record<KeyAction, string>> = {
  forward: "Forward",
  back: "Back",
  left: "Left",
  right: "Right",
  jump: "Jump",
  sprint: "Sprint",
  sneak: "Sneak",
  inventory: "Inventory",
  drop: "Drop item",
  chat: "Chat",
  command: "Command",
  perspective: "Third person",
  debug: "Debug screen",
};

/** A key's name for a button: "KeyW" is W. */
const keyLabel = (code: string): string => code.replace(/^Key|^Digit/, "").replace("Slash", "/");

/**
 * The Options screen. Every change is saved and passed to `onChange` at once (a running game applies it);
 * `textured` is whether the current page draws with WebGL, for the default view distance. Sections: the
 * view, sound, controls (with the keys, changed by clicking one and pressing the new key).
 */
export function optionsScreen(settings: Settings, textured: boolean, onChange: (s: Settings) => void, onDone: () => void): HTMLElement {
  const change = (patch: Partial<Settings>): void => {
    Object.assign(settings, patch);
    saveSettings(settings);
    onChange(settings);
  };
  const renderer = h(
    "select",
    { onchange: () => change({ renderer: renderer.value === "canvas" ? "canvas" : "webgl" }) },
    h("option", { value: "webgl" }, "Textured (WebGL)"),
    h("option", { value: "canvas" }, "Flat colors (Canvas 2D)"),
  );
  renderer.value = settings.renderer;
  const particles = h(
    "select",
    { onchange: () => change({ particles: particles.value === "minimal" ? "minimal" : particles.value === "decreased" ? "decreased" : "all" }) },
    h("option", { value: "all" }, "All"),
    h("option", { value: "decreased" }, "Decreased"),
    h("option", { value: "minimal" }, "Minimal"),
  );
  particles.value = settings.particles;
  const name = h("input", { type: "text", maxlength: NAME_LENGTH, placeholder: "Your name", value: settings.name, onchange: () => change({ name: name.value.trim().slice(0, NAME_LENGTH) }) });

  // Keys: click, then press the key to use (Escape keeps the old one)
  let waiting: { action: KeyAction; button: HTMLButtonElement } | null = null;
  const keyButtons = KEY_ACTIONS.map((action) => {
    const button = h("button", { type: "button" }, keyLabel(settings.keys[action]));
    button.onclick = () => {
      if (waiting) waiting.button.classList.remove("waiting");
      waiting = { action, button };
      button.classList.add("waiting");
      button.textContent = "Press a key";
    };
    return [h("span", {}, KEY_LABELS[action]), button];
  });
  const listen = (e: KeyboardEvent): void => {
    if (!waiting) return;
    e.preventDefault();
    e.stopPropagation();
    const { action, button } = waiting;
    waiting = null;
    button.classList.remove("waiting");
    if (e.code !== "Escape") change({ keys: { ...settings.keys, [action]: e.code } });
    button.textContent = keyLabel(settings.keys[action]);
  };
  window.addEventListener("keydown", listen, true);
  const done = (): void => {
    window.removeEventListener("keydown", listen, true);
    onDone();
  };
  const resetKeys = h("button", { type: "button", onclick: () => {
    change({ keys: { ...DEFAULT_KEYS } });
    keyButtons.forEach(([, b], i) => (b.textContent = keyLabel(settings.keys[KEY_ACTIONS[i]])));
  } }, "Reset keys");

  return h(
    "div",
    { class: "screen options" },
    h("h2", {}, "Options"),
    h(
      "div",
      { class: "scroll" },
      h("p", { class: "section" }, "View"),
      slider((v) => `Render distance: ${v} blocks`, viewDistance(settings, textured), VIEW_RANGE, 16, (v) => change({ view: v })),
      slider((v) => `Field of view: ${v}°`, settings.fov, FOV_RANGE, 1, (v) => change({ fov: v })),
      slider((v) => `Hotbar size: ${Math.round(v * 100)}%`, settings.guiScale, GUI_SCALE_RANGE, 0.05, (v) => change({ guiScale: v })),
      h(
        "div",
        { class: "toggles" },
        toggle("Smooth lighting", settings.smoothLighting, (v) => change({ smoothLighting: v })),
        toggle("View bobbing", settings.bobbing, (v) => change({ bobbing: v })),
        toggle("FOV effects", settings.fovEffects, (v) => change({ fovEffects: v })),
      ),
      h("label", { class: "field" }, h("span", {}, "Particles"), particles),
      h("label", { class: "field" }, h("span", {}, "Renderer"), renderer),
      h("p", { class: "muted" }, "A different renderer takes effect when a world is opened."),
      h("p", { class: "section" }, "Sound"),
      ...SOUND_KINDS.map((k) => slider((v) => `${SOUND_LABELS[k]}: ${Math.round(v * 100)}%`, settings.volume[k], [0, 1], 0.05, (v) => change({ volume: { ...settings.volume, [k]: v } }))),
      h("p", { class: "section" }, "Controls"),
      slider((v) => `Mouse sensitivity: ${Math.round(v * 100)}%`, settings.sensitivity, SENSITIVITY_RANGE, 0.05, (v) => change({ sensitivity: v })),
      h("div", { class: "keys-grid" }, ...keyButtons.flat()),
      h("div", { class: "buttons small" }, resetKeys),
      h("p", { class: "section" }, "Multiplayer"),
      h("label", { class: "field" }, h("span", {}, "Name (other players see it)"), name),
    ),
    h("div", { class: "buttons" }, h("button", { onclick: done, autofocus: true }, "Done")),
  );
}

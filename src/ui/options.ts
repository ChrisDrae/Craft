import { FOV_RANGE, SENSITIVITY_RANGE, VIEW_RANGE, saveSettings, viewDistance, type Settings } from "../settings.js";
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

/**
 * The Options screen. Every change is saved and passed to `onChange` at once (a running game applies it);
 * `textured` is whether the current page draws with WebGL, for the default view distance.
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
  return h(
    "div",
    { class: "screen options" },
    h("h2", {}, "Options"),
    slider((v) => `Render distance: ${v} blocks`, viewDistance(settings, textured), VIEW_RANGE, 16, (v) => change({ view: v })),
    slider((v) => `Field of view: ${v}°`, settings.fov, FOV_RANGE, 1, (v) => change({ fov: v })),
    slider((v) => `Mouse sensitivity: ${Math.round(v * 100)}%`, settings.sensitivity, SENSITIVITY_RANGE, 0.05, (v) => change({ sensitivity: v })),
    h("label", { class: "field" }, h("span", {}, "Renderer"), renderer),
    h("p", { class: "muted" }, "A different renderer takes effect when a world is opened."),
    h("div", { class: "buttons" }, h("button", { onclick: onDone, autofocus: true }, "Done")),
  );
}

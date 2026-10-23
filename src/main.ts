import { startGame } from "./game.js";
import { codeFrom, join } from "./net/rtc.js";
import { WorldStore } from "./save/store.js";
import { NAME_LENGTH, loadSettings, playerId, saveSettings } from "./settings.js";
import { h } from "./ui/dom.js";
import { TitleScreen } from "./ui/title.js";
import { DIFFICULTIES } from "./vitals.js";
import "./style.css";

function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`Missing #${id}`);
  return el;
}

const canvas = element("canvas", HTMLCanvasElement);
const menu = element("menu", HTMLElement);
const settings = loadSettings();
// ?world=<id> plays a saved world, ?seed=... a fresh one that isn't saved (in survival, or with
// &mode=creative; &difficulty= one of peaceful, easy, normal, hard), ?join=<code> a friend's world, nothing
// the title screen.
// ?renderer=canvas|webgl and ?view=16..160 override the options for one page.
const params = new URLSearchParams(location.search);
const renderer = params.get("renderer");
const pageRenderer = renderer === "canvas" || renderer === "webgl" ? renderer : settings.renderer;

async function openStore(): Promise<WorldStore | null> {
  try {
    return await WorldStore.open();
  } catch (e) {
    console.warn("Craft: no IndexedDB, worlds can't be kept.", e);
    return null;
  }
}

/** Holds a lock on the world while the page is open, so two tabs can't write it. False if another tab has it. */
function lockWorld(id: string): Promise<boolean> {
  const locks = globalThis.navigator?.locks;
  if (!locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    void locks.request(`craft-world-${id}`, { ifAvailable: true }, (lock) => {
      resolve(lock !== null);
      // Never released: the lock goes with the page
      return lock ? new Promise<void>(() => {}) : undefined;
    });
  });
}

function message(text: string): void {
  menu.replaceChildren(
    h(
      "div",
      { class: "screen" },
      h("h2", {}, text),
      h("div", { class: "buttons" }, h("button", { autofocus: true, onclick: () => (location.href = location.pathname) }, "Back to title")),
    ),
  );
}

async function playSaved(id: string): Promise<void> {
  menu.replaceChildren(h("div", { class: "screen" }, h("h2", {}, "Loading world…")));
  const store = await openStore();
  if (!store) return message("This browser doesn't let Craft keep worlds here, so saved worlds can't be opened.");
  let meta;
  try {
    meta = await store.getWorld(id);
  } catch (e) {
    return message(`This world can't be opened. ${(e as Error).message}`);
  }
  if (!meta) return message("This world doesn't exist anymore.");
  if (!(await lockWorld(id))) return message(`“${meta.name}” is open in another tab.`);
  const [player, chunks] = await Promise.all([store.getPlayer(id), store.chunkKeys(id)]);
  await startGame({ canvas, menu, settings, renderer: pageRenderer, world: { store, meta, player, chunks } });
}

/** The name others will see, asked for the first time this browser joins a world. */
function askName(): Promise<string> {
  return new Promise((resolve) => {
    const name = h("input", { maxlength: NAME_LENGTH, placeholder: "Your name", autofocus: true });
    menu.replaceChildren(
      h(
        "div",
        { class: "screen" },
        h("h2", {}, "Joining a friend's world"),
        h(
          "form",
          {
            onsubmit: (e: Event) => {
              e.preventDefault();
              const chosen = name.value.trim().slice(0, NAME_LENGTH);
              if (chosen) resolve(chosen);
            },
          },
          h("label", { class: "field" }, h("span", {}, "Your name (the others see it)"), name),
          h("div", { class: "buttons" }, h("button", { class: "primary", type: "submit" }, "Join"), h("button", { type: "button", onclick: () => (location.href = location.pathname) }, "Cancel")),
        ),
      ),
    );
    name.focus();
  });
}

async function playJoined(text: string): Promise<void> {
  const code = codeFrom(text);
  if (!code) return message("That isn't a world code.");
  if (!settings.name) {
    settings.name = await askName();
    saveSettings(settings);
  }
  menu.replaceChildren(h("div", { class: "screen" }, h("h2", {}, `Joining ${code}…`)));
  try {
    const connection = await join(code, playerId());
    await startGame({ canvas, menu, settings, renderer: pageRenderer, world: { guest: connection } });
  } catch (e) {
    message((e as Error).message);
  }
}

const worldId = params.get("world");
const seed = params.get("seed");
const joinCode = params.get("join");
if (joinCode !== null) {
  await playJoined(joinCode);
} else if (worldId) {
  await playSaved(worldId);
} else if (seed !== null) {
  const difficulty = DIFFICULTIES.find((d) => d === params.get("difficulty")) ?? "normal";
  await startGame({ canvas, menu, settings, renderer: pageRenderer, world: { seed: seed || "craft", mode: params.get("mode") === "creative" ? "creative" : "survival", difficulty } });
} else {
  await new TitleScreen(menu, await openStore(), settings).show();
}

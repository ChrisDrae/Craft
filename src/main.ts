import { startGame } from "./game.js";
import { WorldStore } from "./save/store.js";
import { loadSettings } from "./settings.js";
import { h } from "./ui/dom.js";
import { TitleScreen } from "./ui/title.js";
import "./style.css";

function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`Missing #${id}`);
  return el;
}

const canvas = element("canvas", HTMLCanvasElement);
const menu = element("menu", HTMLElement);
const settings = loadSettings();
// ?world=<id> plays a saved world, ?seed=... a fresh one that isn't saved, nothing the title screen.
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

const worldId = params.get("world");
const seed = params.get("seed");
if (worldId) {
  await playSaved(worldId);
} else if (seed !== null) {
  await startGame({ canvas, menu, settings, renderer: pageRenderer, world: { seed: seed || "craft" } });
} else {
  await new TitleScreen(menu, await openStore(), settings).show();
}

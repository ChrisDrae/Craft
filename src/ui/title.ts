import { GENERATOR_VERSION } from "../generator.js";
import { codeFrom } from "../net/rtc.js";
import { FORMAT_VERSION, type GameMode, type WorldMeta } from "../save/format.js";
import type { WorldStore } from "../save/store.js";
import { readWorldFile, writeWorldFile } from "../save/worldFile.js";
import type { Settings } from "../settings.js";
import { formatBytes, formatWhen, h } from "./dom.js";
import { optionsScreen } from "./options.js";

/** The page that plays a saved world. */
export function worldUrl(id: string): string {
  return `?world=${encodeURIComponent(id)}`;
}

/** A new world's metadata; a blank seed gets a random one. */
export function newWorld(name: string, seed: string, mode: GameMode = "survival"): WorldMeta {
  const now = Date.now();
  return {
    format: FORMAT_VERSION,
    id: crypto.randomUUID(),
    name: name.trim() || "New World",
    seed: seed.trim() || String(Math.floor(Math.random() * 2 ** 31)),
    generator: GENERATOR_VERSION,
    created: now,
    lastPlayed: now,
    time: 0,
    spawn: null,
    chunks: 0,
    bytes: 0,
    mode,
  };
}

function download(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** File names from world names: letters, digits, spaces, dashes and dots kept. */
function fileName(name: string): string {
  return `${name.replace(/[^\p{L}\p{N} ._-]/gu, "").trim() || "world"}.craftworld`;
}

/**
 * The title screen: the worlds kept in this browser, to play, create, rename, copy, delete, export and
 * import, and the options. Without a store (storage blocked) only quick play is offered.
 */
export class TitleScreen {
  private readonly root: HTMLElement;
  private readonly store: WorldStore | null;
  private readonly settings: Settings;
  private worlds: WorldMeta[] = [];
  private selected: string | null = null;
  private message: string = "";

  constructor(root: HTMLElement, store: WorldStore | null, settings: Settings) {
    this.root = root;
    this.store = store;
    this.settings = settings;
  }

  async show(message: string = ""): Promise<void> {
    this.message = message;
    if (this.store) {
      try {
        this.worlds = await this.store.listWorlds();
      } catch (e) {
        this.worlds = [];
        this.message = `The world list couldn't be read: ${(e as Error).message}`;
      }
    }
    if (!this.worlds.some((w) => w.id === this.selected)) this.selected = this.worlds[0]?.id ?? null;
    await this.render();
  }

  private screen(...children: (Node | string | null | false)[]): void {
    this.root.replaceChildren(h("div", { class: "screen" }, ...children));
    this.root.querySelector<HTMLElement>("[autofocus]")?.focus();
  }

  private async render(): Promise<void> {
    const store = this.store;
    const quick = h("button", { onclick: () => (location.href = `?seed=${Math.floor(Math.random() * 2 ** 31)}`) }, "Quick play");
    const joinButton = h("button", { onclick: () => this.join() }, "Join a friend…");
    if (!store) {
      this.screen(
        h("h1", {}, "Craft"),
        h("p", { class: "error" }, "This browser doesn't let Craft keep worlds here (IndexedDB is blocked), so nothing can be saved."),
        h("div", { class: "buttons" }, quick, joinButton),
      );
      return;
    }
    const selected = this.worlds.find((w) => w.id === this.selected) ?? null;
    const list = h(
      "ul",
      { class: "worlds", role: "listbox", "aria-label": "Worlds" },
      ...this.worlds.map((w) =>
        h(
          "li",
          {
            role: "option",
            tabindex: 0,
            class: w.id === this.selected ? "selected" : "",
            "aria-selected": String(w.id === this.selected),
            onclick: () => {
              this.selected = w.id;
              void this.render();
            },
            ondblclick: () => (location.href = worldUrl(w.id)),
            onkeydown: (e: KeyboardEvent) => {
              if (e.key === "Enter") location.href = worldUrl(w.id);
            },
          },
          h("b", {}, w.name),
          h("span", { class: "muted" }, `${w.mode === "creative" ? "Creative" : "Survival"} · Seed ${w.seed} · ${formatWhen(w.lastPlayed)} · ${formatBytes(w.bytes)}`),
        ),
      ),
    );
    const none = !selected;
    let usage = "";
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (estimate?.usage !== undefined) usage = ` ${formatBytes(estimate.usage)} in use.`;
    } catch {
      // No estimate
    }
    const importer = h("input", { type: "file", accept: ".craftworld", hidden: true, onchange: () => void this.importFile(importer) });
    this.screen(
      h("h1", {}, "Craft"),
      this.worlds.length > 0 ? list : h("p", { class: "muted" }, "No worlds yet. Create one to start."),
      h(
        "div",
        { class: "buttons" },
        h("button", { class: "primary", disabled: none, onclick: () => selected && (location.href = worldUrl(selected.id)) }, "Play"),
        h("button", { onclick: () => this.create() }, "Create new world"),
        joinButton,
      ),
      h(
        "div",
        { class: "buttons small" },
        h("button", { disabled: none, onclick: () => selected && this.rename(selected) }, "Rename"),
        h("button", { disabled: none, onclick: () => selected && void this.duplicate(selected) }, "Copy"),
        h("button", { disabled: none, onclick: () => selected && this.confirmDelete(selected) }, "Delete"),
        h("button", { disabled: none, onclick: () => selected && void this.exportWorld(selected) }, "Export"),
        h("button", { onclick: () => importer.click() }, "Import…"),
        h("button", { onclick: () => this.options() }, "Options"),
        importer,
      ),
      this.message && h("p", { class: "error", role: "alert" }, this.message),
      h("p", { class: "muted" }, `Worlds are kept in this browser.${usage} Export one to keep a copy elsewhere.`),
      h("p", { class: "muted" }, quick, " a fresh world that isn't saved"),
    );
  }

  /** Asks for the code (or the invite link) of a friend's world open to friends, and joins it. */
  private join(): void {
    const code = h("input", { placeholder: "ABC234, or the link your friend sent", maxLength: 200, autofocus: true });
    const error = h("p", { class: "error", hidden: true });
    const go = (): void => {
      const c = codeFrom(code.value);
      if (!c) {
        error.textContent = "That isn't a world code: six letters and digits.";
        error.hidden = false;
        return;
      }
      location.href = `?join=${c}`;
    };
    this.screen(
      h("h2", {}, "Join a friend"),
      h("p", { class: "muted" }, "Your friend opens their world to friends from its game menu, and sends you the code or the link."),
      h(
        "form",
        { onsubmit: (e: Event) => (e.preventDefault(), go()) },
        h("label", { class: "field" }, h("span", {}, "World code"), code),
        error,
        h("div", { class: "buttons" }, h("button", { class: "primary", type: "submit" }, "Join"), h("button", { type: "button", onclick: () => void this.show() }, "Cancel")),
      ),
    );
  }

  private create(): void {
    const name = h("input", { value: "New World", maxLength: 64, autofocus: true });
    const seed = h("input", { placeholder: "Leave empty for a random one", maxLength: 64 });
    const mode = h(
      "select",
      {},
      h("option", { value: "survival" }, "Survival: gather, craft and build"),
      h("option", { value: "creative" }, "Creative: every block at hand"),
    );
    const go = async (): Promise<void> => {
      const meta = newWorld(name.value, seed.value, mode.value === "creative" ? "creative" : "survival");
      await this.store!.putWorld(meta);
      location.href = worldUrl(meta.id);
    };
    this.screen(
      h("h2", {}, "Create a new world"),
      h(
        "form",
        { onsubmit: (e: Event) => (e.preventDefault(), void go()) },
        h("label", { class: "field" }, h("span", {}, "World name"), name),
        h("label", { class: "field" }, h("span", {}, "Seed"), seed),
        h("label", { class: "field" }, h("span", {}, "Game mode"), mode),
        h("div", { class: "buttons" }, h("button", { class: "primary", type: "submit" }, "Create"), h("button", { type: "button", onclick: () => void this.show() }, "Cancel")),
      ),
    );
    name.select();
  }

  private rename(world: WorldMeta): void {
    const name = h("input", { value: world.name, maxLength: 64, autofocus: true });
    const go = async (): Promise<void> => {
      await this.store!.putWorld({ ...world, name: name.value.trim() || world.name });
      await this.show();
    };
    this.screen(
      h("h2", {}, "Rename world"),
      h(
        "form",
        { onsubmit: (e: Event) => (e.preventDefault(), void go()) },
        h("label", { class: "field" }, h("span", {}, "World name"), name),
        h("div", { class: "buttons" }, h("button", { class: "primary", type: "submit" }, "Rename"), h("button", { type: "button", onclick: () => void this.show() }, "Cancel")),
      ),
    );
    name.select();
  }

  private async duplicate(world: WorldMeta): Promise<void> {
    const copy = await this.store!.duplicateWorld(world.id, { id: crypto.randomUUID(), name: `${world.name} (copy)`, created: Date.now() });
    if (copy) this.selected = copy.id;
    await this.show();
  }

  private confirmDelete(world: WorldMeta): void {
    this.screen(
      h("h2", {}, `Delete “${world.name}”?`),
      h("p", {}, "It will be gone for good, unless you exported it."),
      h(
        "div",
        { class: "buttons" },
        h("button", { class: "danger", onclick: async () => (await this.store!.deleteWorld(world.id), await this.show()) }, "Delete"),
        h("button", { autofocus: true, onclick: () => void this.show() }, "Cancel"),
      ),
    );
  }

  private async exportWorld(world: WorldMeta): Promise<void> {
    const data = await this.store!.readWorld(world.id);
    if (data) download(writeWorldFile(data), fileName(world.name));
  }

  private async importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const data = readWorldFile(new Uint8Array(await file.arrayBuffer()));
      // A world of its own, even when the same file comes in twice
      const meta = { ...data.meta, id: crypto.randomUUID(), lastPlayed: Date.now() };
      await this.store!.writeWorld({ ...data, meta });
      this.selected = meta.id;
      await this.show();
    } catch (e) {
      await this.show(`${file.name} couldn't be imported. ${(e as Error).message}`);
    }
  }

  private options(): void {
    this.root.replaceChildren(optionsScreen(this.settings, this.settings.renderer === "webgl", () => {}, () => void this.show()));
  }
}

import { MAX_AIR, levelOf } from "../vitals.js";
import { h } from "./dom.js";

/**
 * The status bar over the hotbar, as Minecraft's: hearts on the left with armor above them, food on the
 * right (filling from the right) with air bubbles above it while under water, and the experience bar with
 * the level between them and the hotbar. Hearts flash when hit and shake when nearly gone. Its sprites
 * are Minecraft's when imported (gui/sprites/hud), Craft's own pixel drawings otherwise.
 */

/** The sprites by name, as Minecraft names them under gui/sprites/hud ("/" made "_"). */
const SPRITES = [
  "heart_container",
  "heart_container_blinking",
  "heart_container_hardcore",
  "heart_full",
  "heart_half",
  "heart_hardcore_full",
  "heart_hardcore_half",
  "food_empty",
  "food_full",
  "food_half",
  "armor_empty",
  "armor_full",
  "armor_half",
  "air",
  "air_bursting",
  "experience_bar_background",
  "experience_bar_progress",
] as const;
type Sprite = (typeof SPRITES)[number];

/** Craft's own sprites, 9 x 9: a letter per pixel, its color from the palette ('.' clear). */
const HEART = [".oo...oo.", "oiio.oiio", "oiiioiiio", "oiiiiiiio", ".oiiiiio.", "..oiiio..", "...oio...", "....o....", "........."];
const SHANK = ["..ooo....", ".oiiio...", "oiiiiio..", "oiiiiio..", "oiiiio...", ".oiiob...", "..oo.bb..", "......bbw", ".......ww"];
const PLATE = ["oo.....oo", "oioo.ooio", "oiiioiiio", ".oiiiiio.", ".oiiiiio.", ".oiiiiio.", ".oiiiiio.", ".ooooooo.", "........."];
const BUBBLE = ["..ooooo..", ".oiiiiio.", "oihiiiiio", "oihiiiiio", "oiiiiiiio", "oiiiiiiio", "oiiiiiiio", ".oiiiiio.", "..ooooo.."];

type Rgba = [number, number, number, number];
const CLEAR: Rgba = [0, 0, 0, 0];
const SHADOW: Rgba = [0, 0, 0, 110];

/** A 9 x 9 drawing: each letter's color, `half` keeping the inside's color to the left five columns. */
function sprite(rows: readonly string[], colors: Record<string, Rgba>, half: boolean = false, inside: Rgba = SHADOW): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 9;
  const g = canvas.getContext("2d")!;
  const image = g.createImageData(9, 9);
  rows.forEach((row, y) => {
    for (let x = 0; x < 9; x++) {
      const ch = row[x];
      let c = colors[ch] ?? (ch === "." ? CLEAR : SHADOW);
      if (half && x > 4 && ch !== "o" && ch !== ".") c = inside;
      image.data.set(c, (y * 9 + x) * 4);
    }
  });
  g.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

/** An experience bar, 182 x 5: dark, or filled green. */
function bar(filled: boolean): string {
  const canvas = document.createElement("canvas");
  canvas.width = 182;
  canvas.height = 5;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, 182, 5);
  g.fillStyle = filled ? "#80d020" : "#3a3a3a";
  g.fillRect(1, 1, 180, 3);
  if (filled) {
    g.fillStyle = "#c0ff60";
    g.fillRect(1, 1, 180, 1);
  }
  return canvas.toDataURL();
}

function craftSprites(): Record<Sprite, string> {
  const black: Rgba = [0, 0, 0, 255];
  const red: Rgba = [222, 22, 22, 255];
  const shine: Rgba = [255, 190, 190, 255];
  const dark: Rgba = [120, 10, 10, 255];
  const meat: Rgba = [176, 96, 52, 255];
  const crust: Rgba = [96, 46, 20, 255];
  const bone: Rgba = [232, 220, 192, 255];
  const iron: Rgba = [210, 210, 214, 255];
  const blue: Rgba = [40, 96, 200, 255];
  const water: Rgba = [170, 210, 255, 200];
  const heart = (fill: Rgba, half: boolean, hardcore: boolean): string =>
    sprite(hardcore ? HEART.map((r, y) => (y === 2 ? "oiDioiDio" : r)) : HEART, { o: black, i: fill, D: dark, h: shine }, half);
  return {
    heart_container: sprite(HEART, { o: black }),
    heart_container_blinking: sprite(HEART, { o: [255, 255, 255, 255] }),
    heart_container_hardcore: sprite(HEART, { o: [40, 40, 40, 255] }),
    heart_full: sprite(HEART.map((r, y) => (y === 1 ? "oiho.oiio" : r)), { o: black, i: red, h: shine }),
    heart_half: heart(red, true, false),
    heart_hardcore_full: heart(red, false, true),
    heart_hardcore_half: heart(red, true, true),
    food_empty: sprite(SHANK, { o: crust, b: [120, 110, 96, 255], w: [140, 130, 116, 255] }),
    food_full: sprite(SHANK, { o: crust, i: meat, b: bone, w: [255, 255, 255, 255] }),
    food_half: sprite(SHANK, { o: crust, i: meat, b: bone, w: [255, 255, 255, 255] }, true),
    armor_empty: sprite(PLATE, { o: [40, 40, 40, 255] }),
    armor_full: sprite(PLATE, { o: [60, 60, 60, 255], i: iron }),
    armor_half: sprite(PLATE, { o: [60, 60, 60, 255], i: iron }, true),
    air: sprite(BUBBLE, { o: blue, i: water, h: [255, 255, 255, 255] }),
    air_bursting: sprite(BUBBLE.map((r) => r.replace(/i|h/g, ".")), { o: blue }),
    experience_bar_background: bar(false),
    experience_bar_progress: bar(true),
  };
}

/** The sprites: Minecraft's imported ones (hud_<name>), Craft's for the rest. */
export function hudSprites(imported: ReadonlyMap<string, ImageBitmap> | null): Record<Sprite, string> {
  const own = craftSprites();
  for (const name of SPRITES) {
    const image = imported?.get(`hud_${name}`);
    if (!image) continue;
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")!.drawImage(image, 0, 0);
    own[name] = canvas.toDataURL();
  }
  return own;
}

/** What the status bar shows. */
export interface Status {
  /** Whether it shows at all (survival), and hearts' look. */
  shown: boolean;
  hardcore: boolean;
  health: number;
  food: number;
  defense: number;
  air: number;
  underwater: boolean;
  xp: number;
  /** Ticks left of the last hit's flash (20 down to 0). */
  hurt: number;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly hearts: HTMLElement[];
  private readonly food: HTMLElement[];
  private readonly armor: HTMLElement[];
  private readonly air: HTMLElement[];
  private readonly xpFill: HTMLElement;
  private readonly level: HTMLElement;
  private readonly armorRow: HTMLElement;
  private readonly airRow: HTMLElement;
  private shown: string = "";
  private shake: number = 0;

  constructor(root: HTMLElement, private readonly sprites: Record<Sprite, string>) {
    this.root = root;
    const icons = (n: number): HTMLElement[] => Array.from({ length: n }, () => h("span"));
    this.hearts = icons(10);
    this.food = icons(10);
    this.armor = icons(10);
    this.air = icons(10);
    this.armorRow = h("div", { class: "icons" }, ...this.armor);
    this.airRow = h("div", { class: "icons right" }, ...this.air);
    this.xpFill = h("i");
    this.level = h("b");
    const bar = h("div", { class: "xp" }, this.xpFill, this.level);
    bar.style.backgroundImage = `url(${sprites.experience_bar_background})`;
    this.xpFill.style.backgroundImage = `url(${sprites.experience_bar_progress})`;
    root.replaceChildren(
      h("div", { class: "row" }, this.armorRow, this.airRow),
      h("div", { class: "row" }, h("div", { class: "icons" }, ...this.hearts), h("div", { class: "icons right" }, ...this.food)),
      bar,
    );
  }

  /** Shows the status, changing only what changed (and the shaking hearts every tick they shake). */
  update(s: Status): void {
    const health = Math.ceil(s.health);
    const low = s.shown && health <= 4;
    if (low) this.shake++;
    const key = `${s.shown}|${s.hardcore}|${health}|${s.food}|${s.defense}|${s.air}|${s.underwater}|${s.xp}|${s.hurt > 10 ? Math.floor(s.hurt / 3) % 2 : -1}|${low ? this.shake : ""}`;
    if (key === this.shown) return;
    this.shown = key;
    this.root.hidden = !s.shown;
    if (!s.shown) return;
    const sp = this.sprites;
    const set = (el: HTMLElement, ...layers: string[]): void => {
      el.style.backgroundImage = layers.map((n) => `url(${n})`).join(",");
    };
    // Hearts: a container behind every one, flashing white when hit
    const flash = s.hurt > 10 && Math.floor(s.hurt / 3) % 2 === 0;
    const container = flash ? sp.heart_container_blinking : s.hardcore ? sp.heart_container_hardcore : sp.heart_container;
    this.hearts.forEach((el, i) => {
      const fill = i * 2 + 1 < health ? (s.hardcore ? sp.heart_hardcore_full : sp.heart_full) : i * 2 + 1 === health ? (s.hardcore ? sp.heart_hardcore_half : sp.heart_half) : null;
      if (fill) set(el, fill, container);
      else set(el, container);
      el.style.transform = low ? `translateY(${(((i * 7 + this.shake * 13) % 5) - 2) / 2}px)` : "";
    });
    // Food fills from the right
    this.food.forEach((el, i) => {
      const fill = i * 2 + 1 < s.food ? sp.food_full : i * 2 + 1 === s.food ? sp.food_half : null;
      if (fill) set(el, fill, sp.food_empty);
      else set(el, sp.food_empty);
    });
    this.armorRow.style.visibility = s.defense > 0 ? "visible" : "hidden";
    this.armor.forEach((el, i) => set(el, i * 2 + 1 < s.defense ? sp.armor_full : i * 2 + 1 === s.defense ? sp.armor_half : sp.armor_empty));
    // Bubbles while under water (and while the air comes back), from the right; the last one bursting
    const showAir = s.underwater || s.air < MAX_AIR;
    this.airRow.style.visibility = showAir ? "visible" : "hidden";
    const full = Math.ceil(((Math.max(0, s.air) - 2) * 10) / MAX_AIR);
    const bursting = Math.ceil((Math.max(0, s.air) * 10) / MAX_AIR) - full;
    this.air.forEach((el, i) => {
      el.style.visibility = i < full + bursting ? "visible" : "hidden";
      set(el, i < full ? sp.air : sp.air_bursting);
    });
    const { level, progress } = levelOf(s.xp);
    this.xpFill.style.width = `${progress * 100}%`;
    this.level.textContent = level > 0 ? String(level) : "";
  }
}

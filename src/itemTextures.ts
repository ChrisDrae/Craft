import type { Random } from "projector";
import { TILE, type TilePixels } from "./atlas.js";
import { ITEMS, type ItemInfo } from "./items.js";
import { hex, jitter, paint, scale, type Rgb } from "./paint.js";

/**
 * The textures of items that aren't blocks, of the cracks on a block being broken and of the chest: the
 * names they have in the atlas, and Craft's own drawings of them for when Minecraft's weren't imported.
 */

/** Atlas names of item textures: "item_" and Minecraft's name (item/stick.png is "item_stick"). */
export const ITEM_TILES: readonly string[] = ITEMS.filter((i) => i.texture !== null).map((i) => `item_${i.texture}`);
/** The ten stages of cracks, from a few to many (Minecraft's block/destroy_stage_N.png). */
export const DESTROY_TILES: readonly string[] = Array.from({ length: 10 }, (_, i) => `destroy_stage_${i}`);

type Mask = (x: number, y: number) => boolean;
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];

/** A drawing from layers: each a shape and its color; later layers on top. */
function layered(seed: string, layers: ReadonlyArray<readonly [Mask, Rgb, number?]>): TilePixels {
  return paint(seed, (x, y, rnd) => {
    for (let i = layers.length - 1; i >= 0; i--) {
      const [mask, color, spread = 0.15] = layers[i];
      if (mask(x, y)) return scale(color, jitter(rnd, spread));
    }
    return CLEAR;
  });
}

const disc = (cx: number, cy: number, r: number): Mask => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
/** A line from (x0, y0) to (x1, y1), `w` pixels thick. */
function line(x0: number, y0: number, x1: number, y1: number, w: number = 1): Mask {
  return (x, y) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)) < w * 0.75;
  };
}
const rect = (x0: number, y0: number, x1: number, y1: number): Mask => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const any = (...masks: Mask[]): Mask => (x, y) => masks.some((m) => m(x, y));
const edge = (mask: Mask): Mask => (x, y) => mask(x, y) && !(mask(x - 1, y) && mask(x + 1, y) && mask(x, y - 1) && mask(x, y + 1));

const HANDLE = hex("#6b4a26");
/** Every tool has its handle from the lower left corner up. */
const handle = line(3, 13, 9, 7, 1.2);

const TOOL_HEADS: Record<string, Mask> = {
  pickaxe: any(line(4, 4, 8, 2, 1.3), line(8, 2, 12, 4, 1.3), line(12, 4, 13, 8, 1.3), line(4, 4, 3, 7, 1)),
  axe: any(rect(8, 2, 11, 7), line(8, 3, 12, 6, 1.3)),
  shovel: any(disc(11, 5, 3), rect(10, 3, 13, 6)),
  hoe: any(line(7, 4, 12, 4, 1.3), line(12, 4, 12, 7, 1.2)),
  sword: any(line(6, 10, 13, 3, 1.4), line(4, 8, 8, 12, 1)),
};

const ARMOR_SHAPES: Record<string, Mask> = {
  helmet: any(rect(3, 4, 12, 7), rect(3, 8, 5, 11), rect(10, 8, 12, 11)),
  chestplate: any(rect(2, 3, 5, 6), rect(10, 3, 13, 6), rect(4, 5, 11, 13)),
  leggings: any(rect(3, 3, 12, 6), rect(3, 7, 6, 13), rect(9, 7, 12, 13)),
  boots: any(rect(2, 8, 5, 13), rect(10, 8, 13, 13), rect(1, 11, 6, 13), rect(9, 11, 14, 13)),
};

/** Craft's drawing of an item. */
function drawItem(info: ItemInfo): TilePixels {
  const name = info.name;
  const color = hex(info.color);
  const dark = scale(color, 0.6) as Rgb;
  if (info.tool) {
    const head = TOOL_HEADS[info.tool.kind];
    return layered(name, info.tool.kind === "sword" ? [[line(3, 13, 6, 10, 1.2), HANDLE], [head, color], [edge(head), dark, 0.05]] : [[handle, HANDLE], [head, color], [edge(head), dark, 0.05]]);
  }
  if (info.armor) {
    const shape = ARMOR_SHAPES[name.split("_").pop()!];
    return layered(name, [[shape, color], [edge(shape), dark, 0.05]]);
  }
  switch (name) {
    case "stick":
      return layered(name, [[line(4, 13, 12, 3, 1.2), HANDLE]]);
    case "iron_ingot":
    case "gold_ingot":
    case "copper_ingot":
    case "brick": {
      const bar = (x: number, y: number): boolean => y >= 6 && y <= 11 && x >= 2 + (11 - y) && x <= 13 - (y - 6) / 2;
      return layered(name, [[bar, color], [edge(bar), dark, 0.05]]);
    }
    case "diamond":
    case "emerald": {
      const gem = (x: number, y: number): boolean => Math.abs(x - 7.5) + Math.abs(y - 7.5) * 1.2 <= 6;
      return layered(name, [[gem, color], [edge(gem), dark, 0.05], [disc(6, 6, 1.2), [240, 255, 255]]]);
    }
    case "redstone":
    case "glowstone_dust":
      return paint(name, (x, y, rnd) => (disc(8, 9, 5)(x, y) && rnd.next() < 0.55 ? scale(color, jitter(rnd, 0.4)) : CLEAR));
    case "string":
      return layered(name, [[any(line(3, 4, 8, 8, 0.8), line(8, 8, 5, 12, 0.8), line(5, 12, 12, 13, 0.8)), color]]);
    case "paper":
      return layered(name, [[rect(3, 2, 12, 13), color, 0.05], [any(rect(5, 5, 10, 5), rect(5, 8, 10, 8), rect(5, 11, 9, 11)), [190, 190, 180]]]);
    case "book":
      return layered(name, [[rect(3, 2, 12, 13), color], [rect(4, 3, 11, 12), [240, 236, 220], 0.05], [rect(3, 2, 6, 13), color]]);
    case "wheat":
      return layered(name, [[any(line(5, 14, 7, 3, 0.7), line(8, 14, 9, 2, 0.7), line(11, 14, 11, 4, 0.7)), color, 0.3]]);
    case "apple":
      return layered(name, [[disc(8, 9, 5), color], [line(8, 4, 9, 2, 0.6), HANDLE], [disc(10, 3, 1), hex("#3e8a2a")], [disc(6, 7, 1), [255, 140, 140]]]);
    case "bread":
      return layered(name, [[(x, y) => ((x - 7.5) / 6.5) ** 2 + ((y - 9) / 3.5) ** 2 <= 1, color], [any(line(5, 8, 6, 10, 0.5), line(8, 7, 9, 9, 0.5)), [230, 190, 120]]]);
    case "snowball":
      return layered(name, [[disc(8, 8, 5), color, 0.05], [edge(disc(8, 8, 5)), [200, 214, 222], 0.03]]);
    default: {
      // Lumps: coal, ores, flint, clay, leather, lapis
      const lump = any(disc(7, 8, 4.5), disc(10, 7, 3), disc(8, 11, 3));
      return layered(name, [[lump, color, 0.3], [edge(lump), dark, 0.1]]);
    }
  }
}

/** Craft's drawings of every item that isn't a block, by atlas name. */
export function itemTiles(): Map<string, TilePixels> {
  const out = new Map<string, TilePixels>();
  for (const info of ITEMS) if (info.texture !== null) out.set(`item_${info.texture}`, drawItem(info));
  return out;
}

/** Cracks spreading from the middle, more in each stage, as dark see-through lines. */
export function destroyStages(): Map<string, TilePixels> {
  // Ten wandering cracks, the first k + 1 drawn in stage k, each longer the further along
  const paths: Array<Array<[number, number]>> = [];
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let c = 0; c < 10; c++) {
    let x = 6 + rnd() * 4;
    let y = 6 + rnd() * 4;
    const angle = (c / 10) * Math.PI * 2 + rnd();
    const path: Array<[number, number]> = [];
    for (let s = 0; s < 12; s++) {
      path.push([Math.round(x), Math.round(y)]);
      x += Math.cos(angle) + (rnd() - 0.5) * 0.8;
      y += Math.sin(angle) + (rnd() - 0.5) * 0.8;
    }
    paths.push(path);
  }
  const out = new Map<string, TilePixels>();
  DESTROY_TILES.forEach((name, stage) => {
    const pixels = new Uint8ClampedArray(TILE * TILE * 4);
    for (let c = 0; c <= stage; c++) {
      for (const [x, y] of paths[c].slice(0, 4 + stage)) {
        if (x < 0 || y < 0 || x >= TILE || y >= TILE) continue;
        pixels.set([30, 30, 30, 200], (y * TILE + x) * 4);
      }
    }
    out.set(name, pixels);
  });
  return out;
}

const WOOD = hex("#a8742e");
const RIM = hex("#4a3014");
const LOCK = hex("#c8c8c8");

/** A point clamped into the chest's box on a tile (1-14 across, from 2 or 1 down): its margins repeat its edge. */
const inBox = (x: number, y: number, top: number): [number, number] => [Math.min(14, Math.max(1, x)), Math.min(15, Math.max(top, y))];

/** Craft's chest: wooden sides with a dark rim and a lid line, a lock on the front. */
export function chestTiles(): Map<string, TilePixels> {
  const side = (lock: boolean) => (px: number, py: number, rnd: Random): [number, number, number, number?] => {
    const [x, y] = inBox(px, py, 2);
    if (lock && x >= 7 && x <= 8 && y >= 5 && y <= 8) return scale(LOCK, jitter(rnd, 0.1));
    if (x === 1 || x === 14 || y === 2 || y === 15 || y === 6 || y === 7) return scale(RIM, jitter(rnd, 0.15));
    return scale(WOOD, (y % 3 === 0 ? 0.88 : 1) * jitter(rnd, 0.12));
  };
  return new Map([
    ["chest_front", paint("chest front", side(true))],
    ["chest_side", paint("chest side", side(false))],
    [
      "chest_top",
      paint("chest top", (px, py, rnd) => {
        const [x, y] = inBox(px, Math.min(14, py), 1);
        return x === 1 || x === 14 || y === 1 || y === 14 ? scale(RIM, jitter(rnd, 0.15)) : scale(WOOD, (x % 4 === 0 ? 0.88 : 1) * jitter(rnd, 0.12));
      }),
    ],
  ]);
}

/**
 * The chest's tiles from Minecraft's chest model texture (entity/chest/normal.png, 64 x 64): the lid's
 * top, and for the sides the lid's side over the base's, with the lock on the front. The chest's box is a
 * pixel in from the sides and 14 high, so the tiles are laid out to match.
 */
export function chestFromSheet(sheet: Uint8ClampedArray, width: number): Map<string, TilePixels> {
  const k = width / 64;
  const at = (x: number, y: number): [number, number, number, number] => {
    const o = (Math.floor(y * k) * width + Math.floor(x * k)) * 4;
    return [sheet[o], sheet[o + 1], sheet[o + 2], sheet[o + 3]];
  };
  const tile = (pixel: (x: number, y: number) => [number, number, number, number]): TilePixels => {
    const out = new Uint8ClampedArray(TILE * TILE * 4);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) out.set(pixel(x, y), (y * TILE + x) * 4);
    return out;
  };
  // Lid side: 14 x 5 at (14, 14); base side: 14 x 10 at (14, 33); lock front: 2 x 4 at (1, 1)
  const sideAt = (px: number, py: number, lock: boolean): [number, number, number, number] => {
    const [x, y] = inBox(px, py, 2);
    if (lock && x >= 7 && x <= 8 && y >= 5 && y <= 8) return at(1 + (x - 7), 1 + (y - 5));
    return y <= 6 ? at(14 + (x - 1), 14 + (y - 2)) : at(14 + (x - 1), 33 + 1 + (y - 7));
  };
  return new Map([
    [
      "chest_top",
      tile((px, py) => {
        const [x, y] = inBox(px, Math.min(14, py), 1);
        return at(14 + (x - 1), y - 1);
      }),
    ],
    ["chest_side", tile((x, y) => sideAt(x, y, false))],
    ["chest_front", tile((x, y) => sideAt(x, y, true))],
  ]);
}

/** A furnace's front burning: its opening glowing orange. */
export function furnaceOn(front: TilePixels): TilePixels {
  const out = new Uint8ClampedArray(front);
  for (let y = 9; y <= 13; y++) {
    for (let x = 4; x <= 11; x++) {
      const o = (y * TILE + x) * 4;
      const glow = y >= 11 ? [255, 160, 40] : [230, 90, 20];
      out.set([glow[0], glow[1], glow[2], 255], o);
    }
  }
  return out;
}

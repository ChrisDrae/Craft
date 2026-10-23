import type { Random } from "projector";
import { TILE, type TilePixels } from "./atlas.js";
import { BLOCKS, Block, COLORS } from "./blocks.js";
import { ITEMS, type ItemInfo } from "./items.js";
import { hex, jitter, paint, scale, type Rgb } from "./paint.js";

/**
 * The textures of items that aren't blocks, of the cracks on a block being broken, of orbs of experience,
 * of the chest, beds, melons and mushrooms: the names they have in the atlas, and Craft's own drawings of
 * them for when Minecraft's weren't imported.
 */

/** Atlas names of item textures: "item_" and Minecraft's name (item/stick.png is "item_stick"). */
export const ITEM_TILES: readonly string[] = ITEMS.filter((i) => i.texture !== null).map((i) => `item_${i.texture}`);
/** The ten stages of cracks, from a few to many (Minecraft's block/destroy_stage_N.png). */
export const DESTROY_TILES: readonly string[] = Array.from({ length: 10 }, (_, i) => `destroy_stage_${i}`);
/** The particle textures: Minecraft's particle/<name>.png as particle_<name>, or Craft's drawings. */
export const PARTICLE_TILES: readonly string[] = [
  ...Array.from({ length: 8 }, (_, i) => `particle_generic_${i}`),
  ...Array.from({ length: 4 }, (_, i) => `particle_splash_${i}`),
  "particle_flame",
  "particle_critical_hit",
  "particle_lava",
  "particle_heart",
  "particle_glint",
  ...Array.from({ length: 16 }, (_, i) => `particle_explosion_${i}`),
];
/** Orbs of experience from small to large, gray to be colored as they are drawn. */
export const ORB_TILES: readonly string[] = Array.from({ length: 11 }, (_, i) => `experience_orb_${i}`);

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
    case "tin_ingot":
    case "bronze_ingot":
    case "refined_iron_ingot":
    case "brick": {
      const bar = (x: number, y: number): boolean => y >= 6 && y <= 11 && x >= 2 + (11 - y) && x <= 13 - (y - 6) / 2;
      return layered(name, [[bar, color], [edge(bar), dark, 0.05]]);
    }
    case "diamond":
    case "emerald": {
      const gem = (x: number, y: number): boolean => Math.abs(x - 7.5) + Math.abs(y - 7.5) * 1.2 <= 6;
      return layered(name, [[gem, color], [edge(gem), dark, 0.05], [disc(6, 6, 1.2), [240, 255, 255]]]);
    }
    case "porkchop":
    case "cooked_porkchop":
    case "beef":
    case "cooked_beef":
    case "mutton":
    case "cooked_mutton":
    case "rotten_flesh": {
      // A cut of meat with a rim of fat (a bone in the chops)
      const meat = (x: number, y: number): boolean => ((x - 7.5) / 6) ** 2 + ((y - 8.5) / 4.5) ** 2 <= 1;
      const fat = (x: number, y: number): boolean => meat(x, y) && ((x - 7.5) / 6) ** 2 + ((y - 8.5) / 4.5) ** 2 > 0.6;
      const cooked = name.startsWith("cooked");
      return layered(name, [[meat, color, 0.25], [fat, cooked ? (scale(color, 1.3) as Rgb) : hex("#f0e0d0"), 0.1], [edge(meat), dark, 0.05]]);
    }
    case "chicken":
    case "cooked_chicken": {
      const leg = any(disc(6, 7, 4), disc(8, 9, 3.5));
      return layered(name, [[leg, color, 0.2], [edge(leg), dark, 0.05], [line(10, 11, 13, 14, 1), hex("#f0ecd8")]]);
    }
    case "spider_eye":
      return layered(name, [[disc(8, 8, 5), color, 0.15], [disc(9, 7, 2), [20, 10, 10]], [disc(10, 6, 0.7), [240, 200, 200], 0]]);
    case "bone":
      return layered(name, [[any(line(4, 12, 12, 4, 1.2), disc(3.5, 12.5, 1.6), disc(5, 13.5, 1.4), disc(12.5, 3.5, 1.6), disc(11, 2.5, 1.4)), color, 0.08]]);
    case "feather":
      return layered(name, [[(x, y) => Math.abs(x + y - 16) <= 2.5 && x > 3 && x < 14, color, 0.08], [line(3, 13, 13, 3, 0.6), hex("#a8a8a8")]]);
    case "egg":
      return layered(name, [[(x, y) => ((x - 7.5) / 4.5) ** 2 + ((y - 8.5) / 5.5) ** 2 <= 1, color, 0.08]]);
    case "arrow":
      return layered(name, [[line(4, 12, 12, 4, 0.8), HANDLE], [any(line(12, 4, 9, 4, 0.8), line(12, 4, 12, 7, 0.8)), hex("#9a9a9a")], [any(line(3, 10, 5, 13, 0.8), line(2, 11, 4, 13, 0.8)), hex("#f0f0f0")]]);
    case "bow": {
      const arc = (x: number, y: number): boolean => Math.abs(Math.hypot(x - 2, y - 14) - 11) < 0.9 && x >= 2 && y <= 14;
      return layered(name, [[arc, color, 0.15], [line(3, 3.5, 12.5, 13, 0.4), hex("#e8e8e8")]]);
    }
    case "shears":
      return layered(name, [[any(line(4, 12, 11, 5, 1), line(6, 13, 12, 7, 1)), color, 0.08], [any(disc(4, 12, 1.5), disc(6.5, 13, 1.5)), hex("#5a5a5a")]]);
    case "wheat_seeds":
    case "pumpkin_seeds":
    case "melon_seeds":
      return layered(name, [[any(disc(5, 6, 1.2), disc(9, 5, 1.2), disc(7, 9, 1.2), disc(11, 9, 1.2), disc(6, 12, 1.2)), color, 0.2]]);
    case "carrot":
      return layered(name, [[(x, y) => Math.abs(x - y) < 2.4 - (x + y) / 14 && x > 2 && x < 12, color, 0.15], [any(line(11, 3, 13, 1, 0.8), line(12, 4, 14, 3, 0.8)), hex("#3a8a2a")]]);
    case "potato":
    case "baked_potato":
      return layered(name, [[(x, y) => ((x - 7.5) / 5) ** 2 + ((y - 8) / 4) ** 2 <= 1, color, 0.2], [edge((x, y) => ((x - 7.5) / 5) ** 2 + ((y - 8) / 4) ** 2 <= 1), dark, 0.1]]);
    case "bone_meal":
      return paint(name, (x, y, rnd) => (disc(8, 9, 4.5)(x, y) && rnd.next() < 0.7 ? scale(color, jitter(rnd, 0.1)) : CLEAR));
    case "redstone":
    case "glowstone_dust":
    case "gunpowder":
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
    case "melon_slice": {
      // A wedge of red flesh with seeds, green rind along its curve
      const wedge = (x: number, y: number): boolean => y >= 4 && y <= 13 && Math.hypot(x - 2, y - 14) <= 11 && x >= 2 + (13 - y) * 0.15;
      const rind = (x: number, y: number): boolean => wedge(x, y) && Math.hypot(x - 2, y - 14) > 9.5;
      return layered(name, [[wedge, color], [rind, hex("#4a8a2a")], [any(disc(6, 10, 0.6), disc(9, 9, 0.6), disc(7, 7, 0.6)), [30, 20, 20], 0]]);
    }
    case "bowl":
    case "mushroom_stew": {
      const bowl = (x: number, y: number): boolean => y >= 8 && y <= 13 && Math.abs(x - 7.5) <= 6.5 - Math.max(0, y - 10) * 1.2;
      const layers: Array<readonly [Mask, Rgb, number?]> = [[bowl, hex("#8a6a3a")], [edge(bowl), hex("#5a4426"), 0.05]];
      if (name === "mushroom_stew") layers.push([(x, y) => y === 8 && Math.abs(x - 7.5) <= 5.5, color], [(x, y) => y === 7 && Math.abs(x - 7.5) <= 4, scale(color, 1.15) as Rgb]);
      return layered(name, layers);
    }
    case "iron_dust":
    case "gold_dust":
    case "copper_dust":
    case "tin_dust":
    case "bronze_dust":
    case "coal_dust": {
      // A little heap of powder
      const heap = (x: number, y: number): boolean => y >= 7 && y <= 13 && Math.abs(x - 7.5) <= (y - 6) * 1.1;
      return layered(name, [[heap, color, 0.25], [edge(heap), dark, 0.1]]);
    }
    case "sticky_resin":
      return layered(name, [[any(disc(7, 9, 4), disc(9, 6, 2.5)), color, 0.1], [disc(6, 7, 1.2), [250, 220, 140], 0.05]]);
    case "rubber":
      return layered(name, [[rect(3, 5, 12, 10), color, 0.1], [edge(rect(3, 5, 12, 10)), [10, 10, 10]]]);
    case "electronic_circuit": {
      // A green board with copper traces and a chip
      const board = rect(2, 3, 13, 12);
      return layered(name, [[board, color, 0.08], [any(line(3, 6, 12, 6, 0.6), line(3, 9, 12, 9, 0.6), line(5, 4, 5, 11, 0.6)), [210, 150, 60]], [rect(7, 5, 10, 10), [30, 30, 30]], [edge(board), scale(color, 0.6) as Rgb]]);
    }
    case "battery": {
      // A cell standing up: red jacket, a contact on top
      const body = rect(5, 3, 10, 13);
      return layered(name, [[body, color, 0.08], [rect(6, 1, 9, 2), [200, 200, 200]], [rect(5, 6, 10, 7), [240, 240, 240]], [edge(body), dark]]);
    }
    case "tree_tap":
      return layered(name, [[any(rect(3, 4, 12, 7), rect(10, 7, 12, 12)), color, 0.15], [line(11, 12, 11, 14, 0.5), [224, 160, 48]]]);
    case "wrench":
      return layered(name, [[any(line(4, 12, 10, 6, 1.3), disc(11, 4.5, 2.6)), color, 0.1], [disc(11.5, 4, 1), scale(color, 0.4) as Rgb]]);
    case "eu_meter": {
      const box = rect(3, 2, 12, 13);
      return layered(name, [[box, hex("#3a3a3a")], [rect(4, 3, 11, 7), [220, 230, 160]], [line(5, 7, 9, 4, 0.5), [200, 40, 30]], [any(disc(5.5, 11, 1.2), disc(9.5, 11, 1.2)), color], [edge(box), [20, 20, 20]]]);
    }
    case "slime_ball": {
      const ball = disc(8, 8, 4.5);
      return layered(name, [[ball, color, 0.1], [disc(6.5, 6.5, 1.5), [190, 240, 170], 0.05], [edge(ball), dark, 0.05]]);
    }
    case "hopper": {
      // A funnel: a wide bowl over a narrow spout
      const funnel = (x: number, y: number): boolean => (y >= 2 && y <= 7 && x >= 1 && x <= 14) || (y > 7 && y <= 11 && x >= 4 && x <= 11) || (y > 11 && y <= 14 && x >= 6 && x <= 9);
      return layered(name, [[funnel, color, 0.1], [(x, y) => y >= 3 && y <= 5 && x >= 3 && x <= 12, scale(color, 0.55) as Rgb], [edge(funnel), dark, 0.05]]);
    }
    case "comparator": {
      // Seen from above at a slant: the slab, two torches at the back, one at the front
      const slab = (x: number, y: number): boolean => y >= 7 && y <= 13 && x >= 1 && x <= 14;
      const torches = any(rect(3, 3, 4, 9), rect(11, 3, 12, 9), rect(7, 8, 8, 12));
      return layered(name, [[slab, hex("#a8a8a8")], [edge(slab), hex("#6a6a6a")], [torches, hex("#8a6a3a")], [any(rect(3, 3, 4, 4), rect(11, 3, 12, 4), rect(7, 8, 8, 9)), [200, 40, 30]]]);
    }
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

/** Pistons, observers, hoppers and comparators, as Craft draws them. */
export function pistonTiles(): Map<string, TilePixels> {
  const out = new Map<string, TilePixels>();
  const stone = hex("#7a7a72");
  const wood = hex("#b0905a");
  const iron = hex("#c8c8c8");
  const rim = (x: number, y: number): boolean => x === 0 || y === 0 || x === 15 || y === 15;
  const rock = (rnd: Parameters<Parameters<typeof paint>[1]>[2], k: number = 1): [number, number, number] => scale(stone, k * jitter(rnd, 0.12) * (rnd.next() < 0.1 ? 0.85 : 1));
  // The face: planks round an iron plate (slime over it on a sticky one)
  const face = (sticky: boolean) =>
    paint(sticky ? "piston top sticky" : "piston top", (x, y, rnd) => {
      if (sticky && Math.hypot(x - 7.5, y - 7.5) < 5.5 && rnd.next() < 0.9) return scale(hex("#7ac85a"), jitter(rnd, 0.15));
      if (x >= 5 && x <= 10 && y >= 5 && y <= 10) return scale(iron, (x === 5 || y === 5 || x === 10 || y === 10 ? 0.75 : 1) * jitter(rnd, 0.05));
      return scale(wood, (y % 4 === 3 ? 0.78 : 1) * (rim(x, y) ? 0.8 : 1) * jitter(rnd, 0.1));
    });
  out.set("piston_top", face(false));
  out.set("piston_top_sticky", face(true));
  // The side: the head's wooden band on top, stone below with an iron strip down the middle
  out.set(
    "piston_side",
    paint("piston side", (x, y, rnd) => {
      if (y < 4) return scale(wood, (y === 3 ? 0.7 : 1) * (x % 8 === 0 ? 0.85 : 1) * jitter(rnd, 0.1));
      if (x >= 6 && x <= 9 && y >= 5) return scale(iron, (x === 6 || x === 9 ? 0.8 : 0.95) * jitter(rnd, 0.05));
      return rock(rnd, rim(x, y) ? 0.8 : 1);
    }),
  );
  out.set("piston_bottom", paint("piston bottom", (x, y, rnd) => (Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) < 3 ? scale(iron, 0.8 * jitter(rnd, 0.05)) : rock(rnd, rim(x, y) ? 0.8 : 1))));
  out.set("piston_inner", paint("piston inner", (x, y, rnd) => (Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) < 2.5 ? scale(stone, 0.35) : rock(rnd, rim(x, y) ? 0.8 : 1))));
  // An observer: a face looking out, a red dot at its back, arrows along its sides toward the face
  const dark = hex("#5a5a5e");
  const plate = (rnd: Parameters<Parameters<typeof paint>[1]>[2], x: number, y: number): [number, number, number] => scale(dark, (rim(x, y) ? 0.75 : 1) * jitter(rnd, 0.08));
  out.set(
    "observer_front",
    paint("observer front", (x, y, rnd) => {
      const eye = y >= 5 && y <= 6 && ((x >= 3 && x <= 6) || (x >= 9 && x <= 12));
      const mouth = y >= 10 && y <= 11 && x >= 4 && x <= 11;
      return eye || mouth ? scale(hex("#1a1a1e"), jitter(rnd, 0.1)) : plate(rnd, x, y);
    }),
  );
  const back = (on: boolean) => paint(on ? "observer back on" : "observer back", (x, y, rnd) => (Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) < 1.5 ? scale(on ? [255, 60, 40] : [110, 30, 30], jitter(rnd, 0.1)) : plate(rnd, x, y)));
  out.set("observer_back", back(false));
  out.set("observer_back_on", back(true));
  out.set("observer_side", paint("observer side", (x, y, rnd) => (x >= 6 && x <= 9 && !rim(x, y) ? scale(dark, 0.6 * jitter(rnd, 0.08)) : plate(rnd, x, y))));
  // The top: an arrow up the tile, toward the face
  out.set("observer_top", paint("observer top", (x, y, rnd) => ((Math.abs(x - 7.5) < 1 && y >= 3 && y <= 12) || (y >= 3 && y < 8 && Math.abs(x - 7.5) <= y - 2 && Math.abs(x - 7.5) > y - 4) ? scale(hex("#2a2a2e"), jitter(rnd, 0.1)) : plate(rnd, x, y))));
  // A hopper: dark iron outside, darker in its bowl, the rim lighter on top
  const metal = hex("#4a4a50");
  out.set("hopper_outside", paint("hopper outside", (x, y, rnd) => scale(metal, (rim(x, y) ? 0.75 : x % 5 === 2 && y % 5 === 2 ? 1.3 : 1) * jitter(rnd, 0.08))));
  out.set("hopper_inside", paint("hopper inside", (x, y, rnd) => scale(metal, 0.55 * jitter(rnd, 0.08))));
  out.set("hopper_top", paint("hopper top", (x, y, rnd) => scale(metal, (x < 2 || y < 2 || x > 13 || y > 13 ? 1.35 : 0.5) * jitter(rnd, 0.08))));
  // A comparator: smooth stone, two lines from the back's torches meeting at the front, red while it sends
  const smooth = hex("#a8a8a8");
  const comparator = (on: boolean) =>
    paint(on ? "comparator on" : "comparator", (x, y, rnd) => {
      const lines = (y >= 4 && y <= 12 && (Math.abs(x - (4 + (12 - y) * 0.45)) < 0.8 || Math.abs(x - (11 - (12 - y) * 0.45)) < 0.8)) || (y < 4 && Math.abs(x - 7.5) < 1);
      return lines ? scale(on ? [230, 40, 30] : [110, 30, 30], jitter(rnd, 0.15)) : scale(smooth, (rim(x, y) ? 0.85 : 1) * jitter(rnd, 0.06));
    });
  out.set("comparator", comparator(false));
  out.set("comparator_on", comparator(true));
  return out;
}

/** Block textures only Craft has (the industry's: IndustrialCraft's own aren't Minecraft's, and aren't imported). */
export const INDUSTRY_TILES: readonly string[] = [
  "tin_ore",
  "uranium_ore",
  "rubber_log",
  "rubber_log_top",
  "rubber_log_wet",
  "rubber_log_dry",
  "rubber_leaves",
  "rubber_sapling",
  "machine_top",
  "machine_side",
  "machine_bottom",
  ...["generator", "electric_furnace", "macerator", "extractor", "compressor"].flatMap((m) => [`${m}_front`, `${m}_front_on`]),
  "battery_box_front",
  "battery_box_side",
  "battery_box_top",
  "tin_cable",
  "copper_cable",
  "insulated_copper_cable",
];

/** Item textures only Craft has: the industry's materials, tools and bronze. */
export const INDUSTRY_ITEM_TILES: ReadonlySet<string> = new Set(
  [
    "raw_tin",
    "tin_ingot",
    "bronze_ingot",
    "refined_iron_ingot",
    "raw_uranium",
    "sticky_resin",
    "rubber",
    ...["iron", "gold", "copper", "tin", "bronze", "coal"].map((m) => `${m}_dust`),
    "electronic_circuit",
    "battery",
    "tree_tap",
    "wrench",
    "eu_meter",
    ...["pickaxe", "axe", "shovel", "hoe", "sword", "helmet", "chestplate", "leggings", "boots"].map((t) => `bronze_${t}`),
  ].map((n) => `item_${n}`),
);

/** The industry's blocks, as Craft draws them, in Minecraft's style. */
export function industryTiles(): Map<string, TilePixels> {
  const out = new Map<string, TilePixels>();
  const rim = (x: number, y: number): boolean => x === 0 || y === 0 || x === 15 || y === 15;
  type Rnd = Parameters<Parameters<typeof paint>[1]>[2];
  const stone = hex("#7f7f7f");
  const rock = (rnd: Rnd): [number, number, number] => scale(stone, jitter(rnd, 0.14) * (rnd.next() < 0.12 ? 0.82 : 1));
  // Ores: speckles of their mineral in stone
  const ore = (name: string, color: string, glow: boolean) =>
    paint(name, (x, y, rnd) => {
      const fleck = (Math.sin(x * 2.1 + y * 0.7) + Math.cos(y * 1.9 - x * 0.4)) * 0.5 + rnd.next() * 0.6 > 1.05;
      return fleck ? scale(hex(color), (glow ? 1.1 : 1) * jitter(rnd, 0.12)) : rock(rnd);
    });
  out.set("tin_ore", ore("tin ore", "#d8d8e4", false));
  out.set("uranium_ore", ore("uranium ore", "#7ac83a", true));
  // Rubber wood: gray-brown bark with dark seams, pale rings, a resin spot amber (wet) or dark (dry)
  const bark = hex("#6a5a42");
  const barkAt = (x: number, rnd: Rnd): [number, number, number] => scale(bark, (x % 5 === 2 ? 0.7 : 1) * jitter(rnd, 0.1));
  out.set("rubber_log", paint("rubber log", (x, _y, rnd) => barkAt(x, rnd)));
  out.set("rubber_log_top", paint("rubber log top", (x, y, rnd) => (rim(x, y) ? barkAt(x, rnd) : scale(hex("#b8a070"), (Math.round(Math.hypot(x - 7.5, y - 7.5)) % 3 === 0 ? 0.85 : 1) * jitter(rnd, 0.06)))));
  const spot = (wet: boolean) =>
    paint(wet ? "rubber log wet" : "rubber log dry", (x, y, rnd) => {
      const inSpot = Math.hypot((x - 7.5) / 2.2, (y - 8) / 3.5) < 1;
      return inSpot ? scale(wet ? [224, 160, 48] : [80, 60, 40], jitter(rnd, 0.1)) : barkAt(x, rnd);
    });
  out.set("rubber_log_wet", spot(true));
  out.set("rubber_log_dry", spot(false));
  out.set("rubber_leaves", paint("rubber leaves", (_x, _y, rnd) => (rnd.next() < 0.18 ? [0, 0, 0, 0] : scale(hex("#4a8a3a"), jitter(rnd, 0.25)))));
  out.set(
    "rubber_sapling",
    paint("rubber sapling", (x, y, rnd) => {
      if (Math.abs(x - 7.5) < 1 && y >= 7) return scale(bark, jitter(rnd, 0.1));
      return Math.hypot((x - 7.5) / 5, (y - 5) / 4) < 1 && rnd.next() < 0.85 ? scale(hex("#4a8a3a"), jitter(rnd, 0.2)) : [0, 0, 0, 0];
    }),
  );
  // Machines: steel plates with rivets, each front its own
  const steel = hex("#a4a8ae");
  const plate = (x: number, y: number, rnd: Rnd): [number, number, number] =>
    scale(steel, (rim(x, y) ? 0.72 : (x === 1 || y === 1) ? 1.12 : (x === 14 || y === 14) ? 0.85 : 1) * ((x === 2 || x === 13) && (y === 2 || y === 13) ? 0.7 : 1) * jitter(rnd, 0.05));
  out.set("machine_side", paint("machine side", (x, y, rnd) => plate(x, y, rnd)));
  out.set("machine_top", paint("machine top", (x, y, rnd) => (x >= 5 && x <= 10 && y >= 5 && y <= 10 && (x + y) % 2 === 0 ? scale(steel, 0.6) : plate(x, y, rnd))));
  out.set("machine_bottom", paint("machine bottom", (x, y, rnd) => scale(plate(x, y, rnd), 0.85)));
  const window = (x: number, y: number): boolean => x >= 4 && x <= 11 && y >= 5 && y <= 11;
  const front = (name: string, on: boolean, inside: (x: number, y: number, rnd: Rnd) => [number, number, number]) =>
    paint(`${name}${on ? " on" : ""}`, (x, y, rnd) => (window(x, y) ? inside(x, y, rnd) : plate(x, y, rnd)));
  for (const on of [false, true]) {
    const suffix = on ? "_on" : "";
    // The generator: a firebox, glowing while it burns
    out.set(`generator_front${suffix}`, front("generator", on, (x, y, rnd) => (on && y >= 8 ? scale([250, 140 + (y - 8) * 20, 40], jitter(rnd, 0.2)) : y % 2 === 0 ? scale(steel, 0.35) : [30, 30, 32])));
    // The electric furnace: a heating coil, red while it works
    out.set(`electric_furnace_front${suffix}`, front("electric furnace", on, (x, y, rnd) => ((x - 4) % 3 === 0 ? scale(on ? [240, 70, 40] : [90, 50, 45], jitter(rnd, 0.1)) : [32, 30, 30])));
    // The macerator: grinding teeth, turning while it works
    out.set(`macerator_front${suffix}`, front("macerator", on, (x, y, rnd) => (((x + y + (on ? 1 : 0)) % 3 === 0) ? scale(hex("#d8d8d8"), jitter(rnd, 0.1)) : [40, 40, 44])));
    // The extractor: a press over a drip of resin
    out.set(`extractor_front${suffix}`, front("extractor", on, (x, y, rnd) => (y <= 6 ? scale(steel, 0.55) : Math.abs(x - 7.5) < 1 && on ? scale([224, 160, 48], jitter(rnd, 0.1)) : [36, 34, 32])));
    // The compressor: a ram over a plate
    out.set(`compressor_front${suffix}`, front("compressor", on, (x, y, rnd) => (y === (on ? 9 : 6) || (y < (on ? 9 : 6) && Math.abs(x - 7.5) < 1.5) ? scale(steel, 0.75) : y >= 10 ? scale(steel, 0.5 * jitter(rnd, 0.1)) : [30, 30, 34])));
  }
  // The battery box: planks round a block of batteries, its output a socket on the front
  const wood = hex("#a8895a");
  const planks = (x: number, y: number, rnd: Rnd): [number, number, number] => scale(wood, (y % 4 === 3 ? 0.75 : 1) * (rim(x, y) ? 0.8 : 1) * jitter(rnd, 0.1));
  out.set("battery_box_side", paint("battery box side", (x, y, rnd) => (x >= 3 && x <= 12 && y >= 4 && y <= 11 ? scale((x - 3) % 3 === 2 ? [40, 40, 40] : [200, 50, 50], jitter(rnd, 0.08)) : planks(x, y, rnd))));
  out.set("battery_box_top", paint("battery box top", (x, y, rnd) => planks(x, y, rnd)));
  out.set("battery_box_front", paint("battery box front", (x, y, rnd) => (Math.hypot(x - 7.5, y - 7.5) < 3 ? (Math.hypot(x - 7.5, y - 7.5) < 1.6 ? [20, 20, 20] : scale(hex("#c8883a"), jitter(rnd, 0.08))) : planks(x, y, rnd))));
  // Cables: tin bare and bright, copper bare and orange, insulated black with a copper core showing at the ends
  out.set("tin_cable", paint("tin cable", (_x, y, rnd) => scale(hex("#c8c8cc"), (y % 4 === 0 ? 0.85 : 1) * jitter(rnd, 0.06))));
  out.set("copper_cable", paint("copper cable", (_x, y, rnd) => scale(hex("#d07a4a"), (y % 4 === 0 ? 0.85 : 1) * jitter(rnd, 0.06))));
  out.set("insulated_copper_cable", paint("insulated cable", (x, y, rnd) => (Math.hypot(x - 7.5, y - 7.5) < 1.5 ? scale(hex("#d07a4a"), jitter(rnd, 0.06)) : scale(hex("#2a2a2c"), jitter(rnd, 0.1)))));
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

/** Orbs of experience, gray with a lighter middle, from 3 pixels across to 13. */
export function orbTiles(): Map<string, TilePixels> {
  const out = new Map<string, TilePixels>();
  ORB_TILES.forEach((name, i) => {
    const r = 1.5 + i * 0.5;
    out.set(name, paint(name, (x, y) => {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > r) return CLEAR;
      const k = d < r * 0.45 ? 255 : d < r - 0.8 ? 200 : 120;
      return [k, k, k, 255];
    }));
  });
  return out;
}

/** Orbs of experience from Minecraft's sheet (entity/experience/experience_orb.png): 16 cells of 4 x 4, by size. */
export function orbsFromSheet(sheet: Uint8ClampedArray, width: number): Map<string, TilePixels> {
  const cell = width / 4;
  const out = new Map<string, TilePixels>();
  ORB_TILES.forEach((name, i) => {
    const pixels = new Uint8ClampedArray(TILE * TILE * 4);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const sx = (i % 4) * cell + Math.floor((x * cell) / TILE);
        const sy = Math.floor(i / 4) * cell + Math.floor((y * cell) / TILE);
        pixels.set(sheet.subarray((sy * width + sx) * 4, (sy * width + sx) * 4 + 4), (y * TILE + x) * 4);
      }
    }
    out.set(name, pixels);
  });
  return out;
}

const SHEET = hex("#e4e4e4");
const FRAME = hex("#8a6a3a");

/**
 * Craft's beds, laid out as Minecraft's bed textures are (block/<color>_bed_*.png): the tops, the sides of
 * the mattress in rows 7 to 12 (sheet and blanket over a wooden frame), the ends, and the planks below.
 * A side named west shows the head end on its left, east on its right.
 */
export function bedTiles(): Map<string, TilePixels> {
  const out = new Map<string, TilePixels>();
  const side = (seed: string, cloth: (x: number) => Rgb) =>
    paint(seed, (x, y, rnd) => {
      if (y < 7 || y > 12) return CLEAR;
      if (y >= 11) return scale(FRAME, (y === 12 ? 0.8 : 1) * jitter(rnd, 0.12));
      return scale(cloth(x), (y === 10 ? 0.85 : 1) * jitter(rnd, 0.06));
    });
  out.set("bed_down", paint("bed down", (x, y, rnd) => scale(FRAME, (y % 4 === 0 ? 0.8 : 1) * (x === (y >> 2) * 5 % 16 ? 0.85 : 1) * jitter(rnd, 0.12))));
  out.set("bed_head_north", side("bed head north", () => SHEET));
  COLORS.forEach((c, i) => {
    const color = hex(BLOCKS[Block.WhiteBed + i].top);
    const blanket = (x: number, y: number, rnd: { next(): number }): [number, number, number] => scale(color, ((x + y * 3) % 7 === 0 ? 0.9 : 1) * (0.94 + rnd.next() * 0.08));
    out.set(
      `${c}_bed_head_up`,
      paint(`${c} bed head`, (x, y, rnd) => {
        if (y >= 7) return blanket(x, y, rnd);
        if (y === 6) return scale(SHEET, 0.7);
        const pillow = x >= 2 && x <= 13 && y >= 1 && y <= 5;
        const rim = pillow && (x === 2 || x === 13 || y === 1 || y === 5);
        return scale(SHEET, (rim ? 0.82 : pillow ? 1.05 : 0.92) * jitter(rnd, 0.04));
      }),
    );
    out.set(`${c}_bed_foot_up`, paint(`${c} bed foot`, (x, y, rnd) => (y === 15 ? scale(color, 0.8) : blanket(x, y, rnd))));
    // The head's sides: sheet at the head end (the pillow's), blanket after it
    out.set(`${c}_bed_head_west`, side(`${c} head west`, (x) => (x < 6 ? SHEET : color)));
    out.set(`${c}_bed_head_east`, side(`${c} head east`, (x) => (x > 9 ? SHEET : color)));
    out.set(`${c}_bed_foot_west`, side(`${c} foot west`, () => color));
    out.set(`${c}_bed_foot_east`, side(`${c} foot east`, () => color));
    out.set(`${c}_bed_foot_south`, side(`${c} foot south`, () => color));
  });
  return out;
}

/** Craft's melon and mushrooms. */
export function plantTiles(): Map<string, TilePixels> {
  const green = hex("#6f9a2a");
  const dark = hex("#3e6a1a");
  return new Map([
    ["melon_side", paint("melon side", (x, _y, rnd) => scale(x % 5 < 2 ? dark : green, jitter(rnd, 0.15)))],
    ["melon_top", paint("melon top", (x, y, rnd) => scale(Math.floor(Math.hypot(x - 7.5, y - 7.5)) % 3 === 0 ? dark : hex("#a3a428"), jitter(rnd, 0.15)))],
    [
      "brown_mushroom",
      layered("brown mushroom", [
        [rect(7, 9, 8, 13), hex("#d8ccb4")],
        [(x, y) => y >= 6 && y <= 9 && Math.abs(x - 7.5) <= (y === 6 ? 2.5 : 4.5), hex("#9a7558"), 0.2],
      ]),
    ],
    [
      "red_mushroom",
      layered("red mushroom", [
        [rect(7, 10, 8, 14), hex("#d8ccb4")],
        [(x, y) => y >= 5 && y <= 10 && Math.abs(x - 7.5) <= (y === 5 ? 2 : y === 6 ? 3.5 : 4.5), hex("#c8322a"), 0.15],
        [any(disc(5, 8, 0.6), disc(9, 6, 0.6), disc(10, 9, 0.6)), [240, 236, 230], 0.05],
      ]),
    ],
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

/** Craft's particles: soft puffs of smoke from large to small, droplets, a flame, a star, puffs of a blast. */
export function particleTiles(): Map<string, TilePixels> {
  const out = new Map<string, TilePixels>();
  for (let i = 0; i < 8; i++) {
    const r = 2 + i * 0.75;
    out.set(`particle_generic_${i}`, paint(`smoke ${i}`, (x, y, rnd) => (Math.hypot(x - 7.5, y - 7.5) <= r && rnd.next() < 0.85 ? scale([235, 235, 235], jitter(rnd, 0.15)) : CLEAR)));
  }
  for (let i = 0; i < 4; i++) out.set(`particle_splash_${i}`, layered(`splash ${i}`, [[disc(7.5, 8.5 - i, 2.5 - i * 0.3), [90, 140, 230]], [disc(7, 7.5 - i, 0.8), [200, 225, 255]]]));
  out.set("particle_flame", layered("flame", [[(x, y) => ((x - 7.5) / 3) ** 2 + ((y - 9) / 5.5) ** 2 <= 1, [255, 140, 20]], [(x, y) => ((x - 7.5) / 1.6) ** 2 + ((y - 10) / 3) ** 2 <= 1, [255, 230, 120]]]));
  out.set("particle_critical_hit", layered("crit", [[any(line(7.5, 2, 7.5, 13, 0.8), line(2, 7.5, 13, 7.5, 0.8), line(4, 4, 11, 11, 0.6), line(4, 11, 11, 4, 0.6)), [240, 240, 255], 0.05]]));
  out.set("particle_lava", layered("lava", [[disc(7.5, 7.5, 3), [255, 120, 20]], [disc(7, 7, 1.5), [255, 220, 90]]]));
  out.set("particle_heart", layered("heart", [[(x, y) => (Math.hypot(x - 5.5, y - 6) < 3 || Math.hypot(x - 9.5, y - 6) < 3 || (y >= 6 && Math.abs(x - 7.5) < 13 - y)) && y < 13, [230, 30, 50]]]));
  out.set("particle_glint", layered("glint", [[any(line(7.5, 3, 7.5, 12, 0.7), line(3, 7.5, 12, 7.5, 0.7)), [120, 230, 120]]]));
  for (let i = 0; i < 16; i++) {
    const r = 3 + i * 0.3;
    out.set(`particle_explosion_${i}`, paint(`blast ${i}`, (x, y, rnd) => {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > r + rnd.next() * 2) return CLEAR;
      const k = 1 - i / 20;
      return d < r * 0.5 ? scale([255, 240, 200], k * jitter(rnd, 0.2)) : scale([200, 190, 180], k * jitter(rnd, 0.3));
    }));
  }
  return out;
}

/** Craft's farmland, crops by stage, and stems (gray, to be tinted by age). */
export function farmTiles(): Map<string, TilePixels> {
  const out = new Map<string, TilePixels>();
  const soil = (wet: boolean) => paint(wet ? "farmland wet" : "farmland", (x, y, rnd) => scale(hex(wet ? "#4a2e18" : "#6a4628"), (y % 4 === 0 ? 0.8 : 1) * jitter(rnd, 0.2)));
  out.set("farmland", soil(false));
  out.set("farmland_moist", soil(true));
  // Stalks growing taller stage by stage, wheat yellowing at the end
  const stalks = (seed: string, height: number, color: Rgb, top: Rgb | null) =>
    paint(seed, (x, y, rnd) => {
      if (x % 3 !== 1 || y < 16 - height) return CLEAR;
      if (top && y < 16 - height + 3) return scale(top, jitter(rnd, 0.2));
      return scale(color, jitter(rnd, 0.25));
    });
  for (let i = 0; i < 8; i++) out.set(`wheat_stage${i}`, stalks(`wheat ${i}`, 2 + i * 2, i === 7 ? hex("#b8a040") : hex("#4a9a2a"), i >= 5 ? hex("#c8b050") : null));
  for (let i = 0; i < 4; i++) {
    out.set(`carrots_stage${i}`, stalks(`carrots ${i}`, 3 + i * 3, hex("#3a8a2a"), i === 3 ? hex("#f08a1a") : null));
    out.set(`potatoes_stage${i}`, stalks(`potatoes ${i}`, 3 + i * 3, hex("#4a9a2a"), i === 3 ? hex("#d8d050") : null));
  }
  const stem = (seed: string, bent: boolean) => paint(seed, (x, y, rnd) => ((bent ? Math.abs(x - (16 - y) * 0.6) < 1.2 : Math.abs(x - 7.5) < 1) && y > 5 ? scale([210, 210, 210], jitter(rnd, 0.15)) : CLEAR));
  out.set("pumpkin_stem", stem("pumpkin stem", false));
  out.set("melon_stem", stem("melon stem", false));
  out.set("attached_pumpkin_stem", stem("pumpkin stem bent", true));
  out.set("attached_melon_stem", stem("melon stem bent", true));
  return out;
}

/** Craft's redstone: dust (gray, tinted by its power), torches lit and out, a lever, repeaters, lamps, smooth stone. */
export function redstoneTiles(): Map<string, TilePixels> {
  const out = new Map<string, TilePixels>();
  const gray: Rgb = [235, 235, 235];
  out.set("redstone_dust_dot", paint("dust dot", (x, y, rnd) => (Math.hypot(x - 7.5, y - 7.5) < 3.5 && rnd.next() < 0.8 ? scale(gray, jitter(rnd, 0.2)) : CLEAR)));
  out.set("redstone_dust_line0", paint("dust ns", (x, _y, rnd) => (Math.abs(x - 7.5) < 1.5 && rnd.next() < 0.8 ? scale(gray, jitter(rnd, 0.2)) : CLEAR)));
  out.set("redstone_dust_line1", paint("dust ew", (_x, y, rnd) => (Math.abs(y - 7.5) < 1.5 && rnd.next() < 0.8 ? scale(gray, jitter(rnd, 0.2)) : CLEAR)));
  const torch = (lit: boolean) =>
    paint(lit ? "redstone torch" : "redstone torch off", (x, y, rnd) => {
      if (x < 7 || x > 8 || y < 6) return CLEAR;
      if (y < 8) return scale(lit ? [255, 60, 30] : [90, 20, 20], jitter(rnd, 0.15));
      return scale(hex("#8a6a3a"), jitter(rnd, 0.2));
    });
  out.set("redstone_torch", torch(true));
  out.set("redstone_torch_off", torch(false));
  out.set("lever", paint("lever", (x, y, rnd) => (x >= 7 && x <= 8 && y >= 6 ? scale(hex("#8a6a3a"), jitter(rnd, 0.2)) : CLEAR)));
  const smooth = hex("#a8a8a8");
  out.set("smooth_stone", paint("smooth stone", (x, y, rnd) => scale(smooth, (x === 0 || y === 0 || x === 15 || y === 15 ? 0.85 : 1) * jitter(rnd, 0.06))));
  const repeater = (on: boolean) =>
    paint(on ? "repeater on" : "repeater", (x, y, rnd) => {
      // An arrow pointing to the top of the tile (north, the way it sends power), dust along it
      const arrow = Math.abs(x - 7.5) < 1 || (y < 6 && Math.abs(x - 7.5) < 6 - y);
      return arrow ? scale(on ? [230, 40, 30] : [110, 30, 30], jitter(rnd, 0.15)) : scale(smooth, (x === 0 || y === 0 || x === 15 || y === 15 ? 0.85 : 1) * jitter(rnd, 0.06));
    });
  out.set("repeater", repeater(false));
  out.set("repeater_on", repeater(true));
  const lamp = (on: boolean) =>
    paint(on ? "lamp on" : "lamp", (x, y, rnd) => {
      const frame = x % 5 === 0 || y % 5 === 0;
      return frame ? scale(hex("#5a3a1a"), jitter(rnd, 0.2)) : scale(on ? [250, 220, 150] : [140, 90, 50], jitter(rnd, 0.15));
    });
  out.set("redstone_lamp", lamp(false));
  out.set("redstone_lamp_on", lamp(true));
  return out;
}

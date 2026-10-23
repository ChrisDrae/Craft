import { COLORS } from "./blocks.js";
import { ITEMS, itemByName, type Item, type ItemStack } from "./items.js";

/**
 * Crafting and smelting recipes, as data. An ingredient is an item's name, or "#tag" for any of a group
 * (#planks, #logs, #coals). Shaped recipes match wherever they sit in the grid and mirrored; shapeless
 * ones in any order.
 */

const WOODS = ["oak", "birch", "spruce", "jungle", "acacia", "dark_oak"];
const TAGS: Readonly<Record<string, readonly string[]>> = {
  planks: WOODS.map((w) => `${w}_planks`),
  logs: WOODS.map((w) => `${w}_log`),
  coals: ["coal", "charcoal"],
};

interface Shaped {
  pattern: string[];
  key: Record<string, string>;
  result: string;
  count: number;
}

interface Shapeless {
  ingredients: string[];
  result: string;
  count: number;
}

const shaped = (pattern: string[], key: Record<string, string>, result: string, count: number = 1): Shaped => ({ pattern, key, result, count });
const shapeless = (ingredients: string[], result: string, count: number = 1): Shapeless => ({ ingredients, result, count });

const TOOL_SHAPES: Record<string, string[]> = {
  pickaxe: ["MMM", " S ", " S "],
  axe: ["MM", "MS", " S"],
  shovel: ["M", "S", "S"],
  hoe: ["MM", " S", " S"],
  sword: ["M", "M", "S"],
};
const ARMOR_SHAPES: Record<string, string[]> = {
  helmet: ["MMM", "M M"],
  chestplate: ["M M", "MMM", "MMM"],
  leggings: ["MMM", "M M", "M M"],
  boots: ["M M", "M M"],
};

export const SHAPED: readonly Shaped[] = [
  shaped(["#", "#"], { "#": "#planks" }, "stick", 4),
  shaped(["##", "##"], { "#": "#planks" }, "crafting_table"),
  shaped(["###", "# #", "###"], { "#": "cobblestone" }, "furnace"),
  shaped(["###", "# #", "###"], { "#": "#planks" }, "chest"),
  shaped(["C", "S"], { C: "#coals", S: "stick" }, "torch", 4),
  ...[
    ["wooden", "#planks"],
    ["stone", "cobblestone"],
    ["iron", "iron_ingot"],
    ["golden", "gold_ingot"],
    ["diamond", "diamond"],
  ].flatMap(([prefix, material]) => Object.entries(TOOL_SHAPES).map(([kind, pattern]) => shaped(pattern, { M: material, S: "stick" }, `${prefix}_${kind}`))),
  ...[
    ["leather", "leather"],
    ["iron", "iron_ingot"],
    ["golden", "gold_ingot"],
    ["diamond", "diamond"],
  ].flatMap(([prefix, material]) => Object.entries(ARMOR_SHAPES).map(([piece, pattern]) => shaped(pattern, { M: material }, `${prefix}_${piece}`))),
  shaped(["##", "##", "##"], { "#": "oak_planks" }, "oak_door", 3),
  shaped(["###", "###"], { "#": "oak_planks" }, "oak_trapdoor", 2),
  ...[
    ["oak", "oak_planks"],
    ["stone", "stone"],
    ["cobblestone", "cobblestone"],
    ["brick", "bricks"],
    ["stone_brick", "stone_bricks"],
  ].map(([name, material]) => shaped(["#  ", "## ", "###"], { "#": material }, `${name}_stairs`, 4)),
  ...[
    ["oak", "oak_planks"],
    ["stone", "stone"],
    ["cobblestone", "cobblestone"],
    ["brick", "bricks"],
    ["stone_brick", "stone_bricks"],
    ["sandstone", "sandstone"],
  ].map(([name, material]) => shaped(["###"], { "#": material }, `${name}_slab`, 6)),
  shaped(["###", "###"], { "#": "glass" }, "glass_pane", 16),
  shaped(["S S", "SSS", "S S"], { S: "stick" }, "ladder", 3),
  shaped(["#S#", "#S#"], { "#": "oak_planks", S: "stick" }, "oak_fence", 3),
  shaped(["###", "###"], { "#": "cobblestone" }, "cobblestone_wall", 6),
  shaped(["##", "##"], { "#": "brick" }, "bricks"),
  shaped(["##", "##"], { "#": "stone" }, "stone_bricks", 4),
  shaped(["##", "##"], { "#": "sand" }, "sandstone"),
  shaped(["##", "##"], { "#": "glowstone_dust" }, "glowstone"),
  shaped(["##", "##"], { "#": "snowball" }, "snow_block"),
  shaped(["##", "##"], { "#": "clay_ball" }, "clay"),
  shaped(["##", "##"], { "#": "string" }, "white_wool"),
  shaped(["###"], { "#": "snow_block" }, "snow", 6),
  shaped(["###", "BBB", "###"], { "#": "#planks", B: "book" }, "bookshelf"),
  shaped(["###"], { "#": "sugar_cane" }, "paper", 3),
  shaped(["WWW"], { W: "wheat" }, "bread"),
  ...COLORS.map((c) => shaped(["##"], { "#": `${c}_wool` }, `${c}_carpet`, 3)),
  ...COLORS.map((c) => shaped(["WWW", "PPP"], { W: `${c}_wool`, P: "#planks" }, `${c}_bed`)),
  shaped(["# #", " # "], { "#": "#planks" }, "bowl", 4),
  shaped([" #S", "# S", " #S"], { "#": "stick", S: "string" }, "bow"),
  shaped(["F", "S", "E"], { F: "flint", S: "stick", E: "feather" }, "arrow", 4),
  shaped([" #", "# "], { "#": "iron_ingot" }, "shears"),
  shaped(["R", "S"], { R: "redstone", S: "stick" }, "redstone_torch"),
  shaped(["S", "C"], { S: "stick", C: "cobblestone" }, "lever"),
  shaped(["##"], { "#": "stone" }, "stone_pressure_plate"),
  shaped(["##"], { "#": "#planks" }, "oak_pressure_plate"),
  shaped(["T#T", "SSS"], { T: "redstone_torch", "#": "redstone", S: "stone" }, "repeater"),
  shaped([" R ", "RGR", " R "], { R: "redstone", G: "glowstone" }, "redstone_lamp"),
  shaped(["###", "CIC", "CRC"], { "#": "#planks", C: "cobblestone", I: "iron_ingot", R: "redstone" }, "piston"),
  shaped(["S", "P"], { S: "slime_ball", P: "piston" }, "sticky_piston"),
  shaped(["I I", "ICI", " I "], { I: "iron_ingot", C: "chest" }, "hopper"),
  // Minecraft's observers and comparators take Nether quartz; until Craft has a Nether, an iron ingot
  shaped(["CCC", "RRI", "CCC"], { C: "cobblestone", R: "redstone", I: "iron_ingot" }, "observer"),
  shaped([" T ", "TIT", "SSS"], { T: "redstone_torch", I: "iron_ingot", S: "stone" }, "comparator"),
  shaped(["###", "###", "###"], { "#": "melon_slice" }, "melon"),
];

export const SHAPELESS: readonly Shapeless[] = [
  ...WOODS.map((w) => shapeless([`${w}_log`], `${w}_planks`, 4)),
  shapeless(["paper", "paper", "paper", "leather"], "book"),
  shapeless(["brown_mushroom", "red_mushroom", "bowl"], "mushroom_stew"),
  shapeless(["stone"], "stone_button"),
  shapeless(["#planks"], "oak_button"),
  shapeless(["bone"], "bone_meal", 3),
  shapeless(["pumpkin"], "pumpkin_seeds", 4),
  shapeless(["melon_slice"], "melon_seeds"),
];

/** Whether an item fits an ingredient (a name or a #tag). */
function fits(item: Item, ingredient: string): boolean {
  const name = ITEMS[item].name;
  return ingredient.startsWith("#") ? (TAGS[ingredient.slice(1)] ?? []).includes(name) : name === ingredient;
}

/** The grid's filled part: rows and columns between the first and last filled ones. */
function trim(grid: readonly (ItemStack | null)[], width: number): { cells: (Item | null)[][]; filled: number } {
  const height = grid.length / width;
  let x0 = width;
  let x1 = -1;
  let y0 = height;
  let y1 = -1;
  let filled = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!grid[y * width + x]) continue;
      filled++;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  const cells: (Item | null)[][] = [];
  for (let y = y0; y <= y1; y++) cells.push(Array.from({ length: x1 - x0 + 1 }, (_, i) => grid[y * width + x0 + i]?.item ?? null));
  return { cells, filled };
}

function matchesShape(cells: (Item | null)[][], r: Shaped, mirrored: boolean): boolean {
  const width = Math.max(...r.pattern.map((row) => row.length));
  if (cells.length !== r.pattern.length || cells[0].length !== width) return false;
  for (let y = 0; y < cells.length; y++) {
    for (let x = 0; x < width; x++) {
      const ch = r.pattern[y][mirrored ? width - 1 - x : x] ?? " ";
      const item = cells[y][x];
      if (ch === " ") {
        if (item !== null) return false;
      } else if (item === null || !fits(item, r.key[ch])) {
        return false;
      }
    }
  }
  return true;
}

/** What the items in a crafting grid (width wide, 2 or 3) make, or null. */
export function craft(grid: readonly (ItemStack | null)[], width: number): ItemStack | null {
  const { cells, filled } = trim(grid, width);
  if (filled === 0) return null;
  for (const r of SHAPED) {
    if (matchesShape(cells, r, false) || matchesShape(cells, r, true)) return result(r.result, r.count);
  }
  const items = grid.filter((s): s is ItemStack => s !== null).map((s) => s.item);
  for (const r of SHAPELESS) {
    if (r.ingredients.length !== items.length) continue;
    // Each ingredient takes one item, any order
    const left = [...items];
    if (r.ingredients.every((ing) => {
      const i = left.findIndex((item) => fits(item, ing));
      if (i < 0) return false;
      left.splice(i, 1);
      return true;
    })) return result(r.result, r.count);
  }
  return null;
}

function result(name: string, count: number): ItemStack {
  const item = itemByName(name);
  if (item === null) throw new Error(`No item ${name}`);
  return { item, count, damage: 0 };
}

/** What a furnace makes of an item, by name. */
const SMELTING: Readonly<Record<string, string>> = {
  raw_iron: "iron_ingot",
  raw_gold: "gold_ingot",
  raw_copper: "copper_ingot",
  iron_ore: "iron_ingot",
  gold_ore: "gold_ingot",
  copper_ore: "copper_ingot",
  sand: "glass",
  cobblestone: "stone",
  clay_ball: "brick",
  porkchop: "cooked_porkchop",
  beef: "cooked_beef",
  chicken: "cooked_chicken",
  mutton: "cooked_mutton",
  potato: "baked_potato",
  ...Object.fromEntries(TAGS.logs.map((log) => [log, "charcoal"])),
};

/** What a furnace makes of an item, or null if it doesn't smelt. */
export function smelt(item: Item): Item | null {
  const out = SMELTING[ITEMS[item].name];
  return out ? itemByName(out) : null;
}

/** Experience a furnace keeps for each item it makes, by what it made, until someone takes the output. */
const SMELT_XP: Readonly<Record<string, number>> = {
  iron_ingot: 0.7,
  gold_ingot: 1,
  copper_ingot: 0.7,
  glass: 0.1,
  stone: 0.1,
  brick: 0.3,
  charcoal: 0.15,
  cooked_porkchop: 0.35,
  cooked_beef: 0.35,
  cooked_chicken: 0.35,
  cooked_mutton: 0.35,
  baked_potato: 0.35,
};

/** The experience smelting gives per item made. */
export function smeltXp(made: Item): number {
  return SMELT_XP[ITEMS[made].name] ?? 0;
}

/** Ticks of furnace burning an item gives (0 if it doesn't burn). */
export function fuelOf(item: Item): number {
  return ITEMS[item].fuel;
}

/** Ticks a furnace takes to smelt one item: 10 seconds. */
export const SMELT_TIME = 200;

import { BLOCKS, Block } from "./blocks.js";

/**
 * Items: what the player carries. Every block but air is an item that places it (the item's id is the
 * block's), and after the blocks come the items that aren't blocks: materials, tools, armor and food. Ids
 * are only for this run of Craft; saves and messages use names.
 */
export type Item = number;

/** What a tool is for: the blocks it breaks faster, and those that drop only for it. */
export type ToolKind = "pickaxe" | "axe" | "shovel" | "hoe" | "sword";

/** Tool tiers, from wood to diamond; gold breaks fastest but is weak (the tier of wood). */
export const Tier = { Wood: 0, Stone: 1, Iron: 2, Diamond: 3, Gold: 0 } as const;

export interface Tool {
  kind: ToolKind;
  /** The tier of blocks it can harvest (stone needs wood, iron ore stone, diamond ore iron, obsidian diamond). */
  tier: number;
  /** How many times faster than a hand it breaks the blocks it is for. */
  speed: number;
}

export type ArmorSlot = "head" | "chest" | "legs" | "feet";

/** What eating an item gives: food points, saturation, and what is left in the hand (a stew's bowl). */
export interface Food {
  hunger: number;
  saturation: number;
  leaves?: string;
}

export interface ItemInfo {
  readonly id: Item;
  /** Stable name, as saves store it: "iron_ingot". A block item has its block's name. */
  readonly name: string;
  readonly label: string;
  /** How many fit in a slot. */
  readonly maxStack: number;
  /** The block it is, or null. */
  readonly block: Block | null;
  /** The block it places when it isn't one (seeds a crop, redstone its dust), or null. */
  readonly places: Block | null;
  readonly tool: Tool | null;
  readonly armor: ArmorSlot | null;
  /** Armor points worn (each half an armor icon), and the toughness that helps against heavy hits. */
  readonly defense: number;
  readonly toughness: number;
  readonly food: Food | null;
  /** Damage a hit with it does (1 by hand), and hits a second at full strength (4 by hand). */
  readonly attack: number;
  readonly attackSpeed: number;
  /** Uses before it breaks (tools and armor), 0 for items that don't wear. */
  readonly durability: number;
  /** Ticks it keeps a furnace burning, 0 if it doesn't burn. */
  readonly fuel: number;
  /** Its picture in Minecraft's textures (item/<texture>.png), for items that aren't blocks. */
  readonly texture: string | null;
  /** Its color without textures (Canvas 2D). */
  readonly color: string;
}

interface ItemOptions {
  maxStack?: number;
  tool?: Tool;
  armor?: ArmorSlot;
  defense?: number;
  toughness?: number;
  food?: Food;
  places?: Block;
  attack?: number;
  attackSpeed?: number;
  durability?: number;
  fuel?: number;
}

/** Ticks a furnace burns: wood for one and a half items, coal for eight. */
const WOOD_FUEL = 300;

const WOODEN: ReadonlySet<number> = new Set([
  Block.Log,
  Block.Planks,
  Block.BirchLog,
  Block.BirchPlanks,
  Block.SpruceLog,
  Block.SprucePlanks,
  Block.JungleLog,
  Block.JunglePlanks,
  Block.AcaciaLog,
  Block.AcaciaPlanks,
  Block.DarkOakLog,
  Block.DarkOakPlanks,
  Block.CraftingTable,
  Block.Bookshelf,
  Block.OakFence,
  Block.OakStairs,
  Block.OakTrapdoor,
  Block.OakDoor,
]);

/** Block items drawn as a picture of their own rather than as the block. */
const PICTURED: ReadonlySet<number> = new Set([Block.Hopper, Block.Comparator]);

function blockItem(b: (typeof BLOCKS)[number]): ItemInfo {
  const fuel = WOODEN.has(b.id) ? WOOD_FUEL : b.id === Block.OakSlab ? 150 : b.id === Block.Ladder ? WOOD_FUEL : b.id === Block.OakSapling ? 100 : 0;
  // Hoppers and comparators show pictures of their own, as Minecraft's
  const texture = PICTURED.has(b.id) ? b.name : null;
  return { id: b.id, name: b.name, label: b.label, maxStack: b.shape === "bed" ? 1 : 64, block: b.id, places: null, tool: null, armor: null, defense: 0, toughness: 0, food: null, attack: 1, attackSpeed: 4, durability: 0, fuel, texture, color: b.top };
}

const extra: ItemInfo[] = [];
function item(name: string, label: string, color: string, options: ItemOptions = {}): Item {
  const id = BLOCKS.length + extra.length;
  extra.push({
    id,
    name,
    label,
    maxStack: options.maxStack ?? (options.tool || options.armor ? 1 : 64),
    block: null,
    places: options.places ?? null,
    tool: options.tool ?? null,
    armor: options.armor ?? null,
    defense: options.defense ?? 0,
    toughness: options.toughness ?? 0,
    food: options.food ?? null,
    attack: options.attack ?? 1,
    attackSpeed: options.attackSpeed ?? 4,
    durability: options.durability ?? 0,
    fuel: options.fuel ?? 0,
    texture: name,
    color,
  });
  return id;
}

/** The items that aren't blocks, by name in code. */
export const Items = {
  Stick: item("stick", "stick", "#8a6a3a", { fuel: 100 }),
  Coal: item("coal", "coal", "#2a2a2a", { fuel: 1600 }),
  Charcoal: item("charcoal", "charcoal", "#3a2e24", { fuel: 1600 }),
  RawIron: item("raw_iron", "raw iron", "#c8a38a"),
  IronIngot: item("iron_ingot", "iron ingot", "#d8d8d8"),
  RawGold: item("raw_gold", "raw gold", "#e8c040"),
  GoldIngot: item("gold_ingot", "gold ingot", "#f6d84a"),
  RawCopper: item("raw_copper", "raw copper", "#c87850"),
  CopperIngot: item("copper_ingot", "copper ingot", "#e0804a"),
  Diamond: item("diamond", "diamond", "#5ae8e0"),
  Emerald: item("emerald", "emerald", "#17dd62"),
  Lapis: item("lapis_lazuli", "lapis lazuli", "#2a4ac8"),
  Redstone: item("redstone", "redstone", "#c01010", { places: Block.RedstoneWire }),
  Flint: item("flint", "flint", "#3a3a3a"),
  String: item("string", "string", "#e8e8e8"),
  Leather: item("leather", "leather", "#a0552e"),
  ClayBall: item("clay_ball", "clay ball", "#a1a7b2"),
  Brick: item("brick", "brick", "#a85a40"),
  GlowstoneDust: item("glowstone_dust", "glowstone dust", "#e8c06a"),
  Snowball: item("snowball", "snowball", "#f6fbfb", { maxStack: 16 }),
  Paper: item("paper", "paper", "#f0f0e8"),
  Book: item("book", "book", "#7a4a2a"),
  Wheat: item("wheat", "wheat", "#d8c060"),
  Apple: item("apple", "apple", "#d02020", { food: { hunger: 4, saturation: 2.4 } }),
  Bread: item("bread", "bread", "#c08840", { food: { hunger: 5, saturation: 6 } }),
  MelonSlice: item("melon_slice", "melon slice", "#c8402a", { food: { hunger: 2, saturation: 1.2 } }),
  Bowl: item("bowl", "bowl", "#8a6a3a"),
  MushroomStew: item("mushroom_stew", "mushroom stew", "#b08a5a", { maxStack: 1, food: { hunger: 6, saturation: 7.2, leaves: "bowl" } }),
  Porkchop: item("porkchop", "raw porkchop", "#f0a0a0", { food: { hunger: 3, saturation: 1.8 } }),
  CookedPorkchop: item("cooked_porkchop", "cooked porkchop", "#c87850", { food: { hunger: 8, saturation: 12.8 } }),
  Beef: item("beef", "raw beef", "#c83a3a", { food: { hunger: 3, saturation: 1.8 } }),
  CookedBeef: item("cooked_beef", "steak", "#8a4a2a", { food: { hunger: 8, saturation: 12.8 } }),
  Chicken: item("chicken", "raw chicken", "#f0c8b0", { food: { hunger: 2, saturation: 1.2 } }),
  CookedChicken: item("cooked_chicken", "cooked chicken", "#c8884a", { food: { hunger: 6, saturation: 7.2 } }),
  Mutton: item("mutton", "raw mutton", "#c8504a", { food: { hunger: 2, saturation: 1.2 } }),
  CookedMutton: item("cooked_mutton", "cooked mutton", "#8a5030", { food: { hunger: 6, saturation: 9.6 } }),
  RottenFlesh: item("rotten_flesh", "rotten flesh", "#8a6a3a", { food: { hunger: 4, saturation: 0.8 } }),
  SpiderEye: item("spider_eye", "spider eye", "#a02a3a", { food: { hunger: 2, saturation: 3.2 } }),
  Bone: item("bone", "bone", "#e8e4d0"),
  Gunpowder: item("gunpowder", "gunpowder", "#5a5a5a"),
  Feather: item("feather", "feather", "#f0f0f0"),
  Egg: item("egg", "egg", "#e8d8b0", { maxStack: 16 }),
  Arrow: item("arrow", "arrow", "#8a6a3a"),
  Bow: item("bow", "bow", "#8a6a3a", { maxStack: 1, durability: 384, fuel: 300 }),
  Shears: item("shears", "shears", "#d8d8d8", { maxStack: 1, durability: 238 }),
  WheatSeeds: item("wheat_seeds", "wheat seeds", "#6a9a3a", { places: Block.Wheat }),
  Carrot: item("carrot", "carrot", "#f08a1a", { places: Block.Carrots, food: { hunger: 3, saturation: 3.6 } }),
  Potato: item("potato", "potato", "#d8b060", { places: Block.Potatoes, food: { hunger: 1, saturation: 0.6 } }),
  BakedPotato: item("baked_potato", "baked potato", "#c8903a", { food: { hunger: 5, saturation: 6 } }),
  PumpkinSeeds: item("pumpkin_seeds", "pumpkin seeds", "#e8d8a0", { places: Block.PumpkinStem }),
  MelonSeeds: item("melon_seeds", "melon seeds", "#3a2a1a", { places: Block.MelonStem }),
  BoneMeal: item("bone_meal", "bone meal", "#f0f0e8"),
  SlimeBall: item("slime_ball", "slimeball", "#7ac85a"),
};

/**
 * The five tool kinds in each of the five materials, and the four armor pieces in four. As weapons, by
 * Minecraft's numbers: damage per kind (pickaxe, axe, shovel, hoe, sword) and the axe's hits a second.
 */
const TOOL_MATERIALS = [
  { prefix: "wooden", label: "wooden", tier: Tier.Wood, speed: 2, durability: 59, color: "#a8895a", attack: [2, 7, 2.5, 1, 4], axeSpeed: 0.8, hoeSpeed: 1 },
  { prefix: "stone", label: "stone", tier: Tier.Stone, speed: 4, durability: 131, color: "#7f7f7f", attack: [3, 9, 3.5, 1, 5], axeSpeed: 0.8, hoeSpeed: 2 },
  { prefix: "iron", label: "iron", tier: Tier.Iron, speed: 6, durability: 250, color: "#d8d8d8", attack: [4, 9, 4.5, 1, 6], axeSpeed: 0.9, hoeSpeed: 3 },
  { prefix: "golden", label: "golden", tier: Tier.Gold, speed: 12, durability: 32, color: "#f6d84a", attack: [2, 7, 2.5, 1, 4], axeSpeed: 1, hoeSpeed: 1 },
  { prefix: "diamond", label: "diamond", tier: Tier.Diamond, speed: 8, durability: 1561, color: "#5ae8e0", attack: [5, 9, 5.5, 1, 7], axeSpeed: 1, hoeSpeed: 4 },
] as const;
const TOOL_KINDS: readonly ToolKind[] = ["pickaxe", "axe", "shovel", "hoe", "sword"];

/** Tools by material prefix and kind: TOOLS.iron.pickaxe. */
export const TOOLS: Readonly<Record<string, Readonly<Record<ToolKind, Item>>>> = Object.fromEntries(
  TOOL_MATERIALS.map((m) => [
    m.prefix,
    Object.fromEntries(
      TOOL_KINDS.map((kind, k) => [
        kind,
        item(`${m.prefix}_${kind}`, `${m.label} ${kind}`, m.color, {
          tool: { kind, tier: m.tier, speed: kind === "sword" ? 1.5 : m.speed },
          durability: m.durability,
          fuel: m.prefix === "wooden" ? 200 : 0,
          attack: m.attack[k],
          attackSpeed: [1.2, m.axeSpeed, 1, m.hoeSpeed, 1.6][k],
        }),
      ]),
    ) as Record<ToolKind, Item>,
  ]),
);

/** Armor materials: durability factors, armor points of helmet, chestplate, leggings and boots, toughness. */
const ARMOR_MATERIALS = [
  { prefix: "leather", factor: 5, defense: [1, 3, 2, 1], toughness: 0, color: "#a0552e" },
  { prefix: "iron", factor: 15, defense: [2, 6, 5, 2], toughness: 0, color: "#d8d8d8" },
  { prefix: "golden", factor: 7, defense: [2, 5, 3, 1], toughness: 0, color: "#f6d84a" },
  { prefix: "diamond", factor: 33, defense: [3, 8, 6, 3], toughness: 2, color: "#5ae8e0" },
] as const;
const ARMOR_PIECES: ReadonlyArray<readonly [string, ArmorSlot, number]> = [
  ["helmet", "head", 11],
  ["chestplate", "chest", 16],
  ["leggings", "legs", 15],
  ["boots", "feet", 13],
];

/** Armor by material prefix and piece: ARMOR.iron.helmet. */
export const ARMOR: Readonly<Record<string, Readonly<Record<string, Item>>>> = Object.fromEntries(
  ARMOR_MATERIALS.map((m) => [
    m.prefix,
    Object.fromEntries(
      ARMOR_PIECES.map(([piece, slot, base], i) => [piece, item(`${m.prefix}_${piece}`, `${m.prefix} ${piece}`, m.color, { armor: slot, defense: m.defense[i], toughness: m.toughness, durability: base * m.factor })]),
    ),
  ]),
);

/** Every item, by id: the blocks' first (air included, as no item), then the rest. */
export const ITEMS: readonly ItemInfo[] = [...BLOCKS.map(blockItem), ...extra];

const BY_NAME: ReadonlyMap<string, Item> = new Map(ITEMS.filter((i) => i.id !== Block.Air).map((i) => [i.name, i.id]));

/** The item with a stable name, or null. */
export function itemByName(name: string): Item | null {
  return BY_NAME.get(name) ?? null;
}

/** A stack of items in a slot: what, how many, and how worn (uses taken off its durability). */
export interface ItemStack {
  item: Item;
  count: number;
  damage: number;
}

export const stack = (item: Item, count: number = 1, damage: number = 0): ItemStack => ({ item, count, damage });

/** Whether two stacks can share a slot: the same item, unworn (tools never stack anyway). */
export function stacksWith(a: ItemStack, b: ItemStack): boolean {
  return a.item === b.item && a.damage === 0 && b.damage === 0 && ITEMS[a.item].maxStack > 1;
}

/** A stack as saves and messages keep it: by name. */
export interface SavedStack {
  item: string;
  count: number;
  damage?: number;
}

export function saveStack(s: ItemStack | null): SavedStack | null {
  if (!s) return null;
  return s.damage > 0 ? { item: ITEMS[s.item].name, count: s.count, damage: s.damage } : { item: ITEMS[s.item].name, count: s.count };
}

/** A saved stack back; unknown items (from a newer Craft) and nonsense counts are nothing. */
export function loadStack(s: SavedStack | null | undefined): ItemStack | null {
  if (!s || typeof s.item !== "string") return null;
  const item = itemByName(s.item);
  if (item === null) return null;
  const count = Math.min(ITEMS[item].maxStack, Math.floor(Number(s.count)));
  if (!(count > 0)) return null;
  const damage = Math.max(0, Math.floor(Number(s.damage) || 0));
  return { item, count, damage };
}

/** Blocks only ever there by other means: crops and stems (from seeds), dust (from redstone), farmland (tilled). */
const NOT_ITEMS: ReadonlySet<number> = new Set([Block.Air, Block.Bedrock, Block.Farmland, Block.Wheat, Block.Carrots, Block.Potatoes, Block.PumpkinStem, Block.AttachedPumpkinStem, Block.MelonStem, Block.AttachedMelonStem, Block.RedstoneWire, Block.PistonHead, Block.MovingPiston]);

/** The items the creative inventory offers: every block a player can have, then every other item. */
export const CREATIVE: readonly Item[] = ITEMS.filter((i) => !NOT_ITEMS.has(i.id)).map((i) => i.id);

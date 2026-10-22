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

export interface ItemInfo {
  readonly id: Item;
  /** Stable name, as saves store it: "iron_ingot". A block item has its block's name. */
  readonly name: string;
  readonly label: string;
  /** How many fit in a slot. */
  readonly maxStack: number;
  /** The block it places, or null. */
  readonly block: Block | null;
  readonly tool: Tool | null;
  readonly armor: ArmorSlot | null;
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

function blockItem(b: (typeof BLOCKS)[number]): ItemInfo {
  const fuel = WOODEN.has(b.id) ? WOOD_FUEL : b.id === Block.OakSlab ? 150 : b.id === Block.Ladder ? WOOD_FUEL : b.id === Block.OakSapling ? 100 : 0;
  return { id: b.id, name: b.name, label: b.label, maxStack: 64, block: b.id, tool: null, armor: null, durability: 0, fuel, texture: null, color: b.top };
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
    tool: options.tool ?? null,
    armor: options.armor ?? null,
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
  Redstone: item("redstone", "redstone", "#c01010"),
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
  Apple: item("apple", "apple", "#d02020"),
  Bread: item("bread", "bread", "#c08840"),
};

/** The five tool kinds in each of the five materials, and the four armor pieces in four. */
const TOOL_MATERIALS = [
  { prefix: "wooden", label: "wooden", tier: Tier.Wood, speed: 2, durability: 59, color: "#a8895a" },
  { prefix: "stone", label: "stone", tier: Tier.Stone, speed: 4, durability: 131, color: "#7f7f7f" },
  { prefix: "iron", label: "iron", tier: Tier.Iron, speed: 6, durability: 250, color: "#d8d8d8" },
  { prefix: "golden", label: "golden", tier: Tier.Gold, speed: 12, durability: 32, color: "#f6d84a" },
  { prefix: "diamond", label: "diamond", tier: Tier.Diamond, speed: 8, durability: 1561, color: "#5ae8e0" },
] as const;
const TOOL_KINDS: readonly ToolKind[] = ["pickaxe", "axe", "shovel", "hoe", "sword"];

/** Tools by material prefix and kind: TOOLS.iron.pickaxe. */
export const TOOLS: Readonly<Record<string, Readonly<Record<ToolKind, Item>>>> = Object.fromEntries(
  TOOL_MATERIALS.map((m) => [
    m.prefix,
    Object.fromEntries(
      TOOL_KINDS.map((kind) => [
        kind,
        item(`${m.prefix}_${kind}`, `${m.label} ${kind}`, m.color, {
          tool: { kind, tier: m.tier, speed: kind === "sword" ? 1.5 : m.speed },
          durability: m.durability,
          fuel: m.prefix === "wooden" ? 200 : 0,
        }),
      ]),
    ) as Record<ToolKind, Item>,
  ]),
);

const ARMOR_MATERIALS = [
  { prefix: "leather", factor: 5, color: "#a0552e" },
  { prefix: "iron", factor: 15, color: "#d8d8d8" },
  { prefix: "golden", factor: 7, color: "#f6d84a" },
  { prefix: "diamond", factor: 33, color: "#5ae8e0" },
] as const;
const ARMOR_PIECES: ReadonlyArray<readonly [string, ArmorSlot, number]> = [
  ["helmet", "head", 11],
  ["chestplate", "chest", 16],
  ["leggings", "legs", 15],
  ["boots", "feet", 13],
];

/** Armor by material prefix and piece: ARMOR.iron.helmet. */
export const ARMOR: Readonly<Record<string, Readonly<Record<string, Item>>>> = Object.fromEntries(
  ARMOR_MATERIALS.map((m) => [m.prefix, Object.fromEntries(ARMOR_PIECES.map(([piece, slot, base]) => [piece, item(`${m.prefix}_${piece}`, `${m.prefix} ${piece}`, m.color, { armor: slot, durability: base * m.factor })]))]),
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

/** The items the creative inventory offers: every block but air and bedrock, then every other item. */
export const CREATIVE: readonly Item[] = ITEMS.filter((i) => i.id !== Block.Air && i.id !== Block.Bedrock).map((i) => i.id);

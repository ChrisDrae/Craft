import { BLOCKS, Block, SHAPE, STATE_BLOCK, propertyOf } from "./blocks.js";
import { ITEMS, Items, Tier, type ItemStack, type ToolKind } from "./items.js";

/**
 * Breaking blocks as Minecraft has it: each block has a hardness, a kind of tool that breaks it faster,
 * and maybe a tool tier without which it drops nothing (stone needs a pickaxe). The time to break a block
 * is its hardness times 1.5 seconds when it can be harvested, 5 when it can't, divided by the tool's
 * speed when it is the right kind of tool.
 */

interface Mining {
  hardness: number;
  tool: ToolKind | null;
  /** The tier of tool (of its kind) needed for drops, or -1 when anything harvests it. */
  tier: number;
}

const hand = (hardness: number): Mining => ({ hardness, tool: null, tier: -1 });
const by = (tool: ToolKind, hardness: number, tier: number = -1): Mining => ({ hardness, tool, tier });

const STONE_LIKE = by("pickaxe", 1.5, Tier.Wood);
const WOOD_LIKE = by("axe", 2);

/** Mining by block, the rest filled in by kind below. */
const TABLE: Partial<Record<number, Mining>> = {
  [Block.Grass]: by("shovel", 0.6),
  [Block.Dirt]: by("shovel", 0.5),
  [Block.Sand]: by("shovel", 0.5),
  [Block.Gravel]: by("shovel", 0.6),
  [Block.Clay]: by("shovel", 0.6),
  [Block.Snow]: by("shovel", 0.1, Tier.Wood),
  [Block.SnowBlock]: by("shovel", 0.2, Tier.Wood),
  [Block.Stone]: STONE_LIKE,
  [Block.Cobblestone]: by("pickaxe", 2, Tier.Wood),
  [Block.MossyCobblestone]: by("pickaxe", 2, Tier.Wood),
  [Block.StoneBricks]: STONE_LIKE,
  [Block.MossyStoneBricks]: STONE_LIKE,
  [Block.CrackedStoneBricks]: STONE_LIKE,
  [Block.Bricks]: by("pickaxe", 2, Tier.Wood),
  [Block.Sandstone]: by("pickaxe", 0.8, Tier.Wood),
  [Block.Obsidian]: by("pickaxe", 50, Tier.Diamond),
  [Block.CoalOre]: by("pickaxe", 3, Tier.Wood),
  [Block.IronOre]: by("pickaxe", 3, Tier.Stone),
  [Block.CopperOre]: by("pickaxe", 3, Tier.Stone),
  [Block.LapisOre]: by("pickaxe", 3, Tier.Stone),
  [Block.GoldOre]: by("pickaxe", 3, Tier.Iron),
  [Block.RedstoneOre]: by("pickaxe", 3, Tier.Iron),
  [Block.DiamondOre]: by("pickaxe", 3, Tier.Iron),
  [Block.EmeraldOre]: by("pickaxe", 3, Tier.Iron),
  [Block.Furnace]: by("pickaxe", 3.5, Tier.Wood),
  [Block.Spawner]: by("pickaxe", 5, Tier.Wood),
  [Block.Ice]: by("pickaxe", 0.5),
  [Block.CraftingTable]: by("axe", 2.5),
  [Block.Chest]: by("axe", 2.5),
  [Block.Bookshelf]: by("axe", 1.5),
  [Block.Ladder]: by("axe", 0.4),
  [Block.OakDoor]: by("axe", 3),
  [Block.OakTrapdoor]: by("axe", 3),
  [Block.OakFence]: WOOD_LIKE,
  [Block.Pumpkin]: by("axe", 1),
  [Block.Melon]: by("axe", 1),
  [Block.Vine]: by("axe", 0.2),
  [Block.Glass]: hand(0.3),
  [Block.GlassPane]: hand(0.3),
  [Block.Glowstone]: hand(0.3),
  [Block.Cactus]: hand(0.4),
  [Block.Bedrock]: hand(-1),
  [Block.Water]: hand(-1),
  [Block.Lava]: hand(-1),
};
for (const b of BLOCKS) {
  if (TABLE[b.id]) continue;
  const n = b.name;
  if (n.endsWith("_log") || n.endsWith("_planks")) TABLE[b.id] = WOOD_LIKE;
  else if (n.endsWith("_leaves")) TABLE[b.id] = by("hoe", 0.2);
  else if (n.endsWith("_wool")) TABLE[b.id] = hand(0.8);
  else if (n.endsWith("_carpet")) TABLE[b.id] = hand(0.1);
  else if (b.shape === "bed") TABLE[b.id] = hand(0.2);
  else if (b.shape === "slab" || b.shape === "stairs" || b.shape === "wall") TABLE[b.id] = n.startsWith("oak") ? WOOD_LIKE : by("pickaxe", 2, Tier.Wood);
  else if (b.shape === "cross" || b.shape === "tall" || b.shape === "torch" || b.shape === "lilypad" || n === "sugar_cane") TABLE[b.id] = hand(0);
}

/** Mining for every block (a hand and a second's worth of hardness for anything not listed). */
export function miningOf(block: Block): Mining {
  return TABLE[block] ?? hand(1);
}

/** Blast resistance where it isn't the hardness (Minecraft's): stone things 6, obsidian 1200, fluids 100. */
const RESISTANCE: Partial<Record<number, number>> = {
  [Block.Stone]: 6,
  [Block.Cobblestone]: 6,
  [Block.MossyCobblestone]: 6,
  [Block.StoneBricks]: 6,
  [Block.MossyStoneBricks]: 6,
  [Block.CrackedStoneBricks]: 6,
  [Block.Bricks]: 6,
  [Block.Obsidian]: 1200,
  [Block.Bedrock]: 3600000,
  [Block.Water]: 100,
  [Block.Lava]: 100,
  [Block.CobblestoneWall]: 6,
};

/** How well a block stands up to explosions. */
export function resistanceOf(block: Block): number {
  const r = RESISTANCE[block];
  if (r !== undefined) return r;
  const b = BLOCKS[block];
  if (b.shape === "slab" || b.shape === "stairs") return b.name.startsWith("oak") ? 3 : 6;
  return Math.max(0, miningOf(block).hardness);
}

/** Whether a held item (or none) gets drops from a block. */
export function canHarvest(block: Block, held: ItemStack | null): boolean {
  const m = miningOf(block);
  if (m.tier < 0) return true;
  const tool = held ? ITEMS[held.item].tool : null;
  return tool !== null && tool.kind === m.tool && tool.tier >= m.tier;
}

/** Seconds to break a block with a held item (or none); 0 is at once, Infinity never. */
export function breakTime(block: Block, held: ItemStack | null): number {
  const m = miningOf(block);
  if (m.hardness < 0) return Infinity;
  if (m.hardness === 0) return 0;
  const tool = held ? ITEMS[held.item].tool : null;
  const speed = tool && tool.kind === m.tool ? tool.speed : tool?.kind === "sword" && (m.tool === "hoe" || m.tool === null) ? 1.5 : 1;
  return (m.hardness * (canHarvest(block, held) ? 1.5 : 5)) / speed;
}

const one = (item: number, count: number = 1): ItemStack[] => [{ item, count, damage: 0 }];

/**
 * What a block in a state drops when broken by a player with a held item (`random` gives numbers in
 * [0, 1), for the drops that are a matter of luck). Nothing without the right tool, unless `anyTool`
 * (blown up: an explosion harvests anything).
 */
export function dropsOf(state: number, held: ItemStack | null, random: () => number, anyTool: boolean = false): ItemStack[] {
  const block = STATE_BLOCK[state];
  if (!anyTool && !canHarvest(block, held)) return [];
  const between = (lo: number, hi: number): number => lo + Math.floor(random() * (hi - lo + 1));
  switch (block) {
    case Block.Grass:
      return one(Block.Dirt);
    case Block.Stone:
      return one(Block.Cobblestone);
    case Block.Gravel:
      return random() < 0.1 ? one(Items.Flint) : one(Block.Gravel);
    case Block.Clay:
      return one(Items.ClayBall, 4);
    case Block.Snow:
      return one(Items.Snowball, Number(propertyOf(state, "layers")));
    case Block.SnowBlock:
      return one(Items.Snowball, 4);
    case Block.CoalOre:
      return one(Items.Coal);
    case Block.IronOre:
      return one(Items.RawIron);
    case Block.GoldOre:
      return one(Items.RawGold);
    case Block.CopperOre:
      return one(Items.RawCopper, between(2, 5));
    case Block.RedstoneOre:
      return one(Items.Redstone, between(4, 5));
    case Block.LapisOre:
      return one(Items.Lapis, between(4, 9));
    case Block.DiamondOre:
      return one(Items.Diamond);
    case Block.EmeraldOre:
      return one(Items.Emerald);
    case Block.Glowstone:
      return one(Items.GlowstoneDust, between(2, 4));
    case Block.Melon:
      return one(Items.MelonSlice, between(3, 7));
    case Block.Vine:
      return held?.item === Items.Shears ? one(Block.Vine) : [];
    case Block.Bookshelf:
      return one(Items.Book, 3);
    case Block.DeadBush:
      return between(0, 2) > 0 ? one(Items.Stick, between(1, 2)) : [];
    case Block.Glass:
    case Block.GlassPane:
    case Block.Ice:
    case Block.Spawner:
    case Block.ShortGrass:
    case Block.Fern:
    case Block.TallGrass:
    case Block.LargeFern:
    case Block.Bedrock:
      return [];
  }
  const shape = SHAPE[state];
  if (BLOCKS[block].leafy) {
    // Saplings now and then (oak's for every kind, the only sapling there is), apples from oaks
    const out: ItemStack[] = [];
    if (random() < 0.05) out.push(...one(Block.OakSapling));
    if (block === Block.Leaves && random() < 0.005) out.push(...one(Items.Apple));
    return out;
  }
  if (shape === "slab" && propertyOf(state, "type") === "double") return one(block, 2);
  if (shape === "door" || shape === "tall") return one(block);
  return one(block);
}

/** Experience from ores that drop what they hold (coal, gems, redstone, lapis), when harvested. */
const ORE_XP: Partial<Record<number, readonly [number, number]>> = {
  [Block.CoalOre]: [0, 2],
  [Block.DiamondOre]: [3, 7],
  [Block.EmeraldOre]: [3, 7],
  [Block.LapisOre]: [2, 5],
  [Block.RedstoneOre]: [1, 5],
};

/** The experience breaking a block gives with a held item (or none). */
export function xpOf(state: number, held: ItemStack | null, random: () => number): number {
  const block = STATE_BLOCK[state];
  const range = ORE_XP[block];
  if (!range || !canHarvest(block, held)) return 0;
  return range[0] + Math.floor(random() * (range[1] - range[0] + 1));
}

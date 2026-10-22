import { Material } from "projector";

/** The 16 dye colors, in Minecraft's order: wool and carpet come in each. */
export const COLORS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"] as const;
const DYES = ["#e9ecec", "#f07613", "#bd44b3", "#3aafd9", "#f8c527", "#70b919", "#ed8dac", "#3e4447", "#8e8e86", "#158991", "#792aac", "#35399d", "#724728", "#546d1b", "#a12722", "#141519"];

/** Block ids. A block's default state has the same id (see the states below). */
export const Block = {
  Air: 0,
  Grass: 1,
  Dirt: 2,
  Stone: 3,
  Sand: 4,
  Water: 5,
  Log: 6,
  Leaves: 7,
  Planks: 8,
  Cobblestone: 9,
  Bricks: 10,
  CoalOre: 11,
  IronOre: 12,
  GoldOre: 13,
  Bedrock: 14,
  Torch: 15,
  Glowstone: 16,
  Gravel: 17,
  Glass: 18,
  Ice: 19,
  SnowBlock: 20,
  Clay: 21,
  Obsidian: 22,
  StoneBricks: 23,
  CraftingTable: 24,
  Furnace: 25,
  Bookshelf: 26,
  Ladder: 27,
  Lava: 28,
  OakDoor: 29,
  OakTrapdoor: 30,
  GlassPane: 31,
  OakFence: 32,
  CobblestoneWall: 33,
  Dandelion: 34,
  Poppy: 35,
  ShortGrass: 36,
  OakSapling: 37,
  Cactus: 38,
  Snow: 39,
  OakSlab: 40,
  StoneSlab: 41,
  CobblestoneSlab: 42,
  BrickSlab: 43,
  StoneBrickSlab: 44,
  OakStairs: 45,
  StoneStairs: 46,
  CobblestoneStairs: 47,
  BrickStairs: 48,
  StoneBrickStairs: 49,
  /** WhiteWool + a color's index in COLORS. */
  WhiteWool: 50,
  /** WhiteCarpet + a color's index in COLORS. */
  WhiteCarpet: 66,
  BirchLog: 82,
  BirchLeaves: 83,
  BirchPlanks: 84,
  SpruceLog: 85,
  SpruceLeaves: 86,
  SprucePlanks: 87,
  JungleLog: 88,
  JungleLeaves: 89,
  JunglePlanks: 90,
  AcaciaLog: 91,
  AcaciaLeaves: 92,
  AcaciaPlanks: 93,
  DarkOakLog: 94,
  DarkOakLeaves: 95,
  DarkOakPlanks: 96,
  Sandstone: 97,
  SandstoneSlab: 98,
  CopperOre: 99,
  RedstoneOre: 100,
  LapisOre: 101,
  DiamondOre: 102,
  EmeraldOre: 103,
  MossyCobblestone: 104,
  MossyStoneBricks: 105,
  CrackedStoneBricks: 106,
  Spawner: 107,
  Fern: 108,
  DeadBush: 109,
  SugarCane: 110,
  Cornflower: 111,
  OxeyeDaisy: 112,
  Allium: 113,
  AzureBluet: 114,
  BlueOrchid: 115,
  LilyOfTheValley: 116,
  TallGrass: 117,
  LargeFern: 118,
  LilyPad: 119,
  Pumpkin: 120,
  Chest: 121,
} as const;
export type Block = number;

/** Face directions: +x, -x, +y, -y, +z, -z (east, west, up, down, south, north). */
export const Dir = { PosX: 0, NegX: 1, Up: 2, Down: 3, PosZ: 4, NegZ: 5 } as const;
export type Dir = (typeof Dir)[keyof typeof Dir];
export const DIR_X: readonly number[] = [1, -1, 0, 0, 0, 0];
export const DIR_Y: readonly number[] = [0, 0, 1, -1, 0, 0];
export const DIR_Z: readonly number[] = [0, 0, 0, 0, 1, -1];
/** The opposite of a direction: the face of the neighbor that touches a face in direction d. */
export const opposite = (d: number): number => d ^ 1;

/**
 * How a block lets sight through. Opaque blocks hide the faces next to them; cut-out ones (leaves) have
 * see-through pixels; translucent ones (water) are drawn see-through, after everything else.
 */
export type Opacity = "opaque" | "cutout" | "translucent" | "none";

/** How a block is drawn: a full cube, or a model of smaller boxes and quads (see shapes.ts). */
export type Shape =
  | "cube"
  | "fluid"
  | "cross"
  | "torch"
  | "slab"
  | "stairs"
  | "fence"
  | "pane"
  | "wall"
  | "door"
  | "trapdoor"
  | "ladder"
  | "carpet"
  | "snow"
  | "cactus"
  /** Two blocks high, crossed planes in each half (tall grass, large ferns). */
  | "tall"
  | "lilypad"
  /** A chest: a box a pixel in from the sides, 14 pixels high (two side by side make one long box). */
  | "chest";

/**
 * How a block's color depends on where it is, as Minecraft tints its gray grass, leaf and water textures:
 * by the biome's grass, foliage or water color (blended between biomes), or by a fixed color.
 */
export const Tint = { None: 0, Grass: 1, Foliage: 2, Water: 3, Birch: 4, Spruce: 5, LilyPad: 6 } as const;

/** Which of a block's looks (textures and colors) a face shows. */
export const Face = { Top: 0, Side: 1, Bottom: 2, Front: 3 } as const;

/** A block property, such as a log's axis: its name and its values, the first being the default. */
export interface Property {
  readonly name: string;
  readonly values: readonly string[];
}

/** Texture names for a block's looks; `all` for every face, the others where they differ. */
export interface Textures {
  all?: string;
  top?: string;
  side?: string;
  bottom?: string;
  front?: string;
}

export interface BlockInfo {
  readonly id: Block;
  /** Stable name, as saves store it: "oak_log". */
  readonly name: string;
  /** What the player sees: "log". */
  readonly label: string;
  readonly shape: Shape;
  /** Stops entities (in the boxes of its shape). */
  readonly solid: boolean;
  readonly opacity: Opacity;
  readonly breakable: boolean;
  /** Light level the block gives off, 0-15. */
  readonly emission: number;
  /** How much more light dims passing into the block than through air: 15 stops it. */
  readonly lightFilter: number;
  /** Falls when nothing holds it up (sand, gravel). */
  readonly gravity: boolean;
  /** Hides its faces toward another block of its kind (glass, water). */
  readonly cullSame: boolean;
  /** Leaves: hide what is behind them when drawn without see-through textures. */
  readonly leafy: boolean;
  /** Placing a block on it takes its place (short grass, flowing fluids). */
  readonly replaceable: boolean;
  /** Its color by biome (Tint): all faces, but only the top of a grass block (its sides have an overlay). */
  readonly tint: number;
  /** Fill colors of the top, the sides and the bottom (Canvas 2D, the hotbar without textures). */
  readonly top: string;
  readonly side: string;
  readonly bottom: string;
  /** Material per look (Top, Side, Bottom; Front uses Side). */
  readonly materials: readonly Material[];
  /** Texture names per look (Face): top, side, bottom, front. */
  readonly textures: readonly [string, string, string, string];
  readonly properties: readonly Property[];
  /** Ids of the block's states, in the order of its property values (the last property counting fastest). */
  readonly states: readonly number[];
}

interface Colors {
  top: string;
  side?: string;
  bottom?: string;
}

interface BlockOptions {
  shape?: Shape;
  textures?: Textures;
  solid?: boolean;
  opacity?: Opacity;
  breakable?: boolean;
  properties?: Property[];
  emission?: number;
  lightFilter?: number;
  gravity?: boolean;
  cullSame?: boolean;
  leafy?: boolean;
  replaceable?: boolean;
  tint?: number;
}

/** Faces of the same color share one material, so they share the renderer's styles too. */
const materials: Map<string, Material> = new Map();

function materialFor(color: string, opacity: number): Material {
  const key = `${color}|${opacity}`;
  let m = materials.get(key);
  if (!m) {
    m = new Material({ color, shading: "flat", opacity });
    materials.set(key, m);
  }
  return m;
}

/** Shapes without collision: you walk through plants, torches and fluids. */
const PASSABLE: readonly Shape[] = ["cross", "torch", "fluid", "tall"];

function block(id: Block, name: string, label: string, colors: Colors, options: BlockOptions = {}): BlockInfo {
  const top = colors.top;
  const side = colors.side ?? top;
  const bottom = colors.bottom ?? side;
  const shape = options.shape ?? "cube";
  const opacity = options.opacity ?? "opaque";
  const alpha = opacity === "translucent" ? 0.7 : 1;
  const t = options.textures ?? { all: name };
  const sideTile = t.side ?? t.all ?? name;
  const topTile = t.top ?? t.all ?? sideTile;
  const filter = opacity === "opaque" && (shape === "cube" || shape === "slab" || shape === "stairs") ? 15 : 0;
  return {
    id,
    name,
    label,
    shape,
    solid: options.solid ?? !PASSABLE.includes(shape),
    opacity,
    breakable: options.breakable ?? true,
    emission: options.emission ?? 0,
    lightFilter: options.lightFilter ?? filter,
    gravity: options.gravity ?? false,
    cullSame: options.cullSame ?? (shape === "fluid" || ((opacity === "cutout" || opacity === "translucent") && shape === "cube" && !options.leafy)),
    leafy: options.leafy ?? false,
    replaceable: options.replaceable ?? false,
    tint: options.tint ?? Tint.None,
    top,
    side,
    bottom,
    materials: [materialFor(top, alpha), materialFor(side, alpha), materialFor(bottom, alpha)],
    textures: [topTile, sideTile, t.bottom ?? t.all ?? topTile, t.front ?? sideTile],
    properties: options.properties ?? [],
    states: [],
  };
}

const bool = (name: string): Property => ({ name, values: ["false", "true"] });
const AXIS: Property = { name: "axis", values: ["y", "x", "z"] };
/** Where a torch points: up on the floor, or away from the wall it hangs on. */
const TORCH_FACING: Property = { name: "facing", values: ["up", "north", "south", "east", "west"] };
/** The way a block faces, toward its front (furnaces, stairs, doors, ladders: away from the wall). */
const FACING: Property = { name: "facing", values: ["north", "south", "east", "west"] };
const HALF: Property = { name: "half", values: ["bottom", "top"] };
const DOOR_HALF: Property = { name: "half", values: ["lower", "upper"] };
const OPEN = bool("open");
const HINGE: Property = { name: "hinge", values: ["left", "right"] };
const STAIR_SHAPE: Property = { name: "shape", values: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"] };
const SLAB_TYPE: Property = { name: "type", values: ["bottom", "top", "double"] };
const CONNECTIONS: Property[] = ["north", "east", "south", "west"].map(bool);
const LEVEL: Property = { name: "level", values: ["0", "1", "2", "3", "4", "5", "6", "7"] };
const FALLING = bool("falling");
const LAYERS: Property = { name: "layers", values: ["1", "2", "3", "4", "5", "6", "7", "8"] };
/** A grass block with snow on it shows snow on its sides. */
const SNOWY = bool("snowy");
/** A furnace burning: its front glows, and it gives off light. */
const LIT = bool("lit");
/** A chest alone, or half of a double chest: the left or right half as seen from its front. */
const CHEST_TYPE: Property = { name: "type", values: ["single", "left", "right"] };

const AIR = { solid: false, opacity: "none", breakable: false } as const;
const PLANT = { shape: "cross", opacity: "cutout", replaceable: false } as const;
const GRASSY = { ...PLANT, replaceable: true, tint: Tint.Grass } as const;
const TALL: BlockOptions = { shape: "tall", opacity: "cutout", replaceable: true, tint: Tint.Grass, properties: [DOOR_HALF] };

function slab(id: Block, name: string, label: string, color: string, texture: string | Textures): BlockInfo {
  const textures = typeof texture === "string" ? { all: texture } : texture;
  return block(id, `${name}_slab`, `${label} slab`, { top: color }, { shape: "slab", textures, properties: [SLAB_TYPE] });
}

/** A kind of wood: its log (id `log`), its leaves (log + 1) and its planks (log + 2). */
function wood(log: Block, name: string, bark: string, rings: string, leaves: string, planks: string, tint: number): BlockInfo[] {
  const label = name.replace("_", " ");
  return [
    block(log, `${name}_log`, `${label} log`, { top: rings, side: bark }, { textures: { top: `${name}_log_top`, side: `${name}_log` }, properties: [AXIS] }),
    block(log + 1, `${name}_leaves`, `${label} leaves`, { top: leaves }, { opacity: "cutout", lightFilter: 1, leafy: true, tint }),
    block(log + 2, `${name}_planks`, `${label} planks`, { top: planks }),
  ];
}

function stairs(id: Block, name: string, label: string, color: string, texture: string): BlockInfo {
  return block(id, `${name}_stairs`, `${label} stairs`, { top: color }, { shape: "stairs", textures: { all: texture }, properties: [FACING, HALF, STAIR_SHAPE] });
}

/** Everything about a block, indexed by its id. */
export const BLOCKS: readonly BlockInfo[] = [
  block(Block.Air, "air", "air", { top: "#000000" }, AIR),
  block(Block.Grass, "grass_block", "grass", { top: "#67a842", side: "#7c7445", bottom: "#86603f" }, { textures: { top: "grass_block_top", side: "grass_block_side", bottom: "dirt" }, properties: [SNOWY], tint: Tint.Grass }),
  block(Block.Dirt, "dirt", "dirt", { top: "#86603f" }),
  block(Block.Stone, "stone", "stone", { top: "#808080" }),
  block(Block.Sand, "sand", "sand", { top: "#dcd29c" }, { gravity: true }),
  block(Block.Water, "water", "water", { top: "#3d6fdc" }, { shape: "fluid", opacity: "translucent", breakable: false, lightFilter: 1, textures: { all: "water_still" }, properties: [LEVEL, FALLING], tint: Tint.Water }),
  block(Block.Log, "oak_log", "log", { top: "#a8895a", side: "#664f31" }, { textures: { top: "oak_log_top", side: "oak_log" }, properties: [AXIS] }),
  block(Block.Leaves, "oak_leaves", "leaves", { top: "#3e8a2a" }, { opacity: "cutout", lightFilter: 1, leafy: true, tint: Tint.Foliage }),
  block(Block.Planks, "oak_planks", "planks", { top: "#b38d55" }),
  block(Block.Cobblestone, "cobblestone", "cobblestone", { top: "#6c6c6c" }),
  block(Block.Bricks, "bricks", "bricks", { top: "#985040" }),
  block(Block.CoalOre, "coal_ore", "coal ore", { top: "#3a3a3a" }),
  block(Block.IronOre, "iron_ore", "iron ore", { top: "#b8987c" }),
  block(Block.GoldOre, "gold_ore", "gold ore", { top: "#e6c53e" }),
  block(Block.Bedrock, "bedrock", "bedrock", { top: "#4d4950" }, { breakable: false }),
  block(Block.Torch, "torch", "torch", { top: "#ffd86a", side: "#8a6a3a" }, { shape: "torch", opacity: "cutout", properties: [TORCH_FACING], emission: 14 }),
  block(Block.Glowstone, "glowstone", "glowstone", { top: "#e8c06a" }, { emission: 15 }),
  block(Block.Gravel, "gravel", "gravel", { top: "#857f7b" }, { gravity: true }),
  block(Block.Glass, "glass", "glass", { top: "#c0e0e8" }, { opacity: "cutout" }),
  block(Block.Ice, "ice", "ice", { top: "#91b7fd" }, { opacity: "translucent", lightFilter: 1 }),
  block(Block.SnowBlock, "snow_block", "snow block", { top: "#f6fbfb" }, { textures: { all: "snow" } }),
  block(Block.Clay, "clay", "clay", { top: "#a1a7b2" }),
  block(Block.Obsidian, "obsidian", "obsidian", { top: "#14121e" }),
  block(Block.StoneBricks, "stone_bricks", "stone bricks", { top: "#7a7a7a" }),
  block(Block.CraftingTable, "crafting_table", "crafting table", { top: "#a07a48", side: "#7b5a35" }, { textures: { top: "crafting_table_top", side: "crafting_table_side", bottom: "oak_planks", front: "crafting_table_front" } }),
  block(Block.Furnace, "furnace", "furnace", { top: "#6e6e6e", side: "#5a5a5a" }, { textures: { top: "furnace_top", side: "furnace_side", front: "furnace_front" }, properties: [FACING, LIT] }),
  block(Block.Bookshelf, "bookshelf", "bookshelf", { top: "#b38d55", side: "#7a5a3a" }, { textures: { top: "oak_planks", side: "bookshelf" } }),
  block(Block.Ladder, "ladder", "ladder", { top: "#8a6a3a" }, { shape: "ladder", opacity: "cutout", properties: [FACING] }),
  block(Block.Lava, "lava", "lava", { top: "#d4600e" }, { shape: "fluid", breakable: false, emission: 15, lightFilter: 1, textures: { all: "lava_still" }, properties: [LEVEL, FALLING] }),
  block(Block.OakDoor, "oak_door", "door", { top: "#8a6a3a" }, { shape: "door", opacity: "cutout", textures: { top: "oak_door_top", side: "oak_door_bottom" }, properties: [FACING, DOOR_HALF, OPEN, HINGE] }),
  block(Block.OakTrapdoor, "oak_trapdoor", "trapdoor", { top: "#8a6a3a" }, { shape: "trapdoor", opacity: "cutout", properties: [FACING, HALF, OPEN] }),
  block(Block.GlassPane, "glass_pane", "glass pane", { top: "#c0e0e8" }, { shape: "pane", opacity: "cutout", textures: { side: "glass", top: "glass_pane_top" }, properties: CONNECTIONS }),
  block(Block.OakFence, "oak_fence", "fence", { top: "#b38d55" }, { shape: "fence", textures: { all: "oak_planks" }, properties: CONNECTIONS }),
  block(Block.CobblestoneWall, "cobblestone_wall", "cobblestone wall", { top: "#6c6c6c" }, { shape: "wall", textures: { all: "cobblestone" }, properties: CONNECTIONS }),
  block(Block.Dandelion, "dandelion", "dandelion", { top: "#f1d42c" }, PLANT),
  block(Block.Poppy, "poppy", "poppy", { top: "#c8261a" }, PLANT),
  block(Block.ShortGrass, "short_grass", "grass", { top: "#5d9b3a" }, GRASSY),
  block(Block.OakSapling, "oak_sapling", "sapling", { top: "#3e7a2a" }, PLANT),
  block(Block.Cactus, "cactus", "cactus", { top: "#5a8a2e", side: "#4a7a26" }, { shape: "cactus", opacity: "cutout", textures: { top: "cactus_top", side: "cactus_side", bottom: "cactus_bottom" } }),
  block(Block.Snow, "snow", "snow", { top: "#f6fbfb" }, { shape: "snow", properties: [LAYERS] }),
  slab(Block.OakSlab, "oak", "oak", "#b38d55", "oak_planks"),
  slab(Block.StoneSlab, "stone", "stone", "#808080", "stone"),
  slab(Block.CobblestoneSlab, "cobblestone", "cobblestone", "#6c6c6c", "cobblestone"),
  slab(Block.BrickSlab, "brick", "brick", "#985040", "bricks"),
  slab(Block.StoneBrickSlab, "stone_brick", "stone brick", "#7a7a7a", "stone_bricks"),
  stairs(Block.OakStairs, "oak", "oak", "#b38d55", "oak_planks"),
  stairs(Block.StoneStairs, "stone", "stone", "#808080", "stone"),
  stairs(Block.CobblestoneStairs, "cobblestone", "cobblestone", "#6c6c6c", "cobblestone"),
  stairs(Block.BrickStairs, "brick", "brick", "#985040", "bricks"),
  stairs(Block.StoneBrickStairs, "stone_brick", "stone brick", "#7a7a7a", "stone_bricks"),
  ...COLORS.map((c, i) => block(Block.WhiteWool + i, `${c}_wool`, `${c.replace("_", " ")} wool`, { top: DYES[i] })),
  ...COLORS.map((c, i) => block(Block.WhiteCarpet + i, `${c}_carpet`, `${c.replace("_", " ")} carpet`, { top: DYES[i] }, { shape: "carpet", textures: { all: `${c}_wool` } })),
  ...wood(Block.BirchLog, "birch", "#d8d7d2", "#c8b77a", "#6d9a4c", "#c5b47b", Tint.Birch),
  ...wood(Block.SpruceLog, "spruce", "#3b2a17", "#735531", "#3f6640", "#735531", Tint.Spruce),
  ...wood(Block.JungleLog, "jungle", "#56461d", "#a5784e", "#2f8a1a", "#a0734d", Tint.Foliage),
  ...wood(Block.AcaciaLog, "acacia", "#676157", "#ad5d32", "#5f8a1f", "#ad5d32", Tint.Foliage),
  ...wood(Block.DarkOakLog, "dark_oak", "#3c2e1a", "#4c3318", "#2f6a1a", "#42291a", Tint.Foliage),
  block(Block.Sandstone, "sandstone", "sandstone", { top: "#dbd3a0", side: "#d8cb93" }, { textures: { top: "sandstone_top", side: "sandstone", bottom: "sandstone_bottom" } }),
  slab(Block.SandstoneSlab, "sandstone", "sandstone", "#dbd3a0", { top: "sandstone_top", side: "sandstone", bottom: "sandstone_bottom" }),
  block(Block.CopperOre, "copper_ore", "copper ore", { top: "#8c7b6a" }),
  block(Block.RedstoneOre, "redstone_ore", "redstone ore", { top: "#8a5a5a" }),
  block(Block.LapisOre, "lapis_ore", "lapis ore", { top: "#6a7a9a" }),
  block(Block.DiamondOre, "diamond_ore", "diamond ore", { top: "#7aa8a8" }),
  block(Block.EmeraldOre, "emerald_ore", "emerald ore", { top: "#6a9a7a" }),
  block(Block.MossyCobblestone, "mossy_cobblestone", "mossy cobblestone", { top: "#667a5a" }),
  block(Block.MossyStoneBricks, "mossy_stone_bricks", "mossy stone bricks", { top: "#73796a" }),
  block(Block.CrackedStoneBricks, "cracked_stone_bricks", "cracked stone bricks", { top: "#767676" }),
  block(Block.Spawner, "spawner", "spawner", { top: "#2a3440" }, { opacity: "cutout" }),
  block(Block.Fern, "fern", "fern", { top: "#5a8f3a" }, GRASSY),
  block(Block.DeadBush, "dead_bush", "dead bush", { top: "#8a6a3a" }, { ...PLANT, replaceable: true }),
  block(Block.SugarCane, "sugar_cane", "sugar cane", { top: "#8ab45a" }, { ...PLANT, tint: Tint.Grass }),
  block(Block.Cornflower, "cornflower", "cornflower", { top: "#4a6ad8" }, PLANT),
  block(Block.OxeyeDaisy, "oxeye_daisy", "oxeye daisy", { top: "#e8e8d8" }, PLANT),
  block(Block.Allium, "allium", "allium", { top: "#b86ad8" }, PLANT),
  block(Block.AzureBluet, "azure_bluet", "azure bluet", { top: "#d8e0e8" }, PLANT),
  block(Block.BlueOrchid, "blue_orchid", "blue orchid", { top: "#2aa8d8" }, PLANT),
  block(Block.LilyOfTheValley, "lily_of_the_valley", "lily of the valley", { top: "#f0f0f0" }, PLANT),
  block(Block.TallGrass, "tall_grass", "tall grass", { top: "#5d9b3a" }, { ...TALL, textures: { top: "tall_grass_top", side: "tall_grass_bottom" } }),
  block(Block.LargeFern, "large_fern", "large fern", { top: "#5a8f3a" }, { ...TALL, textures: { top: "large_fern_top", side: "large_fern_bottom" } }),
  block(Block.LilyPad, "lily_pad", "lily pad", { top: "#208030" }, { shape: "lilypad", opacity: "cutout", tint: Tint.LilyPad }),
  block(Block.Pumpkin, "pumpkin", "pumpkin", { top: "#c07615", side: "#e08a1d" }, { textures: { top: "pumpkin_top", side: "pumpkin_side" } }),
  block(Block.Chest, "chest", "chest", { top: "#a8742e", side: "#8a5a24" }, { shape: "chest", textures: { top: "chest_top", side: "chest_side", front: "chest_front" }, properties: [FACING, CHEST_TYPE] }),
];

// States: the default ones take the blocks' own ids, the others the ids after them
const stateBlock: number[] = BLOCKS.map((b) => b.id);
const stateIndex: number[] = BLOCKS.map(() => 0);
for (const b of BLOCKS) {
  const count = b.properties.reduce((n, p) => n * p.values.length, 1);
  const states = b.states as number[];
  states.push(b.id);
  for (let i = 1; i < count; i++) {
    states.push(stateBlock.length);
    stateBlock.push(b.id);
    stateIndex.push(i);
  }
}

/** How many block states there are; chunks store state ids below this. */
export const STATE_COUNT = stateBlock.length;
/** The block of every state. */
export const STATE_BLOCK: Uint16Array = Uint16Array.from(stateBlock);
const STATE_INDEX: Uint16Array = Uint16Array.from(stateIndex);

/** The block a state belongs to. */
export function blockOf(state: number): Block {
  return STATE_BLOCK[state];
}

/** The value of one of the state's properties. */
export function propertyOf(state: number, name: string): string {
  const props = BLOCKS[STATE_BLOCK[state]].properties;
  let index = STATE_INDEX[state];
  for (let p = props.length - 1; p >= 0; p--) {
    const n = props[p].values.length;
    if (props[p].name === name) return props[p].values[index % n];
    index = Math.floor(index / n);
  }
  throw new Error(`${BLOCKS[STATE_BLOCK[state]].name} has no property ${name}`);
}

/** The block's state with the given property values (the defaults for the rest). */
export function stateOf(block: Block, values: Readonly<Record<string, string>> = {}): number {
  const info = BLOCKS[block];
  let index = 0;
  for (const p of info.properties) {
    const v = values[p.name] === undefined ? 0 : p.values.indexOf(values[p.name]);
    if (v < 0) throw new Error(`${info.name}: ${p.name} can't be ${values[p.name]}`);
    index = index * p.values.length + v;
  }
  return info.states[index];
}

/** The same block in a state with some properties changed. */
export function withProperties(state: number, values: Readonly<Record<string, string>>): number {
  const info = BLOCKS[STATE_BLOCK[state]];
  const all: Record<string, string> = {};
  for (const p of info.properties) all[p.name] = values[p.name] ?? propertyOf(state, p.name);
  return stateOf(info.id, all);
}

/** The state as text, with every property: "oak_log[axis=x]". Saves store states this way. */
export function stateName(state: number): string {
  const info = BLOCKS[STATE_BLOCK[state]];
  if (info.properties.length === 0) return info.name;
  return `${info.name}[${info.properties.map((p) => `${p.name}=${propertyOf(state, p.name)}`).join(",")}]`;
}

const BY_NAME: Map<string, BlockInfo> = new Map(BLOCKS.map((b) => [b.name, b]));

/** The block with a stable name ("oak_log"), or null. */
export function blockByName(name: string): Block | null {
  return BY_NAME.get(name)?.id ?? null;
}

/** The state a name stands for (see stateName), or null for a block or value that doesn't exist. */
export function stateByName(text: string): number | null {
  const match = /^([a-z0-9_]+)(?:\[(.*)\])?$/.exec(text);
  const info = match ? BY_NAME.get(match[1]) : undefined;
  if (!match || !info) return null;
  const values: Record<string, string> = {};
  for (const pair of match[2] ? match[2].split(",") : []) {
    const [name, value] = pair.split("=");
    const p = info.properties.find((q) => q.name === name);
    if (!p || !p.values.includes(value)) return null;
    values[name] = value;
  }
  return stateOf(info.id, values);
}

/** The shape every state is drawn with (per block). */
export const SHAPE: readonly Shape[] = stateBlock.map((b) => BLOCKS[b].shape);
const isFluid = (b: number): boolean => BLOCKS[b].shape === "fluid";
const isCube = (s: number): boolean => SHAPE[s] === "cube" || (SHAPE[s] === "slab" && propertyOf(s, "type") === "double");

/** Lookup tables by state id for the hot loops: 1 where the flag is set. */
export const SOLID: Uint8Array = Uint8Array.from(stateBlock, (b) => (BLOCKS[b].solid ? 1 : 0));
/** Full opaque cubes: they hide every face next to them and darken corners (ambient occlusion). */
export const OPAQUE: Uint8Array = Uint8Array.from(stateBlock, (b, s) => (BLOCKS[b].opacity === "opaque" && isCube(s) ? 1 : 0));
/** Drawn with the see-through blocks, after everything else (water, ice). */
export const TRANSLUCENT: Uint8Array = Uint8Array.from(stateBlock, (b) => (BLOCKS[b].opacity === "translucent" ? 1 : 0));
/** Drawn as a full cube (with the fast path of face lists and smooth lighting), fluids included. */
export const CUBE_SHAPED: Uint8Array = Uint8Array.from(stateBlock, (b, s) => (isCube(s) || isFluid(b) ? 1 : 0));
/**
 * The light filter of blocks that light gets into but not through: slabs and stairs. Their own cell is lit
 * (as from a neighbor a block away), so the faces drawn from it aren't black, but a slab roof keeps the
 * house below dark, as Minecraft's light that is stopped by the solid sides of shapes.
 */
export const LIGHT_SINK = 16;
/** Light each state gives off (0-15), and how much it dims light passing into it (15 stops it, see LIGHT_SINK). */
export const EMISSION: Uint8Array = Uint8Array.from(stateBlock, (b, s) => (b === Block.Furnace && propertyOf(s, "lit") === "true" ? 13 : BLOCKS[b].emission));
export const LIGHT_FILTER: Uint8Array = Uint8Array.from(stateBlock, (b, s) => (BLOCKS[b].lightFilter >= 15 && !OPAQUE[s] ? LIGHT_SINK : BLOCKS[b].lightFilter));
/** See BlockInfo. */
export const CULL_SAME: Uint8Array = Uint8Array.from(stateBlock, (b) => (BLOCKS[b].cullSame ? 1 : 0));
export const LEAFY: Uint8Array = Uint8Array.from(stateBlock, (b) => (BLOCKS[b].leafy ? 1 : 0));
/** 1 for water, 2 for lava, 0 for everything else. */
export const FLUID: Uint8Array = Uint8Array.from(stateBlock, (b) => (b === Block.Water ? 1 : b === Block.Lava ? 2 : 0));

/** Every texture any block uses, in a fixed order: blocks refer to them by index. Snowy grass, the grass overlay and a burning furnace's front too. */
export const TILE_NAMES: readonly string[] = [...new Set([...BLOCKS.flatMap((b) => (b.id === Block.Air ? [] : b.textures)), "grass_block_snow", "grass_block_side_overlay", "furnace_front_on"])];
const TILE_INDEX: ReadonlyMap<string, number> = new Map(TILE_NAMES.map((n, i) => [n, i]));

/** The index of a texture in TILE_NAMES. */
export function tileIndex(name: string): number {
  const i = TILE_INDEX.get(name);
  if (i === undefined) throw new Error(`No texture ${name}`);
  return i;
}

/** The direction (Dir) a facing value points to. */
export const FACING_DIR: Readonly<Record<string, number>> = { north: Dir.NegZ, south: Dir.PosZ, east: Dir.PosX, west: Dir.NegX };
/** The sides to the right and the left of a block's front, as seen by someone facing it (a double chest's halves). */
export const RIGHT_OF: Readonly<Record<string, string>> = { north: "east", south: "west", east: "south", west: "north" };
export const LEFT_OF: Readonly<Record<string, string>> = { north: "west", south: "east", east: "north", west: "south" };

/** The look (Face) each state shows in each direction, at (state * 6 + dir), for cubes. */
export const FACE_LOOK: Uint8Array = new Uint8Array(STATE_COUNT * 6);
/** The texture (TILE_NAMES index) of each cube face, at (state * 6 + dir). */
export const FACE_TILE: Uint16Array = new Uint16Array(STATE_COUNT * 6);
/**
 * Quarter turns of the texture on each face, at (state * 6 + dir): a log lying on its side turns its bark
 * so the grain runs along the log.
 */
export const FACE_TURN: Uint8Array = new Uint8Array(STATE_COUNT * 6);
/** The tint (Tint) of each cube face, at (state * 6 + dir). */
export const FACE_TINT: Uint8Array = new Uint8Array(STATE_COUNT * 6);
/**
 * A second texture drawn over a cube face, tinted like grass, or -1, at (state * 6 + dir): the grass on the
 * sides of grass blocks, as Minecraft draws it over the dirt.
 */
export const FACE_OVERLAY: Int16Array = new Int16Array(STATE_COUNT * 6).fill(-1);
for (let state = 0; state < STATE_COUNT; state++) {
  const info = BLOCKS[STATE_BLOCK[state]];
  const axis = info.properties.includes(AXIS) ? propertyOf(state, "axis") : null;
  const front = info.properties.includes(FACING) ? FACING_DIR[propertyOf(state, "facing")] : info.id === Block.CraftingTable ? Dir.NegZ : -1;
  for (let d = 0; d < 6; d++) {
    const i = state * 6 + d;
    let look: number = d === Dir.Up ? Face.Top : d === Dir.Down ? Face.Bottom : Face.Side;
    if (axis) {
      // Both ends show the rings
      const along = d < 2 ? "x" : d < 4 ? "y" : "z";
      look = along === axis ? Face.Top : Face.Side;
      FACE_TURN[i] = (axis === "x" && d >= 2) || (axis === "z" && d < 2) ? 1 : 0;
    }
    // A crafting table shows its front on two sides
    if (d === front || (info.id === Block.CraftingTable && d === Dir.NegX)) look = Face.Front;
    FACE_LOOK[i] = look;
    FACE_TILE[i] = info.id === Block.Air ? 0 : tileIndex(info.textures[look]);
    if (info.id === Block.Grass && look === Face.Side) {
      // Snow shows on the sides of a snowy grass block; otherwise the grass overlay goes over the dirt
      if (propertyOf(state, "snowy") === "true") FACE_TILE[i] = tileIndex("grass_block_snow");
      else FACE_OVERLAY[i] = tileIndex("grass_block_side_overlay");
    }
    if (info.id === Block.Furnace && look === Face.Front && propertyOf(state, "lit") === "true") FACE_TILE[i] = tileIndex("furnace_front_on");
    FACE_TINT[i] = info.id === Block.Grass ? (d === Dir.Up ? info.tint : Tint.None) : info.tint;
  }
}

/** The canvas material of a state's look. */
export function lookMaterial(state: number, look: number): Material {
  return BLOCKS[STATE_BLOCK[state]].materials[look === Face.Front ? Face.Side : look];
}

/** The canvas material of a state's face in direction `dir`. */
export function faceMaterial(state: number, dir: number): Material {
  return lookMaterial(state, FACE_LOOK[state * 6 + dir]);
}

/** The blocks the hotbar starts with, slots 1-9. */
export const HOTBAR: readonly Block[] = [
  Block.Dirt,
  Block.Stone,
  Block.Cobblestone,
  Block.Planks,
  Block.Log,
  Block.Glass,
  Block.OakStairs,
  Block.Torch,
  Block.OakDoor,
];

/** Blocks the player can pick for the hotbar: everything but air and bedrock. */
export const PLACEABLE: readonly Block[] = BLOCKS.filter((b) => b.id !== Block.Air && b.id !== Block.Bedrock).map((b) => b.id);

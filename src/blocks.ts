import { Material } from "projector";

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
} as const;
export type Block = (typeof Block)[keyof typeof Block];

/** Face directions: +x, -x, +y, -y, +z, -z. */
export const Dir = { PosX: 0, NegX: 1, Up: 2, Down: 3, PosZ: 4, NegZ: 5 } as const;
export type Dir = (typeof Dir)[keyof typeof Dir];
export const DIR_X: readonly number[] = [1, -1, 0, 0, 0, 0];
export const DIR_Y: readonly number[] = [0, 0, 1, -1, 0, 0];
export const DIR_Z: readonly number[] = [0, 0, 0, 0, 1, -1];

/**
 * How a block lets sight through. Opaque blocks hide the faces next to them; cut-out ones (leaves) have
 * see-through pixels; translucent ones (water) are drawn see-through, after everything else.
 */
export type Opacity = "opaque" | "cutout" | "translucent" | "none";

/** Which of a block's three looks (textures and colors) a face shows. */
export const Face = { Top: 0, Side: 1, Bottom: 2 } as const;

/** A block property, such as a log's axis: its name and its values, the first being the default. */
export interface Property {
  readonly name: string;
  readonly values: readonly string[];
}

export interface BlockInfo {
  readonly id: Block;
  /** Stable name, as saves store it: "oak_log". */
  readonly name: string;
  /** What the player sees: "log". */
  readonly label: string;
  /** Stops entities. */
  readonly solid: boolean;
  readonly opacity: Opacity;
  readonly breakable: boolean;
  /** Light level the block gives off, 0-15. */
  readonly emission: number;
  /** How much more light dims passing into the block than through air: 15 stops it (opaque blocks). */
  readonly lightFilter: number;
  /** Fill colors of the top, the sides and the bottom (Canvas 2D, the hotbar without textures). */
  readonly top: string;
  readonly side: string;
  readonly bottom: string;
  /** Material per look (Face). */
  readonly materials: readonly Material[];
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
  solid?: boolean;
  opacity?: Opacity;
  breakable?: boolean;
  properties?: Property[];
  emission?: number;
  lightFilter?: number;
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

function block(id: Block, name: string, label: string, colors: Colors, options: BlockOptions = {}): BlockInfo {
  const top = colors.top;
  const side = colors.side ?? top;
  const bottom = colors.bottom ?? side;
  const opacity = options.opacity ?? "opaque";
  const alpha = opacity === "translucent" ? 0.7 : 1;
  return {
    id,
    name,
    label,
    solid: options.solid ?? true,
    opacity,
    breakable: options.breakable ?? true,
    emission: options.emission ?? 0,
    lightFilter: options.lightFilter ?? (opacity === "opaque" ? 15 : 0),
    top,
    side,
    bottom,
    materials: [materialFor(top, alpha), materialFor(side, alpha), materialFor(bottom, alpha)],
    properties: options.properties ?? [],
    states: [],
  };
}

const AXIS: Property = { name: "axis", values: ["y", "x", "z"] };
/** Where a torch points: up on the floor, or away from the wall it hangs on. */
const FACING: Property = { name: "facing", values: ["up", "north", "south", "east", "west"] };
const AIR = { solid: false, opacity: "none", breakable: false } as const;

/** Everything about a block, indexed by its id. */
export const BLOCKS: readonly BlockInfo[] = [
  block(Block.Air, "air", "air", { top: "#000000" }, AIR),
  block(Block.Grass, "grass_block", "grass", { top: "#67a842", side: "#7c7445", bottom: "#86603f" }),
  block(Block.Dirt, "dirt", "dirt", { top: "#86603f" }),
  block(Block.Stone, "stone", "stone", { top: "#808080" }),
  block(Block.Sand, "sand", "sand", { top: "#dcd29c" }),
  block(Block.Water, "water", "water", { top: "#3d6fdc" }, { solid: false, opacity: "translucent", breakable: false, lightFilter: 2 }),
  block(Block.Log, "oak_log", "log", { top: "#a8895a", side: "#664f31" }, { properties: [AXIS] }),
  block(Block.Leaves, "oak_leaves", "leaves", { top: "#3e8a2a" }, { opacity: "cutout", lightFilter: 1 }),
  block(Block.Planks, "oak_planks", "planks", { top: "#b38d55" }),
  block(Block.Cobblestone, "cobblestone", "cobblestone", { top: "#6c6c6c" }),
  block(Block.Bricks, "bricks", "bricks", { top: "#985040" }),
  block(Block.CoalOre, "coal_ore", "coal ore", { top: "#3a3a3a" }),
  block(Block.IronOre, "iron_ore", "iron ore", { top: "#b8987c" }),
  block(Block.GoldOre, "gold_ore", "gold ore", { top: "#e6c53e" }),
  block(Block.Bedrock, "bedrock", "bedrock", { top: "#4d4950" }, { breakable: false }),
  block(Block.Torch, "torch", "torch", { top: "#ffd86a", side: "#8a6a3a" }, { solid: false, opacity: "cutout", properties: [FACING], emission: 14 }),
  block(Block.Glowstone, "glowstone", "glowstone", { top: "#e8c06a" }, { emission: 15 }),
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
  return STATE_BLOCK[state] as Block;
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

/**
 * The state of a block placed against a face with normal (nx, ny, nz), or null where it can't go: blocks
 * with an axis (logs) lie along the normal, torches stand on floors and hang on walls (not ceilings),
 * everything else takes its default state.
 */
export function placementState(block: Block, nx: number, ny: number, nz: number): number | null {
  const props = BLOCKS[block].properties;
  if (props.includes(AXIS)) return stateOf(block, { axis: nx !== 0 ? "x" : nz !== 0 ? "z" : "y" });
  if (props.includes(FACING)) {
    if (ny < 0) return null;
    return stateOf(block, { facing: ny > 0 ? "up" : nx > 0 ? "east" : nx < 0 ? "west" : nz > 0 ? "south" : "north" });
  }
  return block;
}

/** Lookup tables by state id for the hot loops: 1 where the flag is set. */
export const SOLID: Uint8Array = Uint8Array.from(stateBlock, (b) => (BLOCKS[b].solid ? 1 : 0));
export const OPAQUE: Uint8Array = Uint8Array.from(stateBlock, (b) => (BLOCKS[b].opacity === "opaque" ? 1 : 0));
export const CUTOUT: Uint8Array = Uint8Array.from(stateBlock, (b) => (BLOCKS[b].opacity === "cutout" ? 1 : 0));
export const TRANSLUCENT: Uint8Array = Uint8Array.from(stateBlock, (b) => (BLOCKS[b].opacity === "translucent" ? 1 : 0));
/** Light each state gives off (0-15), and how much it dims light passing into it (15 stops it). */
export const EMISSION: Uint8Array = Uint8Array.from(stateBlock, (b) => BLOCKS[b].emission);
export const LIGHT_FILTER: Uint8Array = Uint8Array.from(stateBlock, (b) => BLOCKS[b].lightFilter);

/** The look (Face) each state shows in each direction, at (state * 6 + dir). */
export const FACE_LOOK: Uint8Array = new Uint8Array(STATE_COUNT * 6);
/**
 * Quarter turns of the texture on each face, at (state * 6 + dir): a log lying on its side turns its bark
 * so the grain runs along the log.
 */
export const FACE_TURN: Uint8Array = new Uint8Array(STATE_COUNT * 6);
for (let state = 0; state < STATE_COUNT; state++) {
  const axis = BLOCKS[STATE_BLOCK[state]].properties.includes(AXIS) ? propertyOf(state, "axis") : null;
  for (let d = 0; d < 6; d++) {
    const i = state * 6 + d;
    if (!axis) {
      FACE_LOOK[i] = d === Dir.Up ? Face.Top : d === Dir.Down ? Face.Bottom : Face.Side;
      continue;
    }
    // Both ends show the rings
    const along = d < 2 ? "x" : d < 4 ? "y" : "z";
    FACE_LOOK[i] = along === axis ? Face.Top : Face.Side;
    FACE_TURN[i] = (axis === "x" && d >= 2) || (axis === "z" && d < 2) ? 1 : 0;
  }
}

/** The canvas material of a state's face in direction `dir`. */
export function faceMaterial(state: number, dir: number): Material {
  return BLOCKS[STATE_BLOCK[state]].materials[FACE_LOOK[state * 6 + dir]];
}

/** A unit cube, as the boxes of a shape (min x, y, z, max x, y, z per box, in the block's own coordinates). */
const CUBE: Float64Array = Float64Array.of(0, 0, 0, 1, 1, 1);
const NOTHING: Float64Array = new Float64Array(0);
const px = (v: number): number => v / 16;

/** A block drawn as a box smaller than its cell: the box, and the box whose position picks the texture. */
export interface Model {
  box: Float64Array;
  uv: Float64Array;
}

/** A torch on the floor: a stick 2 pixels thick and 10 high in the middle of the cell, as on its texture. */
const STANDING = Float64Array.of(px(7), 0, px(7), px(9), px(10), px(9));

function torchModel(facing: string): Model {
  if (facing === "up") return { box: STANDING, uv: STANDING };
  // On a wall: the same stick a little raised, its back a pixel from the wall
  const lo = px(1);
  const hi = px(3);
  const [x0, x1] = facing === "east" ? [lo, hi] : facing === "west" ? [1 - hi, 1 - lo] : [px(7), px(9)];
  const [z0, z1] = facing === "south" ? [lo, hi] : facing === "north" ? [1 - hi, 1 - lo] : [px(7), px(9)];
  return { box: Float64Array.of(x0, px(3.5), z0, x1, px(13.5), z1), uv: STANDING };
}

/** The model of every state that isn't a full cube (null for cubes). */
export const MODELS: readonly (Model | null)[] = Array.from({ length: STATE_COUNT }, (_, s) =>
  STATE_BLOCK[s] === Block.Torch ? torchModel(propertyOf(s, "facing")) : null,
);

const SUPPORT_DIR: Readonly<Record<string, number>> = { up: Dir.Down, north: Dir.PosZ, south: Dir.NegZ, east: Dir.NegX, west: Dir.PosX };

/**
 * The direction (Dir) of the block a state hangs on and can't stay without (torches), or -1. A standing
 * torch needs the block below it, one on a wall the wall behind it.
 */
export const SUPPORT: Int8Array = Int8Array.from({ length: STATE_COUNT }, (_, s) =>
  STATE_BLOCK[s] === Block.Torch ? SUPPORT_DIR[propertyOf(s, "facing")] : -1,
);

/** Boxes that stop entities, per state. */
export const COLLISION: readonly Float64Array[] = stateBlock.map((b) => (BLOCKS[b].solid ? CUBE : NOTHING));
/** Boxes the crosshair can hit, per state: everything but air and water (a model's box for models). */
export const SELECTION: readonly Float64Array[] = stateBlock.map((b, s) =>
  b === Block.Air || b === Block.Water ? NOTHING : (MODELS[s]?.box ?? CUBE),
);

/** What the hotbar slots 1-9 place. */
export const HOTBAR: readonly Block[] = [
  Block.Dirt,
  Block.Stone,
  Block.Cobblestone,
  Block.Planks,
  Block.Log,
  Block.Leaves,
  Block.Bricks,
  Block.Torch,
  Block.Glowstone,
];

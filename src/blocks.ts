import { Material } from "projector";

/** Block ids, one byte each in a chunk. */
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
} as const;
export type Block = (typeof Block)[keyof typeof Block];

/** Face directions: +x, -x, +y, -y, +z, -z. */
export const Dir = { PosX: 0, NegX: 1, Up: 2, Down: 3, PosZ: 4, NegZ: 5 } as const;
export type Dir = (typeof Dir)[keyof typeof Dir];
export const DIR_X: readonly number[] = [1, -1, 0, 0, 0, 0];
export const DIR_Y: readonly number[] = [0, 0, 1, -1, 0, 0];
export const DIR_Z: readonly number[] = [0, 0, 0, 0, 1, -1];

export interface BlockInfo {
  readonly name: string;
  /** Stops the player. */
  readonly solid: boolean;
  /** Hides the faces of the blocks next to it. */
  readonly opaque: boolean;
  readonly breakable: boolean;
  /** Fill colors of the top, the sides and the bottom. */
  readonly top: string;
  readonly side: string;
  readonly bottom: string;
  /** Material per face direction (Dir). */
  readonly materials: readonly Material[];
}

interface Colors {
  top: string;
  side?: string;
  bottom?: string;
}

interface BlockOptions {
  solid?: boolean;
  opaque?: boolean;
  breakable?: boolean;
  opacity?: number;
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

function block(name: string, colors: Colors, options: BlockOptions = {}): BlockInfo {
  const top = colors.top;
  const side = colors.side ?? top;
  const bottom = colors.bottom ?? side;
  const opacity = options.opacity ?? 1;
  const s = materialFor(side, opacity);
  return {
    name,
    solid: options.solid ?? true,
    opaque: options.opaque ?? true,
    breakable: options.breakable ?? true,
    top,
    side,
    bottom,
    materials: [s, s, materialFor(top, opacity), materialFor(bottom, opacity), s, s],
  };
}

/** Everything about a block, indexed by its id. */
export const BLOCKS: readonly BlockInfo[] = [
  block("air", { top: "#000000" }, { solid: false, opaque: false, breakable: false }),
  block("grass", { top: "#67a842", side: "#7c7445", bottom: "#86603f" }),
  block("dirt", { top: "#86603f" }),
  block("stone", { top: "#808080" }),
  block("sand", { top: "#dcd29c" }),
  block("water", { top: "#3d6fdc" }, { solid: false, opaque: false, breakable: false, opacity: 0.7 }),
  block("log", { top: "#a8895a", side: "#664f31" }),
  block("leaves", { top: "#3e8a2a" }),
  block("planks", { top: "#b38d55" }),
  block("cobblestone", { top: "#6c6c6c" }),
  block("bricks", { top: "#985040" }),
  block("coal ore", { top: "#3a3a3a" }),
  block("iron ore", { top: "#b8987c" }),
  block("gold ore", { top: "#e6c53e" }),
  block("bedrock", { top: "#4d4950" }, { breakable: false }),
];

/** Lookup tables for the hot loops: 1 where the flag is set. */
export const SOLID: Uint8Array = Uint8Array.from(BLOCKS, (b) => (b.solid ? 1 : 0));
export const OPAQUE: Uint8Array = Uint8Array.from(BLOCKS, (b) => (b.opaque ? 1 : 0));

/** What the hotbar slots 1-9 place. */
export const HOTBAR: readonly Block[] = [
  Block.Grass,
  Block.Dirt,
  Block.Stone,
  Block.Cobblestone,
  Block.Planks,
  Block.Log,
  Block.Leaves,
  Block.Sand,
  Block.Bricks,
];

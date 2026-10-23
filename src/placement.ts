import { BLOCKS, type Block, stateOf } from "./blocks.js";

/** Where the crosshair is on the block it points at: the face's normal, and the point hit (0-1 in the block). */
export interface Aim {
  nx: number;
  ny: number;
  nz: number;
  /** Height of the point hit within the block, 0 at its bottom. */
  hy: number;
}

/** The horizontal facing a yaw looks toward (yaw 0 looks along +z, south). */
export function lookFacing(yaw: number): string {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  return Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? "east" : "west") : fz > 0 ? "south" : "north";
}

const OPPOSITE: Readonly<Record<string, string>> = { north: "south", south: "north", east: "west", west: "east" };

/** The facing out of a side face, by its normal. */
function normalFacing(nx: number, nz: number): string {
  return nx > 0 ? "east" : nx < 0 ? "west" : nz > 0 ? "south" : "north";
}

/**
 * The state of a block placed against the face the crosshair is on, by a player looking along `yaw`, or
 * null where it can't go:
 * - logs lie along the normal;
 * - torches stand on floors and hang on walls, ladders only hang on walls;
 * - slabs and stairs (and trapdoors) take the top half when placed against a ceiling or the upper half of
 *   a wall, the bottom half otherwise;
 * - stairs, doors and trapdoors face the way the player looks; furnaces turn their front to the player;
 * - a bed's foot goes there, its head the way the player looks.
 */
export function placementState(block: Block, aim: Aim, yaw: number): number | null {
  const info = BLOCKS[block];
  const has = (name: string): boolean => info.properties.some((p) => p.name === name);
  const { nx, ny, nz } = aim;
  const upper = ny < 0 || (ny === 0 && aim.hy > 0.5);
  const look = lookFacing(yaw);
  switch (info.shape) {
    case "torch":
      if (ny < 0) return null;
      return stateOf(block, { facing: ny > 0 ? "up" : normalFacing(nx, nz) });
    case "ladder":
    case "vine":
      if (ny !== 0) return null;
      return stateOf(block, { facing: normalFacing(nx, nz) });
    case "slab":
      return stateOf(block, { type: upper ? "top" : "bottom" });
    case "stairs":
      return stateOf(block, { facing: look, half: upper ? "top" : "bottom" });
    case "trapdoor":
      return stateOf(block, { facing: look, half: upper ? "top" : "bottom" });
    case "door":
      return stateOf(block, { facing: look });
    case "bed":
      return stateOf(block, { facing: look, part: "foot" });
  }
  if (has("axis")) return stateOf(block, { axis: nx !== 0 ? "x" : nz !== 0 ? "z" : "y" });
  if (has("facing")) return stateOf(block, { facing: OPPOSITE[look] });
  return block;
}

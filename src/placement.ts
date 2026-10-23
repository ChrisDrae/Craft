import { BLOCKS, Block, stateOf } from "./blocks.js";

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

const OPPOSITE: Readonly<Record<string, string>> = { north: "south", south: "north", east: "west", west: "east", up: "down", down: "up" };

/** The nearest of six ways a player looks (pitch grows looking up), as Minecraft's look direction. */
export function lookFacing6(yaw: number, pitch: number): string {
  const up = Math.sin(pitch);
  const level = Math.cos(pitch) * Math.max(Math.abs(Math.sin(yaw)), Math.abs(Math.cos(yaw)));
  return Math.abs(up) > level ? (up > 0 ? "up" : "down") : lookFacing(yaw);
}

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
 * - a bed's foot goes there, its head the way the player looks;
 * - pistons turn their face to the player, observers watch the way the player looks (any of six ways);
 *   hoppers point into the block they were put against, or down; comparators face like repeaters.
 */
export function placementState(block: Block, aim: Aim, yaw: number, pitch: number = 0): number | null {
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
    case "lever":
    case "button":
      // On the floor or ceiling facing the way the player looks, on a wall facing out of it
      if (ny !== 0) return stateOf(block, { face: ny > 0 ? "floor" : "ceiling", facing: look });
      return stateOf(block, { face: "wall", facing: normalFacing(nx, nz) });
    case "repeater":
    case "comparator":
      return stateOf(block, { facing: look });
    case "piston":
      return stateOf(block, { facing: OPPOSITE[lookFacing6(yaw, pitch)] });
    case "hopper":
      return stateOf(block, { facing: ny !== 0 ? "down" : OPPOSITE[normalFacing(nx, nz)] });
  }
  if (block === Block.Observer) return stateOf(block, { facing: lookFacing6(yaw, pitch) });
  // A battery box turns its front (its output) to the player, any of six ways
  if (block === Block.BatteryBox) return stateOf(block, { facing: OPPOSITE[lookFacing6(yaw, pitch)] });
  if (has("axis")) return stateOf(block, { axis: nx !== 0 ? "x" : nz !== 0 ? "z" : "y" });
  if (has("facing")) return stateOf(block, { facing: OPPOSITE[look] });
  return block;
}

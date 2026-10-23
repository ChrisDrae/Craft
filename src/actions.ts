import { BLOCKS, Block, DIR_X, DIR_Z, Dir, FACING_DIR, FLUID, SHAPE, SOLID, blockOf, propertyOf, withProperties } from "./blocks.js";
import { boxOverlapsCell } from "./collision.js";
import { canFertilize, fertilize } from "./growth.js";
import { placementState } from "./placement.js";
import { PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from "./player.js";
import { standsOn, sturdy, supported } from "./updates.js";
import type { VoxelWorld } from "./world.js";

/** How far away blocks can be broken or placed, in blocks. */
export const REACH = 6;

/** A player's action on a block: what they did, to which block, through which face. */
export interface Action {
  act: "break" | "place" | "use";
  x: number;
  y: number;
  z: number;
  /** Normal of the face aimed at. */
  nx: number;
  ny: number;
  nz: number;
  /** Height of the point aimed at within the block (0-1): top or bottom halves of slabs and stairs. */
  hy: number;
  /** The block placed. */
  block: Block;
  /** Where the player looked (stairs and doors face that way). */
  yaw: number;
  /** What the held item does to the block used (a hoe tills, bone meal makes things grow), or landing hard on farmland. */
  use?: "till" | "fertilize" | "trample";
}

/** A block placing takes the place of: air, fluid, or a replaceable one (short grass). */
function makesRoom(state: number): boolean {
  return state === Block.Air || FLUID[state] !== 0 || BLOCKS[blockOf(state)].replaceable;
}

/**
 * Does an action to the world, by the same rules for everyone (the host applies its guests' actions with
 * them). `standing` holds the feet of every player, whom solid blocks can't be placed into. Returns whether
 * anything changed; the block updates deal with what that does around it.
 */
export function perform(world: VoxelWorld, a: Action, standing: readonly { x: number; y: number; z: number }[]): boolean {
  switch (a.act) {
    case "break":
      return breakBlock(world, a);
    case "use":
      return useBlock(world, a);
    case "place":
      return placeBlock(world, a, standing);
  }
}

/** Breaks a block, unless it can't be broken (bedrock). */
export function breakBlock(world: VoxelWorld, a: Pick<Action, "x" | "y" | "z">): boolean {
  const state = world.get(a.x, a.y, a.z);
  if (state === Block.Air || !BLOCKS[blockOf(state)].breakable) return false;
  return world.set(a.x, a.y, a.z, Block.Air);
}

/**
 * Uses a block: a hoe tills grass or dirt with air above into farmland; bone meal makes a crop, sapling or
 * grass grow (fertilize); a lever flips, a button is pressed, a repeater's delay goes round; a door (both
 * halves) or a trapdoor opens or shuts. Farmland landed on hard is trampled back to dirt. Returns whether
 * anything happened.
 */
export function useBlock(world: VoxelWorld, a: Pick<Action, "x" | "y" | "z"> & { use?: Action["use"]; ny?: number }): boolean {
  const state = world.get(a.x, a.y, a.z);
  const shape = SHAPE[state];
  const block = blockOf(state);
  if (a.use === "till" && (block === Block.Grass || block === Block.Dirt) && world.get(a.x, a.y + 1, a.z) === Block.Air && (a.ny ?? 1) >= 0) return world.set(a.x, a.y, a.z, Block.Farmland);
  if (a.use === "trample") return block === Block.Farmland && world.set(a.x, a.y, a.z, Block.Dirt);
  if (a.use === "fertilize" && canFertilize(state)) {
    fertilize(world, a.x, a.y, a.z);
    return true;
  }
  if (block === Block.Lever) return world.set(a.x, a.y, a.z, withProperties(state, { powered: propertyOf(state, "powered") === "true" ? "false" : "true" }));
  if (block === Block.StoneButton || block === Block.OakButton) return propertyOf(state, "powered") === "false" && world.set(a.x, a.y, a.z, withProperties(state, { powered: "true" }));
  if (block === Block.Repeater) return world.set(a.x, a.y, a.z, withProperties(state, { delay: String((Number(propertyOf(state, "delay")) % 4) + 1) }));
  if (shape !== "door" && shape !== "trapdoor") return false;
  const open = propertyOf(state, "open") === "true" ? "false" : "true";
  if (shape === "door") {
    // The other half moves with it
    const other = propertyOf(state, "half") === "lower" ? a.y + 1 : a.y - 1;
    const there = world.get(a.x, other, a.z);
    if (blockOf(there) === blockOf(state)) world.set(a.x, other, a.z, withProperties(there, { open }));
  }
  world.set(a.x, a.y, a.z, withProperties(state, { open }));
  return true;
}

/** Whether anyone stands in the block at (x, y, z). */
function occupied(standing: readonly { x: number; y: number; z: number }[], x: number, y: number, z: number): boolean {
  return standing.some((p) => boxOverlapsCell(p, PLAYER_HALF_WIDTH, PLAYER_HEIGHT, x, y, z));
}

/**
 * Places a block against the face aimed at (see placementState), or adds it to the block aimed at: a slab
 * on a slab of its kind makes a double slab, snow on snow a thicker layer, and short grass gives way to it.
 * Doors and tall plants take two blocks up, beds two along the way the player looks. Nothing happens where
 * the block has nothing to hold it up, the place is taken, or someone stands there.
 */
export function placeBlock(world: VoxelWorld, a: Action, standing: readonly { x: number; y: number; z: number }[]): boolean {
  const aimed = world.get(a.x, a.y, a.z);
  if (aimed === Block.Air || FLUID[aimed] !== 0) return false;
  const block = a.block;
  const target = blockOf(aimed);
  if (!BLOCKS[block] || block === Block.Air) return false;

  if (target === block && SHAPE[aimed] === "slab") {
    const type = propertyOf(aimed, "type");
    if ((type === "bottom" && a.ny > 0) || (type === "top" && a.ny < 0)) return world.set(a.x, a.y, a.z, withProperties(aimed, { type: "double" }));
  }
  if (target === block && block === Block.Snow && a.ny > 0) {
    const layers = Number(propertyOf(aimed, "layers"));
    if (layers < 8) return world.set(a.x, a.y, a.z, withProperties(aimed, { layers: String(layers + 1) }));
  }

  const state = placementState(block, { nx: a.nx, ny: a.ny, nz: a.nz, hy: a.hy }, a.yaw);
  if (state === null) return false;
  // Short grass gives way: the block goes in its place
  const inPlace = BLOCKS[target].replaceable;
  const x = inPlace ? a.x : a.x + a.nx;
  const y = inPlace ? a.y : a.y + a.ny;
  const z = inPlace ? a.z : a.z + a.nz;
  if (!makesRoom(world.get(x, y, z))) return false;
  // Doors and tall plants are two blocks high, on ground that holds them; beds two long, on a floor
  const twoHigh = SHAPE[state] === "door" || SHAPE[state] === "tall";
  const bed = SHAPE[state] === "bed";
  const ahead = bed ? FACING_DIR[propertyOf(state, "facing")] : -1;
  const [hx, hz] = bed ? [x + DIR_X[ahead], z + DIR_Z[ahead]] : [x, z];
  if (twoHigh) {
    if (!makesRoom(world.get(x, y + 1, z)) || !standsOn(world, x, y, z, state)) return false;
  } else if (bed) {
    if (!makesRoom(world.get(hx, y, hz)) || !sturdy(world.get(x, y - 1, z), Dir.Up) || !sturdy(world.get(hx, y - 1, hz), Dir.Up)) return false;
  } else if (!supported(world, x, y, z, state)) {
    return false;
  }
  const other = twoHigh ? [x, y + 1, z] : bed ? [hx, y, hz] : null;
  if (SOLID[state] && (occupied(standing, x, y, z) || (other && occupied(standing, other[0], other[1], other[2])))) return false;
  if (!world.set(x, y, z, state)) return false;
  if (twoHigh) world.set(x, y + 1, z, withProperties(state, { half: "upper" }));
  if (bed) world.set(hx, y, hz, withProperties(state, { part: "head" }));
  return true;
}

/** The blocks an action may change, for putting them right on a guest that guessed wrong (a bed's head among them). */
export function touched(a: Action): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (const [x, y, z] of [
    [a.x, a.y, a.z],
    [a.x + a.nx, a.y + a.ny, a.z + a.nz],
  ]) {
    for (let dy = -1; dy <= 1; dy++) out.push([x, y + dy, z]);
  }
  const [x, y, z] = [a.x + a.nx, a.y + a.ny, a.z + a.nz];
  for (const d of [Dir.PosX, Dir.NegX, Dir.PosZ, Dir.NegZ]) out.push([x + DIR_X[d], y, z + DIR_Z[d]]);
  return out;
}

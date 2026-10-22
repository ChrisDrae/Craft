import { BLOCKS, Block, DIR_X, DIR_Z, FLUID, SHAPE, STATE_BLOCK, STATE_COUNT, propertyOf, stateOf } from "./blocks.js";
import type { TickBehavior } from "./ticks.js";
import type { VoxelWorld } from "./world.js";

/**
 * Water and lava as Minecraft has them: a source block (level 0) feeds flowing blocks around it, each a
 * level weaker (lava two), down to level 7; fluid with nothing below falls straight down as a column,
 * and spreads from where it lands. Flowing water runs toward the nearest drop within 4 blocks (lava 2) if
 * there is one. Water between two sources becomes a source. Where lava meets water, the lava hardens:
 * a source to obsidian, flowing lava to cobblestone (stone where lava falls into water).
 */

/** Game ticks between a fluid's updates. */
export const WATER_DELAY = 5;
export const LAVA_DELAY = 30;
/** Game ticks between a falling block's steps down: 20 blocks a second. */
export const FALL_DELAY = 1;

/** A fluid's level: 0 for a source, up to 7 at the far end of a flow. */
export function fluidLevel(state: number): number {
  return Number(propertyOf(state, "level"));
}

/** Whether a fluid block is part of a falling column. */
export function isFalling(state: number): boolean {
  return propertyOf(state, "falling") === "true";
}

export function isSource(state: number): boolean {
  return FLUID[state] !== 0 && fluidLevel(state) === 0 && !isFalling(state);
}

const FLUID_STATES: number[][] = [Block.Water, Block.Lava].map((b) => Array.from({ length: 16 }, (_, i) => stateOf(b, { level: String(i & 7), falling: i >= 8 ? "true" : "false" })));

/** The state of a fluid (Block.Water or Block.Lava) at a level, falling or not. */
export function fluidState(block: Block, level: number, falling: boolean = false): number {
  return FLUID_STATES[block === Block.Water ? 0 : 1][level + (falling ? 8 : 0)];
}

/**
 * Height of a fluid's surface in its own cell when no fluid of its kind is above it (then it fills the
 * cell): 8/9 for a source or a falling column, a ninth less per level.
 */
export function ownHeight(state: number): number {
  return isFalling(state) ? 8 / 9 : (8 - fluidLevel(state)) / 9;
}

/** How much a fluid weakens per block it flows, and how far it looks for a drop. */
const STEP = [0, 1, 2];
const REACH = [0, 4, 2];

/** Blocks fluid washes away and takes the place of: air, plants and torches. */
const WASHABLE: Uint8Array = Uint8Array.from({ length: STATE_COUNT }, (_, s) => (s === Block.Air || SHAPE[s] === "cross" || SHAPE[s] === "torch" ? 1 : 0));

/** Whether fluid can flow into a block: one it washes away, or a weaker flow of the same fluid. */
function canFlowInto(state: number, fluid: number, level: number): boolean {
  const kind = FLUID[state];
  if (kind === fluid) return !isSource(state) && !isFalling(state) && fluidLevel(state) > level;
  return kind === 0 && WASHABLE[state] === 1;
}

/** Whether fluid standing on this block stays on it rather than falling through. */
function holdsFluid(state: number, fluid: number): boolean {
  return FLUID[state] === fluid ? isSource(state) : !canFlowInto(state, fluid, 0) && FLUID[state] === 0;
}

/** The distance to the nearest place within `reach` where the fluid could flow down, leaving through `first`. */
function dropDistance(world: VoxelWorld, x: number, y: number, z: number, fluid: number, first: number, reach: number): number {
  // Breadth-first over the cells the fluid could flow through, not turning back
  let frontier: Array<[number, number, number]> = [[x + DIR_X[first], z + DIR_Z[first], first]];
  const seen = new Set<string>([`${x},${z}`]);
  for (let dist = 1; dist <= reach; dist++) {
    const next: Array<[number, number, number]> = [];
    for (const [cx, cz, from] of frontier) {
      if (seen.has(`${cx},${cz}`)) continue;
      seen.add(`${cx},${cz}`);
      // Through open cells and the fluid's own flow; a drop is a hole below, also one it already fills
      const cell = world.get(cx, y, cz);
      if (!canFlowInto(cell, fluid, 7) && !(FLUID[cell] === fluid && !isSource(cell))) continue;
      const below = world.get(cx, y - 1, cz);
      if (canFlowInto(below, fluid, 7) || FLUID[below] === fluid) return dist;
      for (const d of [0, 1, 4, 5]) if (d !== (from ^ 1)) next.push([cx + DIR_X[d], cz + DIR_Z[d], d]);
    }
    frontier = next;
  }
  return Infinity;
}

/** Turns lava touched by water into stone, obsidian or cobblestone. Returns whether it did. */
function harden(world: VoxelWorld, x: number, y: number, z: number, state: number): boolean {
  for (const [dx, dy, dz] of [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0, 1, 0],
  ]) {
    if (FLUID[world.get(x + dx, y + dy, z + dz)] !== 1) continue;
    world.set(x, y, z, isSource(state) ? Block.Obsidian : Block.Cobblestone);
    return true;
  }
  return false;
}

/** Puts fluid into a block, where lava and water meeting there harden. */
function flowInto(world: VoxelWorld, x: number, y: number, z: number, block: Block, level: number, falling: boolean): void {
  const there = world.get(x, y, z);
  const other = FLUID[there];
  const fluid = block === Block.Water ? 1 : 2;
  if (other !== 0 && other !== fluid) {
    // Water into lava hardens the lava; lava into water turns to stone
    world.set(x, y, z, fluid === 1 ? (isSource(there) ? Block.Obsidian : Block.Cobblestone) : Block.Stone);
    return;
  }
  world.set(x, y, z, fluidState(block, level, falling));
}

/**
 * A fluid block's update: settle its own level from what feeds it (flowing blocks without a feed dry up),
 * then flow down if it can, else out to the sides.
 */
function fluidTick(world: VoxelWorld, x: number, y: number, z: number, state: number, block: Block): void {
  const fluid = FLUID[state];
  if (fluid === 2 && harden(world, x, y, z, state)) return;
  const step = STEP[fluid];
  let current = state;
  if (!isSource(state)) {
    let next: number = Block.Air;
    if (FLUID[world.get(x, y + 1, z)] === fluid) {
      next = fluidState(block, 0, true);
    } else {
      let best = 8;
      let sources = 0;
      for (const d of [0, 1, 4, 5]) {
        const n = world.get(x + DIR_X[d], y, z + DIR_Z[d]);
        if (FLUID[n] !== fluid) continue;
        if (isSource(n)) sources++;
        // A falling column feeds the sides like a source
        best = Math.min(best, (isFalling(n) ? 0 : fluidLevel(n)) + step);
      }
      if (fluid === 1 && sources >= 2 && holdsFluid(world.get(x, y - 1, z), fluid)) next = fluidState(block, 0);
      else if (best <= 7) next = fluidState(block, best);
    }
    if (next !== state) {
      world.set(x, y, z, next);
      if (next === Block.Air) return;
      current = next;
    }
  }

  // Down first; only fluid that can't fall spreads sideways (a falling source too, if three sources surround it)
  const below = world.get(x, y - 1, z);
  if (y > 0 && (canFlowInto(below, fluid, -1) || (FLUID[below] !== 0 && FLUID[below] !== fluid))) {
    flowInto(world, x, y - 1, z, block, 0, true);
    let sources = 0;
    for (const d of [0, 1, 4, 5]) if (isSource(world.get(x + DIR_X[d], y, z + DIR_Z[d]))) sources++;
    if (!isSource(current) || sources < 3) return;
  } else if (!isSource(current) && FLUID[below] === fluid) {
    // Flowing on its own fluid (inside a column): that is where it goes, not to the sides
    return;
  }
  const level = (isFalling(current) ? 0 : fluidLevel(current)) + step;
  if (level > 7) return;
  // Toward the nearest drop if there is one in reach, everywhere otherwise
  const sides = [0, 1, 4, 5];
  const distance = sides.map((d) => dropDistance(world, x, y, z, fluid, d, REACH[fluid]));
  const nearest = Math.min(...distance);
  for (let i = 0; i < 4; i++) {
    if (nearest !== Infinity && distance[i] !== nearest) continue;
    const d = sides[i];
    const nx = x + DIR_X[d];
    const nz = z + DIR_Z[d];
    const there = world.get(nx, y, nz);
    if (canFlowInto(there, fluid, level) || (FLUID[there] !== 0 && FLUID[there] !== fluid)) flowInto(world, nx, y, nz, block, level, false);
  }
}

/** Whether a falling block (sand, gravel) can drop into this block. */
export function canFallInto(state: number): boolean {
  return state === Block.Air || FLUID[state] !== 0 || BLOCKS[STATE_BLOCK[state]].replaceable;
}

/** Steps a falling block down one cell while nothing holds it up. */
function fallTick(world: VoxelWorld, x: number, y: number, z: number, state: number): void {
  if (y <= 0 || !canFallInto(world.get(x, y - 1, z))) return;
  world.set(x, y, z, Block.Air);
  world.set(x, y - 1, z, state);
}

/** The scheduled-tick behaviors of fluids and falling blocks, for WorldTicks. */
export function blockBehaviors(): Map<Block, TickBehavior> {
  const fluid: TickBehavior = { scheduled: (w, x, y, z, s) => fluidTick(w, x, y, z, s, STATE_BLOCK[s]) };
  const falling: TickBehavior = { scheduled: (w, x, y, z, s) => fallTick(w, x, y, z, s) };
  return new Map<Block, TickBehavior>([
    [Block.Water, fluid],
    [Block.Lava, fluid],
    [Block.Sand, falling],
    [Block.Gravel, falling],
  ]);
}

/** The delay of a block's scheduled update, for ticks.schedule. */
export function delayOf(state: number): number {
  return FLUID[state] === 2 ? LAVA_DELAY : FLUID[state] === 1 ? WATER_DELAY : FALL_DELAY;
}


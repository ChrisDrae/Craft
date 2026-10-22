import { Block, DIR_X, DIR_Y, DIR_Z, Dir, FACING_DIR, FLUID, SHAPE, STATE_BLOCK, propertyOf, withProperties } from "./blocks.js";
import { canFallInto, delayOf } from "./fluids.js";
import { STURDY, SUPPORT } from "./shapes.js";
import type { WorldTicks } from "./ticks.js";
import type { VoxelWorld } from "./world.js";

/** Horizontal directions in the order of the connection properties: north, east, south, west. */
const SIDES = [Dir.NegZ, Dir.PosX, Dir.PosZ, Dir.NegX];
const SIDE_NAMES = ["north", "east", "south", "west"];
/** A facing turned a quarter counterclockwise (seen from above) and clockwise. */
const LEFT: Readonly<Record<string, string>> = { north: "west", west: "south", south: "east", east: "north" };
const RIGHT: Readonly<Record<string, string>> = { north: "east", east: "south", south: "west", west: "north" };

/** Whether a block's side (in direction d from it) is a full solid face that things can attach to. */
function sturdy(state: number, d: number): boolean {
  return STURDY[state * 6 + d] === 1;
}

/**
 * Whether the block at (x, y, z) in `state` is held up by what it rests or hangs on (see SUPPORT):
 * plants by grass or dirt, cactus by sand or cactus, a door's lower half by a solid floor and its upper
 * half, the upper half by the lower one, everything else by a solid face.
 */
export function supported(world: VoxelWorld, x: number, y: number, z: number, state: number): boolean {
  const d = SUPPORT[state];
  if (d < 0) return true;
  const n = world.get(x + DIR_X[d], y + DIR_Y[d], z + DIR_Z[d]);
  const nb = STATE_BLOCK[n];
  switch (SHAPE[state]) {
    case "cross":
      return nb === Block.Grass || nb === Block.Dirt;
    case "cactus":
      return nb === Block.Sand || nb === Block.Cactus;
    case "carpet":
      return n !== Block.Air && FLUID[n] === 0;
    case "door": {
      const door = STATE_BLOCK[state];
      if (propertyOf(state, "half") === "upper") return nb === door && propertyOf(n, "half") === "lower";
      const above = world.get(x, y + 1, z);
      return sturdy(n, Dir.Up) && STATE_BLOCK[above] === door && propertyOf(above, "half") === "upper";
    }
    default:
      return sturdy(n, d ^ 1);
  }
}

/** Whether a fence, pane or wall connects toward a neighbor: one of its kind (panes to glass too), or a solid face. */
function connectsTo(block: number, neighbor: number, toward: number): boolean {
  const nb = STATE_BLOCK[neighbor];
  if (nb === block) return true;
  if (block === Block.GlassPane && nb === Block.Glass) return true;
  return sturdy(neighbor, toward ^ 1);
}

/** The stairs at a position, if they're stairs with the given half. */
function stairsAt(world: VoxelWorld, x: number, y: number, z: number, half: string): number | null {
  const s = world.get(x, y, z);
  return SHAPE[s] === "stairs" && propertyOf(s, "half") === half ? s : null;
}

/**
 * The shape stairs take from the stairs around them, as Minecraft works it out: an outer corner where the
 * stairs behind turn across, an inner corner where the stairs in front do.
 */
function stairShape(world: VoxelWorld, x: number, y: number, z: number, state: number): string {
  const facing = propertyOf(state, "facing");
  const half = propertyOf(state, "half");
  const f = FACING_DIR[facing];
  // Unless the stairs on that side already run the same way, which keeps this side straight
  const takes = (toward: string): boolean => {
    const d = FACING_DIR[toward];
    const s = stairsAt(world, x + DIR_X[d], y, z + DIR_Z[d], half);
    return !(s !== null && propertyOf(s, "facing") === facing);
  };
  const back = stairsAt(world, x + DIR_X[f], y, z + DIR_Z[f], half);
  if (back !== null) {
    const bf = propertyOf(back, "facing");
    if (FACING_DIR[bf] >> 1 !== f >> 1 && takes(RIGHT[RIGHT[bf]])) return bf === LEFT[facing] ? "outer_left" : "outer_right";
  }
  const front = stairsAt(world, x - DIR_X[f], y, z - DIR_Z[f], half);
  if (front !== null) {
    const ff = propertyOf(front, "facing");
    if (FACING_DIR[ff] >> 1 !== f >> 1 && takes(ff)) return ff === LEFT[facing] ? "inner_left" : "inner_right";
  }
  return "straight";
}

/**
 * Block updates: whenever a block changes, it and its six neighbors react, as in Minecraft. Fences, panes
 * and walls connect to what is around them, stairs take their corner shapes, blocks that lose their
 * support come off, and fluids and blocks that fall are scheduled to move. Changes made here cause updates
 * of their own; they are queued and handled in order.
 */
export class BlockUpdates {
  private readonly world: VoxelWorld;
  private readonly ticks: WorldTicks;
  private readonly queue: number[] = [];
  private running: boolean = false;

  constructor(world: VoxelWorld, ticks: WorldTicks) {
    this.world = world;
    this.ticks = ticks;
  }

  /** The block at (x, y, z) changed (VoxelWorld.onChanged). */
  changed(x: number, y: number, z: number): void {
    this.queue.push(x, y, z);
    if (this.running) return;
    this.running = true;
    try {
      // Each change updates the block itself and its neighbors; changes made meanwhile join the queue
      for (let i = 0; i < this.queue.length; i += 3) {
        const [cx, cy, cz] = [this.queue[i], this.queue[i + 1], this.queue[i + 2]];
        this.update(cx, cy, cz, true);
        for (let d = 0; d < 6; d++) this.update(cx + DIR_X[d], cy + DIR_Y[d], cz + DIR_Z[d], false);
      }
    } finally {
      this.queue.length = 0;
      this.running = false;
    }
  }

  /**
   * One block reacting to what is around it. A block that was just put there (`placed`) doesn't check its
   * support, as in Minecraft: whoever put it there did, and a door's lower half goes in before its upper.
   */
  private update(x: number, y: number, z: number, placed: boolean): void {
    const w = this.world;
    const state = w.get(x, y, z);
    if (state === Block.Air) return;
    const shape = SHAPE[state];
    if (FLUID[state] !== 0) {
      this.ticks.schedule(x, y, z, STATE_BLOCK[state], delayOf(state));
      return;
    }
    if (!placed && !supported(w, x, y, z, state)) {
      w.set(x, y, z, Block.Air);
      return;
    }
    const block = STATE_BLOCK[state];
    if (block === Block.Sand || block === Block.Gravel) {
      if (canFallInto(w.get(x, y - 1, z))) this.ticks.schedule(x, y, z, block, delayOf(state));
      return;
    }
    let next = state;
    if (shape === "fence" || shape === "pane" || shape === "wall") {
      const values: Record<string, string> = {};
      SIDES.forEach((d, i) => {
        values[SIDE_NAMES[i]] = String(connectsTo(block, w.get(x + DIR_X[d], y, z + DIR_Z[d]), d));
      });
      next = withProperties(state, values);
    } else if (shape === "stairs") {
      next = withProperties(state, { shape: stairShape(w, x, y, z, state) });
    }
    if (next !== state) w.set(x, y, z, next);
  }
}

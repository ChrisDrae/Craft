import { Block, DIR_X, DIR_Y, DIR_Z, Dir, FACING_DIR, FLUID, LEFT_OF, OPAQUE, RIGHT_OF, SHAPE, STATE_BLOCK, propertyOf, stateOf, withProperties } from "./blocks.js";
import { canFallInto, delayOf, isSource } from "./fluids.js";
import { STURDY, SUPPORT } from "./shapes.js";
import { Redstone, isRedstone } from "./redstone.js";
import type { WorldTicks } from "./ticks.js";
import type { VoxelWorld } from "./world.js";

/** Horizontal directions in the order of the connection properties: north, east, south, west. */
const SIDES = [Dir.NegZ, Dir.PosX, Dir.PosZ, Dir.NegX];
const SIDE_NAMES = ["north", "east", "south", "west"];
/** A facing turned a quarter counterclockwise (seen from above) and clockwise. */
const LEFT: Readonly<Record<string, string>> = { north: "west", west: "south", south: "east", east: "north" };
const RIGHT: Readonly<Record<string, string>> = { north: "east", east: "south", south: "west", west: "north" };

/** Whether a block's side (in direction d from it) is a full solid face that things can attach to. */
export function sturdy(state: number, d: number): boolean {
  return STURDY[state * 6 + d] === 1;
}

const isSoil = (block: number): boolean => block === Block.Grass || block === Block.Dirt;

/**
 * Whether a block can stand on the block below it, for plants and the lower halves of doors and tall
 * plants: flowers and grass on grass or dirt, dead bushes on sand too, sugar cane on sugar cane or on
 * ground by water, mushrooms and doors on a solid floor.
 */
export function standsOn(world: VoxelWorld, x: number, y: number, z: number, state: number): boolean {
  const below = world.get(x, y - 1, z);
  const b = STATE_BLOCK[below];
  switch (STATE_BLOCK[state]) {
    case Block.DeadBush:
      return isSoil(b) || b === Block.Sand;
    case Block.BrownMushroom:
    case Block.RedMushroom:
      return sturdy(below, Dir.Up);
    case Block.SugarCane: {
      if (b === Block.SugarCane) return true;
      if (!isSoil(b) && b !== Block.Sand) return false;
      for (const d of [0, 1, 4, 5]) if (FLUID[world.get(x + DIR_X[d], y - 1, z + DIR_Z[d])] === 1) return true;
      return false;
    }
  }
  return SHAPE[state] === "door" ? sturdy(below, Dir.Up) : isSoil(b);
}

/**
 * Whether the block at (x, y, z) in `state` is held up by what it rests or hangs on (see SUPPORT):
 * plants by the ground they grow on (standsOn), cactus by sand or cactus, lily pads by still water, the
 * lower half of a door or tall plant by its ground and its upper half, the upper half by the lower one,
 * each half of a bed by the other, everything else by a solid face.
 */
export function supported(world: VoxelWorld, x: number, y: number, z: number, state: number): boolean {
  const d = SUPPORT[state];
  if (d < 0) return true;
  const n = world.get(x + DIR_X[d], y + DIR_Y[d], z + DIR_Z[d]);
  const nb = STATE_BLOCK[n];
  switch (SHAPE[state]) {
    case "cross":
      return standsOn(world, x, y, z, state);
    case "cactus":
      return nb === Block.Sand || nb === Block.Cactus;
    case "carpet":
      return n !== Block.Air && FLUID[n] === 0;
    case "lilypad":
      return (FLUID[n] === 1 && isSource(n)) || nb === Block.Ice;
    case "crop":
    case "stem":
      return nb === Block.Farmland;
    case "vine": {
      // On a solid wall, or hanging from the vine above
      const above = world.get(x, y + 1, z);
      return sturdy(n, d ^ 1) || (STATE_BLOCK[above] === Block.Vine && propertyOf(above, "facing") === propertyOf(state, "facing"));
    }
    case "bed":
      return nb === STATE_BLOCK[state] && propertyOf(n, "part") !== propertyOf(state, "part") && propertyOf(n, "facing") === propertyOf(state, "facing");
    case "door":
    case "tall": {
      const own = STATE_BLOCK[state];
      if (propertyOf(state, "half") === "upper") return nb === own && propertyOf(n, "half") === "lower";
      const above = world.get(x, y + 1, z);
      return standsOn(world, x, y, z, state) && STATE_BLOCK[above] === own && propertyOf(above, "half") === "upper";
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
 * Whether a chest pairs with the one beside it into a double chest: two chests side by side facing the same
 * way, neither paired with another. The one on the left (seen from the front) is the left half.
 */
function chestType(world: VoxelWorld, x: number, y: number, z: number, state: number): string {
  const facing = propertyOf(state, "facing");
  const partner = (side: string, theirs: string): boolean => {
    const d = FACING_DIR[side];
    const s = world.get(x + DIR_X[d], y, z + DIR_Z[d]);
    if (STATE_BLOCK[s] !== Block.Chest || propertyOf(s, "facing") !== facing) return false;
    const type = propertyOf(s, "type");
    return type === "single" || type === theirs;
  };
  // A pair stays together while both halves are there; a single chest pairs with the first one free
  const current = propertyOf(state, "type");
  if (current === "left" && partner(RIGHT_OF[facing], "right")) return "left";
  if (current === "right" && partner(LEFT_OF[facing], "left")) return "right";
  if (partner(RIGHT_OF[facing], "right")) return "left";
  if (partner(LEFT_OF[facing], "left")) return "right";
  return "single";
}

/**
 * Block updates: whenever a block changes, it and its six neighbors react, as in Minecraft. Fences, panes
 * and walls connect to what is around them, stairs take their corner shapes, blocks that lose their
 * support come off, and fluids and blocks that fall are scheduled to move. Changes made here cause updates
 * of their own; they are queued and handled in order.
 */
export class BlockUpdates {
  /** Redstone's reactions and delays (its pressure plates need to know who stands on them). */
  readonly redstone: Redstone;
  private readonly world: VoxelWorld;
  private readonly ticks: WorldTicks;
  private readonly queue: number[] = [];
  private running: boolean = false;

  constructor(world: VoxelWorld, ticks: WorldTicks) {
    this.world = world;
    this.ticks = ticks;
    this.redstone = new Redstone(world, ticks);
    for (const [block, behavior] of this.redstone.behaviors()) ticks.behave(block, behavior);
  }

  /** The block at (x, y, z) changed from `old` (VoxelWorld.onChanged). */
  changed(x: number, y: number, z: number, old: number = -1): void {
    this.queue.push(x, y, z, old);
    if (this.running) return;
    this.running = true;
    try {
      // Each change updates the block itself and its neighbors; changes made meanwhile join the queue.
      // Redstone reaches further: what a lever or dust powers is a block away, and that block's neighbors
      // feel it, so they are updated too
      for (let i = 0; i < this.queue.length; i += 4) {
        const [cx, cy, cz, was] = [this.queue[i], this.queue[i + 1], this.queue[i + 2], this.queue[i + 3]];
        if (was !== this.world.get(cx, cy, cz)) this.redstone.observe(cx, cy, cz);
        this.update(cx, cy, cz, true);
        for (let d = 0; d < 6; d++) this.update(cx + DIR_X[d], cy + DIR_Y[d], cz + DIR_Z[d], false);
        if ((was >= 0 && isRedstone(was)) || isRedstone(this.world.get(cx, cy, cz))) {
          for (let d = 0; d < 6; d++) {
            for (let e = 0; e < 6; e++) if ((e ^ 1) !== d) this.update(cx + DIR_X[d] + DIR_X[e], cy + DIR_Y[d] + DIR_Y[e], cz + DIR_Z[d] + DIR_Z[e], false);
          }
        }
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
    } else if (block === Block.Chest) {
      next = withProperties(state, { type: chestType(w, x, y, z, state) });
    } else if (block === Block.Grass) {
      const above = STATE_BLOCK[w.get(x, y + 1, z)];
      next = withProperties(state, { snowy: String(above === Block.Snow || above === Block.SnowBlock) });
    } else if (block === Block.Farmland && OPAQUE[w.get(x, y + 1, z)]) {
      // Packed down under a block
      next = Block.Dirt;
    } else if (block === Block.AttachedPumpkinStem || block === Block.AttachedMelonStem) {
      // Its fruit was taken: it stands up again, grown
      const d = FACING_DIR[propertyOf(state, "facing")];
      const fruit = STATE_BLOCK[w.get(x + DIR_X[d], y, z + DIR_Z[d])];
      if (fruit !== (block === Block.AttachedPumpkinStem ? Block.Pumpkin : Block.Melon)) next = stateOf(block === Block.AttachedPumpkinStem ? Block.PumpkinStem : Block.MelonStem, { age: "7" });
    }
    if (next !== state) {
      w.set(x, y, z, next);
      return;
    }
    this.redstone.update(x, y, z, state);
  }
}

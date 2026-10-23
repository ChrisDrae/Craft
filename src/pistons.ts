import { BLOCKS, Block, DIR_X, DIR_Y, DIR_Z, DIR_FACING, FACING6_DIR, FLUID, SHAPE, STATE_BLOCK, propertyOf, stateOf, withProperties, type Shape } from "./blocks.js";
import { entityFor, type BlockEntity, type MovingEntity } from "./blockEntities.js";
import { CHUNK_SIZE, WORLD_HEIGHT, type Chunk } from "./chunk.js";

/** What pistons need of the world (VoxelWorld). */
export interface PistonWorld {
  readonly chunks: ReadonlyMap<number, Chunk>;
  get(x: number, y: number, z: number): number;
  set(x: number, y: number, z: number, state: number): boolean;
  blockEntity(x: number, y: number, z: number): BlockEntity | null;
  isLoaded(x: number, z: number): boolean;
}

/** How many blocks a piston pushes at most, and how many game ticks a move takes (Minecraft's). */
export const PUSH_LIMIT = 12;
export const MOVE_TICKS = 2;

/** A block that started moving: where it goes, what it is, the way it goes (Dir), and whether it is a head. */
export interface Move {
  x: number;
  y: number;
  z: number;
  state: number;
  dir: number;
  /** Out of a piston (pushed, or its head going out) rather than back toward it. */
  extending: boolean;
  /** The piston's head. */
  head: boolean;
}

/** Shapes a piston breaks rather than pushes, as Minecraft's: plants, torches, redstone's parts, doors and beds. */
const FRAGILE: ReadonlySet<Shape> = new Set<Shape>(["cross", "torch", "tall", "vine", "ladder", "crop", "stem", "wire", "lever", "button", "plate", "repeater", "comparator", "door", "bed", "lilypad", "snow", "cactus", "carpet"]);

/**
 * How a block takes a piston's push: nothing there (air, fluids: the line ends), broken (fragile things,
 * pumpkins and melons, what is replaceable), pushed, or in the way (unbreakable blocks, obsidian, what holds
 * things, pistons pushed out, moving blocks).
 */
export function reaction(state: number): "empty" | "destroy" | "push" | "block" {
  if (state === Block.Air || FLUID[state] !== 0) return "empty";
  const b = STATE_BLOCK[state];
  const info = BLOCKS[b];
  if (!info.breakable || b === Block.Obsidian || b === Block.Spawner || b === Block.PistonHead || b === Block.MovingPiston) return "block";
  if ((b === Block.Piston || b === Block.StickyPiston) && propertyOf(state, "extended") === "true") return "block";
  if (entityFor(b) !== null) return "block";
  if (info.replaceable || FRAGILE.has(SHAPE[state]) || b === Block.Pumpkin || b === Block.Melon) return "destroy";
  return "push";
}

/**
 * The blocks a piston at (x, y, z) pushing toward d moves (nearest first) and the one it breaks at the end
 * of the line, or null if it can't push: more than PUSH_LIMIT blocks, something in the way, the edge of
 * the world or of what is loaded.
 */
export function pushLine(w: PistonWorld, x: number, y: number, z: number, d: number): { moved: Array<[number, number, number]>; broken: [number, number, number] | null } | null {
  const moved: Array<[number, number, number]> = [];
  let [px, py, pz] = [x + DIR_X[d], y + DIR_Y[d], z + DIR_Z[d]];
  for (;;) {
    if (py < 0 || py >= WORLD_HEIGHT || !w.isLoaded(px, pz)) return null;
    const r = reaction(w.get(px, py, pz));
    if (r === "empty") return { moved, broken: null };
    if (r === "destroy") return { moved, broken: [px, py, pz] };
    if (r === "block" || moved.length === PUSH_LIMIT) return null;
    moved.push([px, py, pz]);
    [px, py, pz] = [px + DIR_X[d], py + DIR_Y[d], pz + DIR_Z[d]];
  }
}

const isPiston = (b: number): boolean => b === Block.Piston || b === Block.StickyPiston;

/**
 * Pistons, as Minecraft's: powered from any side but their front, they push the line of blocks ahead
 * (PUSH_LIMIT at most), breaking what is fragile at its end, and put their head out; unpowered, they take
 * it back, and a sticky one pulls the block in front back with it. Moves take MOVE_TICKS: meanwhile the
 * blocks are moving blocks (Block.MovingPiston, with a MovingEntity saying what they will be), carrying
 * what is in their way along. A piston losing power before its move is done finishes it at once.
 */
export class Pistons {
  /** A block a push breaks, before it goes (its drops). */
  onBreak: ((x: number, y: number, z: number, state: number) => void) | null = null;
  /** Blocks that started moving (to draw them, and for the sound). */
  onMove: ((moves: Move[]) => void) | null = null;
  /** A moving block's box this tick, and how far it moved: what is in it is carried along. */
  onCarry: ((box: readonly [number, number, number, number, number, number], dx: number, dy: number, dz: number) => void) | null = null;

  constructor(
    private readonly world: PistonWorld,
    /** The power reaching a block from one side (Dir), see redstone.ts. */
    private readonly powerFrom: (x: number, y: number, z: number, d: number) => number,
    /** The game tick now (WorldTicks.time). */
    private readonly time: () => number,
  ) {}

  /** Whether a piston is powered: from any side but the one it faces. */
  powered(x: number, y: number, z: number, facing: number): boolean {
    for (let d = 0; d < 6; d++) if (d !== facing && this.powerFrom(x, y, z, d) > 0) return true;
    return false;
  }

  /** A piston, or a piston's head, reacting to what is around it (Redstone.update). */
  update(x: number, y: number, z: number, state: number): void {
    const w = this.world;
    const d = FACING6_DIR[propertyOf(state, "facing")];
    const front = w.get(x + DIR_X[d], y + DIR_Y[d], z + DIR_Z[d]);
    if (STATE_BLOCK[state] === Block.PistonHead) {
      // A head without its piston behind it goes
      const base = w.get(x - DIR_X[d], y - DIR_Y[d], z - DIR_Z[d]);
      if (!isPiston(STATE_BLOCK[base]) || propertyOf(base, "extended") !== "true" || FACING6_DIR[propertyOf(base, "facing")] !== d) w.set(x, y, z, Block.Air);
      return;
    }
    const extended = propertyOf(state, "extended") === "true";
    const powered = this.powered(x, y, z, d);
    if (powered && !extended) this.extend(x, y, z, state, d);
    else if (!powered && extended) this.retract(x, y, z, state, d);
    // Its head gone (broken, blown up): the piston goes too
    else if (extended && STATE_BLOCK[front] !== Block.PistonHead && STATE_BLOCK[front] !== Block.MovingPiston) w.set(x, y, z, Block.Air);
  }

  private extend(x: number, y: number, z: number, state: number, d: number): void {
    const w = this.world;
    const line = pushLine(w, x, y, z, d);
    if (!line) return;
    if (line.broken) {
      const [bx, by, bz] = line.broken;
      this.onBreak?.(bx, by, bz, w.get(bx, by, bz));
      w.set(bx, by, bz, Block.Air);
    }
    const moves: Move[] = [];
    // The farthest first, each a cell on; the piston's head goes into the first
    for (let i = line.moved.length - 1; i >= 0; i--) {
      const [bx, by, bz] = line.moved[i];
      moves.push(this.start(bx + DIR_X[d], by + DIR_Y[d], bz + DIR_Z[d], w.get(bx, by, bz), d, true, false));
    }
    w.set(x, y, z, withProperties(state, { extended: "true" }));
    const head = stateOf(Block.PistonHead, { facing: DIR_FACING[d], type: STATE_BLOCK[state] === Block.StickyPiston ? "sticky" : "normal" });
    moves.push(this.start(x + DIR_X[d], y + DIR_Y[d], z + DIR_Z[d], head, d, true, true));
    this.onMove?.(moves);
  }

  private retract(x: number, y: number, z: number, state: number, d: number): void {
    const w = this.world;
    const [fx, fy, fz] = [x + DIR_X[d], y + DIR_Y[d], z + DIR_Z[d]];
    // Still on its way out: there at once
    if (STATE_BLOCK[w.get(fx, fy, fz)] === Block.MovingPiston) this.finishLine(x, y, z, d);
    w.set(x, y, z, withProperties(state, { extended: "false" }));
    const head = w.get(fx, fy, fz);
    if (STATE_BLOCK[head] !== Block.PistonHead) return;
    const [ax, ay, az] = [fx + DIR_X[d], fy + DIR_Y[d], fz + DIR_Z[d]];
    const pulled = STATE_BLOCK[state] === Block.StickyPiston && ay >= 0 && ay < WORLD_HEIGHT && w.isLoaded(ax, az) ? w.get(ax, ay, az) : Block.Air;
    let move: Move;
    if (reaction(pulled) === "push") {
      w.set(ax, ay, az, Block.Air);
      move = this.start(fx, fy, fz, pulled, d ^ 1, false, false);
    } else {
      move = this.start(fx, fy, fz, head, d ^ 1, false, true);
    }
    this.onMove?.([move]);
  }

  /** Makes (x, y, z) a block moving there that will be `state` (a head going back in will be nothing). */
  private start(x: number, y: number, z: number, state: number, dir: number, extending: boolean, head: boolean): Move {
    this.world.set(x, y, z, Block.MovingPiston);
    const e = this.world.blockEntity(x, y, z) as MovingEntity | null;
    if (e) Object.assign(e, { state, dir, progress: 0, extending, head, since: this.time() });
    return { x, y, z, state, dir, extending, head };
  }

  /** Every block of a piston's push still moving gets there at once. */
  private finishLine(x: number, y: number, z: number, d: number): void {
    for (let k = 1; k <= PUSH_LIMIT + 1; k++) {
      const [px, py, pz] = [x + DIR_X[d] * k, y + DIR_Y[d] * k, z + DIR_Z[d] * k];
      if (STATE_BLOCK[this.world.get(px, py, pz)] !== Block.MovingPiston) return;
      const e = this.world.blockEntity(px, py, pz);
      if (e?.kind === "moving" && e.dir === d && e.extending) this.finish(px, py, pz, e);
    }
  }

  /** A moving block arrives: it becomes what it was moving as (a head gone back in becomes nothing). */
  private finish(x: number, y: number, z: number, e: MovingEntity): void {
    this.world.set(x, y, z, e.head && !e.extending ? Block.Air : e.state);
  }

  /** A game tick of every moving block: on a step, carrying what is in its way; there after MOVE_TICKS. */
  tick(): void {
    const arriving: Array<[number, number, number, MovingEntity]> = [];
    for (const chunk of this.world.chunks.values()) {
      if (chunk.entities.size === 0) continue;
      for (const [key, e] of chunk.entities) {
        if (e.kind !== "moving") continue;
        // Moves started this tick go from the next
        if (e.since === this.time()) continue;
        const x = chunk.cx * CHUNK_SIZE + (key & 15);
        const y = key >> 8;
        const z = chunk.cz * CHUNK_SIZE + ((key >> 4) & 15);
        const step = 1 / MOVE_TICKS;
        e.progress = Math.min(1, e.progress + step);
        chunk.unsaved = true;
        if (this.onCarry) {
          const back = 1 - e.progress;
          const [ox, oy, oz] = [x - DIR_X[e.dir] * back, y - DIR_Y[e.dir] * back, z - DIR_Z[e.dir] * back];
          this.onCarry([ox, oy, oz, ox + 1, oy + 1, oz + 1], DIR_X[e.dir] * step, DIR_Y[e.dir] * step, DIR_Z[e.dir] * step);
        }
        if (e.progress >= 1) arriving.push([x, y, z, e]);
      }
    }
    for (const [x, y, z, e] of arriving) if (this.world.blockEntity(x, y, z) === e) this.finish(x, y, z, e);
  }
}

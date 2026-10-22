import { Random, SimObject } from "projector";
import { STATE_BLOCK, type Block } from "./blocks.js";
import { CHUNK_SIZE, SECTIONS, SECTION_VOLUME } from "./chunk.js";
import type { VoxelWorld } from "./world.js";

/** Game ticks per second, as in Minecraft. */
export const TICKS_PER_SECOND = 20;
/** Random ticks per section and game tick (Minecraft's randomTickSpeed): about one per block in 68 s. */
export const RANDOM_TICKS = 3;
/** Ticks run per frame at most, so a long stall doesn't make the next frames catch up for seconds. */
const MAX_TICKS_PER_FRAME = 10;

/** What a block does when it's ticked. */
export interface TickBehavior {
  /** A tick the block asked for with schedule() (water flowing, sand falling). */
  scheduled?(world: VoxelWorld, x: number, y: number, z: number, state: number, ticks: WorldTicks): void;
  /** A tick that comes at random (growth, spreading, decay). */
  random?(world: VoxelWorld, x: number, y: number, z: number, state: number, ticks: WorldTicks): void;
}

/** A tick a block asked for: at `due`, if the block there is still a `block`. */
export interface ScheduledTick {
  x: number;
  y: number;
  z: number;
  block: Block;
  due: number;
}

interface Entry extends ScheduledTick {
  /** Scheduled earlier ticks run first among those due at the same time. */
  order: number;
}

function positionKey(x: number, y: number, z: number): number {
  return ((x + 1048576) * 2097152 + (z + 1048576)) * 256 + y;
}

/**
 * The world's clock: Minecraft's 20 game ticks per second on top of the frames. Each tick runs the
 * scheduled block ticks that are due, in the order they were scheduled, then random ticks in every
 * section with blocks. Deterministic for a seed, and steppable with tick() without a simulation.
 */
export class WorldTicks extends SimObject {
  /** Ticks since the world began. */
  time: number = 0;
  /** Called at the end of every tick (furnaces burn then). */
  onTick: (() => void) | null = null;
  private readonly world: VoxelWorld;
  private readonly behaviors: ReadonlyMap<Block, TickBehavior>;
  private readonly randomTicked: boolean;
  private readonly random: Random;
  /** Min-heap by (due, order). */
  private readonly queue: Entry[] = [];
  private readonly pending: Set<number> = new Set();
  private order: number = 0;
  private elapsed: number = 0;

  constructor(world: VoxelWorld, behaviors: ReadonlyMap<Block, TickBehavior> = new Map(), seed: number | string = "ticks") {
    super();
    this.world = world;
    this.behaviors = behaviors;
    this.randomTicked = [...behaviors.values()].some((b) => b.random);
    this.random = new Random(seed);
  }

  /** How far the clock is into the next tick (0-1), for smooth motion between ticks. */
  get partial(): number {
    return Math.min(1, this.elapsed * TICKS_PER_SECOND);
  }

  /** Scheduled ticks waiting to run. */
  get scheduledCount(): number {
    return this.queue.length;
  }

  /**
   * Asks for a scheduled tick of the block at (x, y, z) in `delay` ticks. A block that already has one
   * waiting gets no second.
   */
  schedule(x: number, y: number, z: number, block: Block, delay: number): void {
    const key = positionKey(x, y, z);
    if (this.pending.has(key)) return;
    this.pending.add(key);
    this.push({ x, y, z, block, due: this.time + Math.max(1, delay), order: this.order++ });
  }

  /** The scheduled ticks waiting in a chunk, left in place (for saving a loaded chunk). */
  inChunk(cx: number, cz: number): ScheduledTick[] {
    return this.queue
      .filter((e) => e.x >> 4 === cx && e.z >> 4 === cz)
      .sort((a, b) => (this.before(a, b) ? -1 : 1))
      .map((e) => ({ x: e.x, y: e.y, z: e.z, block: e.block, due: e.due }));
  }

  /** Puts back scheduled ticks that were saved (or unloaded) with their chunk, in their order. */
  restore(ticks: readonly ScheduledTick[]): void {
    for (const t of ticks) {
      const key = positionKey(t.x, t.y, t.z);
      if (this.pending.has(key)) continue;
      this.pending.add(key);
      this.push({ x: t.x, y: t.y, z: t.z, block: t.block, due: t.due, order: this.order++ });
    }
  }

  /** Takes out the scheduled ticks of a chunk that is being unloaded (to be saved with it), in their order. */
  takeChunk(cx: number, cz: number): ScheduledTick[] {
    const taken = this.inChunk(cx, cz);
    if (taken.length === 0) return taken;
    const kept = this.queue.filter((e) => e.x >> 4 !== cx || e.z >> 4 !== cz);
    for (const t of taken) this.pending.delete(positionKey(t.x, t.y, t.z));
    this.queue.length = 0;
    for (const e of kept) this.push(e);
    return taken;
  }

  override update(dt: number): void {
    this.elapsed += dt;
    let ran = 0;
    while (this.elapsed >= 1 / TICKS_PER_SECOND && ran < MAX_TICKS_PER_FRAME) {
      this.elapsed -= 1 / TICKS_PER_SECOND;
      this.tick();
      ran++;
    }
    if (ran === MAX_TICKS_PER_FRAME) this.elapsed = 0;
  }

  /** One game tick. */
  tick(): void {
    this.time++;
    const w = this.world;
    // Ticks scheduled while these run are due later, so this ends
    while (this.queue.length > 0 && this.queue[0].due <= this.time) {
      const e = this.pop();
      this.pending.delete(positionKey(e.x, e.y, e.z));
      const state = w.get(e.x, e.y, e.z);
      if (STATE_BLOCK[state] !== e.block) continue;
      this.behaviors.get(e.block)?.scheduled?.(w, e.x, e.y, e.z, state, this);
    }
    if (this.randomTicked) this.randomTicks();
    this.onTick?.();
  }

  private randomTicks(): void {
    const w = this.world;
    const rnd = this.random;
    for (const chunk of w.chunks.values()) {
      for (let s = 0; s < SECTIONS; s++) {
        const section = chunk.sections[s];
        for (let k = 0; k < RANDOM_TICKS; k++) {
          // Picked even in sections without blocks, so the random sequence doesn't depend on them
          const i = Math.floor(rnd.next() * SECTION_VOLUME);
          const blocks = section.blocks;
          if (!blocks) continue;
          const state = blocks[i];
          const random = this.behaviors.get(STATE_BLOCK[state] as Block)?.random;
          if (!random) continue;
          const x = chunk.cx * CHUNK_SIZE + (i & 15);
          const y = s * CHUNK_SIZE + (i >> 8);
          const z = chunk.cz * CHUNK_SIZE + ((i >> 4) & 15);
          random(w, x, y, z, state, this);
        }
      }
    }
  }

  private before(a: Entry, b: Entry): boolean {
    return a.due < b.due || (a.due === b.due && a.order < b.order);
  }

  private push(e: Entry): void {
    const q = this.queue;
    q.push(e);
    let i = q.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(q[i], q[parent])) break;
      [q[i], q[parent]] = [q[parent], q[i]];
      i = parent;
    }
  }

  private pop(): Entry {
    const q = this.queue;
    const top = q[0];
    const last = q.pop()!;
    if (q.length > 0) {
      q[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < q.length && this.before(q[l], q[m])) m = l;
        if (r < q.length && this.before(q[r], q[m])) m = r;
        if (m === i) break;
        [q[i], q[m]] = [q[m], q[i]];
        i = m;
      }
    }
    return top;
  }
}

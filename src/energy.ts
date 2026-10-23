import { Block, DIR_X, DIR_Y, DIR_Z, STATE_BLOCK } from "./blocks.js";
import type { BlockEntity, MachineEntity } from "./blockEntities.js";
import { CHUNK_SIZE, WORLD_HEIGHT } from "./chunk.js";
import { MACHINES, sendsOn, takesOn } from "./machines.js";

/** Cables: the tier they carry at most, EU lost each block, and whether bare (it shocks what touches it while it carries). */
export interface CableSpec {
  tier: number;
  loss: number;
  bare: boolean;
}

/** Numbers after IndustrialCraft 2's: tin carries low voltage with next to no loss; copper medium, bare copper losing more. */
export const CABLES: ReadonlyMap<number, CableSpec> = new Map([
  [Block.TinCable, { tier: 1, loss: 0.025, bare: false }],
  [Block.CopperCable, { tier: 2, loss: 0.3, bare: true }],
  [Block.InsulatedCopperCable, { tier: 2, loss: 0.2, bare: false }],
]);

export const isCable = (state: number): boolean => CABLES.has(STATE_BLOCK[state]);
/** Whether a block takes part in energy: a cable or a machine. */
export const isEnergyBlock = (state: number): boolean => CABLES.has(STATE_BLOCK[state]) || MACHINES.has(STATE_BLOCK[state]);

/** A block position as one number (x and z within a million blocks of the middle). */
export const posKey = (x: number, y: number, z: number): number => ((x + 1048576) * 2097152 + (z + 1048576)) * 256 + y;

/** What the energy net needs of the world (VoxelWorld). */
export interface EnergyWorld {
  readonly chunks: ReadonlyMap<number, { cx: number; cz: number; entities: ReadonlyMap<number, BlockEntity>; unsaved: boolean }>;
  get(x: number, y: number, z: number): number;
  set(x: number, y: number, z: number, state: number): boolean;
  blockEntity(x: number, y: number, z: number): BlockEntity | null;
  isLoaded(x: number, z: number): boolean;
}

/** A way from a source to a machine that takes energy: where it ends, what it loses, the weakest cable on it. */
export interface Route {
  x: number;
  y: number;
  z: number;
  /** EU lost on the way (the cables' losses added up). */
  loss: number;
  /** The lowest tier of the cables on the way (Infinity with none), and where that cable is. */
  tier: number;
  weakest: [number, number, number] | null;
  /** The cables on the way, by posKey. */
  cables: number[];
}

/**
 * Energy moving between machines, as IndustrialCraft's: every tick each generator and store sends out up
 * to its output, to the machines it reaches through cables (or touches), the nearest first (by what the
 * cables lose), each getting what it has room for less the loss on the way. Energy of a tier higher than
 * a machine takes blows the machine up; higher than a cable carries burns the cable. The ways are found
 * once (shortest by loss) and again only when a cable or machine changes, or chunks come or go.
 */
export class EnergyNet {
  /** A machine fed above its tier blows up (it is gone already); a cable burnt through (gone too). */
  onExplode: ((x: number, y: number, z: number) => void) | null = null;
  onBurn: ((x: number, y: number, z: number) => void) | null = null;
  /** EU each cable carried in the last tick, by posKey: what an EU meter reads, and what makes bare cable shock. */
  readonly flow: Map<number, number> = new Map();
  private version = 0;
  private chunkCount = -1;
  private readonly routes: Map<number, { version: number; list: Route[] }> = new Map();

  constructor(private readonly world: EnergyWorld) {}

  /** A cable or machine changed: the ways are found again. */
  changed(): void {
    this.version++;
  }

  /** The ways from a source at (x, y, z) to the machines taking energy, least loss first. */
  routesFrom(x: number, y: number, z: number): Route[] {
    const key = posKey(x, y, z);
    const cached = this.routes.get(key);
    if (cached && cached.version === this.version) return cached.list;
    const list = this.find(x, y, z);
    this.routes.set(key, { version: this.version, list });
    return list;
  }

  /** Searches out from a source's sending sides through cables, the least loss first (Dijkstra). */
  private find(x: number, y: number, z: number): Route[] {
    const w = this.world;
    const source = w.get(x, y, z);
    interface Step {
      x: number;
      y: number;
      z: number;
      loss: number;
      tier: number;
      weakest: [number, number, number] | null;
      cables: number[];
    }
    const best = new Map<number, number>();
    const found = new Map<number, Route>();
    const open: Step[] = [];
    const reach = (from: Step, d: number): void => {
      const [nx, ny, nz] = [from.x + DIR_X[d], from.y + DIR_Y[d], from.z + DIR_Z[d]];
      if (ny < 0 || ny >= WORLD_HEIGHT || !w.isLoaded(nx, nz) || (nx === x && ny === y && nz === z)) return;
      const s = w.get(nx, ny, nz);
      const k = posKey(nx, ny, nz);
      const cable = CABLES.get(STATE_BLOCK[s]);
      if (cable) {
        const loss = from.loss + cable.loss;
        if ((best.get(k) ?? Infinity) <= loss) return;
        best.set(k, loss);
        const weaker = cable.tier < from.tier;
        open.push({ x: nx, y: ny, z: nz, loss, tier: weaker ? cable.tier : from.tier, weakest: weaker ? [nx, ny, nz] : from.weakest, cables: [...from.cables, k] });
      } else if (MACHINES.has(STATE_BLOCK[s]) && takesOn(s, d ^ 1)) {
        const r = found.get(k);
        if (!r || r.loss > from.loss) found.set(k, { x: nx, y: ny, z: nz, loss: from.loss, tier: from.tier, weakest: from.weakest, cables: from.cables });
      }
    };
    const start: Step = { x, y, z, loss: 0, tier: Infinity, weakest: null, cables: [] };
    for (let d = 0; d < 6; d++) if (sendsOn(source, d)) reach(start, d);
    while (open.length > 0) {
      let i = 0;
      for (let j = 1; j < open.length; j++) if (open[j].loss < open[i].loss) i = j;
      const step = open.splice(i, 1)[0];
      if ((best.get(posKey(step.x, step.y, step.z)) ?? Infinity) < step.loss) continue;
      for (let d = 0; d < 6; d++) reach(step, d);
    }
    return [...found.values()].sort((a, b) => a.loss - b.loss);
  }

  /** One game tick: every source sends out what it can (see the class). */
  tick(): void {
    const w = this.world;
    if (w.chunks.size !== this.chunkCount) {
      this.chunkCount = w.chunks.size;
      this.changed();
    }
    this.flow.clear();
    const sources: Array<[number, number, number, MachineEntity]> = [];
    for (const chunk of w.chunks.values()) {
      if (chunk.entities.size === 0) continue;
      for (const [key, e] of chunk.entities) {
        if (e.kind !== "machine" || e.energy <= 0 || (MACHINES.get(e.block)?.output ?? 0) === 0) continue;
        sources.push([chunk.cx * CHUNK_SIZE + (key & 15), key >> 8, chunk.cz * CHUNK_SIZE + ((key >> 4) & 15), e]);
      }
    }
    for (const [x, y, z, e] of sources) {
      const spec = MACHINES.get(e.block)!;
      if (w.blockEntity(x, y, z) !== e) continue;
      let budget = Math.min(e.energy, spec.output);
      const offered = budget;
      for (const r of this.routesFrom(x, y, z)) {
        if (budget <= r.loss) break;
        const sink = w.blockEntity(r.x, r.y, r.z);
        if (!sink || sink.kind !== "machine") continue;
        const sinkSpec = MACHINES.get(sink.block)!;
        const room = sinkSpec.capacity - sink.energy;
        if (room <= 0) continue;
        // Too much for a cable on the way: the weakest burns; for the machine: it blows up
        if (spec.tier > r.tier && r.weakest) {
          w.set(r.weakest[0], r.weakest[1], r.weakest[2], Block.Air);
          this.onBurn?.(r.weakest[0], r.weakest[1], r.weakest[2]);
          break;
        }
        if (spec.tier > sinkSpec.tier) {
          w.set(r.x, r.y, r.z, Block.Air);
          this.onExplode?.(r.x, r.y, r.z);
          break;
        }
        const give = Math.min(room, budget - r.loss);
        sink.energy += give;
        budget -= give + r.loss;
        for (const c of r.cables) this.flow.set(c, (this.flow.get(c) ?? 0) + give);
      }
      e.energy -= offered - budget;
    }
  }
}

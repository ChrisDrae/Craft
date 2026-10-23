import { BLOCKS, Block, DIR_X, DIR_Z, FLUID, OPAQUE, STATE_BLOCK, propertyOf, stateOf, withProperties } from "./blocks.js";
import { WORLD_HEIGHT } from "./chunk.js";
import { isFalling, fluidLevel } from "./fluids.js";
import { growTree } from "./gen/features.js";
import type { BlockWriter } from "./gen/writer.js";
import type { ItemStack } from "./items.js";
import { dropsOf } from "./mining.js";
import { STURDY } from "./shapes.js";
import type { TickBehavior } from "./ticks.js";
import { precipitationAt, rainsOn, type Weather } from "./weather.js";
import type { VoxelWorld } from "./world.js";

/** What growing needs beyond the world: the weather (for wet farmland), where drops go (decayed leaves), chance. */
export interface GrowthOptions {
  weather?: () => Weather | null;
  drop?: (x: number, y: number, z: number, stacks: ItemStack[]) => void;
  random?: () => number;
}

/** The light at a block, sky or block light (Minecraft's raw brightness, the time of day aside). */
function lightAt(w: VoxelWorld, x: number, y: number, z: number): number {
  const l = w.getLight(x, y, z);
  return Math.max(l >> 4, l & 15);
}

const LOGS: ReadonlySet<number> = new Set(BLOCKS.filter((b) => b.name.endsWith("_log")).map((b) => b.id));

/** The world as a place to write a tree: only where it is loaded. */
class WorldWriter implements BlockWriter {
  constructor(private readonly world: VoxelWorld) {}
  get(x: number, y: number, z: number): number {
    return y >= 0 && y < WORLD_HEIGHT && this.world.isLoaded(x, z) ? this.world.get(x, y, z) : -1;
  }
  set(x: number, y: number, z: number, state: number): void {
    if (this.get(x, y, z) >= 0) this.world.set(x, y, z, state);
  }
  fill(x: number, y: number, z: number, state: number): void {
    const there = this.get(x, y, z);
    if (there === Block.Air || (there > 0 && BLOCKS[STATE_BLOCK[there]].replaceable)) this.set(x, y, z, state);
  }
}

/** Whether a log is within six blocks of a leaf, through leaves (Minecraft's leaf distance). */
function nearLog(w: VoxelWorld, x: number, y: number, z: number): boolean {
  const seen = new Set<string>([`${x},${y},${z}`]);
  let frontier: Array<[number, number, number]> = [[x, y, z]];
  for (let d = 1; d <= 6 && frontier.length > 0; d++) {
    const next: Array<[number, number, number]> = [];
    for (const [px, py, pz] of frontier) {
      for (const [dx, dy, dz] of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]) {
        const key = `${px + dx},${py + dy},${pz + dz}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const b = STATE_BLOCK[w.get(px + dx, py + dy, pz + dz)];
        if (LOGS.has(b)) return true;
        if (BLOCKS[b].leafy) next.push([px + dx, py + dy, pz + dz]);
      }
    }
    frontier = next;
  }
  return false;
}

/**
 * How fast a crop grows (Minecraft's growth speed): from the farmland under it and around, wet farmland
 * three times as good as dry, the eight around a quarter as much.
 */
function growthSpeed(w: VoxelWorld, x: number, y: number, z: number): number {
  let f = 1;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const below = w.get(x + dx, y - 1, z + dz);
      if (STATE_BLOCK[below] !== Block.Farmland) continue;
      const g = propertyOf(below, "moisture") !== "0" ? 3 : 1;
      f += dx === 0 && dz === 0 ? g : g / 4;
    }
  }
  return f;
}

/** Whether a crop gets its growth this tick (Minecraft's 1 in 25 / speed + 1). */
const grows = (w: VoxelWorld, x: number, y: number, z: number, r: () => number): boolean => r() < 1 / (Math.floor(25 / growthSpeed(w, x, y, z)) + 1);

/** A sapling becomes a tree where there is room: an oak, now and then a big one. */
export function growSapling(w: VoxelWorld, x: number, y: number, z: number, r: () => number): boolean {
  for (let k = 1; k <= 5; k++) {
    const s = w.get(x, y + k, z);
    if (s !== Block.Air && !BLOCKS[STATE_BLOCK[s]].leafy) return false;
  }
  w.set(x, y, z, Block.Air);
  growTree(new WorldWriter(w), r() < 0.1 ? "big_oak" : "oak", x, y, z, Math.floor(r() * 4294967296));
  return true;
}

/** Whether there is water within four blocks around farmland, level with it or a block up. */
function wet(w: VoxelWorld, x: number, y: number, z: number): boolean {
  for (let dy = 0; dy <= 1; dy++) for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) if (FLUID[w.get(x + dx, y + dy, z + dz)] === 1) return true;
  return false;
}

/**
 * What grows and changes on its own, on random ticks, as Minecraft's:
 * - grass spreads to dirt in the light near it, and turns to dirt under something that keeps the light off;
 * - leaves more than six blocks from a log (through leaves) decay, unless a player put them there;
 * - saplings grow into oaks in the light; cacti and sugar cane grow up to three high;
 * - crops (wheat, carrots, potatoes) and stems grow in the light, faster on wet farmland; a grown stem puts
 *   its pumpkin or melon beside it;
 * - farmland stays wet near water or in the rain, dries out, and turns back to dirt dry and bare;
 * - ice and snow melt near a strong light.
 */
export function growthBehaviors(options: GrowthOptions = {}): Map<number, TickBehavior> {
  const r = options.random ?? Math.random;
  const weather = (): Weather | null => options.weather?.() ?? null;
  const grass: TickBehavior = {
    random(w, x, y, z) {
      const above = w.get(x, y + 1, z);
      if (OPAQUE[above] || lightAt(w, x, y + 1, z) < 4) {
        w.set(x, y, z, Block.Dirt);
        return;
      }
      if (lightAt(w, x, y + 1, z) < 9) return;
      for (let i = 0; i < 4; i++) {
        const tx = x + Math.floor(r() * 3) - 1;
        const ty = y + Math.floor(r() * 5) - 3;
        const tz = z + Math.floor(r() * 3) - 1;
        const over = w.get(tx, ty + 1, tz);
        if (w.get(tx, ty, tz) === Block.Dirt && !OPAQUE[over] && FLUID[over] === 0 && lightAt(w, tx, ty + 1, tz) >= 4) w.set(tx, ty, tz, Block.Grass);
      }
    },
  };
  const leaves: TickBehavior = {
    random(w, x, y, z, state) {
      if (propertyOf(state, "persistent") === "true" || nearLog(w, x, y, z)) return;
      options.drop?.(x, y, z, dropsOf(state, null, r));
      w.set(x, y, z, Block.Air);
    },
  };
  const sapling: TickBehavior = {
    random(w, x, y, z) {
      if (lightAt(w, x, y + 1, z) >= 9 && r() < 1 / 7) growSapling(w, x, y, z, r);
    },
  };
  const tall: TickBehavior = {
    random(w, x, y, z, state) {
      const block = STATE_BLOCK[state];
      if (w.get(x, y + 1, z) !== Block.Air || r() >= 1 / 16) return;
      let height = 1;
      while (height < 3 && STATE_BLOCK[w.get(x, y - height, z)] === block) height++;
      if (height >= 3) return;
      // A cactus doesn't grow into a block beside it
      if (block === Block.Cactus && [0, 1, 4, 5].some((d) => w.get(x + DIR_X[d], y + 1, z + DIR_Z[d]) !== Block.Air)) return;
      w.set(x, y + 1, z, block);
    },
  };
  const crop: TickBehavior = {
    random(w, x, y, z, state) {
      const age = Number(propertyOf(state, "age"));
      if (age >= 7 || lightAt(w, x, y, z) < 9 || !grows(w, x, y, z, r)) return;
      w.set(x, y, z, withProperties(state, { age: String(age + 1) }));
    },
  };
  const stem: TickBehavior = {
    random(w, x, y, z, state) {
      if (lightAt(w, x, y, z) < 9 || !grows(w, x, y, z, r)) return;
      const age = Number(propertyOf(state, "age"));
      if (age < 7) {
        w.set(x, y, z, withProperties(state, { age: String(age + 1) }));
        return;
      }
      // Grown: its fruit beside it, on ground
      const d = [0, 1, 4, 5][Math.floor(r() * 4)];
      const fx = x + DIR_X[d];
      const fz = z + DIR_Z[d];
      const ground = STATE_BLOCK[w.get(fx, y - 1, fz)];
      if (w.get(fx, y, fz) !== Block.Air || (ground !== Block.Dirt && ground !== Block.Grass && ground !== Block.Farmland)) return;
      const pumpkin = STATE_BLOCK[state] === Block.PumpkinStem;
      w.set(fx, y, fz, pumpkin ? Block.Pumpkin : Block.Melon);
      const facing = ["east", "west", "", "", "south", "north"][d];
      w.set(x, y, z, stateOf(pumpkin ? Block.AttachedPumpkinStem : Block.AttachedMelonStem, { facing }));
    },
  };
  const farmland: TickBehavior = {
    random(w, x, y, z, state) {
      const moisture = Number(propertyOf(state, "moisture"));
      const now = weather();
      if (wet(w, x, y, z) || (now !== null && rainsOn(w, now, x, y + 1, z))) {
        if (moisture < 7) w.set(x, y, z, withProperties(state, { moisture: "7" }));
      } else if (moisture > 0) {
        w.set(x, y, z, withProperties(state, { moisture: String(moisture - 1) }));
      } else if (!isCropBlock(STATE_BLOCK[w.get(x, y + 1, z)])) {
        w.set(x, y, z, Block.Dirt);
      }
    },
  };
  const melt: TickBehavior = {
    random(w, x, y, z, state) {
      if ((w.getLight(x, y, z) & 15) <= 11 && (STATE_BLOCK[state] !== Block.Ice || (w.getLight(x, y + 1, z) & 15) <= 11)) return;
      w.set(x, y, z, STATE_BLOCK[state] === Block.Ice ? Block.Water : Block.Air);
    },
  };
  const out = new Map<number, TickBehavior>([
    [Block.Grass, grass],
    [Block.OakSapling, sapling],
    [Block.Cactus, tall],
    [Block.SugarCane, tall],
    [Block.Wheat, crop],
    [Block.Carrots, crop],
    [Block.Potatoes, crop],
    [Block.PumpkinStem, stem],
    [Block.MelonStem, stem],
    [Block.Farmland, farmland],
    [Block.Ice, melt],
    [Block.Snow, melt],
  ]);
  for (const b of BLOCKS) if (b.leafy) out.set(b.id, leaves);
  return out;
}

const isCropBlock = (b: number): boolean => b === Block.Wheat || b === Block.Carrots || b === Block.Potatoes || b === Block.PumpkinStem || b === Block.MelonStem || b === Block.AttachedPumpkinStem || b === Block.AttachedMelonStem;

/** Whether bone meal does something to a block: a crop or stem still growing, a sapling, grass. */
export function canFertilize(state: number): boolean {
  const b = STATE_BLOCK[state];
  if (b === Block.OakSapling || b === Block.Grass) return true;
  return isCropBlock(b) && b !== Block.AttachedPumpkinStem && b !== Block.AttachedMelonStem && Number(propertyOf(state, "age")) < 7;
}

/**
 * Bone meal on a block, as Minecraft's: a crop or stem grows two to five stages, a sapling grows into a
 * tree (nearly half the time), grass sprouts grass and flowers around. Returns whether it did anything (it
 * is used up then).
 */
export function fertilize(w: VoxelWorld, x: number, y: number, z: number, r: () => number = Math.random): boolean {
  const state = w.get(x, y, z);
  const b = STATE_BLOCK[state];
  if (b === Block.Wheat || b === Block.Carrots || b === Block.Potatoes || b === Block.PumpkinStem || b === Block.MelonStem) {
    const age = Number(propertyOf(state, "age"));
    if (age >= 7) return false;
    w.set(x, y, z, withProperties(state, { age: String(Math.min(7, age + 2 + Math.floor(r() * 4))) }));
    return true;
  }
  if (b === Block.OakSapling) {
    if (r() < 0.45) growSapling(w, x, y, z, r);
    return true;
  }
  if (b === Block.Grass && w.get(x, y + 1, z) === Block.Air) {
    for (let i = 0; i < 24; i++) {
      const tx = x + Math.floor(r() * 7) - 3;
      const tz = z + Math.floor(r() * 7) - 3;
      for (const ty of [y, y + 1, y - 1]) {
        if (w.get(tx, ty, tz) !== Block.Grass || w.get(tx, ty + 1, tz) !== Block.Air) continue;
        const p = r();
        w.set(tx, ty + 1, tz, p < 0.85 ? Block.ShortGrass : p < 0.93 ? Block.Dandelion : Block.Poppy);
        break;
      }
    }
    return true;
  }
  return false;
}

/**
 * Snow and ice where it is cold, a column of a chunk now and then (as Minecraft's precipitation ticks):
 * still water at the top freezes; while it snows, a layer of snow settles on solid ground open to the sky.
 */
export function precipitationTick(w: VoxelWorld, weather: Weather, r: () => number = Math.random): void {
  for (const chunk of w.chunks.values()) {
    if (r() >= 1 / 16) continue;
    const x = chunk.cx * 16 + Math.floor(r() * 16);
    const z = chunk.cz * 16 + Math.floor(r() * 16);
    let y = WORLD_HEIGHT - 1;
    while (y > 0 && w.get(x, y, z) === Block.Air) y--;
    if (precipitationAt(chunk.biomes[(z & 15) * 16 + (x & 15)], y) !== "snow") continue;
    const top = w.get(x, y, z);
    if (top === Block.Water || (FLUID[top] === 1 && fluidLevel(top) === 0 && !isFalling(top))) {
      if ((w.getLight(x, y + 1, z) & 15) < 10) w.set(x, y, z, Block.Ice);
    } else if (weather.raining && STURDY[top * 6 + 2] && (w.getLight(x, y + 1, z) & 15) < 10) {
      w.set(x, y + 1, z, Block.Snow);
    }
  }
}

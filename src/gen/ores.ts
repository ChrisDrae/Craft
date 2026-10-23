import { Block } from "../blocks.js";
import { CHUNK_SIZE } from "../chunk.js";
import { Rng, hash2 } from "./noise.js";
import type { ChunkWriter } from "./writer.js";

/**
 * An ore: veins per chunk (a fraction gives that chance of one more), blocks per vein, and the heights its
 * veins start at: between lo and hi, most often around peak (a triangle), evenly without one.
 */
interface Ore {
  block: Block;
  veins: number;
  size: number;
  lo: number;
  hi: number;
  peak?: number;
}

/**
 * Minecraft's ore distribution moved onto Craft's world (bedrock at 0, the sea at 63): coal high up and
 * common, copper and iron in the middle, gold, lapis and redstone low, diamonds rare and at the bottom.
 */
export const ORES: readonly Ore[] = [
  { block: Block.CoalOre, veins: 18, size: 16, lo: 5, hi: 160, peak: 95 },
  { block: Block.CopperOre, veins: 10, size: 10, lo: 0, hi: 100, peak: 50 },
  // The industry's: tin about as common as copper, a little lower; uranium rare and deep
  { block: Block.TinOre, veins: 8, size: 9, lo: 0, hi: 80, peak: 35 },
  { block: Block.UraniumOre, veins: 0.6, size: 4, lo: 0, hi: 30, peak: 10 },
  { block: Block.IronOre, veins: 12, size: 9, lo: 0, hi: 80, peak: 30 },
  { block: Block.GoldOre, veins: 2.5, size: 9, lo: 0, hi: 40, peak: 12 },
  { block: Block.RedstoneOre, veins: 5, size: 8, lo: 0, hi: 18 },
  { block: Block.LapisOre, veins: 1.5, size: 7, lo: 0, hi: 50, peak: 22 },
  { block: Block.DiamondOre, veins: 1.2, size: 5, lo: 1, hi: 16, peak: 1 },
];

/** Veins wander at most this far from where they start, so a vein reaches one chunk over at most. */
const SPREAD = 7;

/** A height between lo and hi, most often near peak. */
function triangle(rng: Rng, lo: number, hi: number, peak: number): number {
  const u = rng.next();
  const f = (peak - lo) / (hi - lo);
  return Math.floor(u < f ? lo + Math.sqrt(u * (hi - lo) * (peak - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - peak)));
}

/**
 * Puts the ore veins of the chunk and its eight neighbors into the writer's chunk, replacing stone only.
 * Each chunk's veins come from its own seed, so a vein over a border is the same on both sides.
 */
export function placeOres(w: ChunkWriter, seed: number): void {
  const cx = w.chunk.cx;
  const cz = w.chunk.cz;
  for (let nz = cz - 1; nz <= cz + 1; nz++) {
    for (let nx = cx - 1; nx <= cx + 1; nx++) {
      const rng = new Rng(Math.floor(hash2(nx, nz, seed ^ 0x0e5) * 4294967296));
      for (const ore of ORES) {
        const veins = Math.floor(ore.veins) + (rng.next() < ore.veins % 1 ? 1 : 0);
        for (let v = 0; v < veins; v++) {
          const x0 = nx * CHUNK_SIZE + rng.int(0, CHUNK_SIZE - 1);
          const z0 = nz * CHUNK_SIZE + rng.int(0, CHUNK_SIZE - 1);
          const y0 = ore.peak === undefined ? rng.int(ore.lo, ore.hi) : triangle(rng, ore.lo, ore.hi, ore.peak);
          vein(w, rng, ore.block, x0, y0, z0, ore.size);
        }
      }
    }
  }
}

/** A vein: a wandering line of `size` steps, each step putting ore into stone. */
function vein(w: ChunkWriter, rng: Rng, block: Block, x0: number, y0: number, z0: number, size: number): void {
  let x = x0;
  let y = y0;
  let z = z0;
  for (let i = 0; i < size; i++) {
    if (w.get(x, y, z) === Block.Stone) w.set(x, y, z, block);
    const axis = rng.int(0, 2);
    const step = rng.next() < 0.5 ? -1 : 1;
    if (axis === 0 && Math.abs(x + step - x0) <= SPREAD) x += step;
    else if (axis === 1 && y + step > 0) y += step;
    else if (axis === 2 && Math.abs(z + step - z0) <= SPREAD) z += step;
  }
}

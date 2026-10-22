import { Biome } from "../biomes.js";
import { Block, FLUID, stateOf } from "../blocks.js";
import { SEA_LEVEL } from "./climate.js";
import { hash2, hash3 } from "./noise.js";
import type { ChunkWriter } from "./writer.js";

/** What placing structures needs to know of the terrain, anywhere (not just in the chunk being made). */
export interface TerrainQuery {
  biomeAt(x: number, z: number): Biome;
  /** The y of the highest solid block of a column's terrain (before caves). */
  topAt(x: number, z: number): number;
}

/** A structure's place: where it is built from, and a seed for its details. */
export interface Site {
  x: number;
  y: number;
  z: number;
  seed: number;
}

/**
 * A kind of structure. The world is cut into square regions; each may hold one, at a seeded place inside
 * it, if the terrain there suits it (`site`). `reach` is how far it extends from its site.
 */
interface StructureType {
  name: string;
  region: number;
  chance: number;
  reach: number;
  salt: number;
  site(t: TerrainQuery, x: number, z: number, seed: number): Site | null;
  build(w: ChunkWriter, s: Site): void;
}

/** Puts a block of a structure where something solid is (walls of a dungeon stop where a cave opens). */
function intoSolid(w: ChunkWriter, x: number, y: number, z: number, state: number): void {
  const there = w.get(x, y, z);
  if (there > 0 && FLUID[there] === 0) w.set(x, y, z, state);
}

/** Old stone: cobblestone and stone bricks, mossy and cracked here and there. */
function oldStone(x: number, y: number, z: number, seed: number): number {
  const r = hash3(x, y, z, seed);
  return r < 0.3 ? Block.MossyCobblestone : r < 0.5 ? Block.Cobblestone : r < 0.75 ? Block.StoneBricks : r < 0.9 ? Block.MossyStoneBricks : Block.CrackedStoneBricks;
}

const DUNGEON: StructureType = {
  name: "dungeon",
  region: 32,
  chance: 0.6,
  reach: 5,
  salt: 0xd06,
  site(t, x, z, seed) {
    const y = 10 + Math.floor(hash2(x, z, seed ^ 0x51) * 32);
    // Buried well below the ground
    return t.topAt(x, z) >= y + 12 ? { x, y, z, seed } : null;
  },
  build(w, { x, y, z, seed }) {
    // A room of mossy cobblestone, 5 or 7 wide each way, with a spawner in the middle
    const rx = 2 + (seed & 1);
    const rz = 2 + ((seed >> 1) & 1);
    for (let dy = -1; dy <= 4; dy++) {
      for (let dz = -rz - 1; dz <= rz + 1; dz++) {
        for (let dx = -rx - 1; dx <= rx + 1; dx++) {
          const wall = Math.abs(dx) === rx + 1 || Math.abs(dz) === rz + 1 || dy === -1 || dy === 4;
          if (!wall) w.set(x + dx, y + dy, z + dz, Block.Air);
          else intoSolid(w, x + dx, y + dy, z + dz, hash3(x + dx, y + dy, z + dz, seed) < (dy === -1 ? 0.6 : 0.25) ? Block.MossyCobblestone : Block.Cobblestone);
        }
      }
    }
    w.set(x, y, z, Block.Spawner);
  },
};

const WELL: StructureType = {
  name: "well",
  region: 48,
  chance: 0.5,
  reach: 3,
  salt: 0x3e1,
  site(t, x, z, seed) {
    if (t.biomeAt(x, z) !== Biome.Desert) return null;
    const y = t.topAt(x, z);
    return y > SEA_LEVEL ? { x, y, z, seed } : null;
  },
  build(w, { x, y, z }) {
    const slab = stateOf(Block.SandstoneSlab, { type: "bottom" });
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const px = x + dx;
        const pz = z + dz;
        const outer = Math.abs(dx) === 2 || Math.abs(dz) === 2;
        const middle = dx === 0 && dz === 0;
        // A foundation down to the ground, a basin of water in the middle
        for (let k = 1; k <= 4; k++) {
          const below = w.get(px, y - k, pz);
          if (below === -1 || (below !== Block.Air && FLUID[below] === 0)) break;
          w.set(px, y - k, pz, Block.Sandstone);
        }
        w.set(px, y - 1, pz, middle ? Block.Water : Block.Sandstone);
        w.set(px, y - 2, pz, Block.Sandstone);
        w.set(px, y, pz, middle ? Block.Water : Block.Sandstone);
        for (let k = 1; k <= 4; k++) w.set(px, y + k, pz, Block.Air);
        // A low rim with a gap on each side, four pillars and a roof
        if (outer && dx !== 0 && dz !== 0) w.set(px, y + 1, pz, slab);
        if (Math.abs(dx) === 1 && Math.abs(dz) === 1) {
          w.set(px, y + 1, pz, Block.Sandstone);
          w.set(px, y + 2, pz, Block.Sandstone);
        }
        if (!outer) w.set(px, y + 3, pz, middle ? Block.Sandstone : slab);
      }
    }
  },
};

const RUIN_BIOMES: readonly Biome[] = [Biome.Plains, Biome.Forest, Biome.BirchForest, Biome.DarkForest, Biome.Taiga, Biome.Savanna];

const RUINS: StructureType = {
  name: "ruins",
  region: 64,
  chance: 0.35,
  reach: 4,
  salt: 0x7a1,
  site(t, x, z, seed) {
    if (!RUIN_BIOMES.includes(t.biomeAt(x, z))) return null;
    const y = t.topAt(x, z);
    return y > SEA_LEVEL ? { x, y, z, seed } : null;
  },
  build(w, { x, y, z, seed }) {
    // The floor and the broken walls of a small stone house
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        const px = x + dx;
        const pz = z + dz;
        w.set(px, y, pz, oldStone(px, y, pz, seed));
        for (let k = 1; k <= 4; k++) w.set(px, y + k, pz, Block.Air);
        const wall = Math.abs(dx) === 3 || Math.abs(dz) === 3;
        const height = wall ? Math.floor(hash2(px, pz, seed) * 4) - 1 : hash2(px, pz, seed) < 0.1 ? 1 : 0;
        for (let k = 1; k <= height; k++) w.set(px, y + k, pz, oldStone(px, y + k, pz, seed));
        // Under the floor down to the ground
        for (let k = 1; k <= 3; k++) {
          const below = w.get(px, y - k, pz);
          if (below === -1 || (below !== Block.Air && FLUID[below] === 0)) break;
          w.set(px, y - k, pz, Block.Cobblestone);
        }
      }
    }
  },
};

const TYPES: readonly StructureType[] = [DUNGEON, WELL, RUINS];

/**
 * The structures that reach into the area from (x0, z0) to (x1, z1) (inclusive), with their kind and
 * their reach. Each one's site comes from its region and the seed, so every chunk it reaches finds the
 * same one.
 */
export function findSites(t: TerrainQuery, seed: number, x0: number, z0: number, x1: number, z1: number): Array<{ name: string; reach: number; site: Site }> {
  const out: Array<{ name: string; reach: number; site: Site }> = [];
  for (const type of TYPES) {
    const r = type.region;
    const s = seed ^ type.salt;
    for (let rz = Math.floor((z0 - type.reach) / r); rz <= Math.floor((z1 + type.reach) / r); rz++) {
      for (let rx = Math.floor((x0 - type.reach) / r); rx <= Math.floor((x1 + type.reach) / r); rx++) {
        if (hash2(rx, rz, s) >= type.chance) continue;
        // Somewhere in the region, the whole structure inside it
        const x = rx * r + type.reach + Math.floor(hash2(rx, rz, s ^ 0x1f) * (r - 2 * type.reach));
        const z = rz * r + type.reach + Math.floor(hash2(rx, rz, s ^ 0x2f) * (r - 2 * type.reach));
        if (x + type.reach < x0 || x - type.reach > x1 || z + type.reach < z0 || z - type.reach > z1) continue;
        const site = type.site(t, x, z, Math.floor(hash2(rx, rz, s ^ 0x3f) * 4294967296));
        if (site) out.push({ name: type.name, reach: type.reach, site });
      }
    }
  }
  return out;
}

/** Builds the part of a structure found by findSites that lies in the writer's chunk. */
export function buildSite(w: ChunkWriter, name: string, site: Site): void {
  TYPES.find((type) => type.name === name)!.build(w, site);
}

/** Whether a structure stands on the surface (where trees shouldn't grow through it). */
export const onSurface = (name: string): boolean => name !== "dungeon";

import { BIOMES, Biome } from "./biomes.js";
import { Block, FLUID, LEAFY, OPAQUE, stateOf } from "./blocks.js";
import { CHUNK_SIZE, WORLD_HEIGHT, type Chunk, type ChunkGenerator } from "./chunk.js";
import { Caves, LAVA_LEVEL } from "./gen/caves.js";
import { ClimateSampler, SEA_LEVEL, landShape, type Climate } from "./gen/climate.js";
import { TREE_REACH, growTree, plantFor, treeChance, treeKind } from "./gen/features.js";
import { Octaves, Rng, hash2, seedNumber } from "./gen/noise.js";
import { placeOres } from "./gen/ores.js";
import { buildSite, findSites, onSurface, type Site, type TerrainQuery } from "./gen/structures.js";
import { freezes, surfaceBlock } from "./gen/surface.js";
import { ChunkWriter } from "./gen/writer.js";

export { SEA_LEVEL };

/**
 * Bumped whenever the generator makes different terrain from the same seed; saves record it.
 * 1. A heightmap with oak forests.
 * 2. Biomes, 3D terrain, caves, ores by depth, structures.
 * 3. Melons in jungles, mushrooms in shady places, chests in dungeons.
 * 4. Vines in jungles and swamps.
 */
export const GENERATOR_VERSION = 4;

/** Density is worked out at points this far apart across, STEP apart up, and interpolated between. */
const CELL = 4;
const STEP = 8;
const LEVELS = WORLD_HEIGHT / STEP + 1;
/** Columns beyond the chunk whose surface is worked out: trees' reach, and one more for slopes. */
const PAD = TREE_REACH + 1;
const AREA = CHUNK_SIZE + 2 * PAD;
/** Caves are worked out at points this far apart every way. */
const CAVE_CELL = 4;
/** Density points kept for the chunks next door, which share them. */
const CACHE = 8192;

/** The land at a density point: its shape and biome from the climate, and the density every STEP up. */
interface Point {
  height: number;
  jag: number;
  biome: Biome;
  mountain: number;
  levels: Float64Array;
}

/** Interpolates four points' levels across (fx, fz) into `out` at `o`: one column's levels. */
function interpolate(a: Float64Array, b: Float64Array, c: Float64Array, d: Float64Array, fx: number, fz: number, out: Float64Array, o: number): void {
  for (let l = 0; l < LEVELS; l++) {
    const near = a[l] + (b[l] - a[l]) * fx;
    const far = c[l] + (d[l] - c[l]) * fx;
    out[o + l] = near + (far - near) * fz;
  }
}

/** Density in a column at a height, from its levels at `o`: solid above 0. */
function densityAt(levels: Float64Array, o: number, y: number): number {
  const l = y >> 3;
  const a = levels[o + l];
  return a + (levels[o + l + 1] - a) * ((y & 7) / STEP);
}

/** The highest solid block of a column from its levels, or -1. */
function topSolid(levels: Float64Array, o: number): number {
  for (let l = LEVELS - 2; l >= 0; l--) {
    if (levels[o + l] <= 0 && levels[o + l + 1] <= 0) continue;
    for (let y = l * STEP + STEP - 1; y >= l * STEP; y--) if (densityAt(levels, o, y) > 0) return y;
  }
  return -1;
}

/**
 * Seeded terrain in the manner of Minecraft 1.18: the climate (continentalness, erosion, weirdness,
 * temperature, humidity) shapes the land and picks the biome of every column; a 3D density, solid above
 * 0, gives cliffs and overhangs where the climate makes mountains; noise caves and ravines cut through it,
 * lava fills them deep down; each biome lays its own surface (grass, sand, snow) and grows its trees and
 * plants; ores lie by depth, and dungeons, desert wells and ruins are scattered about. Everything follows
 * from the seed and the position, so chunks are the same however and in whatever order they are made.
 */
export class TerrainGenerator implements ChunkGenerator, TerrainQuery {
  private readonly climate: ClimateSampler;
  private readonly terrain: Octaves;
  private readonly patches: Octaves;
  private readonly caves: Caves;
  private readonly seed: number;
  private readonly points: Map<number, Point> = new Map();
  private readonly sample: Climate = { continentalness: 0, erosion: 0, weirdness: 0, temperature: 0, humidity: 0 };
  // Working space for a chunk: the columns around it (AREA x AREA)
  private readonly levels = new Float64Array(AREA * AREA * LEVELS);
  private readonly tops = new Int16Array(AREA * AREA);
  private readonly biomes = new Uint8Array(AREA * AREA);
  private readonly steep = new Uint8Array(AREA * AREA);
  private readonly patch = new Float64Array(AREA * AREA);
  private readonly column = new Float64Array(LEVELS);

  constructor(seed: number | string = "craft") {
    const s = String(seed);
    this.climate = new ClimateSampler(s);
    this.terrain = new Octaves(`${s}/terrain`, 3, 1 / 90, 4);
    this.patches = new Octaves(`${s}/patches`, 2, 1 / 24, 2.5);
    this.caves = new Caves(s);
    this.seed = seedNumber(s);
  }

  /** The density point at (x, z), which must lie on the grid (multiples of CELL). */
  private point(x: number, z: number): Point {
    const key = (x / CELL) * 4194304 + z / CELL;
    let p = this.points.get(key);
    if (p) return p;
    const shape = landShape(this.climate.sample(x, z, this.sample));
    const levels = new Float64Array(LEVELS);
    for (let l = 0; l < LEVELS; l++) {
      const y = l * STEP;
      const base = shape.height - y;
      // The 3D noise moves the surface by up to `jag` blocks, less above the ground (fewer floating bits);
      // far from the surface it can't change what is solid, so it isn't worked out there
      levels[l] = Math.abs(base) < shape.jag + 8 ? base + shape.jag * this.terrain.at3(x, y, z, 1.4) * (y > shape.height ? 0.7 : 1) : base;
    }
    p = { height: shape.height, jag: shape.jag, biome: shape.biome, mountain: shape.mountain, levels };
    if (this.points.size >= CACHE) this.points.clear();
    this.points.set(key, p);
    return p;
  }

  /** The levels of the column at (x, z) into `out` at `o`. */
  private columnLevels(x: number, z: number, out: Float64Array, o: number): void {
    const gx = x - (x & (CELL - 1));
    const gz = z - (z & (CELL - 1));
    interpolate(
      this.point(gx, gz).levels,
      this.point(gx + CELL, gz).levels,
      this.point(gx, gz + CELL).levels,
      this.point(gx + CELL, gz + CELL).levels,
      (x & (CELL - 1)) / CELL,
      (z & (CELL - 1)) / CELL,
      out,
      o,
    );
  }

  /** The biome of a column: that of a density point near it, picked with some jitter so borders aren't square. */
  biomeAt(x: number, z: number): Biome {
    const jx = x + Math.floor(hash2(x, z, this.seed ^ 0xb1) * 5) - 2;
    const jz = z + Math.floor(hash2(x, z, this.seed ^ 0xb2) * 5) - 2;
    return this.point(CELL * Math.round(jx / CELL), CELL * Math.round(jz / CELL)).biome;
  }

  /** The y of the highest solid block of a column's terrain, before caves. */
  topAt(x: number, z: number): number {
    this.columnLevels(x, z, this.column, 0);
    return topSolid(this.column, 0);
  }

  /** The structures (dungeons, wells, ruins) reaching into an area, by kind, with their sites and reach. */
  structures(x0: number, z0: number, x1: number, z1: number): Array<{ name: string; reach: number; site: Site }> {
    return findSites(this, this.seed, x0, z0, x1, z1);
  }

  /** Ground height of a column: the y just above its top solid block (before caves). */
  surfaceHeight(x: number, z: number): number {
    return this.topAt(x, z) + 1;
  }

  /** Whether a block is water as the terrain leaves it: open below sea level (before caves). */
  private wet(ai: number, y: number): boolean {
    return y <= SEA_LEVEL && densityAt(this.levels, ai * LEVELS, y) <= 0;
  }

  generate(chunk: Chunk): void {
    const ox = chunk.cx * CHUNK_SIZE;
    const oz = chunk.cz * CHUNK_SIZE;
    const w = new ChunkWriter(chunk);
    this.columns(ox, oz);
    this.fill(chunk, ox, oz);
    this.carve(chunk, ox, oz);
    // Bedrock at the bottom, ragged above it
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        chunk.set(x, 0, z, Block.Bedrock);
        if (hash2(ox + x, oz + z, this.seed ^ 1) < 0.5) chunk.set(x, 1, z, Block.Bedrock);
        if (hash2(ox + x, oz + z, this.seed ^ 2) < 0.2) chunk.set(x, 2, z, Block.Bedrock);
      }
    }
    placeOres(w, this.seed);
    this.emeralds(chunk);
    // Structures reaching into the chunk, and those in the area around (no trees grow through them)
    const sites = findSites(this, this.seed, ox - PAD, oz - PAD, ox + CHUNK_SIZE + PAD - 1, oz + CHUNK_SIZE + PAD - 1);
    for (const { name, reach, site } of sites) {
      if (site.x + reach >= ox && site.x - reach < ox + CHUNK_SIZE && site.z + reach >= oz && site.z - reach < oz + CHUNK_SIZE) buildSite(w, name, site);
    }
    this.trees(w, ox, oz, sites.filter((s) => onSurface(s.name)));
    this.plants(chunk, ox, oz);
    this.freeze(chunk);
    for (let z = 0; z < CHUNK_SIZE; z++) for (let x = 0; x < CHUNK_SIZE; x++) chunk.biomes[z * CHUNK_SIZE + x] = this.biomes[(z + PAD) * AREA + x + PAD];
    chunk.generator = GENERATOR_VERSION;
  }

  /** The levels, top, biome, slope and surface patch of every column of the area around a chunk. */
  private columns(ox: number, oz: number): void {
    for (let az = 0; az < AREA; az++) {
      for (let ax = 0; ax < AREA; ax++) {
        const x = ox - PAD + ax;
        const z = oz - PAD + az;
        const i = az * AREA + ax;
        this.columnLevels(x, z, this.levels, i * LEVELS);
        this.tops[i] = topSolid(this.levels, i * LEVELS);
        this.biomes[i] = this.biomeAt(x, z);
        this.patch[i] = Math.min(0.999, Math.max(0, this.patches.at2(x, z) * 0.5 + 0.5));
      }
    }
    for (let az = 1; az < AREA - 1; az++) {
      for (let ax = 1; ax < AREA - 1; ax++) {
        const i = az * AREA + ax;
        const t = this.tops[i];
        this.steep[i] = Math.min(255, Math.max(Math.abs(t - this.tops[i - 1]), Math.abs(t - this.tops[i + 1]), Math.abs(t - this.tops[i - AREA]), Math.abs(t - this.tops[i + AREA])));
      }
    }
  }

  /** How deep a column's soil goes (grass then dirt, sand then sandstone). */
  private fillerDepth(x: number, z: number): number {
    return 3 + Math.floor(hash2(x, z, this.seed ^ 0x5bd1e995) * 2);
  }

  /** Stone where the density is solid, the biome's surface on top, water up to sea level. */
  private fill(chunk: Chunk, ox: number, oz: number): void {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const i = (z + PAD) * AREA + x + PAD;
        const o = i * LEVELS;
        const biome = this.biomes[i];
        const filler = this.fillerDepth(ox + x, oz + z);
        // Counting solid blocks down from the air or water above: the surface starts over under every overhang
        let depth = -1;
        let wet = false;
        for (let y = Math.max(this.tops[i], SEA_LEVEL); y >= 1; y--) {
          if (densityAt(this.levels, o, y) <= 0) {
            depth = -1;
            if (y <= SEA_LEVEL) chunk.set(x, y, z, Block.Water);
            continue;
          }
          if (++depth === 0) wet = y < SEA_LEVEL;
          chunk.set(x, y, z, surfaceBlock(biome, y, depth, this.steep[i], wet, this.patch[i], filler) ?? Block.Stone);
        }
      }
    }
  }

  /**
   * Cuts the caves and ravines out of the chunk: air, or lava below LAVA_LEVEL. Never next to water, so
   * oceans and rivers don't drain into them.
   */
  private carve(chunk: Chunk, ox: number, oz: number): void {
    let highest = 0;
    for (let z = 0; z < CHUNK_SIZE; z++) for (let x = 0; x < CHUNK_SIZE; x++) highest = Math.max(highest, this.tops[(z + PAD) * AREA + x + PAD]);
    const levels = Math.min(WORLD_HEIGHT / CAVE_CELL, Math.ceil((highest + 1) / CAVE_CELL)) + 1;
    const n = CHUNK_SIZE / CAVE_CELL + 1;
    const grid = new Float64Array(n * n * levels);
    for (let gz = 0; gz < n; gz++) {
      for (let gx = 0; gx < n; gx++) {
        const x = ox + gx * CAVE_CELL;
        const z = oz + gz * CAVE_CELL;
        const height = this.point(x, z).height;
        for (let l = 0; l < levels; l++) grid[(gz * n + gx) * levels + l] = this.caves.value(x, l * CAVE_CELL, z, height);
      }
    }
    const column = new Float64Array(levels);
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const i = (z + PAD) * AREA + x + PAD;
        const top = this.tops[i];
        const gx = x >> 2;
        const gz = z >> 2;
        const fx = (x & 3) / CAVE_CELL;
        const fz = (z & 3) / CAVE_CELL;
        const a = (gz * n + gx) * levels;
        const b = a + levels;
        const c = a + n * levels;
        const d = c + levels;
        for (let l = 0; l < levels; l++) {
          const near = grid[a + l] + (grid[b + l] - grid[a + l]) * fx;
          const far = grid[c + l] + (grid[d + l] - grid[c + l]) * fx;
          column[l] = near + (far - near) * fz;
        }
        const ravine = this.caves.ravineAt(ox + x, oz + z);
        for (let y = 1; y <= top; y++) {
          const here = chunk.get(x, y, z);
          if (here === Block.Air || FLUID[here] !== 0) continue;
          const l = y >> 2;
          const v = column[l] + (column[l + 1] - column[l]) * ((y & 3) / CAVE_CELL);
          const cut = v < 0 || (ravine !== null && y >= ravine[0] && y <= ravine[1]);
          if (cut && !this.touchesWater(chunk, x, y, z, i)) chunk.set(x, y, z, y <= LAVA_LEVEL ? Block.Lava : Block.Air);
        }
      }
    }
  }

  /** Whether the block at chunk position (x, y, z) (area column i) has water above or beside it. */
  private touchesWater(chunk: Chunk, x: number, y: number, z: number, i: number): boolean {
    if (y + 1 <= SEA_LEVEL && FLUID[chunk.get(x, y + 1, z)] === 1) return true;
    if (y > SEA_LEVEL) return false;
    // Beside it, inside the chunk or next door
    return this.wet(i - 1, y) || this.wet(i + 1, y) || this.wet(i - AREA, y) || this.wet(i + AREA, y);
  }

  /** Emerald ore, a block here and there, in the stone of mountains. */
  private emeralds(chunk: Chunk): void {
    const rng = new Rng(Math.floor(hash2(chunk.cx, chunk.cz, this.seed ^ 0xe3) * 4294967296));
    for (let k = 0; k < 6; k++) {
      const x = rng.int(0, CHUNK_SIZE - 1);
      const z = rng.int(0, CHUNK_SIZE - 1);
      const i = (z + PAD) * AREA + x + PAD;
      const y = rng.int(80, Math.max(80, this.tops[i] - 4));
      const biome = this.biomes[i];
      if ((biome === Biome.StonyMountains || biome === Biome.SnowyPeaks) && chunk.get(x, y, z) === Block.Stone) chunk.set(x, y, z, Block.EmeraldOre);
    }
  }

  /**
   * Trees on grass, from the columns around the chunk too: whether a column grows one, and which, follows
   * from the terrain alone, so the chunks a tree reaches into agree on it.
   */
  private trees(w: ChunkWriter, ox: number, oz: number, structures: ReadonlyArray<{ reach: number; site: Site }>): void {
    for (let az = 1; az < AREA - 1; az++) {
      for (let ax = 1; ax < AREA - 1; ax++) {
        const x = ox - PAD + ax;
        const z = oz - PAD + az;
        const i = az * AREA + ax;
        const biome = this.biomes[i];
        if (hash2(x, z, this.seed ^ 0x7ee) >= treeChance(biome)) continue;
        const top = this.tops[i];
        if (top < SEA_LEVEL || surfaceBlock(biome, top, 0, this.steep[i], false, this.patch[i], 3) !== Block.Grass) continue;
        if (structures.some(({ reach, site }) => Math.abs(site.x - x) <= reach + 1 && Math.abs(site.z - z) <= reach + 1)) continue;
        growTree(w, treeKind(biome, hash2(x, z, this.seed ^ 0x7ef)), x, top + 1, z, Math.floor(hash2(x, z, this.seed ^ 0x7f0) * 4294967296));
      }
    }
  }

  /** Grass, flowers, ferns, cacti and the like on the chunk's own columns; sugar cane by water, lily pads on swamps. */
  private plants(chunk: Chunk, ox: number, oz: number): void {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const i = (z + PAD) * AREA + x + PAD;
        const biome = this.biomes[i];
        const wx = ox + x;
        const wz = oz + z;
        const top = this.tops[i];
        if (top < 1 || top >= WORLD_HEIGHT - 4) continue;
        const ground = chunk.get(x, top, z);
        // Lily pads on still swamp water
        if (biome === Biome.Swamp && ground !== Block.Water && chunk.get(x, SEA_LEVEL, z) === Block.Water && chunk.get(x, SEA_LEVEL + 1, z) === Block.Air) {
          if (hash2(wx, wz, this.seed ^ 0x11) < 0.06) chunk.set(x, SEA_LEVEL + 1, z, Block.LilyPad);
          continue;
        }
        if (chunk.get(x, top + 1, z) !== Block.Air || top < SEA_LEVEL) continue;
        // Sugar cane where water is right beside the ground
        if ((ground === Block.Grass || ground === Block.Sand || ground === Block.Dirt) && !BIOMES[biome].cold && hash2(wx, wz, this.seed ^ 0x5c) < 0.15) {
          if (this.wet(i - 1, top) || this.wet(i + 1, top) || this.wet(i - AREA, top) || this.wet(i + AREA, top)) {
            const height = 1 + Math.floor(hash2(wx, wz, this.seed ^ 0x5d) * 3);
            for (let k = 1; k <= height; k++) chunk.set(x, top + k, z, Block.SugarCane);
            continue;
          }
        }
        const plant = plantFor(biome, hash2(wx, wz, this.seed ^ 0x9a1));
        if (plant === null) continue;
        if (plant === Block.Cactus || plant === Block.DeadBush) {
          if (ground !== Block.Sand) continue;
          const height = plant === Block.Cactus ? 1 + Math.floor(hash2(wx, wz, this.seed ^ 0xca) * 3) : 1;
          for (let k = 1; k <= height; k++) chunk.set(x, top + k, z, plant);
        } else if (ground === Block.Grass) {
          if (plant === Block.TallGrass || plant === Block.LargeFern) {
            if (chunk.get(x, top + 2, z) !== Block.Air) continue;
            chunk.set(x, top + 1, z, stateOf(plant, { half: "lower" }));
            chunk.set(x, top + 2, z, stateOf(plant, { half: "upper" }));
          } else {
            chunk.set(x, top + 1, z, plant);
          }
        }
      }
    }
  }

  /** Snow on the ground and ice on the water of cold columns, and on high mountains anywhere. */
  private freeze(chunk: Chunk): void {
    const snowy = stateOf(Block.Grass, { snowy: "true" });
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const i = (z + PAD) * AREA + x + PAD;
        const cold = BIOMES[this.biomes[i]].cold;
        if (!freezes(cold, this.tops[i])) continue;
        let y = Math.min(WORLD_HEIGHT - 2, Math.max(this.tops[i], SEA_LEVEL) + 40);
        while (y > 0 && chunk.get(x, y, z) === Block.Air) y--;
        const top = chunk.get(x, y, z);
        if (top === Block.Water) {
          if (y === SEA_LEVEL && freezes(cold, y)) chunk.set(x, y, z, Block.Ice);
          continue;
        }
        if (!OPAQUE[top] && !LEAFY[top]) continue;
        chunk.set(x, y + 1, z, Block.Snow);
        if (top === Block.Grass) chunk.set(x, y, z, snowy);
      }
    }
  }
}

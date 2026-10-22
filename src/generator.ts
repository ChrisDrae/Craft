import { PerlinNoise, Random } from "projector";
import { Block } from "./blocks.js";
import { CHUNK_SIZE, WORLD_HEIGHT, type Chunk, type ChunkGenerator } from "./chunk.js";

/** y of the highest water block. */
export const SEA_LEVEL = 63;
/** Chance of a tree on a grass column. */
const TREE_CHANCE = 0.012;
/** Trees reach this far from their trunk, so chunks look at columns this far outside themselves. */
const TREE_REACH = 2;
/** Height differences from this up make a column a cliff of bare stone. */
const CLIFF = 4;
/** Above this the ground is bare stone. */
const BARE_ROCK = SEA_LEVEL + 24;

/** A deterministic number in [0, 1) for a column and a seed. */
function hash2(x: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Seeded terrain: a heightmap of rolling hills and mountains from layered Perlin noise, oceans below
 * SEA_LEVEL with sand beaches, stone cliffs, ores in the stone and oak trees on the grass.
 */
export class TerrainGenerator implements ChunkGenerator {
  private readonly continent: PerlinNoise;
  private readonly hills: PerlinNoise;
  private readonly mountains: PerlinNoise;
  private readonly beaches: PerlinNoise;
  private readonly ores: PerlinNoise;
  private readonly seed: number;
  /** Ground heights of a chunk and a one-block border, for slopes. */
  private readonly heights: Int32Array = new Int32Array((CHUNK_SIZE + 2) * (CHUNK_SIZE + 2));

  constructor(seed: number | string = "craft") {
    this.continent = new PerlinNoise(`${seed}/continent`);
    this.hills = new PerlinNoise(`${seed}/hills`);
    this.mountains = new PerlinNoise(`${seed}/mountains`);
    this.beaches = new PerlinNoise(`${seed}/beaches`);
    this.ores = new PerlinNoise(`${seed}/ores`);
    this.seed = Math.floor(new Random(seed).next() * 4294967296) | 0;
  }

  /** Ground height of a column: the y just above its top solid block. */
  surfaceHeight(x: number, z: number): number {
    const continent = this.continent.fbm2D(x * 0.004, z * 0.004, { octaves: 3 });
    const hills = this.hills.fbm2D(x * 0.025, z * 0.025, { octaves: 4 });
    const m = Math.max(0, this.mountains.fbm2D(x * 0.008, z * 0.008, { octaves: 3 }) - 0.05);
    const h = SEA_LEVEL + 3 + continent * 20 + hills * 7 + m * m * 130;
    return Math.max(3, Math.min(WORLD_HEIGHT - 10, Math.floor(h)));
  }

  /** The top block of a column with ground height h, on a slope of `steep` blocks. */
  surfaceBlock(x: number, z: number, h: number, steep: number): Block {
    const top = h - 1;
    if (top < SEA_LEVEL - 2) return Block.Dirt;
    const beach = this.beaches.noise2D(x * 0.05 + 0.5, z * 0.05 + 0.5) > 0.15 ? 1 : 0;
    if (top <= SEA_LEVEL + 1 + beach) return Block.Sand;
    if (steep >= CLIFF || top > BARE_ROCK) return Block.Stone;
    return Block.Grass;
  }

  /** Stone, or an ore where its noise is high enough (rarer ores only deeper down). */
  stoneAt(x: number, y: number, z: number): Block {
    if (y < SEA_LEVEL - 4 && this.ores.noise3D(x * 0.2 + 0.5, y * 0.2 + 40.5, z * 0.2) > 0.46) return Block.GoldOre;
    if (y < SEA_LEVEL + 14 && this.ores.noise3D(x * 0.18 + 70.5, y * 0.18, z * 0.18 + 0.5) > 0.42) return Block.IronOre;
    if (this.ores.noise3D(x * 0.15 + 0.5, y * 0.15 + 0.5, z * 0.15 + 140.5) > 0.36) return Block.CoalOre;
    return Block.Stone;
  }

  generate(chunk: Chunk): void {
    const ox = chunk.cx * CHUNK_SIZE;
    const oz = chunk.cz * CHUNK_SIZE;
    const w = CHUNK_SIZE + 2;
    const heights = this.heights;
    for (let j = 0; j < w; j++) {
      for (let i = 0; i < w; i++) heights[j * w + i] = this.surfaceHeight(ox + i - 1, oz + j - 1);
    }

    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = ox + x;
        const wz = oz + z;
        const c = (z + 1) * w + x + 1;
        const h = heights[c];
        const steep = Math.max(
          Math.abs(h - heights[c - 1]),
          Math.abs(h - heights[c + 1]),
          Math.abs(h - heights[c - w]),
          Math.abs(h - heights[c + w]),
        );
        const top = this.surfaceBlock(wx, wz, h, steep);
        const filler = top === Block.Grass ? Block.Dirt : top;
        const fillerDepth = 3 + Math.floor(hash2(wx, wz, this.seed ^ 0x5bd1e995) * 2);
        for (let y = 0; y < h; y++) {
          let b: Block;
          if (y === 0 || (y === 1 && hash2(wx, wz, this.seed ^ y) < 0.5)) b = Block.Bedrock;
          else if (y === h - 1) b = top === Block.Stone ? this.stoneAt(wx, y, wz) : top;
          else if (y >= h - 1 - fillerDepth && filler !== Block.Stone) b = filler;
          else b = this.stoneAt(wx, y, wz);
          chunk.set(x, y, z, b);
        }
        for (let y = h; y <= SEA_LEVEL; y++) chunk.set(x, y, z, Block.Water);
      }
    }

    // Trees from columns around the chunk too, in one global order, so canopies match across borders
    for (let wz = oz - TREE_REACH; wz < oz + CHUNK_SIZE + TREE_REACH; wz++) {
      for (let wx = ox - TREE_REACH; wx < ox + CHUNK_SIZE + TREE_REACH; wx++) {
        if (hash2(wx, wz, this.seed) >= TREE_CHANCE) continue;
        const h = this.surfaceHeight(wx, wz);
        const steep = Math.max(
          Math.abs(h - this.surfaceHeight(wx - 1, wz)),
          Math.abs(h - this.surfaceHeight(wx + 1, wz)),
          Math.abs(h - this.surfaceHeight(wx, wz - 1)),
          Math.abs(h - this.surfaceHeight(wx, wz + 1)),
        );
        if (this.surfaceBlock(wx, wz, h, steep) !== Block.Grass) continue;
        this.tree(chunk, wx, h, wz);
      }
    }
  }

  /** An oak with its trunk on the ground at (x, y, z): the parts of it inside the chunk. */
  private tree(chunk: Chunk, x: number, y: number, z: number): void {
    const trunk = 4 + Math.floor(hash2(x + 7, z - 3, this.seed) * 3);
    const crown = y + trunk;
    for (let dy = -2; dy <= 1; dy++) {
      const r = dy < 0 ? 2 : 1;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const corner = Math.abs(dx) === r && Math.abs(dz) === r;
          // Wide layers lose some corners, the top layer all of them
          if (corner && (dy === 1 || hash2(x + dx * 31 + dy, z + dz * 17, this.seed) < 0.5)) continue;
          this.place(chunk, x + dx, crown + dy, z + dz, Block.Leaves, true);
        }
      }
    }
    for (let k = 0; k < trunk; k++) this.place(chunk, x, y + k, z, Block.Log, false);
  }

  /** Sets a block given in world coordinates if it lies in the chunk (leaves only into air). */
  private place(chunk: Chunk, x: number, y: number, z: number, block: Block, onlyAir: boolean): void {
    const lx = x - chunk.cx * CHUNK_SIZE;
    const lz = z - chunk.cz * CHUNK_SIZE;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
    if (onlyAir && chunk.get(lx, y, lz) !== Block.Air) return;
    chunk.set(lx, y, lz, block);
  }
}

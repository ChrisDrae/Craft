import { Block, DIR_X, DIR_Y, DIR_Z, OPAQUE, SOLID } from "./blocks.js";
import { CHUNK_SIZE, Chunk, WORLD_HEIGHT, localIndex, packFace, type ChunkGenerator } from "./chunk.js";

/** Chunks by position, generated on demand, with block access in world coordinates. */
export class VoxelWorld {
  readonly chunks: Map<number, Chunk> = new Map();
  readonly generator: ChunkGenerator;
  /**
   * Leaves hide nothing behind them and keep the faces between each other, for see-through (cut out)
   * leaf textures. Off, they count as solid: fewer faces, for the untextured renderer.
   */
  fancyLeaves: boolean = false;

  constructor(generator: ChunkGenerator) {
    this.generator = generator;
  }

  static key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  chunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(VoxelWorld.key(cx, cz));
  }

  /** The chunk, generated first if it doesn't exist yet. */
  load(cx: number, cz: number): Chunk {
    const key = VoxelWorld.key(cx, cz);
    let chunk = this.chunks.get(key);
    if (chunk) return chunk;
    chunk = new Chunk(cx, cz);
    this.generator.generate(chunk);
    this.chunks.set(key, chunk);
    // Their border faces were hidden while this chunk was missing
    this.markDirty(cx - 1, cz);
    this.markDirty(cx + 1, cz);
    this.markDirty(cx, cz - 1);
    this.markDirty(cx, cz + 1);
    return chunk;
  }

  /**
   * Generates up to `budget` missing chunks within `radius` chunks of block (x, z), nearest rings first.
   * Returns how many were generated.
   */
  loadAround(x: number, z: number, radius: number, budget: number): number {
    const ccx = Math.floor(x / CHUNK_SIZE);
    const ccz = Math.floor(z / CHUNK_SIZE);
    const r2 = (radius + 0.5) * (radius + 0.5);
    let made = 0;
    for (let ring = 0; ring <= radius && made < budget; ring++) {
      for (let dz = -ring; dz <= ring && made < budget; dz++) {
        for (let dx = -ring; dx <= ring && made < budget; dx++) {
          // Only the border of the square: the inside was done by the smaller rings
          if (Math.abs(dx) !== ring && Math.abs(dz) !== ring) continue;
          if (dx * dx + dz * dz > r2) continue;
          if (this.chunks.has(VoxelWorld.key(ccx + dx, ccz + dz))) continue;
          this.load(ccx + dx, ccz + dz);
          made++;
        }
      }
    }
    return made;
  }

  /** Block at integer world coordinates: bedrock below the world, air above it and in missing chunks. */
  get(x: number, y: number, z: number): number {
    if (y < 0) return Block.Bedrock;
    if (y >= WORLD_HEIGHT) return Block.Air;
    const chunk = this.chunks.get(VoxelWorld.key(x >> 4, z >> 4));
    if (!chunk) return Block.Air;
    return chunk.blocks[localIndex(x & 15, y, z & 15)];
  }

  isSolid(x: number, y: number, z: number): boolean {
    return SOLID[this.get(x, y, z)] === 1;
  }

  /** Sets a block in a loaded chunk and marks the chunks whose faces change. Returns false outside the world. */
  set(x: number, y: number, z: number, block: number): boolean {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const cx = x >> 4;
    const cz = z >> 4;
    const chunk = this.chunk(cx, cz);
    if (!chunk) return false;
    const lx = x & 15;
    const lz = z & 15;
    chunk.set(lx, y, lz, block);
    chunk.dirty = true;
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
    return true;
  }

  /**
   * Rebuilds a chunk's face list. A face is exposed when the block next to it doesn't hide it: air, or
   * water next to anything but water (and leaves, with fancyLeaves). Faces toward a chunk that isn't
   * loaded yet stay hidden until it is.
   */
  buildFaces(chunk: Chunk): void {
    const fancy = this.fancyLeaves;
    const blocks = chunk.blocks;
    const neighbors = [
      this.chunk(chunk.cx + 1, chunk.cz),
      this.chunk(chunk.cx - 1, chunk.cz),
      undefined,
      undefined,
      this.chunk(chunk.cx, chunk.cz + 1),
      this.chunk(chunk.cx, chunk.cz - 1),
    ];
    let faces = chunk.faces;
    let count = 0;
    let minY = WORLD_HEIGHT;
    let maxY = 0;
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const b = blocks[localIndex(x, y, z)];
          if (b === Block.Air) continue;
          const lowered = b === Block.Water && (y + 1 >= WORLD_HEIGHT || blocks[localIndex(x, y + 1, z)] !== Block.Water);
          for (let d = 0; d < 6; d++) {
            const ny = y + DIR_Y[d];
            // Nobody sees the bottom of the world
            if (ny < 0) continue;
            let n: number = Block.Air;
            if (ny < WORLD_HEIGHT) {
              const nx = x + DIR_X[d];
              const nz = z + DIR_Z[d];
              if (nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE) {
                n = blocks[localIndex(nx, ny, nz)];
              } else {
                const other = neighbors[d];
                if (!other) continue;
                n = other.blocks[localIndex(nx & 15, ny, nz & 15)];
              }
            }
            const seeThrough = fancy && n === Block.Leaves;
            if (n === b ? !seeThrough : OPAQUE[n] === 1 && !seeThrough) continue;
            if (count === faces.length) {
              const grown = new Int32Array(faces.length * 2);
              grown.set(faces);
              faces = grown;
            }
            faces[count++] = packFace(x, y, z, d, b, lowered);
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
    }
    chunk.faces = faces;
    chunk.faceCount = count;
    chunk.minY = count > 0 ? minY : 0;
    chunk.maxY = count > 0 ? maxY : 0;
    chunk.dirty = false;
  }

  private markDirty(cx: number, cz: number): void {
    const chunk = this.chunk(cx, cz);
    if (chunk) chunk.dirty = true;
  }
}

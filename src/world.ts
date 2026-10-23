import { entityFor, keeps, type BlockEntity } from "./blockEntities.js";
import { Block, CUBE_SHAPED, CULL_SAME, DIR_X, DIR_Y, DIR_Z, FLUID, LEAFY, SOLID, STATE_BLOCK } from "./blocks.js";
import { CHUNK_SIZE, Chunk, MODEL_FACE, SECTIONS, SECTION_VOLUME, WORLD_HEIGHT, packFace, sectionIndex, type ChunkGenerator, type Section } from "./chunk.js";
import { ownHeight } from "./fluids.js";
import { COLLISION, COVERS } from "./shapes.js";
import { OPEN_SKY, joinChunk, lightChunk, relight, type LightWorld } from "./light.js";

function grow(faces: Int32Array): Int32Array {
  const grown = new Int32Array(Math.max(256, faces.length * 2));
  grown.set(faces);
  return grown;
}

/** Chunks by position, generated on demand, with block and light access in world coordinates. */
export class VoxelWorld implements LightWorld {
  readonly chunks: Map<number, Chunk> = new Map();
  readonly generator: ChunkGenerator;
  /**
   * Leaves hide nothing behind them and keep the faces between each other, for see-through (cut out)
   * leaf textures. Off, they count as solid: fewer faces, for the untextured renderer.
   */
  fancyLeaves: boolean = false;
  /** Called after every block change with its position (BlockUpdates.changed). */
  onChanged: ((x: number, y: number, z: number, old: number) => void) | null = null;
  /** Called when a chest or furnace goes with its block, with what it held (the game drops it). */
  onEntityRemoved: ((x: number, y: number, z: number, entity: BlockEntity) => void) | null = null;

  constructor(generator: ChunkGenerator) {
    this.generator = generator;
  }

  static key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  chunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(VoxelWorld.key(cx, cz));
  }

  /** Whether the chunk holding block column (x, z) is loaded. */
  isLoaded(x: number, z: number): boolean {
    return this.chunks.has(VoxelWorld.key(Math.floor(x) >> 4, Math.floor(z) >> 4));
  }

  /** The chunk, generated (and lit) first if it doesn't exist yet. */
  load(cx: number, cz: number): Chunk {
    const existing = this.chunk(cx, cz);
    if (existing) return existing;
    const chunk = new Chunk(cx, cz);
    this.generator.generate(chunk);
    lightChunk(chunk);
    this.insert(chunk);
    return chunk;
  }

  /**
   * Adds a chunk made elsewhere (by a worker, lit on its own by lightChunk), replacing any chunk at its
   * place, and joins its light with the neighbors'.
   */
  insert(chunk: Chunk): void {
    this.chunks.set(VoxelWorld.key(chunk.cx, chunk.cz), chunk);
    // Their border faces were hidden while this chunk was missing
    this.markColumnDirty(chunk.cx - 1, chunk.cz);
    this.markColumnDirty(chunk.cx + 1, chunk.cz);
    this.markColumnDirty(chunk.cx, chunk.cz - 1);
    this.markColumnDirty(chunk.cx, chunk.cz + 1);
    joinChunk(this, chunk);
  }

  /**
   * The positions of chunks within `radius` chunks of block (x, z) that aren't loaded, nearest rings
   * first.
   */
  *missingAround(x: number, z: number, radius: number): Generator<[number, number]> {
    const ccx = Math.floor(x / CHUNK_SIZE);
    const ccz = Math.floor(z / CHUNK_SIZE);
    const r2 = (radius + 0.5) * (radius + 0.5);
    for (let ring = 0; ring <= radius; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          // Only the border of the square: the inside was done by the smaller rings
          if (Math.abs(dx) !== ring && Math.abs(dz) !== ring) continue;
          if (dx * dx + dz * dz > r2) continue;
          if (!this.chunks.has(VoxelWorld.key(ccx + dx, ccz + dz))) yield [ccx + dx, ccz + dz];
        }
      }
    }
  }

  /**
   * Generates up to `budget` missing chunks within `radius` chunks of block (x, z), nearest rings first.
   * Returns how many were generated.
   */
  loadAround(x: number, z: number, radius: number, budget: number): number {
    let made = 0;
    for (const [cx, cz] of this.missingAround(x, z, radius)) {
      if (made >= budget) break;
      this.load(cx, cz);
      made++;
    }
    return made;
  }

  /** Drops the chunks farther than `radius` chunks from block (x, z), except those `keep` holds on to, and returns them. */
  unloadOutside(x: number, z: number, radius: number, keep?: (cx: number, cz: number) => boolean): Chunk[] {
    const ccx = Math.floor(x / CHUNK_SIZE);
    const ccz = Math.floor(z / CHUNK_SIZE);
    const r2 = (radius + 0.5) * (radius + 0.5);
    const dropped: Chunk[] = [];
    for (const [key, chunk] of this.chunks) {
      const dx = chunk.cx - ccx;
      const dz = chunk.cz - ccz;
      if (dx * dx + dz * dz <= r2 || keep?.(chunk.cx, chunk.cz)) continue;
      this.chunks.delete(key);
      dropped.push(chunk);
    }
    return dropped;
  }

  /** What the chest or furnace at a block holds (made empty the first time), or null for other blocks. */
  blockEntity(x: number, y: number, z: number): BlockEntity | null {
    const chunk = this.chunks.get(VoxelWorld.key(x >> 4, z >> 4));
    if (!chunk || y < 0 || y >= WORLD_HEIGHT) return null;
    const key = (y << 8) | ((z & 15) << 4) | (x & 15);
    const state = chunk.get(x & 15, y, z & 15);
    const kept = chunk.entities.get(key);
    if (kept && keeps(kept, state)) return kept;
    const made = entityFor(STATE_BLOCK[state]);
    if (made) chunk.entities.set(key, made);
    else chunk.entities.delete(key);
    return made;
  }

  /** Block state at integer world coordinates: bedrock below the world, air above it and in missing chunks. */
  get(x: number, y: number, z: number): number {
    if (y < 0) return Block.Bedrock;
    if (y >= WORLD_HEIGHT) return Block.Air;
    const chunk = this.chunks.get(VoxelWorld.key(x >> 4, z >> 4));
    if (!chunk) return Block.Air;
    const blocks = chunk.sections[y >> 4].blocks;
    return blocks ? blocks[sectionIndex(x & 15, y & 15, z & 15)] : Block.Air;
  }

  /**
   * Light at a block (see light.ts): open sky above the world, darkness below it and in missing chunks (no
   * light comes from a chunk that isn't there; it joins in when it arrives).
   */
  getLight(x: number, y: number, z: number): number {
    if (y < 0) return 0;
    if (y >= WORLD_HEIGHT) return OPEN_SKY;
    const chunk = this.chunks.get(VoxelWorld.key(x >> 4, z >> 4));
    if (!chunk) return 0;
    const s = chunk.sections[y >> 4];
    return s.light ? s.light[sectionIndex(x & 15, y & 15, z & 15)] : s.lightFill;
  }

  /**
   * Sets the light at a block of a loaded chunk, and marks the sections whose meshes show it: faces take
   * their light from the blocks in front of them and around their corners, up to two blocks away.
   */
  setLight(x: number, y: number, z: number, light: number): boolean {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const cx = x >> 4;
    const cz = z >> 4;
    const chunk = this.chunk(cx, cz);
    if (!chunk) return false;
    const s = y >> 4;
    const section = chunk.sections[s];
    const i = sectionIndex(x & 15, y & 15, z & 15);
    if (!section.light) {
      if (section.lightFill === light) return true;
      section.light = new Uint8Array(SECTION_VOLUME).fill(section.lightFill);
    }
    if (section.light[i] === light) return true;
    section.light[i] = light;
    section.dirty = true;
    const lx = x & 15;
    const ly = y & 15;
    const lz = z & 15;
    if (ly <= 1 && s > 0) chunk.sections[s - 1].dirty = true;
    if (ly >= 14 && s < SECTIONS - 1) chunk.sections[s + 1].dirty = true;
    if (lx <= 1) this.markDirty(cx - 1, cz, s);
    if (lx >= 14) this.markDirty(cx + 1, cz, s);
    if (lz <= 1) this.markDirty(cx, cz - 1, s);
    if (lz >= 14) this.markDirty(cx, cz + 1, s);
    return true;
  }

  isSolid(x: number, y: number, z: number): boolean {
    return SOLID[this.get(x, y, z)] === 1;
  }

  /** Boxes that stop entities in the block at (x, y, z) (see COLLISION). */
  collisionBoxes(x: number, y: number, z: number): Float64Array {
    return COLLISION[this.get(x, y, z)];
  }

  /** Sets a block in a loaded chunk and marks the sections whose faces change. Returns false outside the world. */
  set(x: number, y: number, z: number, state: number): boolean {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const cx = x >> 4;
    const cz = z >> 4;
    const chunk = this.chunk(cx, cz);
    if (!chunk) return false;
    const lx = x & 15;
    const ly = y & 15;
    const lz = z & 15;
    const s = y >> 4;
    const old = chunk.get(lx, y, lz);
    chunk.set(lx, y, lz, state);
    chunk.unsaved = true;
    const entityKey = (y << 8) | (lz << 4) | lx;
    const entity = chunk.entities.get(entityKey);
    if (entity && !keeps(entity, state)) {
      chunk.entities.delete(entityKey);
      this.onEntityRemoved?.(x, y, z, entity);
    }
    chunk.packed = null;
    chunk.sections[s].dirty = true;
    if (ly === 0 && s > 0) chunk.sections[s - 1].dirty = true;
    if (ly === CHUNK_SIZE - 1 && s < SECTIONS - 1) chunk.sections[s + 1].dirty = true;
    if (lx === 0) this.markDirty(cx - 1, cz, s);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz, s);
    if (lz === 0) this.markDirty(cx, cz - 1, s);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1, s);
    relight(this, x, y, z);
    this.onChanged?.(x, y, z, old);
    return true;
  }

  /**
   * Rebuilds the face lists of a chunk's dirty sections. A cube's face shows unless the block next to it
   * covers that side completely (COVERS), is the same see-through block (glass next to glass, water next
   * to water, unless that water is lower), or is leaves drawn without see-through textures (fancyLeaves
   * off). Faces toward a chunk that isn't loaded yet stay hidden until it is. A block drawn as a model
   * gets one entry (MODEL_FACE) for all its quads, which the meshers cull one by one.
   */
  buildFaces(chunk: Chunk): void {
    for (let s = 0; s < SECTIONS; s++) {
      const section = chunk.sections[s];
      if (section.dirty) this.buildSectionFaces(chunk, s, section);
    }
  }

  private buildSectionFaces(chunk: Chunk, sy: number, section: Section): void {
    section.dirty = false;
    section.faceCount = 0;
    const blocks = section.blocks;
    if (!blocks) return;
    const fancy = this.fancyLeaves;
    // Inside a section of nothing but opaque blocks every face is covered: only its outer layer can show any
    const shell = section.opaque === SECTION_VOLUME;
    const neighbors = [
      this.chunk(chunk.cx + 1, chunk.cz),
      this.chunk(chunk.cx - 1, chunk.cz),
      chunk,
      chunk,
      this.chunk(chunk.cx, chunk.cz + 1),
      this.chunk(chunk.cx, chunk.cz - 1),
    ];
    let faces = section.faces;
    let count = 0;
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const step = shell && y > 0 && y < CHUNK_SIZE - 1 && z > 0 && z < CHUNK_SIZE - 1 ? CHUNK_SIZE - 1 : 1;
        for (let x = 0; x < CHUNK_SIZE; x += step) {
          const b = blocks[sectionIndex(x, y, z)];
          if (b === Block.Air) continue;
          if (CUBE_SHAPED[b] === 0) {
            if (count === faces.length) faces = grow(faces);
            faces[count++] = packFace(x, y, z, MODEL_FACE, b);
            continue;
          }
          const kind = STATE_BLOCK[b];
          for (let d = 0; d < 6; d++) {
            const nx = x + DIR_X[d];
            const ny = y + DIR_Y[d];
            const nz = z + DIR_Z[d];
            let n: number;
            if (nx >= 0 && nx < CHUNK_SIZE && ny >= 0 && ny < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE) {
              n = blocks[sectionIndex(nx, ny, nz)];
            } else {
              const wy = sy * CHUNK_SIZE + ny;
              // Nobody sees the bottom of the world
              if (wy < 0) continue;
              const other = neighbors[d];
              if (!other) continue;
              n = wy >= WORLD_HEIGHT ? Block.Air : other.get(nx & 15, wy, nz & 15);
            }
            if (COVERS[n * 6 + (d ^ 1)] === 1 || (!fancy && LEAFY[n] === 1)) continue;
            if (CULL_SAME[b] === 1 && STATE_BLOCK[n] === kind) {
              // A fluid's side shows above a lower surface of the same fluid next to it
              if (FLUID[b] === 0 || d === 2 || d === 3) continue;
              const wy = sy * CHUNK_SIZE + y;
              const own = FLUID[this.get(chunk.cx * 16 + x, wy + 1, chunk.cz * 16 + z)] === FLUID[b] ? 1 : ownHeight(b);
              const theirs = FLUID[this.get(chunk.cx * 16 + nx, wy + 1, chunk.cz * 16 + nz)] === FLUID[b] ? 1 : ownHeight(n);
              if (theirs >= own) continue;
            }
            if (count === faces.length) faces = grow(faces);
            faces[count++] = packFace(x, y, z, d, b);
          }
        }
      }
    }
    section.faces = faces;
    section.faceCount = count;
  }

  private markDirty(cx: number, cz: number, s: number): void {
    const chunk = this.chunk(cx, cz);
    if (chunk) chunk.sections[s].dirty = true;
  }

  /** Marks every section of a chunk that has blocks (an empty one has no faces either way). */
  private markColumnDirty(cx: number, cz: number): void {
    const chunk = this.chunk(cx, cz);
    if (!chunk) return;
    for (const s of chunk.sections) if (s.blocks) s.dirty = true;
  }
}

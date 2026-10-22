import { OPAQUE } from "./blocks.js";

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 256;
/** Sections of 16 x 16 x 16 blocks stacked in a chunk. */
export const SECTIONS = WORLD_HEIGHT / CHUNK_SIZE;
export const SECTION_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;

/**
 * Corners of each face direction's quad (Dir order), as offsets from the block's minimum corner, wound
 * so the face's normal points out of the block.
 */
export const FACE_CORNERS: Float64Array = Float64Array.from([
  [1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1],
  [0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0],
  [0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0],
  [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1],
  [0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1],
  [0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0],
].flat());

/** Index of a block inside a section: x, y and z in [0, 16). */
export function sectionIndex(x: number, y: number, z: number): number {
  return (y << 8) | (z << 4) | x;
}

/** The direction a face list entry has for a block drawn as a model: one entry stands for all its quads. */
export const MODEL_FACE = 7;

/**
 * A face in one int: x, y and z inside its section (4 bits each), direction (3 bits; MODEL_FACE for a
 * model), and the block state (16 bits, read with `>>> 16`).
 */
export function packFace(x: number, y: number, z: number, dir: number, state: number): number {
  return x | (z << 4) | (y << 8) | (dir << 12) | (state << 16);
}

/** A chunk's blocks as saves store them: a palette of state names and the compressed blocks (see encodeBlocks). */
export interface PackedBlocks {
  palette: string[];
  blocks: Uint8Array;
}

/** 16 x 16 x 16 blocks of a chunk, and the faces of them that can be seen. */
export class Section {
  /** Block states, or null while the section is all air. */
  blocks: Uint16Array | null = null;
  /** Blocks that aren't air. */
  count: number = 0;
  /** Opaque blocks: when all are, only the section's outer layer can have faces. */
  opaque: number = 0;
  /**
   * Light per block, sky light in the high 4 bits and block light in the low ones (see light.ts), or null
   * while the whole section has the same light, `lightFill`.
   */
  light: Uint8Array | null = null;
  lightFill: number = 0xf0;
  /** Exposed faces (see packFace); valid while the section is not dirty. */
  faces: Int32Array = new Int32Array(0);
  faceCount: number = 0;
  /** The faces need rebuilding: a block changed here or next door. */
  dirty: boolean = true;
}

/** A 16 x 256 x 16 column of blocks in 16 sections. */
export class Chunk {
  readonly sections: Section[] = Array.from({ length: SECTIONS }, () => new Section());
  /** Changed since it was last saved, or never saved (as every new chunk). */
  unsaved: boolean = true;
  /**
   * The blocks already encoded for saving (by the worker that generated the chunk), until a block changes:
   * saving then needn't encode them on the main thread.
   */
  packed: PackedBlocks | null = null;
  /** The biome (Biome id) of every column, at z * 16 + x. */
  biomes: Uint8Array = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  /** The version of the terrain generator that made it (GENERATOR_VERSION; 0 before it was known). */
  generator: number = 0;

  constructor(
    readonly cx: number,
    readonly cz: number,
  ) {}

  get(x: number, y: number, z: number): number {
    const blocks = this.sections[y >> 4].blocks;
    return blocks ? blocks[sectionIndex(x, y & 15, z)] : 0;
  }

  set(x: number, y: number, z: number, state: number): void {
    const s = this.sections[y >> 4];
    if (!s.blocks) {
      if (state === 0) return;
      s.blocks = new Uint16Array(SECTION_VOLUME);
    }
    const i = sectionIndex(x, y & 15, z);
    const before = s.blocks[i];
    if (before === state) return;
    s.blocks[i] = state;
    s.opaque += OPAQUE[state] - OPAQUE[before];
    if (before === 0) s.count++;
    else if (state === 0 && --s.count === 0) s.blocks = null;
  }

  /** Some section's faces need rebuilding. */
  get dirty(): boolean {
    return this.sections.some((s) => s.dirty);
  }

  /** Lowest and highest y of any face, for culling (0, -1 without faces). */
  faceBounds(): [number, number] {
    let lo = -1;
    let hi = -1;
    for (let i = 0; i < SECTIONS; i++) {
      if (this.sections[i].faceCount === 0) continue;
      if (lo < 0) lo = i;
      hi = i;
    }
    return lo < 0 ? [0, -1] : [lo * CHUNK_SIZE, hi * CHUNK_SIZE + CHUNK_SIZE - 1];
  }
}

/** Fills a new chunk with blocks. */
export interface ChunkGenerator {
  generate(chunk: Chunk): void;
}

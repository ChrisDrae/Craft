export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 64;
/** Top of a water block with air above it, so the surface sits a little below the shore. */
export const WATER_TOP = 0.875;

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

/** Index of a block inside a chunk: x and z in [0, 16), y in [0, 64). */
export function localIndex(x: number, y: number, z: number): number {
  return (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
}

/**
 * A face in one int: local x (4 bits), local z (4), y (6), direction (3), block (8), and whether it belongs
 * to a water block with air above, whose top sits a little lower (1).
 */
export function packFace(x: number, y: number, z: number, dir: number, block: number, lowered: boolean): number {
  return x | (z << 4) | (y << 8) | (dir << 14) | (block << 17) | (lowered ? 1 << 25 : 0);
}

/** A 16 x 64 x 16 column of blocks and the faces of it that can be seen. */
export class Chunk {
  readonly blocks: Uint8Array = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
  /** Exposed faces (see packFace); valid while the chunk is not dirty. */
  faces: Int32Array = new Int32Array(1024);
  faceCount: number = 0;
  /** Lowest and highest y of any face, for culling. */
  minY: number = 0;
  maxY: number = 0;
  /** The faces need rebuilding: a block changed here or next door. */
  dirty: boolean = true;

  constructor(
    readonly cx: number,
    readonly cz: number,
  ) {}

  get(x: number, y: number, z: number): number {
    return this.blocks[localIndex(x, y, z)];
  }

  set(x: number, y: number, z: number, block: number): void {
    this.blocks[localIndex(x, y, z)] = block;
  }
}

/** Fills a new chunk with blocks. */
export interface ChunkGenerator {
  generate(chunk: Chunk): void;
}

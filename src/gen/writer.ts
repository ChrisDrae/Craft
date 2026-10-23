import type { BlockEntity } from "../blockEntities.js";
import { BLOCKS, Block, STATE_BLOCK } from "../blocks.js";
import { CHUNK_SIZE, WORLD_HEIGHT, type Chunk } from "../chunk.js";

/**
 * Writes features into a chunk by world coordinates, keeping what falls outside it. A feature that
 * reaches over a border (a tree, a dungeon) is built by every chunk it touches, each keeping its own part,
 * so the parts meet.
 */
export class ChunkWriter {
  readonly ox: number;
  readonly oz: number;

  constructor(readonly chunk: Chunk) {
    this.ox = chunk.cx * CHUNK_SIZE;
    this.oz = chunk.cz * CHUNK_SIZE;
  }

  inside(x: number, y: number, z: number): boolean {
    const lx = x - this.ox;
    const lz = z - this.oz;
    return lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE && y >= 0 && y < WORLD_HEIGHT;
  }

  /** The block there, or -1 outside the chunk. */
  get(x: number, y: number, z: number): number {
    return this.inside(x, y, z) ? this.chunk.get(x - this.ox, y, z - this.oz) : -1;
  }

  set(x: number, y: number, z: number, state: number): void {
    if (this.inside(x, y, z)) this.chunk.set(x - this.ox, y, z - this.oz, state);
  }

  /** Gives the block at a point what it holds (a chest's loot), if the point is in the chunk. */
  setEntity(x: number, y: number, z: number, entity: BlockEntity): void {
    if (this.inside(x, y, z)) this.chunk.entities.set((y << 8) | ((z - this.oz) << 4) | (x - this.ox), entity);
  }

  /** Sets a block only where it takes the place of air or something that gives way (leaves around a trunk). */
  fill(x: number, y: number, z: number, state: number): void {
    const there = this.get(x, y, z);
    if (there === Block.Air || (there > 0 && BLOCKS[STATE_BLOCK[there]].replaceable)) this.set(x, y, z, state);
  }
}

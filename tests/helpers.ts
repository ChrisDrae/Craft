import { Block } from "../src/blocks.js";
import { CHUNK_SIZE, type Chunk, type ChunkGenerator } from "../src/chunk.js";
import { VoxelWorld } from "../src/world.js";

/** Stone up to y = height - 1 everywhere. */
export class FlatGenerator implements ChunkGenerator {
  constructor(private readonly height: number = 10) {}

  generate(chunk: Chunk): void {
    for (let y = 0; y < this.height; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) chunk.set(x, y, z, Block.Stone);
      }
    }
  }
}

/** A flat world with the chunks around the origin loaded. */
export function flatWorld(height: number = 10, radius: number = 1): VoxelWorld {
  const world = new VoxelWorld(new FlatGenerator(height));
  world.loadAround(0, 0, radius, Infinity);
  return world;
}

import { assembleChunk, type GenerateRequest, type GeneratedChunk } from "./generation.js";
import { VoxelWorld } from "./world.js";

/** Chunks being generated at once at most: few, so the nearest missing ones are always next. */
const IN_FLIGHT = 4;

/** Chunks a supply should leave alone (they come from elsewhere, such as a save). */
export type SkipChunk = (cx: number, cz: number) => boolean;

/** Where new chunks come from: the world's generator right away, a worker, or a save. */
export interface ChunkSupply {
  /**
   * Asks for the missing chunks within `radius` chunks of block (x, z), nearest first, except those `skip`
   * leaves out; they enter the world when ready.
   */
  requestAround(world: VoxelWorld, x: number, z: number, radius: number, skip?: SkipChunk): void;
}

/** Generates on the spot, up to a few chunks per frame (tests, and browsers without module workers). */
export class DirectSupply implements ChunkSupply {
  constructor(private readonly budget: number = 2) {}

  requestAround(world: VoxelWorld, x: number, z: number, radius: number, skip?: SkipChunk): void {
    let made = 0;
    for (const [cx, cz] of world.missingAround(x, z, radius)) {
      if (made >= this.budget) return;
      if (skip?.(cx, cz)) continue;
      world.load(cx, cz);
      made++;
    }
  }
}

/**
 * Generates chunks in a Web Worker, nearest first, a few at a time, so the main thread only puts them
 * into the world. The worker runs the same generator, so the chunks are the same as made directly.
 */
export class WorkerSupply implements ChunkSupply {
  private readonly worker: Worker;
  private readonly seed: string;
  private readonly waiting: Set<number> = new Set();
  private world: VoxelWorld | null = null;

  constructor(seed: string) {
    this.seed = seed;
    this.worker = new Worker(new URL("./generation.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<GeneratedChunk>) => {
      const { cx, cz } = e.data;
      this.waiting.delete(VoxelWorld.key(cx, cz));
      // A chunk loaded meanwhile (by the player standing in it) stays as it is
      if (this.world && !this.world.chunk(cx, cz)) this.world.insert(assembleChunk(e.data));
    };
  }

  requestAround(world: VoxelWorld, x: number, z: number, radius: number, skip?: SkipChunk): void {
    this.world = world;
    if (this.waiting.size >= IN_FLIGHT) return;
    for (const [cx, cz] of world.missingAround(x, z, radius)) {
      const key = VoxelWorld.key(cx, cz);
      if (this.waiting.has(key) || skip?.(cx, cz)) continue;
      this.waiting.add(key);
      this.worker.postMessage({ seed: this.seed, cx, cz } satisfies GenerateRequest);
      if (this.waiting.size >= IN_FLIGHT) return;
    }
  }

  dispose(): void {
    this.worker.terminate();
  }
}

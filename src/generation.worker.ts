import { TerrainGenerator } from "./generator.js";
import { generatePackedChunk, transferables, type GenerateRequest, type GeneratedChunk } from "./generation.js";

/** The worker's side of WorkerSupply: generates the chunks it's asked for and posts their blocks back. */
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<GenerateRequest>) => void) | null;
  postMessage(data: GeneratedChunk, transfer: Transferable[]): void;
};
const generators: Map<string, TerrainGenerator> = new Map();

scope.onmessage = async (e) => {
  const { seed, cx, cz } = e.data;
  let generator = generators.get(seed);
  if (!generator) {
    generator = new TerrainGenerator(seed);
    generators.set(seed, generator);
  }
  const data = await generatePackedChunk(generator, cx, cz);
  // The blocks and light move to the main thread instead of being copied
  scope.postMessage(data, transferables(data));
};

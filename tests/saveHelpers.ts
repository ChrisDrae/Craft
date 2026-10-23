import "fake-indexeddb/auto";
import { DirectSupply } from "../src/chunkSupply.js";
import { GENERATOR_VERSION, TerrainGenerator } from "../src/generator.js";
import { FORMAT_VERSION, type PlayerLife, type WorldMeta } from "../src/save/format.js";
import { WorldStore } from "../src/save/store.js";
import { WorldSave, type PlayerState } from "../src/save/worldSave.js";
import { WorldTicks } from "../src/ticks.js";
import { FRESH_VITALS } from "../src/vitals.js";
import { VoxelWorld } from "../src/world.js";

let databases = 0;

/** A store in a database of its own (fake-indexeddb), so tests don't see each other's worlds. */
export function freshStore(): Promise<WorldStore> {
  return WorldStore.open(`craft-test-${databases++}`);
}

export function newMeta(id: string, seed: string = "saves"): WorldMeta {
  return {
    format: FORMAT_VERSION,
    id,
    name: `World ${id}`,
    seed,
    generator: GENERATOR_VERSION,
    created: 1,
    lastPlayed: 1,
    time: 0,
    spawn: null,
    chunks: 0,
    bytes: 0,
    mode: "survival",
    difficulty: "normal",
    hardcore: false,
  };
}

/** A player as a new one is: alive and well. */
export const LIFE: PlayerLife = { vitals: { ...FRESH_VITALS }, bed: null, spectating: false, flying: false };

export const standing: PlayerState = {
  position: { x: 1.5, y: 80, z: 2.5 },
  velocity: { x: 0, y: 0, z: 0 },
  yaw: 0.5,
  pitch: -0.2,
  selected: 3,
  inventory: [{ item: "stone", count: 64 }, { item: "iron_pickaxe", count: 1, damage: 30 }, null, { item: "torch", count: 12 }, ...new Array(37).fill(null)],
  vitals: { health: 13.5, food: 17, saturation: 0, exhaustion: 2.5, air: 300, fire: 0, xp: 42 },
  bed: { x: 3, y: 79, z: 5 },
  spectating: false,
  flying: false,
};

/** A world being played as the game does it: generated directly, with ticks and a save. */
export async function openWorld(store: WorldStore, meta: WorldMeta): Promise<{ world: VoxelWorld; ticks: WorldTicks; save: WorldSave }> {
  const world = new VoxelWorld(new TerrainGenerator(meta.seed));
  const ticks = new WorldTicks(world);
  ticks.time = meta.time;
  const save = new WorldSave({
    store,
    meta,
    world,
    ticks,
    generator: new DirectSupply(Infinity),
    savedChunks: await store.chunkKeys(meta.id),
    player: () => standing,
  });
  return { world, ticks, save };
}

/** Waits until `done` holds (async work in flight), failing after a while. */
export async function until(done: () => boolean, ms: number = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error("Timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}

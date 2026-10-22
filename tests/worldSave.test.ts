import { describe, expect, it } from "vitest";
import { Block } from "../src/blocks.js";
import { VoxelWorld } from "../src/world.js";
import { freshStore, newMeta, openWorld, standing, until } from "./saveHelpers.js";

describe("WorldSave", () => {
  it("saves every generated chunk, the player and the time, and gives them back after a restart", async () => {
    const store = await freshStore();
    await store.putWorld(newMeta("w"));
    const first = await openWorld(store, (await store.getWorld("w"))!);
    await first.save.loadNow(8, 8, 1);
    first.world.set(4, 90, 4, Block.Bricks);
    first.ticks.time = 1234;
    first.ticks.schedule(5, 90, 5, Block.Sand, 100);
    await first.save.save();

    const meta = (await store.getWorld("w"))!;
    expect(meta.chunks).toBe(9);
    expect(meta.time).toBe(1234);
    const sizes = await Promise.all((await store.chunkKeys("w")).map(async ([cx, cz]) => (await store.getChunk("w", cx, cz))!.blocks.length));
    expect(meta.bytes).toBe(sizes.reduce((a, b) => a + b, 0));
    expect(await store.getPlayer("w")).toMatchObject(standing);

    // A fresh session reads the chunks instead of generating them
    const again = await openWorld(store, meta);
    await again.save.loadNow(8, 8, 1);
    expect(again.world.chunks.size).toBe(9);
    expect(again.world.get(4, 90, 4)).toBe(Block.Bricks);
    expect(again.world.chunk(0, 0)!.unsaved).toBe(false);
    expect(again.ticks.inChunk(0, 0)).toEqual([{ x: 5, y: 90, z: 5, block: Block.Sand, due: 1334 }]);
  });

  it("saves on its own every 30 seconds", async () => {
    const store = await freshStore();
    await store.putWorld(newMeta("w"));
    const { world, save } = await openWorld(store, newMeta("w"));
    await save.loadNow(0, 0, 0);
    for (let i = 0; i < 29 * 60; i++) save.update(1 / 60);
    expect(save.lastSaved).toBeNull();
    for (let i = 0; i < 61; i++) save.update(1 / 60);
    await until(() => save.lastSaved !== null);
    expect(world.chunk(0, 0)!.unsaved).toBe(false);
    expect(await store.chunkKeys("w")).toEqual([[0, 0]]);
  });

  it("keeps an edit made while a save is running for the next save", async () => {
    const store = await freshStore();
    await store.putWorld(newMeta("w"));
    const { world, save } = await openWorld(store, newMeta("w"));
    await save.loadNow(0, 0, 0);
    const running = save.save();
    world.set(1, 100, 1, Block.Planks);
    await running;
    expect(world.chunk(0, 0)!.unsaved).toBe(true);
    await save.save();
    const again = await openWorld(store, (await store.getWorld("w"))!);
    await again.save.loadNow(0, 0, 0);
    expect(again.world.get(1, 100, 1)).toBe(Block.Planks);
  });

  it("hands back an unloaded chunk that wasn't written yet, edits and ticks included", async () => {
    const store = await freshStore();
    await store.putWorld(newMeta("w"));
    const { world, ticks, save } = await openWorld(store, newMeta("w"));
    await save.loadNow(0, 0, 0);
    world.set(2, 100, 2, Block.Cobblestone);
    ticks.schedule(2, 100, 2, Block.Cobblestone, 50);
    const chunk = world.chunk(0, 0)!;
    world.unloadOutside(1000, 1000, 0);
    save.unload(chunk);
    expect(save.waiting).toBe(1);
    expect(ticks.scheduledCount).toBe(0);
    save.requestAround(world, 0, 0, 0);
    expect(world.chunk(0, 0)).toBe(chunk);
    expect(ticks.scheduledCount).toBe(1);
    expect(save.waiting).toBe(0);
  });

  it("writes unloaded chunks and reads them back when they're needed again", async () => {
    const store = await freshStore();
    await store.putWorld(newMeta("w"));
    const { world, save } = await openWorld(store, newMeta("w"));
    await save.loadNow(0, 0, 0);
    world.set(3, 100, 3, Block.GoldOre);
    const chunk = world.chunk(0, 0)!;
    world.unloadOutside(1000, 1000, 0);
    save.unload(chunk);
    await save.save();
    expect(save.waiting).toBe(0);
    save.requestAround(world, 0, 0, 0);
    // Read from the store (asynchronously), not generated
    expect(world.chunk(0, 0)).toBeUndefined();
    await until(() => world.chunk(0, 0) !== undefined);
    expect(world.get(3, 100, 3)).toBe(Block.GoldOre);
  });

  it("generates a chunk again whose record is damaged", async () => {
    const store = await freshStore();
    await store.putWorld(newMeta("w"));
    const first = await openWorld(store, newMeta("w"));
    await first.save.loadNow(0, 0, 0);
    await first.save.save();
    const record = (await store.getChunk("w", 0, 0))!;
    await store.save({ meta: (await store.getWorld("w"))!, chunks: [{ ...record, blocks: new Uint8Array([1, 2, 3]) }] });
    const again = await openWorld(store, (await store.getWorld("w"))!);
    const errors = console.error;
    console.error = () => {};
    try {
      await again.save.loadNow(0, 0, 0);
      expect(again.world.chunk(0, 0)).toBeUndefined();
      again.save.requestAround(again.world, 0, 0, 0);
    } finally {
      console.error = errors;
    }
    const fresh = new VoxelWorld(again.world.generator).load(0, 0);
    expect(again.world.chunk(0, 0)!.sections[3].blocks).toEqual(fresh.sections[3].blocks);
  });
});

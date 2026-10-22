import { describe, expect, it } from "vitest";
import { FORMAT_VERSION, NewerFormatError, type ChunkRecord } from "../src/save/format.js";
import { readWorldFile, writeWorldFile } from "../src/save/worldFile.js";
import { freshStore, newMeta } from "./saveHelpers.js";

function chunk(world: string, cx: number, cz: number, fill: number): ChunkRecord {
  return { format: FORMAT_VERSION, world, cx, cz, generator: 1, palette: ["air", "stone"], blocks: new Uint8Array([fill, fill, fill]), ticks: [] };
}

const player = (world: string) => ({
  format: FORMAT_VERSION,
  world,
  position: { x: 1, y: 2, z: 3 },
  velocity: { x: 0, y: -1, z: 0 },
  yaw: 1,
  pitch: 0,
  selected: 2,
  hotbar: ["stone"],
});

describe("WorldStore", () => {
  it("lists worlds by when they were last played and saves a batch at once", async () => {
    const store = await freshStore();
    await store.putWorld({ ...newMeta("a"), lastPlayed: 10 });
    await store.putWorld({ ...newMeta("b"), lastPlayed: 20 });
    expect((await store.listWorlds()).map((m) => m.id)).toEqual(["b", "a"]);
    await store.save({ meta: { ...newMeta("a"), lastPlayed: 30 }, player: player("a"), chunks: [chunk("a", 0, 0, 1), chunk("a", -2, 5, 2)] });
    expect((await store.listWorlds())[0].id).toBe("a");
    expect((await store.chunkKeys("a")).sort()).toEqual([[-2, 5], [0, 0]]);
    expect((await store.getChunk("a", -2, 5))!.blocks).toEqual(new Uint8Array([2, 2, 2]));
    expect(await store.getChunk("a", 1, 1)).toBeNull();
    expect(await store.getPlayer("a")).toEqual(player("a"));
  });

  it("keeps worlds apart: deleting one leaves the others' chunks", async () => {
    const store = await freshStore();
    for (const id of ["a", "b"]) await store.save({ meta: newMeta(id), player: player(id), chunks: [chunk(id, 0, 0, 1), chunk(id, 1, 0, 1)] });
    await store.deleteWorld("a");
    expect(await store.getWorld("a")).toBeNull();
    expect(await store.chunkKeys("a")).toEqual([]);
    expect(await store.getPlayer("a")).toBeNull();
    expect(await store.chunkKeys("b")).toHaveLength(2);
  });

  it("copies a world under a new id and name", async () => {
    const store = await freshStore();
    await store.save({ meta: newMeta("a"), player: player("a"), chunks: [chunk("a", 3, 4, 7)] });
    const copy = await store.duplicateWorld("a", { id: "c", name: "Copy", created: 99 });
    expect(copy).toMatchObject({ id: "c", name: "Copy", created: 99, lastPlayed: 99, seed: "saves" });
    expect(await store.chunkKeys("c")).toEqual([[3, 4]]);
    expect((await store.getPlayer("c"))!.world).toBe("c");
    // The copy is a world of its own
    await store.deleteWorld("a");
    expect((await store.getChunk("c", 3, 4))!.blocks).toEqual(new Uint8Array([7, 7, 7]));
  });

  it("refuses records from a newer Craft", async () => {
    const store = await freshStore();
    await store.putWorld({ ...newMeta("a"), format: FORMAT_VERSION + 1 });
    await expect(store.getWorld("a")).rejects.toBeInstanceOf(NewerFormatError);
  });
});

describe("world files", () => {
  it("hold a whole world and give it back", async () => {
    const store = await freshStore();
    await store.save({ meta: newMeta("a"), player: player("a"), chunks: [chunk("a", 0, 0, 1), chunk("a", 0, 1, 9)] });
    const file = writeWorldFile((await store.readWorld("a"))!);
    const back = readWorldFile(file);
    expect(back.meta).toEqual(newMeta("a"));
    expect(back.player).toEqual(player("a"));
    expect(back.chunks.map((c) => [c.cx, c.cz, Array.from(c.blocks)])).toEqual([
      [0, 0, [1, 1, 1]],
      [0, 1, [9, 9, 9]],
    ]);
  });

  it("refuse anything else", () => {
    const file = writeWorldFile({ meta: newMeta("a"), player: null, chunks: [chunk("a", 0, 0, 1)] });
    expect(() => readWorldFile(new TextEncoder().encode("PK\u0003\u0004 a zip file"))).toThrow(/doesn't start like one/);
    expect(() => readWorldFile(file.subarray(0, file.length - 2))).toThrow(/cut short/);
    const newer = writeWorldFile({ meta: { ...newMeta("a"), format: FORMAT_VERSION + 1 }, player: null, chunks: [] });
    expect(() => readWorldFile(newer)).toThrow(NewerFormatError);
  });
});

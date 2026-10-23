import { describe, expect, it } from "vitest";
import { tickFurnaces, type ChestEntity, type FurnaceEntity, type SavedEntity } from "../src/blockEntities.js";
import { Block, propertyOf, stateOf } from "../src/blocks.js";
import { DirectSupply } from "../src/chunkSupply.js";
import { Drops } from "../src/drops.js";
import { blockBehaviors } from "../src/fluids.js";
import { BlockInteraction } from "../src/interaction.js";
import { ITEMS, Items, TOOLS, stack, type ItemStack } from "../src/items.js";
import { dropsOf } from "../src/mining.js";
import { memoryPair } from "../src/net/connection.js";
import { GuestSession } from "../src/net/guest.js";
import { HostSession } from "../src/net/host.js";
import { Player } from "../src/player.js";
import { WorldSave } from "../src/save/worldSave.js";
import type { Terrain } from "../src/terrain.js";
import { WorldTicks } from "../src/ticks.js";
import { BlockUpdates } from "../src/updates.js";
import { VoxelWorld } from "../src/world.js";
import { flatWorld } from "./helpers.js";
import { freshStore, newMeta, standing } from "./saveHelpers.js";

const nameOf = (s: ItemStack | null): string | null => (s ? `${ITEMS[s.item].name} x${s.count}` : null);

/** A survival world on a stone floor (top at y 9) with block updates, furnaces burning, items dropping. */
function survival() {
  const world = flatWorld(10, 2);
  const ticks = new WorldTicks(world, blockBehaviors());
  const updates = new BlockUpdates(world, ticks);
  world.onChanged = (x, y, z) => updates.changed(x, y, z);
  const drops = new Drops(world);
  world.onEntityRemoved = (x, y, z, e) => drops.spill(x, y, z, e.items);
  ticks.onTick = () => tickFurnaces(world);
  const player = new Player(world, { x: 0.5, y: 10, z: 0.5 });
  const hands = new BlockInteraction(world, player, { target: null } as unknown as Terrain);
  hands.mode = "survival";
  hands.onBroken = (x, y, z, state, held) => drops.spill(x, y, z, dropsOf(state, held, () => 0.5));
  drops.collectors = () => [{ position: player.position, take: (s) => hands.inventory.add(s) }];
  /** Holds the left button on a block for some seconds. */
  const mine = (x: number, y: number, z: number, seconds: number): void => {
    hands.target = { x, y, z, nx: 0, ny: 1, nz: 0, block: world.get(x, y, z), distance: 2 };
    hands.press(0);
    for (let t = 0; t < seconds; t += 0.05) hands.update(0.05);
    hands.release(0);
  };
  return { world, ticks, drops, player, hands, mine };
}

describe("furnaces", () => {
  it("burn fuel to smelt, an item every ten seconds, light up while burning and go out", () => {
    const { world, ticks } = survival();
    world.set(3, 10, 3, Block.Furnace);
    const f = world.blockEntity(3, 10, 3) as FurnaceEntity;
    f.items[0] = stack(Items.RawIron, 3);
    f.items[1] = stack(Block.Planks, 1);
    ticks.tick();
    expect(propertyOf(world.get(3, 10, 3), "lit")).toBe("true");
    expect(world.getLight(3, 11, 3) & 15).toBe(12);
    expect(f.items[1]).toBeNull();
    for (let i = 0; i < 199; i++) ticks.tick();
    expect(nameOf(f.items[2])).toBe("iron_ingot x1");
    // A plank burns 300 ticks: one and a half items, then it goes out and loses the half
    for (let i = 0; i < 200; i++) ticks.tick();
    expect(nameOf(f.items[2])).toBe("iron_ingot x1");
    expect(f.cook).toBe(0);
    expect(propertyOf(world.get(3, 10, 3), "lit")).toBe("false");
    f.items[1] = stack(Items.Coal, 1);
    for (let i = 0; i < 401; i++) ticks.tick();
    expect(nameOf(f.items[2])).toBe("iron_ingot x3");
    expect(f.items[0]).toBeNull();
  });
});

describe("chests and items on the ground", () => {
  it("keep what they hold through a save, and a broken chest spills it", async () => {
    const store = await freshStore();
    const meta = newMeta("chests");
    await store.putWorld(meta);
    const make = () => {
      const world = new VoxelWorld({ generate: (c) => { for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) c.set(x, 9, z, Block.Stone); } });
      const ticks = new WorldTicks(world);
      const drops = new Drops(world);
      const save = new WorldSave({ store, meta, world, ticks, generator: new DirectSupply(Infinity), savedChunks: [], player: () => standing, drops });
      return { world, drops, save };
    };
    const first = make();
    await first.save.loadNow(0, 0, 1);
    first.world.set(2, 10, 2, Block.Chest);
    (first.world.blockEntity(2, 10, 2) as ChestEntity).items[5] = stack(Block.Torch, 20);
    first.drops.spawn(6.5, 10, 6.5, stack(Items.Diamond, 2), { x: 0, y: 0, z: 0 });
    await first.save.save();

    const second = make();
    (second.save as unknown as { saved: Set<number> }).saved = new Set((await store.chunkKeys("chests")).map(([cx, cz]) => VoxelWorld.key(cx, cz)));
    await second.save.loadNow(0, 0, 1);
    expect(nameOf((second.world.blockEntity(2, 10, 2) as ChestEntity).items[5])).toBe("torch x20");
    expect([...second.drops.items.values()].map((d) => nameOf(d.stack))).toEqual(["diamond x2"]);

    second.world.onEntityRemoved = (x, y, z, e) => second.drops.spill(x, y, z, e.items);
    second.world.set(2, 10, 2, Block.Air);
    expect([...second.drops.items.values()].map((d) => nameOf(d.stack)).sort()).toEqual(["diamond x2", "torch x20"]);
  });

  it("merge with their kind, get picked up by whoever comes near and go after five minutes", () => {
    const { world, drops, player, hands } = survival();
    drops.spawn(5.5, 10, 5.5, stack(Block.Dirt, 10), { x: 0, y: 0, z: 0 }, 0);
    drops.spawn(5.7, 10, 5.4, stack(Block.Dirt, 7), { x: 0, y: 0, z: 0 }, 0);
    drops.spawn(9.5, 10, 9.5, stack(Block.Sand, 1), { x: 0, y: 0, z: 0 }, 0);
    for (let i = 0; i < 20; i++) drops.update(0.05);
    expect([...drops.items.values()].map((d) => nameOf(d.stack)).sort()).toEqual(["dirt x17", "sand x1"]);
    player.position.x = 5.5;
    player.position.z = 5.5;
    drops.update(0.05);
    expect(hands.inventory.count(Block.Dirt)).toBe(17);
    drops.update(301);
    expect(drops.items.size).toBe(0);
    void world;
  });
});

describe("survival", () => {
  it("breaks blocks in as long as the tool takes, dropping what they drop, and wears the tool", () => {
    const { world, drops, hands, mine } = survival();
    // Stone by hand: 7.5 seconds (letting go starts over), and no cobblestone for it
    mine(2, 9, 2, 5);
    expect(world.get(2, 9, 2)).toBe(Block.Stone);
    mine(2, 9, 2, 5);
    expect(world.get(2, 9, 2)).toBe(Block.Stone);
    mine(2, 9, 2, 7.6);
    expect(world.get(2, 9, 2)).toBe(Block.Air);
    expect(drops.items.size).toBe(0);
    // With a wooden pickaxe: just over a second, cobblestone, one use off the pickaxe
    hands.inventory.put(0, stack(TOOLS.wooden.pickaxe));
    mine(3, 9, 2, 1.3);
    expect(world.get(3, 9, 2)).toBe(Block.Air);
    expect([...drops.items.values()].map((d) => nameOf(d.stack))).toEqual(["cobblestone x1"]);
    expect(hands.inventory.held!.damage).toBe(1);
  });

  it("uses up what it places", () => {
    const { world, hands } = survival();
    hands.inventory.put(0, stack(Block.Planks, 2));
    hands.select(0);
    for (const x of [3, 4, 5]) {
      hands.target = { x, y: 9, z: 3, nx: 0, ny: 1, nz: 0, block: Block.Stone, distance: 3 };
      hands.placeAtTarget();
    }
    expect([world.get(3, 10, 3), world.get(4, 10, 3), world.get(5, 10, 3)]).toEqual([Block.Planks, Block.Planks, Block.Air]);
    expect(hands.inventory.held).toBeNull();
  });
});

describe("items with friends", () => {
  it("a guest's breaking drops on the host, the guest picks it up, and edits the host's chest", async () => {
    const world = flatWorld(10, 3);
    const ticks = new WorldTicks(world);
    const drops = new Drops(world);
    world.onEntityRemoved = (x, y, z, e) => drops.spill(x, y, z, e.items);
    const host = new HostSession({
      world,
      ticks,
      worldName: "Shared",
      mode: "survival",
      difficulty: () => "normal",
      hardcore: false,
      drops,
      host: () => ({ id: "host", name: "Host", x: -20.5, y: 10, z: 0.5, yaw: 0, pitch: 0 }),
      spawn: () => ({ x: 8.5, y: 10, z: 8.5 }),
      saved: () => null,
    });
    world.onChanged = (x, y, z) => host.changed(x, y, z);
    const [hostEnd, guestEnd] = memoryPair();
    host.accept(hostEnd);
    const gw = new VoxelWorld({ generate: () => {} });
    const guest = new GuestSession(guestEnd, { world: gw, ticks: new WorldTicks(gw), id: "guest-1", name: "Alex", view: 2 });
    const given: ItemStack[] = [];
    guest.onGiven = (s) => given.push(s);
    const containers: Array<SavedEntity | null> = [];
    guest.onContainer = (_x, _y, _z, e) => containers.push(e);
    const run = async (n: number): Promise<void> => {
      for (let i = 0; i < n; i++) {
        host.update(0.1);
        drops.update(0.1);
        guest.report(0.1, { position: { x: 8.5, y: 10, z: 8.5 }, yaw: 0, pitch: 0 });
        await new Promise((r) => setTimeout(r, 0));
        await guest.settled();
      }
    };
    expect((await guest.welcome).mode).toBe("survival");
    await run(5);
    // Breaking stone with a stone pickaxe: cobblestone drops on the host's side, the guest is told about it
    guest.act({ act: "break", x: 8, y: 9, z: 9, nx: 0, ny: 1, nz: 0, hy: 1, block: Block.Air, yaw: 0 }, stack(TOOLS.stone.pickaxe));
    await run(10);
    expect(world.get(8, 9, 9)).toBe(Block.Air);
    expect(guest.drops.map(([, , , , item, count]) => nameOf(stack(item, count)))).toEqual(["cobblestone x1"]);
    guest.take(guest.drops[0][0], 64);
    await run(2);
    expect(given.map(nameOf)).toEqual(["cobblestone x1"]);
    expect(drops.items.size).toBe(0);
    // A chest the host has: the guest opens it, sees it, and takes from it
    world.set(9, 10, 9, stateOf(Block.Chest, {}));
    (world.blockEntity(9, 10, 9) as ChestEntity).items[0] = stack(Block.Glass, 4);
    guest.open(9, 10, 9);
    await run(2);
    expect(containers.at(-1)!.items[0]).toEqual({ item: "glass", count: 4 });
    guest.setSlots(9, 10, 9, [[0, null], [1, { item: "torch", count: 2 }]]);
    await run(2);
    const chest = world.blockEntity(9, 10, 9) as ChestEntity;
    expect([nameOf(chest.items[0]), nameOf(chest.items[1])]).toEqual([null, "torch x2"]);
    // Broken by the host, the chest spills, and the guest's screen hears it is gone
    world.set(9, 10, 9, Block.Air);
    await run(2);
    expect(containers.at(-1)).toBeNull();
    expect([...drops.items.values()].map((d) => nameOf(d.stack))).toEqual(["torch x2"]);
  });
});

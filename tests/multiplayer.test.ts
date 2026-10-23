import { describe, expect, it } from "vitest";
import { perform, type Action } from "../src/actions.js";
import { Block, stateName } from "../src/blocks.js";
import type { ChunkGenerator } from "../src/chunk.js";
import { blockBehaviors } from "../src/fluids.js";
import { memoryPair } from "../src/net/connection.js";
import { GuestSession } from "../src/net/guest.js";
import { HostSession, type HostOptions } from "../src/net/host.js";
import { encode, type GuestState } from "../src/net/protocol.js";
import { stack } from "../src/items.js";
import { WorldTicks } from "../src/ticks.js";
import { BlockUpdates } from "../src/updates.js";
import { Drops } from "../src/drops.js";
import { VoxelWorld } from "../src/world.js";
import { flatWorld } from "./helpers.js";

/** A guest's world makes nothing itself: its chunks come from the host. */
const nothing: ChunkGenerator = { generate: () => {} };

/** A host on a stone floor (top at y 9) with block updates and ticks, and guests to connect to it. */
function hostWorld(more: Partial<HostOptions> = {}) {
  const world = flatWorld(10, 4);
  const ticks = new WorldTicks(world, blockBehaviors());
  const updates = new BlockUpdates(world, ticks);
  const kept = new Map<string, GuestState>();
  const drops = new Drops(world);
  const host = new HostSession({
    world,
    ticks,
    worldName: "Shared",
    mode: "creative",
    difficulty: () => "normal",
    hardcore: false,
    drops,
    host: () => ({ id: "host", name: "Host", x: 0.5, y: 10, z: 0.5, yaw: 0, pitch: 0 }),
    spawn: () => ({ x: 8.5, y: 10, z: 8.5 }),
    saved: (id) => kept.get(id) ?? null,
    onLeave: (g) => kept.set(g.id, structuredClone(g.state)),
    ...more,
  });
  world.onChanged = (x, y, z) => {
    updates.changed(x, y, z);
    host.changed(x, y, z);
  };
  const guests: Array<{ session: GuestSession; world: VoxelWorld }> = [];
  const join = (id: string, name: string = id, view: number = 2) => {
    const [hostEnd, guestEnd] = memoryPair();
    host.accept(hostEnd);
    const gw = new VoxelWorld(nothing);
    const session = new GuestSession(guestEnd, { world: gw, ticks: new WorldTicks(gw), id, name, view });
    const guest = { session, world: gw };
    guests.push(guest);
    return guest;
  };
  /** Frames of the host and guests going back and forth. */
  const run = async (frames: number = 10): Promise<void> => {
    for (let i = 0; i < frames; i++) {
      host.update(0.05);
      ticks.tick();
      for (const g of guests) g.session.report(0.05, { position: { x: 8.5, y: 10, z: 8.5 }, yaw: 0, pitch: 0 });
      await new Promise((r) => setTimeout(r, 0));
      await Promise.all(guests.map((g) => g.session.settled()));
    }
  };
  return { world, ticks, host, kept, drops, join, run };
}

/** An action the way BlockInteraction makes it: on the top face of a block, looking south. */
const onTop = (act: Action["act"], x: number, y: number, z: number, block: number = Block.Air): Action => ({ act, x, y, z, nx: 0, ny: 1, nz: 0, hy: 1, block, yaw: 0 });

describe("multiplayer", () => {
  it("welcomes a guest where newcomers start and sends them the chunks around, the same as the host's", async () => {
    const { world, join, run } = hostWorld();
    world.set(9, 10, 9, Block.Glowstone);
    const guest = join("guest-1", "Alex");
    const { world: name, you } = await guest.session.welcome;
    expect(name).toBe("Shared");
    expect(you.position).toEqual({ x: 8.5, y: 10, z: 8.5 });
    await run(10);
    // All 21 chunks within 2 of the guest's, as the world loads them (a circle, not a square)
    expect(guest.world.chunks.size).toBe(21);
    for (const [x, y, z] of [[0, 9, 0], [9, 10, 9], [-20, 9, 30], [5, 30, 5]]) expect(guest.world.get(x, y, z)).toBe(world.get(x, y, z));
    // Lit on the guest's side as on the host's
    expect(guest.world.getLight(10, 10, 9)).toBe(world.getLight(10, 10, 9));
  });

  it("sends block changes both ways, block updates included, to every guest", async () => {
    const { world, join, run } = hostWorld();
    const a = join("guest-a");
    const b = join("guest-b");
    await run(10);
    world.set(8, 10, 8, Block.Stone);
    await run(2);
    expect(a.world.get(8, 10, 8)).toBe(Block.Stone);
    // A guest places a door: done at once on their side, then by the host, both halves reaching the other guest
    const door: Action = { ...onTop("place", 6, 9, 6, Block.OakDoor), yaw: Math.PI };
    expect(perform(a.world, door, [])).toBe(true);
    a.session.act(door, null);
    await run(3);
    expect(stateName(world.get(6, 11, 6))).toBe("oak_door[facing=north,half=upper,open=false,hinge=left,powered=false]");
    expect(b.world.get(6, 11, 6)).toBe(world.get(6, 11, 6));
    // Water poured by a guest flows on the host, and the flow reaches the guests
    a.session.act(onTop("place", 3, 9, 3, Block.Water), null);
    await run(30);
    expect(world.get(4, 10, 3)).not.toBe(Block.Air);
    expect(b.world.get(4, 10, 3)).toBe(world.get(4, 10, 3));
  });

  it("puts right on a guest's side what the host refuses: out of reach, or into a player", async () => {
    const { world, join, run } = hostWorld();
    const guest = join("guest-1");
    await run(10);
    // Twenty blocks away from where the guest stands
    const far = onTop("place", 28, 9, 8, Block.Planks);
    perform(guest.world, far, []);
    expect(guest.world.get(28, 10, 8)).toBe(Block.Planks);
    guest.session.act(far, null);
    await run(2);
    expect(world.get(28, 10, 8)).toBe(Block.Air);
    expect(guest.world.get(28, 10, 8)).toBe(Block.Air);
    // Into the host's feet
    guest.session.act(onTop("place", 0, 9, 0, Block.Planks), null);
    await run(2);
    expect(world.get(0, 10, 0)).toBe(Block.Air);
  });

  it("tells every player where the others are", async () => {
    const { host, join, run } = hostWorld();
    const a = join("guest-a", "Alex");
    const b = join("guest-b", "Sam");
    await run(6);
    expect(host.guests.map((g) => g.name).sort()).toEqual(["Alex", "Sam"]);
    expect(b.session.others.map((p) => p.name).sort()).toEqual(["Alex", "Host"]);
    expect(a.session.others.find((p) => p.name === "Sam")).toMatchObject({ x: 8.5, y: 10, z: 8.5 });
    expect(host.focuses()).toEqual([
      { x: 8.5, z: 8.5, radius: 2 },
      { x: 8.5, z: 8.5, radius: 2 },
    ]);
  });

  it("tells guests the weather when they join and when it turns, and where lightning strikes", async () => {
    let weather = { rain: true, thunder: false };
    const { host, join, run } = hostWorld({ weather: () => weather });
    const guest = join("guest-1");
    expect((await guest.session.welcome).weather).toEqual({ rain: true, thunder: false });
    const heard: unknown[] = [];
    guest.session.onWeather = (rain, thunder) => heard.push({ rain, thunder });
    guest.session.onLightning = (x, y, z) => heard.push([x, y, z]);
    weather = { rain: true, thunder: true };
    host.weatherChanged();
    host.lightning(3, 10, -4);
    await run(2);
    expect(heard).toEqual([{ rain: true, thunder: true }, [3, 10, -4]]);
  });

  it("refuses a guest running another version of Craft", async () => {
    const { host } = hostWorld();
    const [hostEnd, guestEnd] = memoryPair();
    host.accept(hostEnd);
    const answer = new Promise<string>((resolve) => {
      guestEnd.onMessage = (frame) => resolve(new TextDecoder().decode(frame.subarray(4)));
    });
    guestEnd.send(encode({ t: "hello", protocol: 1, registry: 12345, id: "guest-1", name: "Old", view: 4 }));
    expect(await answer).toContain("different version");
    expect(host.guests).toHaveLength(0);
  });

  it("keeps a guest's place and inventory for when they come back, and sends far chunks again after they let go", async () => {
    const { kept, join, run } = hostWorld();
    const first = join("guest-1");
    await first.session.welcome;
    first.session.inventory([stack(Block.Stone, 64), stack(Block.Glass, 5), null, stack(Block.Torch, 12)], 2);
    await run(3);
    first.session.leave();
    await run(1);
    expect(kept.get("guest-1")).toMatchObject({ position: { x: 8.5, y: 10, z: 8.5 }, selected: 2 });
    expect(kept.get("guest-1")!.inventory.slice(0, 4)).toEqual([{ item: "stone", count: 64 }, { item: "glass", count: 5 }, null, { item: "torch", count: 12 }]);
    const again = join("guest-1");
    expect((await again.session.welcome).you.inventory[3]).toEqual({ item: "torch", count: 12 });
    await run(10);
    const chunk = again.world.chunk(1, 1)!;
    again.world.chunks.delete(VoxelWorld.key(1, 1));
    again.session.drop(chunk);
    await run(4);
    expect(again.world.chunk(1, 1)).toBeDefined();
  });
});

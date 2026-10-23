import { describe, expect, it } from "vitest";
import { perform, type Action } from "../src/actions.js";
import { takeXp, tickFurnaces, type ChestEntity, type FurnaceEntity } from "../src/blockEntities.js";
import { Block, propertyOf, stateOf } from "../src/blocks.js";
import type { ChunkGenerator } from "../src/chunk.js";
import { Drops } from "../src/drops.js";
import { blockBehaviors } from "../src/fluids.js";
import { assembleChunk, generateChunk } from "../src/generation.js";
import { TerrainGenerator } from "../src/generator.js";
import { BlockInteraction } from "../src/interaction.js";
import { ITEMS, Items, TOOLS, stack } from "../src/items.js";
import { dropsOf, xpOf } from "../src/mining.js";
import { memoryPair } from "../src/net/connection.js";
import { GuestSession } from "../src/net/guest.js";
import { HostSession } from "../src/net/host.js";
import { ORB } from "../src/net/protocol.js";
import { Player } from "../src/player.js";
import { Survival } from "../src/survival.js";
import type { Terrain } from "../src/terrain.js";
import { WorldTicks } from "../src/ticks.js";
import { BlockUpdates } from "../src/updates.js";
import { VoxelWorld } from "../src/world.js";
import { flatWorld } from "./helpers.js";

/** A survival world on a stone floor (top at y 9) with block updates, and a player with vitals. */
function alive() {
  const world = flatWorld(10, 2);
  const ticks = new WorldTicks(world, blockBehaviors());
  const updates = new BlockUpdates(world, ticks);
  world.onChanged = (x, y, z) => updates.changed(x, y, z);
  const player = new Player(world, { x: 0.5, y: 10, z: 0.5 });
  const hands = new BlockInteraction(world, player, { target: null } as unknown as Terrain);
  hands.mode = "survival";
  const survival = new Survival(world, player, hands.inventory);
  // Not fed enough to heal by itself, so hurts show as they are
  survival.vitals.food = 17;
  survival.vitals.saturation = 0;
  /** Physics steps and game ticks for some seconds. */
  const live = (seconds: number): void => {
    for (let t = 0; t < seconds; t += 0.05) {
      player.fixedUpdate(0.05);
      survival.tick();
    }
  };
  return { world, ticks, player, hands, survival, live };
}

const onTop = (act: Action["act"], x: number, y: number, z: number, block: number = Block.Air, yaw: number = 0): Action => ({ act, x, y, z, nx: 0, ny: 1, nz: 0, hy: 1, block, yaw });

describe("falling", () => {
  it("hurts a point for every block beyond three, on landing", () => {
    const { player, survival, live } = alive();
    player.position.y = 20;
    live(3);
    expect(player.onGround).toBe(true);
    expect(survival.vitals.health).toBe(13);
  });

  it("hurts half as much onto a bed, and not at all into water", () => {
    const bed = alive();
    perform(bed.world, onTop("place", 0, 9, 0, Block.WhiteBed + 14), []);
    expect(bed.world.get(0, 10, 0)).toBe(stateOf(Block.WhiteBed + 14, { facing: "south", part: "foot" }));
    bed.player.position.y = 20;
    bed.live(3);
    expect(bed.survival.vitals.health).toBe(17);

    const pool = alive();
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) for (let y = 7; y <= 9; y++) pool.world.set(x, y, z, Block.Water);
    pool.player.position.y = 20;
    pool.live(4);
    expect(pool.survival.vitals.health).toBe(20);
  });

  it("dies of it, and says so", () => {
    const { player, survival, live } = alive();
    let deaths = 0;
    survival.onDeath = () => deaths++;
    player.position.y = 60;
    live(5);
    expect(survival.vitals.dead).toBe(true);
    expect(survival.vitals.cause).toBe("fall");
    expect(deaths).toBe(1);
    survival.revive();
    expect(survival.vitals.health).toBe(20);
  });

  it("flying in creative, and landing, takes nothing", () => {
    const { player, survival, live } = alive();
    survival.mode = "creative";
    player.mayFly = true;
    player.position.y = 40;
    live(4);
    expect(survival.vitals.health).toBe(20);
    player.flying = true;
    player.position.y = 20;
    player.input.descend = true;
    live(3);
    expect(player.flying).toBe(false);
    expect(player.position.y).toBeCloseTo(10, 3);
  });
});

describe("what the player is in", () => {
  it("lava, water over the eyes, a block at the eyes, a cactus alongside", () => {
    const { world, player, survival } = alive();
    world.set(0, 10, 0, Block.Lava);
    expect(survival.surroundings().inLava).toBe(true);
    world.set(0, 10, 0, Block.Water);
    world.set(0, 11, 0, Block.Water);
    expect(survival.surroundings()).toMatchObject({ inLava: false, inWater: true, eyesInWater: true });
    world.set(0, 11, 0, Block.Stone);
    expect(survival.surroundings().inWall).toBe(true);
    world.set(0, 10, 0, Block.Air);
    world.set(0, 11, 0, Block.Air);
    world.set(1, 10, 0, Block.Sand);
    world.set(1, 11, 0, Block.Cactus);
    expect(survival.surroundings().onCactus).toBe(false);
    player.position.x = 1 - 0.3 + 1 / 16 - 0.005;
    expect(survival.surroundings().onCactus).toBe(true);
  });

  it("armor worn lessens the lava's hurt and wears", () => {
    const { world, hands, survival } = alive();
    hands.inventory.put(37, stack(ITEMS.find((i) => i.name === "diamond_chestplate")!.id));
    expect(survival.armor().defense).toBe(8);
    world.set(0, 10, 0, Block.Lava);
    survival.tick();
    // A diamond chestplate: 8 points, toughness 2
    expect(survival.vitals.health).toBeCloseTo(20 - 4 * (1 - (8 - 16 / 10) / 25));
    expect(hands.inventory.slots[37]!.damage).toBe(1);
  });

  it("hunger stops sprinting", () => {
    const { player, survival } = alive();
    survival.vitals.food = 6;
    survival.tick();
    player.input.sprint = true;
    player.input.forward = 1;
    expect(player.sprinting).toBe(false);
    survival.vitals.food = 7;
    survival.tick();
    expect(player.sprinting).toBe(true);
  });
});

describe("eating", () => {
  it("takes holding the right button 1.6 seconds, when hungry; stew leaves its bowl", () => {
    const { hands, survival } = alive();
    hands.canEat = () => survival.vitals.hungry;
    hands.onEat = (food) => survival.vitals.eat(food);
    hands.inventory.put(0, stack(Items.Bread, 3));
    // Not hungry: nothing happens
    survival.vitals.food = 20;
    hands.press(2);
    expect(hands.eating).toBeNull();
    survival.vitals.food = 10;
    hands.press(2);
    for (let t = 0; t < 1.5; t += 0.05) hands.update(0.05);
    expect(survival.vitals.food).toBe(10);
    hands.update(0.11);
    expect(survival.vitals.food).toBe(15);
    expect(hands.inventory.slots[0]!.count).toBe(2);
    hands.release(2);
    hands.inventory.put(0, stack(Items.MushroomStew));
    hands.press(2);
    for (let t = 0; t < 1.7; t += 0.05) hands.update(0.05);
    expect(survival.vitals.food).toBe(20);
    expect(ITEMS[hands.inventory.slots[0]!.item].name).toBe("bowl");
  });
});

describe("beds", () => {
  it("go down two long, the head the way the player looks, and go together", () => {
    const { world } = alive();
    const red = Block.WhiteBed + 14;
    // Looking east (yaw 90 degrees)
    expect(perform(world, onTop("place", 2, 9, 2, red, Math.PI / 2), [])).toBe(true);
    expect(propertyOf(world.get(2, 10, 2), "part")).toBe("foot");
    expect(world.get(3, 10, 2)).toBe(stateOf(red, { facing: "east", part: "head" }));
    // Not where the head has no room
    world.set(6, 10, 3, Block.Stone);
    expect(perform(world, onTop("place", 5, 9, 3, red, Math.PI / 2), [])).toBe(false);
    // Breaking one half takes the other; it drops one bed
    expect(perform(world, { ...onTop("break", 3, 10, 2), nx: 0 }, [])).toBe(true);
    expect(world.get(2, 10, 2)).toBe(Block.Air);
    expect(dropsOf(stateOf(red, { facing: "east", part: "head" }), null, Math.random)).toEqual([stack(red)]);
  });
});

describe("experience", () => {
  it("comes from ores harvested with the right tool", () => {
    const pick = stack(TOOLS.wooden.pickaxe);
    expect(xpOf(Block.CoalOre, pick, () => 0.99)).toBe(2);
    expect(xpOf(Block.CoalOre, null, () => 0.99)).toBe(0);
    expect(xpOf(Block.DiamondOre, stack(TOOLS.iron.pickaxe), () => 0)).toBe(3);
    expect(xpOf(Block.IronOre, stack(TOOLS.iron.pickaxe), () => 0.5)).toBe(0);
  });

  it("from smelting, kept in the furnace until its output is taken", () => {
    const { world, ticks } = alive();
    ticks.onTick = () => tickFurnaces(world);
    world.set(3, 10, 3, Block.Furnace);
    const f = world.blockEntity(3, 10, 3) as FurnaceEntity;
    f.items[0] = stack(Items.RawIron, 3);
    f.items[1] = stack(Items.Coal, 1);
    for (let i = 0; i < 600; i++) ticks.tick();
    expect(f.items[2]!.count).toBe(3);
    expect(f.xp).toBeCloseTo(2.1);
    expect(takeXp(f, () => 0.05)).toBe(3);
    expect(f.xp).toBe(0);
  });

  it("orbs fly to a player near them, who takes their points, and are saved with their chunk", () => {
    const world = flatWorld(10, 2);
    const drops = new Drops(world);
    let xp = 0;
    const player = { position: { x: 4.5, y: 10, z: 0.5 }, take: () => null, xp: (n: number) => (xp += n) };
    drops.spawnXp(0.5, 10.5, 0.5, 20);
    expect([...drops.orbs.values()].map((o) => o.xp)).toEqual([17, 3]);
    const saved = drops.inChunk(0, 0, false);
    expect(saved.map((d) => d.xp)).toEqual([17, 3]);
    drops.collectors = () => [player];
    for (let i = 0; i < 40; i++) drops.update(0.05);
    expect(xp).toBe(20);
    expect(drops.orbs.size).toBe(0);
    drops.restore(saved);
    expect([...drops.orbs.values()].map((o) => o.xp)).toEqual([17, 3]);
  });
});

describe("dungeons", () => {
  it("hold a chest or two of loot, which comes through the generation worker", () => {
    const generator = new TerrainGenerator("craft");
    let found: { chest: ChestEntity; cx: number; cz: number } | null = null;
    for (let r = 0; r < 12 && !found; r++) {
      for (let cz = -r; cz <= r && !found; cz++) {
        for (let cx = -r; cx <= r && !found; cx++) {
          if (Math.max(Math.abs(cx), Math.abs(cz)) !== r) continue;
          const chunk = assembleChunk(generateChunk(generator as ChunkGenerator, cx, cz));
          const chest = [...chunk.entities.values()].find((e) => e.kind === "chest");
          if (chest) found = { chest: chest as ChestEntity, cx, cz };
        }
      }
    }
    expect(found).not.toBeNull();
    const stacks = found!.chest.items.filter((s) => s !== null);
    expect(stacks.length).toBeGreaterThanOrEqual(1);
    expect(stacks.length).toBeLessThanOrEqual(8);
    // The same chunk made again holds the same loot
    const again = assembleChunk(generateChunk(generator, found!.cx, found!.cz));
    expect([...again.entities.values()].find((e) => e.kind === "chest")!.items).toEqual(found!.chest.items);
  });
});

describe("staying alive with friends", () => {
  const nothing: ChunkGenerator = { generate: () => {} };

  function shared() {
    const world = flatWorld(10, 3);
    const ticks = new WorldTicks(world);
    const drops = new Drops(world);
    const notices: string[] = [];
    let difficulty: "normal" | "hard" = "normal";
    const host = new HostSession({
      world,
      ticks,
      worldName: "Shared",
      mode: "survival",
      difficulty: () => difficulty,
      hardcore: false,
      drops,
      host: () => ({ id: "host", name: "Host", x: -20.5, y: 10, z: 0.5, yaw: 0, pitch: 0 }),
      spawn: () => ({ x: 8.5, y: 10, z: 8.5 }),
      saved: () => null,
      onNotice: (text) => notices.push(text),
    });
    drops.collectors = () => host.collectors();
    const [hostEnd, guestEnd] = memoryPair();
    host.accept(hostEnd);
    const gw = new VoxelWorld(nothing);
    const session = new GuestSession(guestEnd, { world: gw, ticks: new WorldTicks(gw), id: "guest-1", name: "Alex", view: 2 });
    const run = async (frames: number): Promise<void> => {
      for (let i = 0; i < frames; i++) {
        host.update(0.05);
        drops.update(0.05);
        session.report(0.05, { position: { x: 8.5, y: 10, z: 8.5 }, yaw: 0, pitch: 0 });
        await new Promise((r) => setTimeout(r, 0));
        await session.settled();
      }
    };
    return { host, drops, session, notices, run, setDifficulty: (d: "normal" | "hard") => (difficulty = d) };
  }

  it("a guest starts well, and the host keeps how they are", async () => {
    const { host, session, run } = shared();
    const welcome = await session.welcome;
    expect(welcome).toMatchObject({ difficulty: "normal", hardcore: false, spawn: { x: 8.5, y: 10, z: 8.5 } });
    expect(welcome.you.vitals.health).toBe(20);
    session.life({ vitals: { health: 6, food: 9, saturation: 0, exhaustion: 1, air: 300, fire: 0, xp: 30 }, bed: { x: 1, y: 10, z: 2 }, spectating: false, flying: false, mode: null, spawn: null });
    await run(2);
    expect(host.guests[0].state).toMatchObject({ vitals: { health: 6, food: 9, xp: 30 }, bed: { x: 1, y: 10, z: 2 } });
  });

  it("a guest's death is told to everyone, and their experience lies where they died for anyone near", async () => {
    const { session, drops, notices, run } = shared();
    const told: string[] = [];
    session.onNotice = (t) => told.push(t);
    let xp = 0;
    session.onXp = (n) => (xp += n);
    await session.welcome;
    await run(2);
    session.died("lava", null, 21);
    await run(2);
    expect(notices).toEqual(["Alex tried to swim in lava"]);
    expect(told).toEqual(["Alex tried to swim in lava"]);
    // The orbs fly to the guest standing there, and the host sends their points
    await run(30);
    expect(drops.orbs.size).toBe(0);
    expect(xp).toBe(21);
  });

  it("guests see orbs, hear of the difficulty, and the night passes when everyone sleeps", async () => {
    const { host, drops, session, run, setDifficulty } = shared();
    await session.welcome;
    drops.spawnXp(30.5, 10.5, 30.5, 7);
    // After the first chunks, which go first
    await run(15);
    expect(session.drops.filter((d) => d[4] === ORB).map((d) => d[5])).toEqual([7]);
    let rules = "";
    session.onRules = (d) => (rules = d);
    setDifficulty("hard");
    host.rulesChanged();
    await run(5);
    expect(rules).toBe("hard");
    expect(host.allAsleep).toBe(false);
    session.sleep(true);
    await run(5);
    expect(host.allAsleep).toBe(true);
    let woke = false;
    session.onWake = () => (woke = true);
    host.wake();
    await run(5);
    expect(woke).toBe(true);
    expect(host.allAsleep).toBe(false);
  });
});

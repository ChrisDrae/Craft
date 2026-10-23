import { describe, expect, it } from "vitest";
import { Block, stateOf } from "../src/blocks.js";
import type { ChunkGenerator } from "../src/chunk.js";
import { Drops } from "../src/drops.js";
import { blastOn, blastedBlocks } from "../src/explosion.js";
import { BlockInteraction, bowPower } from "../src/interaction.js";
import { ITEMS, TOOLS, stack } from "../src/items.js";
import { Mobs, slimeChunk, type MobPlayer } from "../src/mobs/mobs.js";
import { findPath } from "../src/mobs/path.js";
import { memoryPair } from "../src/net/connection.js";
import { GuestSession } from "../src/net/guest.js";
import { HostSession } from "../src/net/host.js";
import { Player } from "../src/player.js";
import type { Terrain } from "../src/terrain.js";
import { WorldTicks } from "../src/ticks.js";
import type { DamageSource } from "../src/vitals.js";
import { VoxelWorld } from "../src/world.js";
import { flatWorld } from "./helpers.js";

/** Noon and midnight, in ticks. */
const NOON = 6000;
const MIDNIGHT = 18000;

/** A stone floor (top at y 9) with mobs, a player standing at `at`, and what hurt the player. */
function arena(at = { x: 0.5, y: 10, z: 0.5 }, time = MIDNIGHT, random: () => number = () => 0.5) {
  const world = flatWorld(10, 3);
  const drops = new Drops(world);
  const hurts: Array<{ id: string; amount: number; source: DamageSource; by: string }> = [];
  const player: MobPlayer = { id: "host", position: { ...at }, targetable: true, held: null };
  let difficulty: "easy" | "normal" | "hard" | "peaceful" = "normal";
  const mobs = new Mobs({
    world,
    drops,
    players: () => [player],
    difficulty: () => difficulty,
    time: () => time,
    onHurtPlayer: (id, amount, source, by) => hurts.push({ id, amount, source, by }),
    random,
  });
  const run = (ticks: number): void => {
    for (let i = 0; i < ticks; i++) mobs.tick();
  };
  return { world, drops, mobs, player, hurts, run, setDifficulty: (d: typeof difficulty) => (difficulty = d) };
}

/** A wall of stone from (x, z0) to (x, z1), `h` high on the floor. */
function wall(world: VoxelWorld, x: number, z0: number, z1: number, h: number = 3): void {
  for (let z = z0; z <= z1; z++) for (let y = 10; y < 10 + h; y++) world.set(x, y, z, Block.Stone);
}

describe("finding the way", () => {
  it("goes straight over open ground", () => {
    const world = flatWorld(10, 2);
    const path = findPath(world, 0, 10, 0, 6, 10, 0, 1.95);
    expect(path.at(-1)).toEqual({ x: 6, y: 10, z: 0 });
    expect(path).toHaveLength(6);
  });

  it("goes round a wall through the gap", () => {
    const world = flatWorld(10, 2);
    wall(world, 3, -6, 6);
    world.set(3, 10, 5, Block.Air);
    world.set(3, 11, 5, Block.Air);
    const path = findPath(world, 0, 10, 0, 6, 10, 0, 1.95);
    expect(path.at(-1)).toEqual({ x: 6, y: 10, z: 0 });
    expect(path.some((n) => n.x === 3 && n.z === 5)).toBe(true);
  });

  it("steps up one block but not two, and drops three but not four", () => {
    const world = flatWorld(10, 2);
    world.set(2, 10, 0, Block.Stone);
    expect(findPath(world, 0, 10, 0, 2, 11, 0, 1.95).at(-1)).toEqual({ x: 2, y: 11, z: 0 });
    // A two-block step: no way up, so as near as it gets
    const high = flatWorld(10, 1);
    for (let z = -16; z < 16; z++) for (let x = 2; x < 16; x++) for (let y = 10; y < 12; y++) high.set(x, y, z, Block.Stone);
    expect(findPath(high, 0, 10, 0, 4, 12, 0, 1.95).at(-1)).toEqual({ x: 1, y: 10, z: 0 });
    // Down from a ledge three high, not four
    const ledge = flatWorld(10, 1);
    for (let y = 10; y < 13; y++) ledge.set(0, y, 0, Block.Stone);
    expect(findPath(ledge, 0, 13, 0, 3, 10, 0, 1.95).at(-1)).toEqual({ x: 3, y: 10, z: 0 });
    const tower = flatWorld(10, 1);
    for (let y = 10; y < 14; y++) tower.set(0, y, 0, Block.Stone);
    expect(findPath(tower, 0, 14, 0, 3, 10, 0, 1.95)).toEqual([]);
  });

  it("goes through an open door, not a shut one", () => {
    const world = flatWorld(10, 2);
    // A room round the goal, its door the only way in
    wall(world, 3, -3, 3);
    wall(world, 9, -3, 3);
    for (let x = 3; x <= 9; x++) {
      for (let y = 10; y < 13; y++) {
        world.set(x, y, -3, Block.Stone);
        world.set(x, y, 3, Block.Stone);
      }
    }
    for (let x = 3; x <= 9; x++) for (let z = -3; z <= 3; z++) world.set(x, 13, z, Block.Stone);
    const door = (open: string): void => {
      world.set(3, 10, 0, stateOf(Block.OakDoor, { facing: "east", half: "lower", open }));
      world.set(3, 11, 0, stateOf(Block.OakDoor, { facing: "east", half: "upper", open }));
    };
    door("true");
    expect(findPath(world, 0, 10, 0, 6, 10, 0, 1.95).at(-1)).toEqual({ x: 6, y: 10, z: 0 });
    door("false");
    expect(findPath(world, 0, 10, 0, 6, 10, 0, 1.95).at(-1)?.x).toBe(2);
  });
});

describe("spawning", () => {
  it("monsters in the dark: in a cave by day, not by a torch; on the surface only at night", () => {
    const { world, mobs, player } = arena({ x: 40.5, y: 10, z: 40.5 }, NOON, () => 0.99);
    // A cave: two blocks of air under the stone
    for (let x = 0; x < 5; x++) for (let y = 5; y < 7; y++) world.set(x, y, 0, Block.Air);
    expect(mobs.canSpawn("zombie", 1, 5, 0, [player])).toBe(true);
    world.set(4, 5, 0, Block.Torch);
    expect(mobs.canSpawn("zombie", 1, 5, 0, [player])).toBe(false);
    // Out in the open at noon, never
    expect(mobs.canSpawn("zombie", 0, 10, 8, [player])).toBe(false);
    // Nor near a player
    expect(mobs.canSpawn("zombie", 40, 10, 41, [player])).toBe(false);
    const night = arena({ x: 40.5, y: 10, z: 40.5 }, MIDNIGHT, () => 0.99);
    expect(night.mobs.canSpawn("zombie", 0, 10, 8, [night.player])).toBe(true);
  });

  it("animals on grass", () => {
    const { world, mobs, player } = arena({ x: 40.5, y: 10, z: 40.5 }, NOON);
    expect(mobs.canSpawn("cow", 0, 10, 0, [player])).toBe(false);
    world.set(0, 9, 0, Block.Grass);
    expect(mobs.canSpawn("cow", 0, 10, 0, [player])).toBe(true);
  });

  it("from a dungeon's spawner, with a player near", () => {
    let seed = 11;
    const { world, mobs, run } = arena({ x: 2.5, y: 5, z: 2.5 }, MIDNIGHT, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) for (let y = 5; y < 8; y++) world.set(x, y, z, Block.Air);
    world.set(0, 5, 0, Block.Spawner);
    run(30);
    expect(mobs.mobs.size).toBeGreaterThan(0);
    expect([...mobs.mobs.values()].every((m) => ["zombie", "skeleton", "spider"].includes(m.kind))).toBe(true);
  });

  it("none in peaceful, and monsters there go", () => {
    const { mobs, run, setDifficulty } = arena();
    mobs.spawn("zombie", 5.5, 10, 0.5);
    mobs.spawn("cow", -5.5, 10, 0.5);
    setDifficulty("peaceful");
    run(1);
    expect([...mobs.mobs.values()].map((m) => m.kind)).toEqual(["cow"]);
  });
});

describe("monsters", () => {
  it("a zombie finds its way round a wall to the player and strikes, harder on hard", () => {
    const { world, mobs, player, hurts, run, setDifficulty } = arena({ x: 6.5, y: 10, z: 0.5 });
    wall(world, 3, -3, 3);
    const zombie = mobs.spawn("zombie", 0.5, 10, 0.5);
    zombie.target = { id: "host", position: player.position };
    run(200);
    expect(hurts[0]).toEqual({ id: "host", amount: 3, source: "mob", by: "Zombie" });
    expect(zombie.position.x).toBeGreaterThan(3);
    setDifficulty("hard");
    run(25);
    expect(hurts.at(-1)!.amount).toBe(4.5);
  });

  it("burns in the sun", () => {
    const { mobs, run } = arena({ x: 30.5, y: 10, z: 0.5 }, NOON, () => 0.01);
    const zombie = mobs.spawn("zombie", 0.5, 10, 0.5);
    run(2);
    expect(zombie.fire).toBeGreaterThan(0);
    run(500);
    expect(zombie.alive).toBe(false);
  });

  it("a skeleton shoots the player from a distance", () => {
    const { mobs, player, hurts, run } = arena({ x: 9.5, y: 10, z: 0.5 });
    const skeleton = mobs.spawn("skeleton", 0.5, 10, 0.5);
    skeleton.target = { id: "host", position: player.position };
    run(120);
    expect(hurts.some((h) => h.source === "arrow" && h.by === "Skeleton")).toBe(true);
  });

  it("a creeper swells and blows a hole, hurting the player", () => {
    const { world, mobs, player, hurts, run } = arena({ x: 2.5, y: 10, z: 0.5 });
    const creeper = mobs.spawn("creeper", 0.5, 10, 0.5);
    creeper.target = { id: "host", position: player.position };
    run(29);
    expect(creeper.fuse).toBeGreaterThan(20);
    run(5);
    expect(mobs.mobs.has(creeper.id)).toBe(false);
    expect(world.get(0, 9, 0)).toBe(Block.Air);
    const hit = hurts.find((h) => h.source === "explosion")!;
    expect(hit.by).toBe("Creeper");
    expect(hit.amount).toBeGreaterThan(10);
  });

  it("a spider leaves a player alone in the light, not in the dark", () => {
    const day = arena({ x: 4.5, y: 10, z: 0.5 }, NOON);
    const spider = day.mobs.spawn("spider", 0.5, 10, 0.5);
    day.run(100);
    expect(day.hurts).toEqual([]);
    expect(spider.target).toBeNull();
    const night = arena({ x: 4.5, y: 10, z: 0.5 }, MIDNIGHT);
    night.mobs.spawn("spider", 0.5, 10, 0.5);
    night.run(200);
    expect(night.hurts[0]).toMatchObject({ source: "mob", by: "Spider" });
  });
});

describe("explosions", () => {
  it("break blocks by their resistance: a crater in dirt, a dent in stone, not obsidian", () => {
    const world = flatWorld(10, 2);
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) for (let y = 5; y < 10; y++) world.set(x, y, z, Block.Dirt);
    world.set(1, 9, 0, Block.Obsidian);
    const broken = blastedBlocks(world, 0.5, 10.5, 0.5, 3, () => 0.5);
    expect(broken.length).toBeGreaterThan(20);
    expect(broken.some(([x, y, z]) => x === 1 && y === 9 && z === 0)).toBe(false);
    expect(broken.every(([x, y, z]) => Math.hypot(x, y + 0.5 - 10.5, z) < 6)).toBe(true);
    // Inside stone, as in Minecraft, it hardly gets anywhere
    const stone = flatWorld(10, 1);
    expect(blastedBlocks(stone, 0.5, 5.5, 0.5, 3, () => 0.5).length).toBeLessThan(8);
  });

  it("hurt less the farther away, and not at all from behind a wall or beyond twice their power", () => {
    const world = flatWorld(10, 2);
    const body = (x: number) => ({ position: { x, y: 10, z: 0.5 }, halfWidth: 0.3, height: 1.8 });
    const near = blastOn(world, 0.5, 10.5, 0.5, 3, body(2))!;
    const far = blastOn(world, 0.5, 10.5, 0.5, 3, body(5))!;
    expect(near.damage).toBeGreaterThan(far.damage);
    expect(near.push.x).toBeGreaterThan(0);
    expect(blastOn(world, 0.5, 10.5, 0.5, 3, body(8))).toBeNull();
    wall(world, 3, -3, 3, 4);
    expect(blastOn(world, 0.5, 10.5, 0.5, 3, body(5))).toBeNull();
  });
});

describe("fighting", () => {
  it("a sword's hit, knockback, and the hit window", () => {
    const { mobs, player } = arena({ x: -1.5, y: 10, z: 0.5 });
    const zombie = mobs.spawn("zombie", 0.5, 10, 0.5);
    zombie.onGround = true;
    expect(mobs.strike(zombie, 7, player, 8)).toBe(true);
    expect(zombie.health).toBe(13);
    expect(zombie.velocity.x).toBeGreaterThan(5);
    expect(zombie.target?.id).toBe("host");
    // Not again at once, unless harder
    expect(mobs.strike(zombie, 7, player, 8)).toBe(false);
    expect(mobs.strike(zombie, 9, player, 8)).toBe(true);
    expect(zombie.health).toBe(11);
  });

  it("hits as hard as the weapon has recovered from the last swing", () => {
    const world = flatWorld(10, 1);
    const player = new Player(world, { x: 0.5, y: 10, z: 0.5 });
    const hands = new BlockInteraction(world, player, { target: null } as unknown as Terrain);
    hands.mode = "survival";
    hands.inventory.put(0, stack(TOOLS.diamond.sword));
    const hits: number[] = [];
    hands.onAttack = (_id, damage) => hits.push(damage);
    hands.targetMob = { id: 1, distance: 2 };
    hands.press(0);
    hands.press(0);
    hands.update(0.625);
    hands.press(0);
    expect(hits[0]).toBe(7);
    expect(hits[1]).toBeLessThan(1.5);
    expect(hits[2]).toBeCloseTo(7, 0);
    expect(hands.inventory.slots[0]!.damage).toBe(3);
  });

  it("a bow draws to full in a second", () => {
    expect(bowPower(0.05)).toBeLessThan(0.1);
    expect(bowPower(0.5)).toBeCloseTo(0.4167, 3);
    expect(bowPower(1)).toBe(1);
  });

  it("a player's arrow hits a mob, or sticks and can be taken back", () => {
    const { world, mobs, run } = arena({ x: -20.5, y: 10, z: 0.5 });
    const cow = mobs.spawn("cow", 6.5, 10, 0.5);
    mobs.shoot({ x: 0.5, y: 10.7, z: 0.5 }, { x: 60, y: 0, z: 0 }, { player: "host" }, false, true);
    run(3);
    expect(cow.health).toBeLessThan(cow.info.health);
    wall(world, 5, -2, 2);
    const arrow = mobs.shoot({ x: 0.5, y: 10.5, z: 0.5 }, { x: 60, y: 0, z: 0 }, { player: "host" }, false, true);
    run(3);
    expect(arrow.stuck).toBe(true);
    expect(arrow.position.x).toBeCloseTo(5, 1);
  });
});

describe("animals", () => {
  it("die with their drops, cooked if burning, and experience for a player's kill", () => {
    const { drops, mobs, player, run } = arena();
    const pig = mobs.spawn("pig", 0.5, 10, 0.5);
    pig.fire = 100;
    mobs.strike(pig, 20, player, 8);
    expect(pig.alive).toBe(false);
    expect([...drops.items.values()].map((d) => ITEMS[d.stack.item].name)).toEqual(["cooked_porkchop"]);
    expect(drops.orbs.size).toBeGreaterThan(0);
    run(25);
    expect(mobs.mobs.has(pig.id)).toBe(false);
  });

  it("run when hit, follow their food", () => {
    const { mobs, player, run } = arena({ x: 6.5, y: 10, z: 0.5 });
    const cow = mobs.spawn("cow", 0.5, 10, 0.5);
    player.held = "wheat";
    run(100);
    expect(cow.position.x).toBeGreaterThan(3);
    player.held = null;
    mobs.strike(cow, 1, player, 8);
    expect(cow.panic).toBeGreaterThan(0);
  });

  it("sheep give wool when shorn and grow it back eating grass", () => {
    const { world, drops, mobs, run } = arena({ x: 30.5, y: 10, z: 0.5 }, NOON, () => 0);
    const sheep = mobs.spawn("sheep", 0.5, 10, 0.5);
    expect(sheep.color).toBe(15);
    expect(mobs.shear(sheep)).toBe(true);
    expect(mobs.shear(sheep)).toBe(false);
    expect([...drops.items.values()].map((d) => [ITEMS[d.stack.item].name, d.stack.count])).toEqual([["black_wool", 1]]);
    world.set(0, 9, 0, Block.Grass);
    run(1);
    expect(sheep.sheared).toBe(false);
    expect(world.get(0, 9, 0)).toBe(Block.Dirt);
  });

  it("are saved with their chunk; monsters aren't", () => {
    const { mobs } = arena({ x: 40.5, y: 10, z: 0.5 });
    const sheep = mobs.spawn("sheep", 3.5, 10, 4.5);
    sheep.color = 4;
    sheep.sheared = true;
    sheep.health = 5;
    mobs.spawn("zombie", 5.5, 10, 5.5);
    const saved = mobs.inChunk(0, 0, true);
    expect(saved).toEqual([{ kind: "sheep", x: 3.5, y: 10, z: 4.5, yaw: expect.any(Number), health: 5, color: 4, sheared: true }]);
    expect(mobs.mobs.size).toBe(0);
    mobs.restore(saved);
    const back = [...mobs.mobs.values()][0];
    expect([back.kind, back.color, back.sheared, back.health]).toEqual(["sheep", 4, true, 5]);
  });
});

describe("mobs with friends", () => {
  const nothing: ChunkGenerator = { generate: () => {} };

  it("a guest sees the mobs, hits them, and is hurt by them", async () => {
    const world = flatWorld(10, 3);
    const ticks = new WorldTicks(world);
    const drops = new Drops(world);
    let host: HostSession | null = null;
    const guestAt = { x: 8.5, y: 10, z: 8.5 };
    const mobs = new Mobs({
      world,
      drops,
      players: () => (host?.guests ?? []).map((g) => ({ id: g.id, position: g.state.position, targetable: true, held: null })),
      difficulty: () => "normal",
      time: () => MIDNIGHT,
      onHurtPlayer: (id, amount, source, by, push) => host!.hurt(id, amount, source, by, push),
      random: () => 0.5,
    });
    host = new HostSession({
      world,
      ticks,
      worldName: "Shared",
      mode: "survival",
      difficulty: () => "normal",
      hardcore: false,
      drops,
      mobs,
      host: () => ({ id: "host", name: "Host", x: -40.5, y: 10, z: 0.5, yaw: 0, pitch: 0 }),
      spawn: () => guestAt,
      saved: () => null,
    });
    const [hostEnd, guestEnd] = memoryPair();
    host.accept(hostEnd);
    const gw = new VoxelWorld(nothing);
    const session = new GuestSession(guestEnd, { world: gw, ticks: new WorldTicks(gw), id: "guest-1", name: "Alex", view: 2 });
    const hurts: number[] = [];
    session.onHurt = (amount) => hurts.push(amount);
    await session.welcome;
    const zombie = mobs.spawn("zombie", 8.5, 10, 4.5);
    const run = async (frames: number): Promise<void> => {
      for (let i = 0; i < frames; i++) {
        host!.update(0.05);
        mobs.tick();
        session.report(0.05, { position: guestAt, yaw: 0, pitch: 0 });
        await new Promise((r) => setTimeout(r, 0));
        await session.settled();
      }
    };
    await run(15);
    expect(session.mobs.some(([id, kind]) => id === zombie.id && kind === 0)).toBe(true);
    session.attack(zombie.id, 5, false, 8);
    await run(2);
    expect(zombie.health).toBe(15);
    await run(80);
    expect(hurts[0]).toBe(3);
  });
});

describe("slimes", () => {
  it("hop after a player, hurt them by their size, and split when they die; the smallest drop slimeballs", () => {
    const { mobs, drops, hurts, run } = arena({ x: 0.5, y: 10, z: 0.5 });
    const big = mobs.spawn("slime", 6.5, 10, 0.5, 0, 4);
    expect([big.health, big.halfWidth * 2, big.height]).toEqual([16, 2.08, 2.08]);
    run(200);
    expect(Math.abs(big.position.x - 0.5)).toBeLessThan(3);
    expect(hurts.length).toBeGreaterThan(0);
    expect(hurts[0]).toMatchObject({ amount: 4, source: "mob", by: "Slime" });
    mobs.hurt(big, 100, "player", "host");
    const medium = [...mobs.mobs.values()].filter((m) => m.kind === "slime" && m.alive);
    expect(medium.map((m) => m.size)).toEqual([2, 2, 2]);
    // The smallest: no harm, and slimeballs
    const small = mobs.spawn("slime", 20.5, 10, 20.5, 0, 1);
    mobs.hurt(small, 100, "player", "host");
    expect([...drops.items.values()].map((d) => d.stack.count)).toEqual([1]);
  });

  it("live deep down in one chunk in ten, by the world's seed", () => {
    let n = 0;
    for (let cx = 0; cx < 100; cx++) for (let cz = 0; cz < 100; cz++) if (slimeChunk("seed", cx, cz)) n++;
    expect(n / 10000).toBeGreaterThan(0.08);
    expect(n / 10000).toBeLessThan(0.12);
    expect(slimeChunk("seed", 3, 4)).toBe(slimeChunk("seed", 3, 4));
  });
});

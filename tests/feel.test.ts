import type { Texture } from "projector";
import { describe, expect, it } from "vitest";
import { perform } from "../src/actions.js";
import { soundGroup } from "../src/audio.js";
import { Block, stateOf } from "../src/blocks.js";
import type { ChunkGenerator } from "../src/chunk.js";
import { runCommand, type CommandContext } from "../src/commands.js";
import { Drops } from "../src/drops.js";
import { ITEMS, Items, stack } from "../src/items.js";
import type { LightMap } from "../src/lightmap.js";
import { dropsOf } from "../src/mining.js";
import { memoryPair } from "../src/net/connection.js";
import { GuestSession } from "../src/net/guest.js";
import { HostSession } from "../src/net/host.js";
import { Particles } from "../src/particles.js";
import { Player } from "../src/player.js";
import { TILES } from "../src/textures.js";
import { WorldTicks } from "../src/ticks.js";
import { BlockUpdates } from "../src/updates.js";
import { debugLines } from "../src/ui/debug.js";
import { VoxelWorld } from "../src/world.js";
import { flatWorld } from "./helpers.js";

/** A command context that records what was done. */
function game() {
  const done: string[] = [];
  const said: string[] = [];
  let time = 3 * 24000 + 5000;
  const ctx: CommandContext = {
    seed: "seeds",
    position: { x: 10.5, y: 64, z: -3.5 },
    say: (t) => said.push(t),
    setMode: (m) => done.push(`mode ${m}`),
    time: () => time,
    setTime: (t) => {
      time = t;
      done.push(`time ${t}`);
    },
    teleport: (x, y, z) => done.push(`tp ${x} ${y} ${z}`),
    players: () => [{ name: "Alex", position: { x: 1, y: 2, z: 3 } }],
    give: (item, count) => done.push(`give ${ITEMS[item].name} ${count}`),
    kill: () => done.push("kill"),
    setSpawn: (x, y, z) => done.push(`spawn ${x} ${y} ${z}`),
    setDifficulty: (d) => (done.push(`difficulty ${d}`), true),
    summon: (kind, x, y, z) => (done.push(`summon ${kind} ${x} ${y} ${z}`), true),
  };
  return { ctx, done, said, time: () => time };
}

describe("commands", () => {
  it("set the time of day within today, and add to it", () => {
    const g = game();
    runCommand("/time set night", g.ctx);
    expect(g.time()).toBe(3 * 24000 + 13000);
    runCommand("/time add 2000", g.ctx);
    expect(g.time()).toBe(3 * 24000 + 15000);
    runCommand("/time query day", g.ctx);
    expect(g.said.at(-1)).toBe("The day is 3");
  });

  it("teleport to coordinates (~ is where you are) and to players", () => {
    const g = game();
    runCommand("/tp 5 70 -2", g.ctx);
    runCommand("/tp ~ ~10 ~-1", g.ctx);
    runCommand("/tp alex", g.ctx);
    runCommand("/tp nobody", g.ctx);
    expect(g.done).toEqual(["tp 5.5 70 -1.5", "tp 10.5 74 -4.5", "tp 1 2 3"]);
    expect(g.said.at(-1)).toBe("No player was found: nobody");
  });

  it("give items, change the game mode, summon, set the difficulty, kill", () => {
    const g = game();
    runCommand("/give minecraft:diamond 3", g.ctx);
    runCommand("/give dirt", g.ctx);
    runCommand("/give unobtainium", g.ctx);
    runCommand("/gamemode creative", g.ctx);
    runCommand("/summon zombie", g.ctx);
    runCommand("/difficulty hard", g.ctx);
    runCommand("/kill", g.ctx);
    runCommand("/spawnpoint", g.ctx);
    expect(g.done).toEqual(["give diamond 3", "give dirt 1", "mode creative", "summon zombie 10.5 64 -3.5", "difficulty hard", "kill", "spawn 10.5 64 -3.5"]);
    expect(g.said).toContain("Unknown item: unobtainium");
  });

  it("say what is wrong", () => {
    const g = game();
    runCommand("/fly", g.ctx);
    runCommand("/gamemode adventure", g.ctx);
    runCommand("/weather rain", g.ctx);
    expect(g.said).toEqual(["Unknown command: /fly. /help lists them", "Usage: /gamemode survival|creative|spectator", "There is no weather yet"]);
  });
});

describe("sound", () => {
  it("blocks sound by Minecraft's groups", () => {
    expect([Block.Grass, Block.Dirt, Block.Stone, Block.Planks, Block.WhiteWool, Block.Glass, Block.Sand, Block.SnowBlock, Block.Ladder, Block.Leaves, Block.Water].map(soundGroup)).toEqual([
      "grass",
      "gravel",
      "stone",
      "wood",
      "wool",
      "glass",
      "sand",
      "snow",
      "ladder",
      "grass",
      null,
    ]);
  });
});

describe("particles", () => {
  const atlas = (): { texture: Texture; uvs: Float32Array } => {
    const uvs = new Float32Array(TILES.length * 4);
    TILES.forEach((_, i) => uvs.set([0, 0, 1, 1], i * 4));
    return { texture: {} as Texture, uvs };
  };

  it("a broken block crumbles into pieces that fall, land and go", () => {
    const world = flatWorld(10, 1);
    const particles = new Particles(world, { brightness: () => 1 } as unknown as LightMap, atlas());
    particles.breakBlock(0, 10, 0, Block.Stone);
    const list = (particles as unknown as { list: Array<{ y: number }> }).list;
    expect(list).toHaveLength(27);
    particles.amount = 0.5;
    particles.breakBlock(0, 10, 0, Block.Stone);
    expect(list).toHaveLength(27 + 8);
    for (let i = 0; i < 10; i++) particles.update(0.05);
    expect(list.every((p) => p.y >= 9.9)).toBe(true);
    for (let i = 0; i < 40; i++) particles.update(0.05);
    expect(list).toHaveLength(0);
  });
});

describe("moving", () => {
  it("sneaking doesn't walk off an edge, and lowers the eyes", () => {
    const world = flatWorld(10, 1);
    for (let x = 1; x < 16; x++) for (let z = -16; z < 16; z++) world.set(x, 9, z, Block.Air);
    const player = new Player(world, { x: 0.5, y: 10, z: 0.5 });
    player.input.sneak = true;
    player.input.strafe = 1;
    player.yaw = 0;
    for (let i = 0; i < 60; i++) player.fixedUpdate(1 / 60);
    // Right of +z is +x: toward the edge at x = 1, stopping with the feet over it
    expect(player.position.y).toBeCloseTo(10, 3);
    expect(player.position.x).toBeGreaterThan(0.8);
    expect(player.position.x).toBeLessThan(1.31);
    player.input.sneak = false;
    for (let i = 0; i < 60; i++) player.fixedUpdate(1 / 60);
    expect(player.position.y).toBeLessThan(10);
  });

  it("vines hang on walls and from each other, are climbed, and drop only for shears", () => {
    const world = flatWorld(10, 1);
    const ticks = new WorldTicks(world);
    const updates = new BlockUpdates(world, ticks);
    world.onChanged = (x, y, z) => updates.changed(x, y, z);
    for (let y = 10; y < 14; y++) world.set(2, y, 0, Block.Stone);
    const onWall = { act: "place" as const, x: 2, y: 13, z: 0, nx: -1, ny: 0, nz: 0, hy: 0.5, block: Block.Vine, yaw: 0 };
    expect(perform(world, onWall, [])).toBe(true);
    expect(world.get(1, 13, 0)).toBe(stateOf(Block.Vine, { facing: "west" }));
    // One below hangs from it, held up even when the wall behind goes
    world.set(1, 12, 0, stateOf(Block.Vine, { facing: "west" }));
    world.set(2, 12, 0, Block.Air);
    expect(world.get(1, 12, 0)).toBe(stateOf(Block.Vine, { facing: "west" }));
    // Without the vine above and the wall, it falls
    world.set(1, 13, 0, Block.Air);
    expect(world.get(1, 12, 0)).toBe(Block.Air);
    const player = new Player(world, { x: 1.5, y: 12, z: 0.5 });
    world.set(1, 12, 0, stateOf(Block.Vine, { facing: "west" }));
    world.set(2, 12, 0, Block.Stone);
    player.fixedUpdate(0.05);
    expect(player.onLadder).toBe(true);
    expect(dropsOf(stateOf(Block.Vine, { facing: "west" }), null, Math.random)).toEqual([]);
    expect(dropsOf(stateOf(Block.Vine, { facing: "west" }), stack(Items.Shears), Math.random)).toEqual([stack(Block.Vine)]);
  });
});

describe("the debug screen", () => {
  it("says where the player is, which way they look, the light, the block looked at", () => {
    const lines = debugLines({
      frames: [1 / 60, 1 / 60, 1 / 30],
      renderer: "WebGL 2",
      stats: { primitives: 1000, batches: 20, ms: 2.5 },
      position: { x: -5.25, y: 70, z: 17.5 },
      yaw: Math.PI,
      pitch: 0.5,
      biome: 0,
      sky: 15,
      block: 3,
      target: { x: -5, y: 69, z: 18, state: stateOf(Block.Log, { axis: "x" }) },
      time: 24000 * 2 + 6000,
      chunks: 120,
      mobs: 7,
      mode: "survival",
      sharing: "alone",
    });
    expect(lines).toContain("Block: -6 70 17 [10 6 1]");
    expect(lines).toContain("Chunk: -1 4 1");
    expect(lines.find((l) => l.startsWith("Facing"))).toContain("north (towards -Z)");
    expect(lines).toContain("Light: 15 (15 sky, 3 block)");
    expect(lines).toContain("Day 2, time 6000");
    expect(lines.at(-1)).toBe("oak_log[axis=x]");
  });
});

describe("feel with friends", () => {
  const nothing: ChunkGenerator = { generate: () => {} };

  it("chat goes to everyone; a guest's broken block is heard and seen by the others", async () => {
    const world = flatWorld(10, 3);
    const ticks = new WorldTicks(world);
    const notices: string[] = [];
    const acted: string[] = [];
    const host = new HostSession({
      world,
      ticks,
      worldName: "Shared",
      mode: "creative",
      difficulty: () => "normal",
      hardcore: false,
      drops: new Drops(world),
      host: () => ({ id: "host", name: "Host", x: 0.5, y: 10, z: 0.5, yaw: 0, pitch: 0 }),
      spawn: () => ({ x: 8.5, y: 10, z: 8.5 }),
      saved: () => null,
      onNotice: (t) => notices.push(t),
      onAct: (id, a, before) => acted.push(`${id} ${a.act} ${before}`),
    });
    world.onChanged = (x, y, z) => host.changed(x, y, z);
    const join = (id: string) => {
      const [hostEnd, guestEnd] = memoryPair();
      host.accept(hostEnd);
      const gw = new VoxelWorld(nothing);
      return new GuestSession(guestEnd, { world: gw, ticks: new WorldTicks(gw), id, name: id, view: 2 });
    };
    const a = join("guest-a");
    const b = join("guest-b");
    const heard: string[] = [];
    b.onNotice = (t) => heard.push(t);
    const effects: string[] = [];
    b.onEffect = (kind, x, y, z, state) => effects.push(`${kind} ${x} ${y} ${z} ${state}`);
    a.onEffect = (kind) => effects.push(`a saw its own ${kind}`);
    await Promise.all([a.welcome, b.welcome]);
    const run = async (frames: number): Promise<void> => {
      for (let i = 0; i < frames; i++) {
        host.update(0.05);
        for (const s of [a, b]) s.report(0.05, { position: { x: 8.5, y: 10, z: 8.5 }, yaw: 0, pitch: 0 });
        await new Promise((r) => setTimeout(r, 0));
        await Promise.all([a.settled(), b.settled()]);
      }
    };
    await run(15);
    a.chat("hello there");
    a.act({ act: "break", x: 9, y: 9, z: 9, nx: 0, ny: 1, nz: 0, hy: 1, block: 0, yaw: 0 }, null);
    await run(10);
    expect(notices).toContain("<guest-a> hello there");
    expect(heard).toContain("<guest-a> hello there");
    expect(acted).toEqual([`guest-a break ${Block.Stone}`]);
    expect(effects).toEqual([`break 9 9 9 ${Block.Stone}`]);
  });
});

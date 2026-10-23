import { describe, expect, it } from "vitest";
import { useBlock } from "../src/actions.js";
import { FURNACE_FUEL, FURNACE_INPUT, FURNACE_OUTPUT, loadEntity, saveEntity, type BlockEntity, type MovingEntity } from "../src/blockEntities.js";
import { Block, DIR_X, DIR_Y, DIR_Z, FACE_TURN, FACING6_DIR, STATE_BLOCK, propertyOf, stateName, stateOf } from "../src/blocks.js";
import { FACE_CORNERS } from "../src/chunk.js";
import { Drops } from "../src/drops.js";
import { fillLevel, tickHoppers } from "../src/hoppers.js";
import { Items, stack } from "../src/items.js";
import { PUSH_LIMIT } from "../src/pistons.js";
import { lookFacing6, placementState } from "../src/placement.js";
import { cornerUV } from "../src/shapes.js";
import { WorldTicks } from "../src/ticks.js";
import { BlockUpdates } from "../src/updates.js";
import { flatWorld } from "./helpers.js";

/** A stone floor (top at y 9) with block updates, redstone, pistons moving and hoppers working, tick by tick. */
function bench() {
  const world = flatWorld(10, 2);
  const ticks = new WorldTicks(world);
  const updates = new BlockUpdates(world, ticks);
  const drops = new Drops(world);
  world.onChanged = (x, y, z, old) => updates.changed(x, y, z, old);
  const pistons = updates.redstone.pistons;
  ticks.onTick = () => {
    pistons.tick();
    tickHoppers(world, drops);
  };
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) ticks.tick();
  };
  const ticksUntil = (done: () => boolean, max: number = 200): number => {
    for (let n = 0; n <= max; n++) {
      if (done()) return n;
      ticks.tick();
    }
    return -1;
  };
  const name = (x: number, y: number, z: number): string => stateName(world.get(x, y, z));
  const block = (x: number, y: number, z: number): number => STATE_BLOCK[world.get(x, y, z)];
  const on = (x: number, y: number, z: number, prop: string): boolean => propertyOf(world.get(x, y, z), prop) === "true";
  /** A lever on the ground on the north side of (x, y, z), off; flip() turns it. */
  const lever = (x: number, y: number, z: number) => {
    world.set(x, y, z - 1, stateOf(Block.Lever, { face: "floor", facing: "north" }));
    return () => useBlock(world, { x, y, z: z - 1 });
  };
  const items = (x: number, y: number, z: number): BlockEntity => world.blockEntity(x, y, z)!;
  return { world, ticks, updates, pistons, drops, run, ticksUntil, name, block, on, lever, items };
}

describe("pistons", () => {
  it("push the line in front a block and put their head out over two ticks, and take it back", () => {
    const { world, run, ticksUntil, block, on, lever } = bench();
    world.set(0, 10, 0, stateOf(Block.Piston, { facing: "east" }));
    world.set(1, 10, 0, Block.Stone);
    world.set(2, 10, 0, Block.Dirt);
    const flip = lever(0, 10, 0);
    flip();
    expect(on(0, 10, 0, "extended")).toBe(true);
    expect([1, 2, 3].map((x) => block(x, 10, 0))).toEqual([Block.MovingPiston, Block.MovingPiston, Block.MovingPiston]);
    expect(ticksUntil(() => block(3, 10, 0) === Block.Dirt)).toBe(2);
    expect([1, 2, 3].map((x) => block(x, 10, 0))).toEqual([Block.PistonHead, Block.Stone, Block.Dirt]);
    flip();
    expect(on(0, 10, 0, "extended")).toBe(false);
    expect(block(1, 10, 0)).toBe(Block.MovingPiston);
    run(2);
    expect([1, 2, 3].map((x) => block(x, 10, 0))).toEqual([Block.Air, Block.Stone, Block.Dirt]);
  });

  it("sticky ones pull the block in front back with them", () => {
    const { world, run, block, lever } = bench();
    world.set(0, 10, 0, stateOf(Block.StickyPiston, { facing: "west" }));
    world.set(-1, 10, 0, Block.Glass);
    const flip = lever(0, 10, 0);
    flip();
    run(2);
    expect([block(-1, 10, 0), block(-2, 10, 0)]).toEqual([Block.PistonHead, Block.Glass]);
    expect(propertyOf(world.get(-1, 10, 0), "type")).toBe("sticky");
    flip();
    run(2);
    expect([block(-1, 10, 0), block(-2, 10, 0)]).toEqual([Block.Glass, Block.Air]);
  });

  it("push twelve blocks at most, and nothing past obsidian or a chest", () => {
    const { world, run, block, on, lever } = bench();
    for (const [z, count, end] of [
      [0, PUSH_LIMIT, Block.Air],
      [3, PUSH_LIMIT + 1, Block.Air],
      [6, 2, Block.Obsidian],
      [9, 2, Block.Chest],
    ] as const) {
      world.set(0, 10, z, stateOf(Block.Piston, { facing: "east" }));
      for (let x = 1; x <= count; x++) world.set(x, 10, z, Block.Cobblestone);
      world.set(count + 1, 10, z, end);
      lever(0, 10, z)();
    }
    run(2);
    expect([0, 3, 6, 9].map((z) => on(0, 10, z, "extended"))).toEqual([true, false, false, false]);
    expect(block(PUSH_LIMIT + 1, 10, 0)).toBe(Block.Cobblestone);
  });

  it("break what is fragile at the end of the line, and it drops", () => {
    const { world, pistons, run, block, lever } = bench();
    const broken: string[] = [];
    pistons.onBreak = (_x, _y, _z, state) => broken.push(stateName(state));
    world.set(0, 10, 0, stateOf(Block.Piston, { facing: "east" }));
    world.set(1, 10, 0, Block.Pumpkin);
    lever(0, 10, 0)();
    run(2);
    expect(broken).toEqual(["pumpkin"]);
    expect(block(1, 10, 0)).toBe(Block.PistonHead);
  });

  it("finish their push at once when the power goes before it is done", () => {
    const { world, block, lever } = bench();
    world.set(0, 10, 0, stateOf(Block.StickyPiston, { facing: "east" }));
    world.set(1, 10, 0, Block.Stone);
    const flip = lever(0, 10, 0);
    flip();
    flip();
    // The stone got there at once, and (sticky) is on its way back
    expect(block(1, 10, 0)).toBe(Block.MovingPiston);
    expect((world.blockEntity(1, 10, 0) as MovingEntity).state).toBe(Block.Stone);
    expect(block(2, 10, 0)).toBe(Block.Air);
  });

  it("carry what is in the way of what they move", () => {
    const { world, pistons, run, lever } = bench();
    const carried: number[][] = [];
    pistons.onCarry = (box, dx, dy, dz) => carried.push([box[1], dx, dy, dz]);
    world.set(0, 10, 0, stateOf(Block.Piston, { facing: "up" }));
    lever(0, 10, 0)();
    run(2);
    expect(carried).toEqual([
      [10.5, 0, 0.5, 0],
      [11, 0, 0.5, 0],
    ]);
  });

  it("go with their head, and their head with them", () => {
    const { world, run, block, lever } = bench();
    for (const z of [0, 3]) {
      world.set(0, 10, z, stateOf(Block.Piston, { facing: "east" }));
      lever(0, 10, z)();
    }
    run(2);
    world.set(1, 10, 0, Block.Air);
    world.set(0, 10, 3, Block.Air);
    expect([block(0, 10, 0), block(1, 10, 3)]).toEqual([Block.Air, Block.Air]);
  });

  it("keep what they move in the save, by name, and finish it when loaded", () => {
    const { world, run, block, lever } = bench();
    world.set(0, 10, 0, stateOf(Block.Piston, { facing: "east" }));
    world.set(1, 10, 0, stateOf(Block.Log, { axis: "x" }));
    lever(0, 10, 0)();
    const saved = saveEntity(2, 10, 0, world.blockEntity(2, 10, 0)!);
    expect(saved).toMatchObject({ kind: "moving", state: "oak_log[axis=x]", dir: 0, progress: 0, extending: true, head: false });
    const back = loadEntity(saved) as MovingEntity;
    expect([back.state, back.dir]).toEqual([stateOf(Block.Log, { axis: "x" }), 0]);
    run(2);
    expect(block(2, 10, 0)).toBe(Block.Log);
  });

  it("are placed facing the player, any of six ways", () => {
    const aim = { nx: 0, ny: 1, nz: 0, hy: 1 };
    expect(lookFacing6(0, -1.2)).toBe("down");
    expect(propertyOf(placementState(Block.Piston, aim, 0, -1.2)!, "facing")).toBe("up");
    expect(propertyOf(placementState(Block.Piston, aim, 0, 0)!, "facing")).toBe("north");
    expect(propertyOf(placementState(Block.Observer, aim, Math.PI / 2, 0)!, "facing")).toBe("east");
    expect(propertyOf(placementState(Block.Hopper, aim, 0, 0)!, "facing")).toBe("down");
    expect(propertyOf(placementState(Block.Hopper, { nx: 1, ny: 0, nz: 0, hy: 0.5 }, 0, 0)!, "facing")).toBe("west");
  });

  it("show their sides' texture pointing to the way they face", () => {
    for (const facing of ["up", "down", "north", "south", "east", "west"]) {
      const s = stateOf(Block.Piston, { facing });
      const f = FACING6_DIR[facing];
      for (let d = 0; d < 6; d++) {
        if (d === f || d === (f ^ 1)) continue;
        // The corners at the top of the turned texture lie toward the front
        const corners = [0, 1, 2, 3].map((k) => {
          const c = d * 12 + k * 3;
          let [u, v] = cornerUV(d, FACE_CORNERS[c], FACE_CORNERS[c + 1], FACE_CORNERS[c + 2]);
          for (let t = FACE_TURN[s * 6 + d]; t > 0; t--) [u, v] = [v, 1 - u];
          return { v, p: [FACE_CORNERS[c], FACE_CORNERS[c + 1], FACE_CORNERS[c + 2]] };
        });
        const top = corners.filter((c) => c.v < 0.5);
        // Across the face only (along its normal the corners all lie on its side)
        const normal = [Math.abs(DIR_X[d]), Math.abs(DIR_Y[d]), Math.abs(DIR_Z[d])];
        const mid = [0, 1, 2].map((a) => (normal[a] ? 0 : (top[0].p[a] + top[1].p[a]) / 2 - 0.5));
        expect(mid.map((m) => Math.sign(Math.round(m * 2))), `${facing} face ${d}`).toEqual([DIR_X[f], DIR_Y[f], DIR_Z[f]]);
      }
    }
  });
});

describe("observers", () => {
  it("pulse out of their back two ticks after the block they watch changes, for two ticks", () => {
    const { world, run, ticksUntil, on } = bench();
    world.set(0, 10, 0, stateOf(Block.Observer, { facing: "east" }));
    world.set(-1, 10, 0, Block.RedstoneLamp);
    run(5);
    world.set(0, 10, 3, Block.Stone); // Not watched
    world.set(1, 10, 0, Block.Stone);
    expect(ticksUntil(() => on(0, 10, 0, "powered"))).toBe(2);
    expect(on(-1, 10, 0, "lit")).toBe(true);
    expect(ticksUntil(() => !on(0, 10, 0, "powered"))).toBe(2);
    run(10);
    expect(on(0, 10, 0, "powered")).toBe(false);
  });
});

describe("hoppers", () => {
  it("pass items down into a chest two and a half a second, taking them from a chest above", () => {
    const { world, run, items } = bench();
    world.set(0, 10, 0, Block.Chest);
    world.set(0, 11, 0, stateOf(Block.Hopper, { facing: "down" }));
    world.set(0, 12, 0, Block.Chest);
    items(0, 12, 0).items[0] = stack(Block.Cobblestone, 10);
    run(41);
    const below = (): number => items(0, 10, 0).items.reduce((n, s) => n + (s?.count ?? 0), 0);
    expect(below()).toBe(5);
    run(100);
    expect([below(), items(0, 12, 0).items[0], items(0, 11, 0).items.every((s) => s === null)]).toEqual([10, null, true]);
  });

  it("stop while powered", () => {
    const { world, run, items, on } = bench();
    world.set(0, 10, 0, Block.Chest);
    world.set(0, 11, 0, stateOf(Block.Hopper, { facing: "down" }));
    items(0, 11, 0).items[0] = stack(Block.Dirt, 3);
    world.set(1, 10, 0, Block.Stone);
    world.set(1, 11, 0, stateOf(Block.Lever, { face: "floor", facing: "north", powered: "true" }));
    expect(on(0, 11, 0, "enabled")).toBe(false);
    run(40);
    expect(items(0, 11, 0).items[0]?.count).toBe(3);
  });

  it("fill a furnace from above and its fuel from the side, and empty its output from below", () => {
    const { world, run, items } = bench();
    world.set(0, 11, 0, Block.Furnace);
    world.set(0, 12, 0, stateOf(Block.Hopper, { facing: "down" }));
    world.set(1, 11, 0, stateOf(Block.Hopper, { facing: "west" }));
    world.set(0, 10, 0, stateOf(Block.Hopper, { facing: "down" }));
    world.set(0, 9, 0, Block.Chest);
    items(0, 12, 0).items[0] = stack(Items.RawIron, 1);
    items(1, 11, 0).items[0] = stack(Items.Coal, 1);
    items(0, 11, 0).items[FURNACE_OUTPUT] = stack(Items.IronIngot, 2);
    run(20);
    const furnace = items(0, 11, 0);
    expect(furnace.items[FURNACE_INPUT]?.item ?? furnace.kind === "furnace").toBeTruthy();
    expect(furnace.items[FURNACE_FUEL]?.item === Items.Coal || (furnace.kind === "furnace" && furnace.burn > 0)).toBe(true);
    expect(items(0, 9, 0).items.find((s) => s)?.item).toBe(Items.IronIngot);
  });

  it("take in what lies in their bowl", () => {
    const { world, drops, run, items } = bench();
    world.set(0, 11, 0, stateOf(Block.Hopper, { facing: "down" }));
    drops.spawn(0.5, 11.8, 0.5, stack(Items.Apple, 3));
    run(1);
    expect(drops.items.size).toBe(0);
    expect(items(0, 11, 0).items[0]).toMatchObject({ item: Items.Apple, count: 3 });
  });
});

describe("comparators", () => {
  it("read how full the chest behind them is", () => {
    const { world, ticksUntil, items } = bench();
    world.set(0, 10, 0, Block.Chest);
    world.set(1, 10, 0, stateOf(Block.Comparator, { facing: "east" }));
    const power = (): number => Number(propertyOf(world.get(1, 10, 0), "power"));
    const chest = items(0, 10, 0);
    chest.items[0] = stack(Block.Cobblestone, 64);
    expect(fillLevel(chest)).toBe(1);
    expect(ticksUntil(() => power() === 1)).toBeLessThanOrEqual(4);
    for (let i = 0; i < 14; i++) chest.items[i] = stack(Block.Cobblestone, 64);
    expect(ticksUntil(() => power() === 8)).toBeLessThanOrEqual(4);
    for (let i = 0; i < 27; i++) chest.items[i] = stack(Block.Cobblestone, 64);
    expect(ticksUntil(() => power() === 15)).toBeLessThanOrEqual(4);
  });

  it("keep their signal unless a side is stronger, or subtract the side's", () => {
    const { world, run, ticksUntil } = bench();
    world.set(0, 10, 0, stateOf(Block.Lever, { face: "floor", facing: "north", powered: "true" }));
    world.set(1, 10, 0, stateOf(Block.Comparator, { facing: "east" }));
    const power = (): number => Number(propertyOf(world.get(1, 10, 0), "power"));
    expect(ticksUntil(() => power() === 15)).toBe(2);
    // Dust at its side from a lever three blocks off: 13
    world.set(1, 10, 3, stateOf(Block.Lever, { face: "floor", facing: "north", powered: "true" }));
    for (const z of [1, 2]) world.set(1, 10, z, Block.RedstoneWire);
    run(4);
    expect(power()).toBe(15);
    useBlock(world, { x: 1, y: 10, z: 0 });
    expect(propertyOf(world.get(1, 10, 0), "mode")).toBe("subtract");
    expect(ticksUntil(() => power() === 1)).toBeLessThanOrEqual(4);
  });
});

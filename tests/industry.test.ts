import { describe, expect, it } from "vitest";
import { useBlock } from "../src/actions.js";
import { loadEntity, saveEntity, type MachineEntity } from "../src/blockEntities.js";
import { Block, STATE_BLOCK, propertyOf, stateOf } from "../src/blocks.js";
import { CHUNK_SIZE } from "../src/chunk.js";
import { craft } from "../src/crafting.js";
import { CABLES, posKey } from "../src/energy.js";
import { growTree } from "../src/gen/features.js";
import { TerrainGenerator } from "../src/generator.js";
import { growthBehaviors } from "../src/growth.js";
import { ITEMS, Items, itemByName, stack, type ItemStack } from "../src/items.js";
import { BATTERY, CHARGE, FUEL, INPUT, MACHINES, OUTPUT, STORE_DRAIN, charge, chargeOf, discharge, machineTick } from "../src/machines.js";
import { WorldTicks } from "../src/ticks.js";
import { BlockUpdates } from "../src/updates.js";
import { VoxelWorld } from "../src/world.js";
import { flatWorld } from "./helpers.js";

/** A stone floor (top at y 9) with block updates, machines working and energy moving, tick by tick. */
function plant() {
  const world = flatWorld(10, 2);
  const ticks = new WorldTicks(world);
  const updates = new BlockUpdates(world, ticks);
  world.onChanged = (x, y, z, old) => updates.changed(x, y, z, old);
  const energy = updates.energy;
  ticks.onTick = () => {
    for (const chunk of world.chunks.values()) {
      for (const [key, e] of chunk.entities) {
        if (e.kind !== "machine") continue;
        const working = machineTick(MACHINES.get(e.block)!, e);
        const [x, y, z] = [chunk.cx * CHUNK_SIZE + (key & 15), key >> 8, chunk.cz * CHUNK_SIZE + ((key >> 4) & 15)];
        const s = world.get(x, y, z);
        if (MACHINES.get(e.block)!.role !== "storage" && propertyOf(s, "active") !== String(working)) world.set(x, y, z, stateOf(STATE_BLOCK[s], { facing: propertyOf(s, "facing"), active: String(working) }));
      }
    }
    energy.tick();
  };
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) ticks.tick();
  };
  const machine = (x: number, y: number, z: number): MachineEntity => world.blockEntity(x, y, z) as MachineEntity;
  /** A line of cable along x from x0 to x1 (inclusive) at y 10, z 0. */
  const cable = (x0: number, x1: number, kind: number = Block.TinCable, z: number = 0): void => {
    for (let x = x0; x <= x1; x++) world.set(x, 10, z, kind);
  };
  return { world, ticks, energy, run, machine, cable };
}

const item = (name: string): number => itemByName(name)!;

describe("the generator", () => {
  it("burns coal into 4,000 EU, 10 a tick, and charges a battery", () => {
    const spec = MACHINES.get(Block.Generator)!;
    const e = loadEntity({ x: 0, y: 0, z: 0, kind: "machine", block: "generator", items: [] }) as MachineEntity;
    e.items[FUEL] = stack(Items.Coal, 2);
    for (let i = 0; i < 400; i++) machineTick(spec, e);
    expect([e.energy, e.items[FUEL]?.count]).toEqual([4000, 1]);
    // Full: it waits with its fuel
    machineTick(spec, e);
    expect([e.energy, e.items[FUEL]?.count]).toEqual([4000, 1]);
    e.items[CHARGE] = { item: Items.Battery, count: 1, damage: 10000 };
    for (let i = 0; i < 100; i++) machineTick(spec, e);
    expect(chargeOf(e.items[CHARGE])).toBeGreaterThan(3000);
  });
});

describe("energy", () => {
  it("goes from a generator down a cable to a machine, less what the cable loses", () => {
    const { world, run, machine, cable, energy } = plant();
    world.set(0, 10, 0, stateOf(Block.Generator, { facing: "north" }));
    cable(1, 8);
    world.set(9, 10, 0, stateOf(Block.Macerator, { facing: "north" }));
    expect(propertyOf(world.get(3, 10, 0), "east") + propertyOf(world.get(3, 10, 0), "west")).toBe("truetrue");
    machine(0, 10, 0).energy = 1000;
    run(1);
    // 10 EU sent, 8 tin cables lose 0.2 of it
    expect(machine(9, 10, 0).energy).toBeCloseTo(9.8, 5);
    expect(energy.flow.get(posKey(4, 10, 0))).toBeCloseTo(9.8, 5);
  });

  it("fills the nearest machine first", () => {
    const { world, run, machine, cable } = plant();
    world.set(0, 10, 0, stateOf(Block.Generator, { facing: "north" }));
    cable(1, 10);
    world.set(3, 10, 1, stateOf(Block.ElectricFurnace, { facing: "north" }));
    world.set(11, 10, 0, stateOf(Block.Macerator, { facing: "north" }));
    machine(0, 10, 0).energy = 4000;
    // Everything to the furnace (three blocks on) until it is full, then on to the macerator
    run(20);
    expect(machine(11, 10, 0).energy).toBe(0);
    run(40);
    expect(machine(3, 10, 1).energy).toBeCloseTo(MACHINES.get(Block.ElectricFurnace)!.capacity, 1);
    expect(machine(11, 10, 0).energy).toBeGreaterThan(0);
  });

  it("works a macerator: raw iron into two dusts in fifteen seconds, ores doubled", () => {
    const { world, run, machine } = plant();
    world.set(0, 10, 0, stateOf(Block.Generator, { facing: "north" }));
    world.set(1, 10, 0, stateOf(Block.Macerator, { facing: "north" }));
    machine(0, 10, 0).items[FUEL] = stack(Items.Coal, 1);
    machine(1, 10, 0).items[INPUT] = stack(Items.RawIron, 2);
    run(150);
    expect(propertyOf(world.get(1, 10, 0), "active")).toBe("true");
    expect(propertyOf(world.get(0, 10, 0), "active")).toBe("true");
    run(160);
    expect(machine(1, 10, 0).items[OUTPUT]).toEqual({ item: Items.IronDust, count: 2, damage: 0 });
    expect(machine(1, 10, 0).items[INPUT]?.count).toBe(1);
  });

  it("is stored in a battery box, which sends it on only from its front", () => {
    const { world, run, machine, cable } = plant();
    world.set(0, 10, 0, stateOf(Block.Generator, { facing: "north" }));
    cable(1, 2);
    // Its front east, toward the furnace; the generator's cable comes in at its back
    world.set(3, 10, 0, stateOf(Block.BatteryBox, { facing: "east" }));
    world.set(4, 10, 0, stateOf(Block.ElectricFurnace, { facing: "north" }));
    machine(0, 10, 0).energy = 2000;
    run(5);
    expect(machine(3, 10, 0).energy).toBeGreaterThan(0);
    expect(machine(4, 10, 0).energy).toBeGreaterThan(0);
    // Turned round, it sends back into the cable toward the generator, which takes nothing
    world.set(3, 10, 0, stateOf(Block.BatteryBox, { facing: "west" }));
    const box = machine(3, 10, 0);
    box.energy = 1000;
    machine(4, 10, 0).energy = 0;
    machine(0, 10, 0).energy = 0;
    run(5);
    expect(machine(4, 10, 0).energy).toBe(0);
    expect(box.energy).toBe(1000);
  });

  it("charges and empties batteries in a battery box's slots, up to its tier's packets", () => {
    const spec = MACHINES.get(Block.BatteryBox)!;
    const e = loadEntity({ x: 0, y: 0, z: 0, kind: "machine", block: "battery_box", items: [] }) as MachineEntity;
    e.items[STORE_DRAIN] = { item: Items.Battery, count: 1, damage: 0 };
    for (let i = 0; i < 10; i++) machineTick(spec, e);
    expect(e.energy).toBe(320);
    expect(chargeOf(e.items[STORE_DRAIN])).toBe(10000 - 320);
    const slots: (ItemStack | null)[] = [{ item: Items.Battery, count: 1, damage: 10000 }];
    expect(charge(slots, 0, 1000, 1)).toBe(32);
    expect(discharge(slots, 0, 1000, 1)).toBe(32);
    expect(charge(slots, 0, 1000, 0)).toBe(0);
  });

  it("finds its ways again when a cable is cut", () => {
    const { world, run, machine, cable } = plant();
    world.set(0, 10, 0, stateOf(Block.Generator, { facing: "north" }));
    cable(1, 5);
    world.set(6, 10, 0, stateOf(Block.Macerator, { facing: "north" }));
    machine(0, 10, 0).energy = 4000;
    run(2);
    const before = machine(6, 10, 0).energy;
    expect(before).toBeGreaterThan(0);
    world.set(3, 10, 0, Block.Air);
    run(5);
    expect(machine(6, 10, 0).energy).toBe(before);
  });

  it("knows its cables: tin for low voltage with little loss, copper for medium, bare copper losing more", () => {
    expect(CABLES.get(Block.TinCable)).toEqual({ tier: 1, loss: 0.025, bare: false });
    expect(CABLES.get(Block.InsulatedCopperCable)!.loss).toBeLessThan(CABLES.get(Block.CopperCable)!.loss);
  });
});

describe("machines", () => {
  const work = (block: number, input: ItemStack): ItemStack | null => {
    const spec = MACHINES.get(block)!;
    const e = loadEntity({ x: 0, y: 0, z: 0, kind: "machine", block: ITEMS[block].name, items: [] }) as MachineEntity;
    e.items[INPUT] = input;
    e.energy = spec.capacity;
    for (let i = 0; i < spec.time && !e.items[OUTPUT]; i++) machineTick(spec, e);
    return e.items[OUTPUT];
  };

  it("an electric furnace smelts, an extractor makes rubber, a compressor packs", () => {
    expect(work(Block.ElectricFurnace, stack(Items.RawIron, 1))).toEqual(stack(Items.IronIngot, 1));
    expect(work(Block.Extractor, stack(Items.StickyResin, 1))).toEqual(stack(Items.Rubber, 3));
    expect(work(Block.Compressor, stack(Items.Snowball, 4))).toEqual(stack(Block.SnowBlock, 1));
    expect(work(Block.Compressor, stack(Items.Snowball, 3))).toBeNull();
    expect(work(Block.Macerator, stack(Items.Bone, 1))).toEqual(stack(Items.BoneMeal, 5));
  });

  it("run off a battery when they have no other power, and stop without energy", () => {
    const spec = MACHINES.get(Block.ElectricFurnace)!;
    const e = loadEntity({ x: 0, y: 0, z: 0, kind: "machine", block: "electric_furnace", items: [] }) as MachineEntity;
    e.items[INPUT] = stack(Block.Sand, 2);
    expect(machineTick(spec, e)).toBe(false);
    e.items[BATTERY] = { item: Items.Battery, count: 1, damage: 0 };
    for (let i = 0; i < spec.time; i++) machineTick(spec, e);
    expect(e.items[OUTPUT]).toEqual(stack(Block.Glass, 1));
  });

  it("keep their energy and work in the save", () => {
    const e = loadEntity({ x: 0, y: 0, z: 0, kind: "machine", block: "macerator", items: [] }) as MachineEntity;
    e.energy = 500;
    e.progress = 120;
    e.items[INPUT] = stack(Items.RawTin, 3);
    const saved = saveEntity(1, 2, 3, e);
    expect(saved).toMatchObject({ kind: "machine", block: "macerator", energy: 500, progress: 120 });
    expect(loadEntity(saved)).toEqual(e);
  });

  it("are turned with a wrench, or taken up whole sneaking", () => {
    const { world } = plant();
    world.set(0, 10, 0, stateOf(Block.Compressor, { facing: "north" }));
    expect(useBlock(world, { x: 0, y: 10, z: 0, use: "wrench", nx: 1, ny: 0, nz: 0 })).toBe(true);
    expect(propertyOf(world.get(0, 10, 0), "facing")).toBe("east");
    expect(useBlock(world, { x: 0, y: 10, z: 0, use: "wrench", nx: 0, ny: 1, nz: 0 })).toBe(false);
    const dropped: ItemStack[] = [];
    expect(useBlock(world, { x: 0, y: 10, z: 0, use: "wrench", sneak: true }, (_x, _y, _z, s) => dropped.push(...s))).toBe(true);
    expect([world.get(0, 10, 0), dropped]).toEqual([Block.Air, [stack(Block.Compressor, 1)]]);
  });
});

describe("rubber", () => {
  it("trees grow with resin spots, which a tree tap empties and which fill again", () => {
    const world = flatWorld(10, 1);
    world.set(0, 9, 0, Block.Grass);
    let seed = 0;
    let spots = 0;
    // Grow until a tree has a spot
    for (; seed < 40 && spots === 0; seed++) {
      for (let y = 10; y < 20; y++) world.set(0, y, 0, Block.Air);
      growTree({ get: (x, y, z) => world.get(x, y, z), set: (x, y, z, s) => void world.set(x, y, z, s), fill: (x, y, z, s) => void (world.get(x, y, z) === Block.Air && world.set(x, y, z, s)) }, "rubber", 0, 10, 0, seed);
      for (let y = 10; y < 20; y++) if (STATE_BLOCK[world.get(0, y, 0)] === Block.RubberLog && propertyOf(world.get(0, y, 0), "resin") === "wet") spots++;
    }
    expect(spots).toBeGreaterThan(0);
    let y = 10;
    while (propertyOf(world.get(0, y, 0), "resin") !== "wet") y++;
    const face = propertyOf(world.get(0, y, 0), "facing");
    const n = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[face]!;
    const got: ItemStack[] = [];
    // Only on the spot's own side
    expect(useBlock(world, { x: 0, y, z: 0, use: "tap", nx: -n[0], ny: 0, nz: -n[1] })).toBe(false);
    expect(useBlock(world, { x: 0, y, z: 0, use: "tap", nx: n[0], ny: 0, nz: n[1] }, (_x, _y, _z, s) => got.push(...s))).toBe(true);
    expect(got[0].item).toBe(Items.StickyResin);
    expect(propertyOf(world.get(0, y, 0), "resin")).toBe("dry");
    const growth = growthBehaviors({ random: () => 0 });
    const ticks = new WorldTicks(world);
    growth.get(Block.RubberLog)!.random!(world, 0, y, 0, world.get(0, y, 0), ticks);
    expect(propertyOf(world.get(0, y, 0), "resin")).toBe("wet");
  });

  it("is made into insulated cable, circuits and batteries; batteries come empty", () => {
    const grid = (names: (string | null)[]): (ItemStack | null)[] => names.map((n) => (n ? stack(item(n), 1) : null));
    expect(craft(grid(["copper_cable", "rubber", null, null]), 2)?.item).toBe(Block.InsulatedCopperCable);
    const battery = craft(grid([null, "insulated_copper_cable", null, "tin_ingot", "redstone", "tin_ingot", "tin_ingot", "redstone", "tin_ingot"]), 3);
    expect(battery).toEqual({ item: Items.Battery, count: 1, damage: 10000 });
  });
});

describe("the world", () => {
  it("has tin in its stone, uranium deep and rare", () => {
    const gen = new TerrainGenerator("industry");
    const world = new VoxelWorld(gen);
    world.loadAround(0, 0, 3, Infinity);
    let tin = 0;
    let uranium = 0;
    for (const chunk of world.chunks.values()) {
      for (const section of chunk.sections) {
        if (!section.blocks) continue;
        for (const b of section.blocks) {
          if (b === Block.TinOre) tin++;
          if (b === Block.UraniumOre) uranium++;
        }
      }
    }
    expect(tin).toBeGreaterThan(100);
    expect(uranium).toBeGreaterThan(0);
    expect(uranium).toBeLessThan(tin / 5);
  });
});

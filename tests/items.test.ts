import { describe, expect, it } from "vitest";
import { Block, stateOf } from "../src/blocks.js";
import { craft, fuelOf, smelt } from "../src/crafting.js";
import { Inventory, arraySlot, click, gather, moveInto } from "../src/inventory.js";
import { ITEMS, Items, TOOLS, itemByName, loadStack, saveStack, stack, type ItemStack } from "../src/items.js";
import { breakTime, canHarvest, dropsOf } from "../src/mining.js";

const named = (name: string, count: number = 1): ItemStack => stack(itemByName(name)!, count);
const nameOf = (s: ItemStack | null): string | null => (s ? `${ITEMS[s.item].name} x${s.count}` : null);
/** A grid from rows of names ("." for empty). */
const grid = (...rows: string[][]): (ItemStack | null)[] => rows.flat().map((n) => (n === "." ? null : named(n)));

describe("slots", () => {
  it("pick up, put down, merge and swap with the left button; halve and drop one with the right", () => {
    const slots: (ItemStack | null)[] = [named("cobblestone", 40), named("cobblestone", 30), named("dirt", 5), null];
    const at = (i: number) => arraySlot(slots, i);
    let cursor = click(at(0), null, false);
    expect(nameOf(cursor)).toBe("cobblestone x40");
    // Onto 30 of the same: 34 go, 6 stay on the cursor
    cursor = click(at(1), cursor, false);
    expect([nameOf(slots[1]), nameOf(cursor)]).toEqual(["cobblestone x64", "cobblestone x6"]);
    // One at a time with the right button
    cursor = click(at(3), cursor, true);
    expect([nameOf(slots[3]), nameOf(cursor)]).toEqual(["cobblestone x1", "cobblestone x5"]);
    // Onto something else: swap
    cursor = click(at(2), cursor, false);
    expect([nameOf(slots[2]), nameOf(cursor)]).toEqual(["cobblestone x5", "dirt x5"]);
    // Half of a stack, rounded up
    cursor = click(at(2), null, true);
    expect([nameOf(slots[2]), nameOf(cursor)]).toEqual(["cobblestone x2", "cobblestone x3"]);
  });

  it("move stacks onto their kind first, then into empty slots; a double click gathers", () => {
    const slots: (ItemStack | null)[] = [null, named("torch", 60), null, named("torch", 10)];
    const all = slots.map((_, i) => arraySlot(slots, i));
    expect(moveInto(named("torch", 20), all)).toBeNull();
    expect(slots.map(nameOf)).toEqual([null, "torch x64", null, "torch x26"]);
    expect(nameOf(moveInto(named("stone", 64 * 3), all))).toBe("stone x64");
    const cursor = gather(named("torch", 1), all);
    expect([nameOf(cursor), slots.map(nameOf)[3], slots.map(nameOf)[1]]).toEqual(["torch x64", null, "torch x27"]);
  });

  it("keep tools apart and wear them out, and fill the hotbar first", () => {
    const inv = new Inventory();
    expect(inv.add(stack(TOOLS.wooden.pickaxe))).toBeNull();
    expect(inv.add(stack(TOOLS.wooden.pickaxe))).toBeNull();
    expect(inv.slots.slice(0, 2).map(nameOf)).toEqual(["wooden_pickaxe x1", "wooden_pickaxe x1"]);
    for (let i = 0; i < 58; i++) inv.wearHeld();
    expect(inv.held!.damage).toBe(58);
    inv.wearHeld();
    expect(inv.held).toBeNull();
    expect(inv.add(named("dirt", 64 * 40))!.count).toBe(64 * 40 - 64 * 35);
  });

  it("are saved by name, and unknown items or counts come back as nothing", () => {
    const worn = { ...stack(TOOLS.iron.axe), damage: 12 };
    expect(loadStack(saveStack(worn))).toEqual(worn);
    expect(loadStack({ item: "netherite_sword", count: 1 })).toBeNull();
    expect(loadStack({ item: "dirt", count: 0 })).toBeNull();
    expect(loadStack({ item: "dirt", count: 999 })!.count).toBe(64);
  });
});

describe("crafting", () => {
  it("makes planks from any log, sticks, a crafting table, torches", () => {
    expect(nameOf(craft(grid(["birch_log", "."], [".", "."]), 2))).toBe("birch_planks x4");
    expect(nameOf(craft(grid([".", "oak_planks"], [".", "spruce_planks"]), 2))).toBe("stick x4");
    expect(nameOf(craft(grid(["oak_planks", "jungle_planks"], ["oak_planks", "oak_planks"]), 2))).toBe("crafting_table x1");
    expect(nameOf(craft(grid(["charcoal", ".", "."], ["stick", ".", "."], [".", ".", "."]), 3))).toBe("torch x4");
  });

  it("matches shapes anywhere in the grid and mirrored, and nothing else", () => {
    expect(nameOf(craft(grid(["cobblestone", "cobblestone", "cobblestone"], [".", "stick", "."], [".", "stick", "."]), 3))).toBe("stone_pickaxe x1");
    // An axe the other way round
    expect(nameOf(craft(grid([".", "iron_ingot", "iron_ingot"], [".", "stick", "iron_ingot"], [".", "stick", "."]), 3))).toBe("iron_axe x1");
    // A shovel in the right column
    expect(nameOf(craft(grid([".", ".", "diamond"], [".", ".", "stick"], [".", ".", "stick"]), 3))).toBe("diamond_shovel x1");
    expect(craft(grid(["cobblestone", ".", "cobblestone"], [".", "stick", "."], [".", "stick", "."]), 3)).toBeNull();
    expect(craft(grid([".", "."], [".", "."]), 2)).toBeNull();
    // Furnace and chest: the same ring, different materials
    const ring = (m: string) => grid([m, m, m], [m, ".", m], [m, m, m]);
    expect(nameOf(craft(ring("cobblestone"), 3))).toBe("furnace x1");
    expect(nameOf(craft(ring("acacia_planks"), 3))).toBe("chest x1");
  });

  it("smelts ores, sand and logs, burning wood and coal", () => {
    expect(ITEMS[smelt(Items.RawIron)!].name).toBe("iron_ingot");
    expect(ITEMS[smelt(Block.Sand)!].name).toBe("glass");
    expect(ITEMS[smelt(Block.SpruceLog)!].name).toBe("charcoal");
    expect(smelt(Block.Dirt)).toBeNull();
    expect([fuelOf(Items.Coal), fuelOf(Block.Planks), fuelOf(Items.Stick), fuelOf(Block.Stone)]).toEqual([1600, 300, 100, 0]);
  });
});

describe("mining", () => {
  it("takes as long as Minecraft: hardness times 1.5 s, or 5 s without the right tool, divided by its speed", () => {
    const pick = (tier: string) => stack(TOOLS[tier].pickaxe);
    expect(breakTime(Block.Dirt, null)).toBeCloseTo(0.75);
    expect(breakTime(Block.Stone, null)).toBeCloseTo(7.5);
    expect(breakTime(Block.Stone, pick("wooden"))).toBeCloseTo(1.125);
    expect(breakTime(Block.Log, stack(TOOLS.stone.axe))).toBeCloseTo(0.75);
    expect(breakTime(Block.Obsidian, pick("diamond"))).toBeCloseTo(9.375);
    // Iron ore with a wooden pickaxe: no drops, so the slow way
    expect(canHarvest(Block.IronOre, pick("wooden"))).toBe(false);
    expect(breakTime(Block.IronOre, pick("wooden"))).toBeCloseTo(7.5);
    expect(breakTime(Block.Torch, null)).toBe(0);
    expect(breakTime(Block.Bedrock, pick("diamond"))).toBe(Infinity);
  });

  it("drops what Minecraft does, and nothing without the right tool", () => {
    const names = (state: number, held: ItemStack | null, r: number = 0.5) => dropsOf(state, held, () => r).map(nameOf);
    expect(names(Block.Stone, null)).toEqual([]);
    expect(names(Block.Stone, stack(TOOLS.wooden.pickaxe))).toEqual(["cobblestone x1"]);
    expect(names(Block.Grass, null)).toEqual(["dirt x1"]);
    expect(names(Block.IronOre, stack(TOOLS.stone.pickaxe))).toEqual(["raw_iron x1"]);
    expect(names(Block.DiamondOre, stack(TOOLS.stone.pickaxe))).toEqual([]);
    expect(names(Block.Glass, null)).toEqual([]);
    expect(names(stateOf(Block.StoneSlab, { type: "double" }), stack(TOOLS.iron.pickaxe))).toEqual(["stone_slab x2"]);
    expect(names(Block.Leaves, null, 0.001)).toEqual(["oak_sapling x1", "apple x1"]);
    expect(names(Block.Leaves, null, 0.5)).toEqual([]);
    expect(names(stateOf(Block.Snow, { layers: "3" }), stack(TOOLS.wooden.shovel))).toEqual(["snowball x3"]);
  });
});

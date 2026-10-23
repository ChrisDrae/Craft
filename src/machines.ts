import { Block, FACING6_DIR, FACING_DIR, STATE_BLOCK, propertyOf, withProperties } from "./blocks.js";
import type { BlockEntity, MachineEntity } from "./blockEntities.js";
import { CHUNK_SIZE } from "./chunk.js";
import { fuelOf, smelt } from "./crafting.js";
import { ITEMS, itemByName, type Item, type ItemStack } from "./items.js";

/**
 * The industry's machines (after IndustrialCraft 2): what each does with energy (EU), how much it holds,
 * the tier of packets it takes, its slots. Energy moves between them through cables (energy.ts).
 */

/** Packet sizes by tier: low (1), medium (2), high (3), extreme voltage (4). A machine fed above its tier blows up. */
export const PACKET: readonly number[] = [0, 32, 128, 512, 2048];
export const TIER_NAMES: readonly string[] = ["", "LV", "MV", "HV", "EV"];

/** A machine that works items: what it makes of an input, and how many of it that takes. */
export interface MachineRecipe {
  input: Item;
  count: number;
  output: ItemStack;
}

export interface MachineSpec {
  block: number;
  label: string;
  /** Makes energy (from fuel), works items with it, or stores it. */
  role: "generator" | "processor" | "storage";
  /** The tier it takes in (or sends out). */
  tier: number;
  /** EU it holds. */
  capacity: number;
  /** EU it can send out a tick (generators, stores). */
  output: number;
  /** A processor's EU a tick while at work, and ticks an item takes. */
  use: number;
  time: number;
  /** A processor's recipe for an input, or null. */
  recipe: (input: ItemStack) => MachineRecipe | null;
  /** Its slots: a processor's input, battery (powering it) and output; a generator's fuel and a battery to charge; a store's battery to charge and battery to empty. */
  slots: number;
}

const one = (name: string, count: number = 1): ItemStack => ({ item: itemByName(name)!, count, damage: 0 });

/** A table of recipes by input name: [input, how many, output, how many]. */
function table(rows: ReadonlyArray<readonly [string, number, string, number]>): (s: ItemStack) => MachineRecipe | null {
  const byItem = new Map<Item, MachineRecipe>();
  for (const [input, count, output, n] of rows) {
    const item = itemByName(input);
    if (item === null) throw new Error(`No item ${input}`);
    byItem.set(item, { input: item, count, output: one(output, n) });
  }
  return (s) => {
    const r = byItem.get(s.item);
    return r && s.count >= r.count ? r : null;
  };
}

/** The macerator: an ore into two dusts (ores doubled), stone ground down, bones into bone meal. */
export const MACERATE = table([
  ["raw_iron", 1, "iron_dust", 2],
  ["raw_gold", 1, "gold_dust", 2],
  ["raw_copper", 1, "copper_dust", 2],
  ["raw_tin", 1, "tin_dust", 2],
  ["iron_ore", 1, "iron_dust", 2],
  ["gold_ore", 1, "gold_dust", 2],
  ["copper_ore", 1, "copper_dust", 2],
  ["tin_ore", 1, "tin_dust", 2],
  ["iron_ingot", 1, "iron_dust", 1],
  ["gold_ingot", 1, "gold_dust", 1],
  ["copper_ingot", 1, "copper_dust", 1],
  ["tin_ingot", 1, "tin_dust", 1],
  ["bronze_ingot", 1, "bronze_dust", 1],
  ["coal", 1, "coal_dust", 1],
  ["stone", 1, "cobblestone", 1],
  ["cobblestone", 1, "sand", 1],
  ["gravel", 1, "flint", 1],
  ["bone", 1, "bone_meal", 5],
]);

/** The extractor: rubber out of resin (three for one), rubber logs and saplings. */
export const EXTRACT = table([
  ["sticky_resin", 1, "rubber", 3],
  ["rubber_log", 1, "rubber", 1],
  ["rubber_sapling", 1, "rubber", 1],
]);

/** The compressor: what packs into something denser. */
export const COMPRESS = table([
  ["snowball", 4, "snow_block", 1],
  ["snow_block", 1, "ice", 1],
  ["sand", 4, "sandstone", 1],
  ["clay_ball", 4, "clay", 1],
]);

/** The electric furnace: what a furnace makes, one at a time. */
function smelting(s: ItemStack): MachineRecipe | null {
  const out = smelt(s.item);
  return out === null ? null : { input: s.item, count: 1, output: { item: out, count: 1, damage: 0 } };
}

const none = (): null => null;

/** Every machine, by block. Numbers after IndustrialCraft 2's. */
export const MACHINES: ReadonlyMap<number, MachineSpec> = new Map(
  (
    [
      { block: Block.Generator, label: "Generator", role: "generator", tier: 1, capacity: 4000, output: 10, use: 0, time: 0, recipe: none, slots: 2 },
      { block: Block.ElectricFurnace, label: "Electric furnace", role: "processor", tier: 1, capacity: 416, use: 3, time: 130, output: 0, recipe: smelting, slots: 3 },
      { block: Block.Macerator, label: "Macerator", role: "processor", tier: 1, capacity: 832, use: 2, time: 300, output: 0, recipe: MACERATE, slots: 3 },
      { block: Block.Extractor, label: "Extractor", role: "processor", tier: 1, capacity: 832, use: 2, time: 300, output: 0, recipe: EXTRACT, slots: 3 },
      { block: Block.Compressor, label: "Compressor", role: "processor", tier: 1, capacity: 832, use: 2, time: 300, output: 0, recipe: COMPRESS, slots: 3 },
      { block: Block.BatteryBox, label: "Battery box", role: "storage", tier: 1, capacity: 40000, output: 32, use: 0, time: 0, recipe: none, slots: 2 },
    ] satisfies MachineSpec[]
  ).map((m) => [m.block, m]),
);

/** Slots of a processor, a generator, a store. */
export const INPUT = 0;
export const BATTERY = 1;
export const OUTPUT = 2;
export const FUEL = 0;
export const CHARGE = 1;
export const STORE_CHARGE = 0;
export const STORE_DRAIN = 1;

/** EU a generator makes from an item burned: a quarter of a furnace's burning, at 10 EU a tick (coal: 4,000). */
export function fuelEnergy(item: Item): number {
  return (fuelOf(item) / 4) * 10;
}

/** How much energy a stack holds, if it holds any. */
export function chargeOf(s: ItemStack | null): number {
  const c = s ? ITEMS[s.item].charge : null;
  return c && s ? c.capacity - s.damage : 0;
}

/** Puts up to `eu` into a chargeable stack (its tier's packets at most): how much went in. */
export function charge(slots: (ItemStack | null)[], i: number, eu: number, tier: number): number {
  const s = slots[i];
  const c = s ? ITEMS[s.item].charge : null;
  if (!s || !c || c.tier > tier || s.damage <= 0) return 0;
  const n = Math.min(eu, s.damage, PACKET[c.tier]);
  slots[i] = { ...s, damage: s.damage - n };
  return n;
}

/** Takes up to `eu` out of a chargeable stack: how much came out. */
export function discharge(slots: (ItemStack | null)[], i: number, eu: number, tier: number): number {
  const s = slots[i];
  const c = s ? ITEMS[s.item].charge : null;
  if (!s || !c || c.tier > tier) return 0;
  const n = Math.min(eu, c.capacity - s.damage, PACKET[c.tier]);
  if (n <= 0) return 0;
  slots[i] = { ...s, damage: s.damage + n };
  return n;
}

/** Whether an output slot takes what a recipe makes. */
function fits(slot: ItemStack | null, out: ItemStack): boolean {
  return !slot || (slot.item === out.item && slot.damage === out.damage && slot.count + out.count <= ITEMS[out.item].maxStack);
}

/**
 * One game tick of a machine (where the world runs), as IndustrialCraft's: a generator burns fuel into
 * energy (10 EU a tick) and charges the battery in its slot; a processor takes energy from its battery
 * slot when it runs low and works its input while it has the energy, losing its progress when it can't
 * go on; a store charges a battery in its top slot and empties one in its bottom slot. Returns whether it
 * is at work (its front lit).
 */
export function machineTick(spec: MachineSpec, e: MachineEntity): boolean {
  switch (spec.role) {
    case "generator": {
      if (e.burn === 0 && e.energy < spec.capacity) {
        const fuel = e.items[FUEL];
        const eu = fuel ? fuelEnergy(fuel.item) : 0;
        if (fuel && eu > 0) {
          e.burn = e.burnTotal = eu / 10;
          e.items[FUEL] = fuel.count > 1 ? { ...fuel, count: fuel.count - 1 } : null;
        }
      }
      const burning = e.burn > 0;
      if (burning) {
        e.burn--;
        e.energy = Math.min(spec.capacity, e.energy + 10);
      }
      e.energy -= charge(e.items, CHARGE, e.energy, spec.tier);
      return burning;
    }
    case "processor": {
      if (e.energy < spec.use * 20) e.energy += discharge(e.items, BATTERY, spec.capacity - e.energy, spec.tier);
      const input = e.items[INPUT];
      const recipe = input ? spec.recipe(input) : null;
      if (!recipe || !fits(e.items[OUTPUT], recipe.output) || e.energy < spec.use) {
        e.progress = 0;
        return false;
      }
      e.energy -= spec.use;
      if (++e.progress >= spec.time) {
        e.progress = 0;
        e.items[INPUT] = input!.count > recipe.count ? { ...input!, count: input!.count - recipe.count } : null;
        const out = e.items[OUTPUT];
        e.items[OUTPUT] = out ? { ...out, count: out.count + recipe.output.count } : { ...recipe.output };
      }
      return true;
    }
    case "storage":
      e.energy -= charge(e.items, STORE_CHARGE, e.energy, spec.tier);
      e.energy += discharge(e.items, STORE_DRAIN, spec.capacity - e.energy, spec.tier);
      return false;
  }
}

/** What ticking machines needs of the world (VoxelWorld). */
export interface MachineWorld {
  readonly chunks: ReadonlyMap<number, { cx: number; cz: number; entities: ReadonlyMap<number, BlockEntity>; unsaved: boolean }>;
  get(x: number, y: number, z: number): number;
  set(x: number, y: number, z: number, state: number): boolean;
}

/** A game tick of every loaded machine; one that starts or stops working lights or darkens its front. */
export function tickMachines(w: MachineWorld): void {
  for (const chunk of w.chunks.values()) {
    if (chunk.entities.size === 0) continue;
    for (const [key, e] of chunk.entities) {
      if (e.kind !== "machine") continue;
      const spec = MACHINES.get(e.block);
      if (!spec) continue;
      const working = machineTick(spec, e);
      chunk.unsaved = true;
      const x = chunk.cx * CHUNK_SIZE + (key & 15);
      const y = key >> 8;
      const z = chunk.cz * CHUNK_SIZE + ((key >> 4) & 15);
      const state = w.get(x, y, z);
      if (spec.role !== "storage" && propertyOf(state, "active") !== String(working)) w.set(x, y, z, withProperties(state, { active: String(working) }));
    }
  }
}

/** Whether a stack may go in a machine's slot: fuel and batteries where they belong, nothing into an output. */
export function machineAccepts(spec: MachineSpec, slot: number, s: ItemStack): boolean {
  const charged = ITEMS[s.item].charge !== null;
  switch (spec.role) {
    case "generator":
      return slot === FUEL ? fuelEnergy(s.item) > 0 : charged;
    case "processor":
      return slot === INPUT || (slot === BATTERY && charged);
    case "storage":
      return charged;
  }
}

/** Whether a block is a machine (holds energy). */
export const isMachine = (state: number): boolean => MACHINES.has(STATE_BLOCK[state]);

/** The side (Dir) a machine sends its energy out of: a store's front; generators every side (-1). */
export function outputSide(state: number): number {
  return STATE_BLOCK[state] === Block.BatteryBox ? FACING6_DIR[propertyOf(state, "facing")] : -1;
}

/** Whether a machine takes energy in on side d (Dir from it): processors on any, a store anywhere but its front. */
export function takesOn(state: number, d: number): boolean {
  const spec = MACHINES.get(STATE_BLOCK[state]);
  if (!spec || spec.role === "generator") return false;
  return spec.role === "processor" || d !== outputSide(state);
}

/** Whether a machine sends energy out on side d. */
export function sendsOn(state: number, d: number): boolean {
  const spec = MACHINES.get(STATE_BLOCK[state]);
  if (!spec || spec.role === "processor") return false;
  return spec.role === "generator" || d === outputSide(state);
}

/** The direction a machine faces (its front), for the wrench: four ways, or six for a battery box. */
export function frontOf(state: number): number {
  const f = propertyOf(state, "facing");
  return f in FACING_DIR ? FACING_DIR[f] : FACING6_DIR[f];
}


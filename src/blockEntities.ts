import { Block, STATE_BLOCK, propertyOf, stateByName, stateName, withProperties } from "./blocks.js";
import { CHUNK_SIZE, type Chunk } from "./chunk.js";
import { SMELT_TIME, fuelOf, smelt, smeltXp } from "./crafting.js";
import { ITEMS, loadStack, saveStack, type ItemStack, type SavedStack } from "./items.js";

/**
 * What some blocks hold beyond their state, as Minecraft's block entities: a chest's 27 slots, a
 * furnace's input, fuel and output with how far its burning and smelting are. They live in their chunk
 * (by position within it) and are saved with it.
 */
export interface ChestEntity {
  kind: "chest";
  items: (ItemStack | null)[];
}

export interface FurnaceEntity {
  kind: "furnace";
  /** Input, fuel, output. */
  items: (ItemStack | null)[];
  /** Ticks of burning left, and how many the fuel burning gave (for the flame's height). */
  burn: number;
  burnTotal: number;
  /** Ticks into smelting the input, up to SMELT_TIME. */
  cook: number;
  /** Experience from what it smelted, given to whoever takes from the output (takeXp). */
  xp: number;
}

/** A hopper's five slots, and how long until it passes an item on again. */
export interface HopperEntity {
  kind: "hopper";
  items: (ItemStack | null)[];
  cooldown: number;
}

/** A block a piston is moving (see pistons.ts): what it will be, the way it goes, how far it has come. */
export interface MovingEntity {
  kind: "moving";
  /** Always empty: a moving block holds nothing. */
  items: (ItemStack | null)[];
  state: number;
  /** The way it goes (Dir) and how far it has come (0-1). */
  dir: number;
  progress: number;
  /** Out of the piston (pushed, or the head going out), or back toward it. */
  extending: boolean;
  /** The piston's head (gone back in, it becomes nothing). */
  head: boolean;
  /** The game tick it started on: it moves from the next (not saved). */
  since?: number;
}

export type BlockEntity = ChestEntity | FurnaceEntity | HopperEntity | MovingEntity;

export const CHEST_SLOTS = 27;
export const HOPPER_SLOTS = 5;
export const FURNACE_INPUT = 0;
export const FURNACE_FUEL = 1;
export const FURNACE_OUTPUT = 2;

/** A new, empty entity for a block that has one, or null. */
export function entityFor(block: number): BlockEntity | null {
  if (block === Block.Chest) return { kind: "chest", items: new Array(CHEST_SLOTS).fill(null) };
  if (block === Block.Furnace) return { kind: "furnace", items: [null, null, null], burn: 0, burnTotal: 0, cook: 0, xp: 0 };
  if (block === Block.Hopper) return { kind: "hopper", items: new Array(HOPPER_SLOTS).fill(null), cooldown: 0 };
  if (block === Block.MovingPiston) return { kind: "moving", items: [], state: Block.Air, dir: 0, progress: 1, extending: true, head: false };
  return null;
}

/** The block each kind of entity belongs to. */
const BLOCK_OF: Readonly<Record<BlockEntity["kind"], number>> = { chest: Block.Chest, furnace: Block.Furnace, hopper: Block.Hopper, moving: Block.MovingPiston };

/** Whether a state's block keeps the entity (a lit furnace is still a furnace). */
export function keeps(entity: BlockEntity, state: number): boolean {
  return STATE_BLOCK[state] === BLOCK_OF[entity.kind];
}

/** Whether the furnace's input smelts into what its output slot can take. */
function canSmelt(f: FurnaceEntity): boolean {
  const input = f.items[FURNACE_INPUT];
  if (!input) return false;
  const out = smelt(input.item);
  if (out === null) return false;
  const output = f.items[FURNACE_OUTPUT];
  return !output || (output.item === out && output.count < ITEMS[out].maxStack);
}

/**
 * One game tick of a furnace, as Minecraft's: it takes fuel when it has burned out and has something to
 * smelt, smelts while burning (an item every SMELT_TIME ticks), and loses its progress when it stops.
 * Returns whether it is still busy (burning or able to start).
 */
export function furnaceTick(f: FurnaceEntity): boolean {
  if (f.burn > 0) f.burn--;
  const smelting = canSmelt(f);
  if (f.burn === 0 && smelting) {
    const fuel = f.items[FURNACE_FUEL];
    const ticks = fuel ? fuelOf(fuel.item) : 0;
    if (ticks > 0) {
      f.burn = f.burnTotal = ticks;
      f.items[FURNACE_FUEL] = fuel!.count > 1 ? { ...fuel!, count: fuel!.count - 1 } : null;
    }
  }
  if (f.burn > 0 && smelting) {
    if (++f.cook >= SMELT_TIME) {
      f.cook = 0;
      const input = f.items[FURNACE_INPUT]!;
      const made = smelt(input.item)!;
      f.items[FURNACE_INPUT] = input.count > 1 ? { ...input, count: input.count - 1 } : null;
      const output = f.items[FURNACE_OUTPUT];
      f.items[FURNACE_OUTPUT] = output ? { ...output, count: output.count + 1 } : { item: made, count: 1, damage: 0 };
      f.xp += smeltXp(made);
    }
  } else {
    f.cook = 0;
  }
  return f.burn > 0 || canSmelt(f);
}

/** Takes the experience a furnace has kept: its whole points, and one more by chance for the fraction. */
export function takeXp(f: FurnaceEntity, random: () => number): number {
  const whole = Math.floor(f.xp);
  const xp = whole + (random() < f.xp - whole ? 1 : 0);
  f.xp = 0;
  return xp;
}

/** The furnace's state for whether it burns. */
export function litState(state: number, burning: boolean): number {
  return propertyOf(state, "lit") === String(burning) ? state : withProperties(state, { lit: String(burning) });
}

/** What ticking furnaces needs of the world (VoxelWorld). */
export interface EntityWorld {
  readonly chunks: ReadonlyMap<number, Chunk>;
  get(x: number, y: number, z: number): number;
  set(x: number, y: number, z: number, state: number): boolean;
}

/**
 * A game tick of every loaded furnace. One that starts or stops burning changes its block (lit, which
 * gives off light); one that is busy leaves its chunk to be saved.
 */
export function tickFurnaces(world: EntityWorld): void {
  for (const chunk of world.chunks.values()) {
    if (chunk.entities.size === 0) continue;
    for (const [key, e] of chunk.entities) {
      if (e.kind !== "furnace" || (e.burn === 0 && e.cook === 0 && !e.items[FURNACE_INPUT])) continue;
      furnaceTick(e);
      chunk.unsaved = true;
      const x = chunk.cx * CHUNK_SIZE + (key & 15);
      const y = key >> 8;
      const z = chunk.cz * CHUNK_SIZE + ((key >> 4) & 15);
      const state = world.get(x, y, z);
      const lit = litState(state, e.burn > 0);
      if (lit !== state) world.set(x, y, z, lit);
    }
  }
}

/** Whether a stack may go in a furnace slot: fuel in the fuel slot, nothing put into the output. */
export function furnaceAccepts(slot: number, s: ItemStack): boolean {
  if (slot === FURNACE_FUEL) return fuelOf(s.item) > 0;
  return slot === FURNACE_INPUT;
}

/** A block entity as saves keep it, at its position within the chunk. */
export interface SavedEntity {
  x: number;
  y: number;
  z: number;
  kind: string;
  items: (SavedStack | null)[];
  burn?: number;
  burnTotal?: number;
  cook?: number;
  xp?: number;
  /** A hopper's. */
  cooldown?: number;
  /** A moving block's: what it will be (by name, as chunks keep blocks), the way and how far. */
  state?: string;
  dir?: number;
  progress?: number;
  extending?: boolean;
  head?: boolean;
}

export function saveEntity(x: number, y: number, z: number, e: BlockEntity): SavedEntity {
  const items = e.items.map(saveStack);
  switch (e.kind) {
    case "furnace":
      return { x, y, z, kind: e.kind, items, burn: e.burn, burnTotal: e.burnTotal, cook: e.cook, xp: e.xp };
    case "hopper":
      return { x, y, z, kind: e.kind, items, cooldown: e.cooldown };
    case "moving":
      return { x, y, z, kind: e.kind, items: [], state: stateName(e.state), dir: e.dir, progress: e.progress, extending: e.extending, head: e.head };
    default:
      return { x, y, z, kind: e.kind, items };
  }
}

/** A saved entity back, or null for a kind this Craft doesn't know. */
export function loadEntity(s: SavedEntity): BlockEntity | null {
  const fresh = s.kind in BLOCK_OF ? entityFor(BLOCK_OF[s.kind as BlockEntity["kind"]]) : null;
  if (!fresh) return null;
  fresh.items = fresh.items.map((_, i) => loadStack(s.items?.[i]));
  if (fresh.kind === "furnace") {
    fresh.burn = Math.max(0, Number(s.burn) || 0);
    fresh.burnTotal = Math.max(fresh.burn, Number(s.burnTotal) || 0);
    fresh.cook = Math.max(0, Math.min(SMELT_TIME, Number(s.cook) || 0));
    fresh.xp = Math.max(0, Number(s.xp) || 0);
  } else if (fresh.kind === "hopper") {
    fresh.cooldown = Math.max(0, Math.min(8, Math.floor(Number(s.cooldown) || 0)));
  } else if (fresh.kind === "moving") {
    // A block this Craft doesn't know arrives as nothing
    fresh.state = stateByName(String(s.state ?? "air")) ?? Block.Air;
    fresh.dir = Math.max(0, Math.min(5, Math.floor(Number(s.dir) || 0)));
    fresh.progress = Math.max(0, Math.min(1, Number(s.progress) || 0));
    fresh.extending = s.extending !== false;
    fresh.head = s.head === true;
  }
  return fresh;
}

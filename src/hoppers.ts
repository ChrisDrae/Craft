import { Block, DIR_X, DIR_Y, DIR_Z, Dir, FACING6_DIR, STATE_BLOCK, propertyOf } from "./blocks.js";
import { FURNACE_FUEL, FURNACE_INPUT, FURNACE_OUTPUT, type BlockEntity, type EntityWorld } from "./blockEntities.js";
import { CHUNK_SIZE } from "./chunk.js";
import { fuelOf } from "./crafting.js";
import { ITEMS, type ItemStack } from "./items.js";

/** Game ticks between a hopper's moves (Minecraft's: 2.5 items a second). */
export const HOPPER_COOLDOWN = 8;

/** What hoppers need of the world: its blocks and their entities. */
export interface HopperWorld extends EntityWorld {
  blockEntity(x: number, y: number, z: number): BlockEntity | null;
  chunk(cx: number, cz: number): { unsaved: boolean } | undefined;
}

/** Items lying about that a hopper takes in: their stacks and where they are (Drops). */
export interface LooseItems {
  readonly items: ReadonlyMap<number, { stack: ItemStack; readonly position: { x: number; y: number; z: number } }>;
  /** Takes up to `max` of a lying stack, whatever its pickup delay (hoppers don't wait): what was taken. */
  take(id: number, max: number): ItemStack | null;
}

/** The entity holding items at a block that hoppers work with: a chest, a furnace or a hopper, or null. */
export function inventoryAt(w: HopperWorld, x: number, y: number, z: number): BlockEntity | null {
  const b = STATE_BLOCK[w.get(x, y, z)];
  if (b !== Block.Chest && b !== Block.Furnace && b !== Block.Hopper) return null;
  return w.blockEntity(x, y, z);
}

/**
 * The slots an inventory takes from a hopper on side `side` of it (Dir from the inventory toward the
 * hopper): a furnace its input from above and fuel from the sides, chests and hoppers any slot.
 */
function slotsIn(e: BlockEntity, side: number, s: ItemStack): number[] {
  if (e.kind === "furnace") {
    if (side === Dir.Up) return [FURNACE_INPUT];
    return side !== Dir.Down && fuelOf(s.item) > 0 ? [FURNACE_FUEL] : [];
  }
  return e.items.map((_, i) => i);
}

/** The slots a hopper below takes from: a furnace's output, any slot of the rest. */
const slotsOut = (e: BlockEntity): number[] => (e.kind === "furnace" ? [FURNACE_OUTPUT] : e.items.map((_, i) => i));

/** Puts as much of a stack as fits into an inventory's slots (onto a stack of the same, or into an empty slot): what is left. */
export function insert(e: BlockEntity, s: ItemStack, slots: readonly number[]): ItemStack | null {
  let left = s.count;
  const max = ITEMS[s.item].maxStack;
  for (const pass of [true, false]) {
    for (const i of slots) {
      if (left === 0) break;
      const there = e.items[i];
      if (pass ? !there || there.item !== s.item || there.damage !== s.damage : there !== null) continue;
      const room = max - (there?.count ?? 0);
      const n = Math.min(room, left);
      if (n <= 0) continue;
      e.items[i] = { item: s.item, damage: s.damage, count: (there?.count ?? 0) + n };
      left -= n;
    }
  }
  return left > 0 ? { ...s, count: left } : null;
}

/** Takes one item out of a slot. */
function takeOne(e: BlockEntity, i: number): ItemStack {
  const s = e.items[i]!;
  e.items[i] = s.count > 1 ? { ...s, count: s.count - 1 } : null;
  return { ...s, count: 1 };
}

/** Moves one item from `from` into `to` (on side `side` of it), the first that goes; whether one did. */
function moveOne(from: BlockEntity, fromSlots: readonly number[], to: BlockEntity, side: number): boolean {
  for (const i of fromSlots) {
    const s = from.items[i];
    if (!s) continue;
    if (insert(to, { ...s, count: 1 }, slotsIn(to, side, s)) === null) {
      takeOne(from, i);
      return true;
    }
  }
  return false;
}

/**
 * How full an inventory is, as a comparator reads it (Minecraft's): 0 when empty, else 1 to 15 by how
 * full its slots are on average, each by its item's stack size.
 */
export function fillLevel(e: BlockEntity): number {
  if (e.kind === "moving" || e.items.length === 0) return 0;
  let sum = 0;
  let any = false;
  for (const s of e.items) {
    if (!s) continue;
    any = true;
    sum += s.count / ITEMS[s.item].maxStack;
  }
  return any ? Math.floor(1 + (sum / e.items.length) * 14) : 0;
}

/**
 * A game tick of every loaded hopper, as Minecraft's: unless powered (its "enabled" off) and not cooling
 * down, it passes an item into what it points at (down or a side), then takes one from the inventory
 * above or what lies on it; doing either, it rests HOPPER_COOLDOWN ticks.
 */
export function tickHoppers(w: HopperWorld, loose: LooseItems | null): void {
  for (const chunk of w.chunks.values()) {
    if (chunk.entities.size === 0) continue;
    for (const [key, e] of chunk.entities) {
      if (e.kind !== "hopper") continue;
      if (e.cooldown > 0) e.cooldown--;
      const x = chunk.cx * CHUNK_SIZE + (key & 15);
      const y = key >> 8;
      const z = chunk.cz * CHUNK_SIZE + ((key >> 4) & 15);
      const state = w.get(x, y, z);
      if (e.cooldown > 0 || STATE_BLOCK[state] !== Block.Hopper || propertyOf(state, "enabled") !== "true") continue;
      let moved = false;
      // Out: into what it points at
      const d = FACING6_DIR[propertyOf(state, "facing")];
      const target = inventoryAt(w, x + DIR_X[d], y + DIR_Y[d], z + DIR_Z[d]);
      if (target && e.items.some((s) => s)) moved = moveOne(e, e.items.map((_, i) => i), target, d ^ 1);
      // In: from the inventory above, or what lies in its bowl
      const above = inventoryAt(w, x, y + 1, z);
      if (above) moved = moveOne(above, slotsOut(above), e, Dir.Up) || moved;
      else if (loose) moved = takeLoose(e, loose, x, y, z) || moved;
      if (moved) {
        e.cooldown = HOPPER_COOLDOWN;
        // Its chunk and those of the inventories it took from or gave to are to be saved
        for (const [px, pz] of [[x, z], [x + DIR_X[d], z + DIR_Z[d]]]) {
          const c = w.chunk(px >> 4, pz >> 4);
          if (c) c.unsaved = true;
        }
      }
    }
  }
}

/** Takes in the first stack lying in a hopper's bowl or just over it, as much of it as fits. */
function takeLoose(e: BlockEntity, loose: LooseItems, x: number, y: number, z: number): boolean {
  for (const [id, item] of loose.items) {
    const p = item.position;
    if (p.x < x || p.x >= x + 1 || p.z < z || p.z >= z + 1 || p.y < y + 0.6 || p.y >= y + 2) continue;
    const left = insert({ ...e, items: e.items.map((s) => s && { ...s }) }, item.stack, e.items.map((_, i) => i));
    const fits = item.stack.count - (left?.count ?? 0);
    if (fits <= 0) continue;
    const got = loose.take(id, fits);
    if (got) insert(e, got, e.items.map((_, i) => i));
    return got !== null;
  }
  return false;
}

import { ITEMS, stacksWith, type Item, type ItemStack } from "./items.js";

/** The player's slots: the hotbar (0-8), the rest of the inventory (9-35), armor (36-39), off-hand (40). */
export const HOTBAR_SLOTS = 9;
export const INVENTORY_SLOTS = 36;
export const ARMOR_SLOTS = [36, 37, 38, 39] as const;
export const OFFHAND_SLOT = 40;
export const PLAYER_SLOTS = 41;
/** The armor each armor slot takes. */
export const ARMOR_FOR: readonly string[] = ["head", "chest", "legs", "feet"];

/** A place an item can be: a slot of the player, a chest, a crafting grid... */
export interface Slot {
  get(): ItemStack | null;
  set(stack: ItemStack | null): void;
  /** Whether a stack may be put here (armor slots take only their armor, furnace fuel only fuel). */
  accepts(stack: ItemStack): boolean;
  /** Most items it holds: less than a stack's own for some (armor slots hold one). */
  readonly limit: number;
}

/** A slot of an array of stacks. */
export function arraySlot(slots: (ItemStack | null)[], index: number, accepts: (s: ItemStack) => boolean = () => true, limit: number = 64, onChange: (() => void) | null = null): Slot {
  return {
    get: () => slots[index],
    set: (s) => {
      slots[index] = s && s.count > 0 ? s : null;
      onChange?.();
    },
    accepts,
    limit,
  };
}

const room = (slot: Slot, s: ItemStack): number => Math.min(slot.limit, ITEMS[s.item].maxStack);
const copy = (s: ItemStack, count: number = s.count): ItemStack => ({ item: s.item, count, damage: s.damage });

/**
 * A click on a slot with what the cursor carries, as Minecraft handles it; returns what the cursor carries
 * after. The left button picks up, puts down, merges or swaps whole stacks; the right one picks up half,
 * or puts down one.
 */
export function click(slot: Slot, cursor: ItemStack | null, right: boolean): ItemStack | null {
  const here = slot.get();
  if (!cursor) {
    if (!here) return null;
    if (!right) {
      slot.set(null);
      return here;
    }
    const half = Math.ceil(here.count / 2);
    slot.set(here.count - half > 0 ? copy(here, here.count - half) : null);
    return copy(here, half);
  }
  if (!slot.accepts(cursor)) return cursor;
  const max = room(slot, cursor);
  if (!here) {
    const n = right ? 1 : Math.min(cursor.count, max);
    slot.set(copy(cursor, n));
    return cursor.count - n > 0 ? copy(cursor, cursor.count - n) : null;
  }
  if (stacksWith(here, cursor)) {
    const n = Math.min(right ? 1 : cursor.count, max - here.count);
    if (n <= 0) return cursor;
    slot.set(copy(here, here.count + n));
    return cursor.count - n > 0 ? copy(cursor, cursor.count - n) : null;
  }
  // Different things: swap, if the cursor's fit
  if (cursor.count > max) return cursor;
  slot.set(cursor);
  return here;
}

/**
 * Moves a stack into the first of `targets` that take it: onto stacks of the same item first, then into
 * empty slots. Returns what is left (null if all of it went).
 */
export function moveInto(s: ItemStack, targets: readonly Slot[]): ItemStack | null {
  let left = s.count;
  for (const t of targets) {
    const here = t.get();
    if (!here || !stacksWith(here, s) || !t.accepts(s)) continue;
    const n = Math.min(left, room(t, s) - here.count);
    if (n <= 0) continue;
    t.set(copy(here, here.count + n));
    left -= n;
    if (left === 0) return null;
  }
  for (const t of targets) {
    if (t.get() || !t.accepts(s)) continue;
    const n = Math.min(left, room(t, s));
    t.set(copy(s, n));
    left -= n;
    if (left === 0) return null;
  }
  return copy(s, left);
}

/** Gathers the item the cursor carries from the slots onto it, up to a full stack (a double click). */
export function gather(cursor: ItemStack, slots: readonly Slot[]): ItemStack {
  let count = cursor.count;
  const max = ITEMS[cursor.item].maxStack;
  // Partial stacks first, as Minecraft does
  for (const full of [false, true]) {
    for (const s of slots) {
      if (count >= max) break;
      const here = s.get();
      if (!here || !stacksWith(here, cursor) || (here.count >= max) !== full) continue;
      const n = Math.min(max - count, here.count);
      s.set(here.count - n > 0 ? copy(here, here.count - n) : null);
      count += n;
    }
  }
  return copy(cursor, count);
}

/**
 * The player's items: 41 slots (see above) and which hotbar slot is held. Changes go through here, so
 * whoever shows or saves them hears about it (onChange).
 */
export class Inventory {
  readonly slots: (ItemStack | null)[] = new Array(PLAYER_SLOTS).fill(null);
  selected: number = 0;
  /** Called after anything changes. */
  onChange: (() => void) | null = null;

  /** Every slot as a Slot, armor slots taking only their armor, one piece each. */
  slot(index: number): Slot {
    const armor = ARMOR_SLOTS.indexOf(index as (typeof ARMOR_SLOTS)[number]);
    const accepts = armor >= 0 ? (s: ItemStack) => ITEMS[s.item].armor === ARMOR_FOR[armor] : () => true;
    return arraySlot(this.slots, index, accepts, armor >= 0 ? 1 : 64, () => this.onChange?.());
  }

  get held(): ItemStack | null {
    return this.slots[this.selected];
  }

  /** The hotbar, then the rest: where picked up items go. */
  private storage(): Slot[] {
    return Array.from({ length: INVENTORY_SLOTS }, (_, i) => this.slot(i));
  }

  /** Adds as much of a stack as fits; returns what didn't (null if all of it went in). */
  add(s: ItemStack): ItemStack | null {
    return moveInto(s, this.storage());
  }

  /** How many of an item the inventory holds. */
  count(item: Item): number {
    let n = 0;
    for (let i = 0; i < INVENTORY_SLOTS; i++) if (this.slots[i]?.item === item) n += this.slots[i]!.count;
    return n;
  }

  /** Takes `n` of the held stack (a block placed); returns whether there were that many. */
  useHeld(n: number = 1): boolean {
    const held = this.held;
    if (!held || held.count < n) return false;
    this.slots[this.selected] = held.count > n ? copy(held, held.count - n) : null;
    this.onChange?.();
    return true;
  }

  /** Wears the held tool by `uses`; it breaks when worn through. */
  wearHeld(uses: number = 1): void {
    const held = this.held;
    const durability = held ? ITEMS[held.item].durability : 0;
    if (!held || durability === 0) return;
    const damage = held.damage + uses;
    this.slots[this.selected] = damage >= durability ? null : { ...held, damage };
    this.onChange?.();
  }

  /** Puts a stack in a slot (and says so). */
  put(index: number, s: ItemStack | null): void {
    this.slots[index] = s;
    this.onChange?.();
  }

  /** Selects a hotbar slot. */
  select(slot: number): void {
    this.selected = ((slot % HOTBAR_SLOTS) + HOTBAR_SLOTS) % HOTBAR_SLOTS;
    this.onChange?.();
  }

  /** Empties every slot. */
  clear(): void {
    this.slots.fill(null);
    this.onChange?.();
  }
}

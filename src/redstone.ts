import { Block, DIR_X, DIR_Y, DIR_Z, Dir, FACING_DIR, OPAQUE, SHAPE, STATE_BLOCK, propertyOf, withProperties } from "./blocks.js";
import type { TickBehavior, WorldTicks } from "./ticks.js";

/** What redstone needs of the world. */
export interface RedstoneWorld {
  get(x: number, y: number, z: number): number;
  set(x: number, y: number, z: number, state: number): boolean;
}

/** The sides wire connects toward, in the order of its properties: north, east, south, west. */
const SIDES: readonly number[] = [Dir.NegZ, Dir.PosX, Dir.PosZ, Dir.NegX];
const SIDE_NAMES = ["north", "east", "south", "west"] as const;
/** Game ticks a redstone torch takes to turn, a button stays pressed (stone, wood), a lamp to go out. */
const TORCH_DELAY = 2;
const STONE_BUTTON = 20;
const OAK_BUTTON = 30;
const LAMP_OFF = 4;
/** How often a pressed plate checks whether anything is still on it. */
const PLATE_CHECK = 20;

/** Whether a block passes power on: a solid opaque cube. */
const conductor = (state: number): boolean => OPAQUE[state] === 1;
const isOn = (state: number, name: string): boolean => propertyOf(state, name) === "true";

/** The side a lever, button or torch hangs on: the block it powers through (Dir from it). */
function attachedDir(state: number): number {
  const b = STATE_BLOCK[state];
  if (b === Block.RedstoneTorch) {
    const f = propertyOf(state, "facing");
    return f === "up" ? Dir.Down : FACING_DIR[f] ^ 1;
  }
  const face = propertyOf(state, "face");
  return face === "floor" ? Dir.Down : face === "ceiling" ? Dir.Up : FACING_DIR[propertyOf(state, "facing")] ^ 1;
}

/** Whether a block takes part in redstone: changes to it reach two blocks around (see BlockUpdates). */
export function isRedstone(state: number): boolean {
  const b = STATE_BLOCK[state];
  return b === Block.RedstoneWire || b === Block.RedstoneTorch || b === Block.Lever || b === Block.StoneButton || b === Block.OakButton || b === Block.StonePressurePlate || b === Block.OakPressurePlate || b === Block.Repeater;
}

/** Whether wire beside a block connects to it: wire, a power source, a repeater in line. */
function connectsTo(state: number, side: number): boolean {
  const b = STATE_BLOCK[state];
  if (b === Block.Repeater) {
    const f = FACING_DIR[propertyOf(state, "facing")];
    return f === side || f === (side ^ 1);
  }
  return b === Block.RedstoneWire || b === Block.RedstoneTorch || b === Block.Lever || b === Block.StoneButton || b === Block.OakButton || b === Block.StonePressurePlate || b === Block.OakPressurePlate;
}

/**
 * The power a block puts out toward direction d (into its neighbor that way), 0-15. `strong` asks only for
 * power that goes through solid blocks: a lever's, button's or plate's into the block it is on, a torch's
 * into the block above, a repeater's into what it faces; dust's power is weak (into the block below and
 * the ones it points at).
 */
export function emitted(w: RedstoneWorld, x: number, y: number, z: number, d: number, strong: boolean): number {
  const s = w.get(x, y, z);
  switch (STATE_BLOCK[s]) {
    case Block.Lever:
    case Block.StoneButton:
    case Block.OakButton:
      if (!isOn(s, "powered")) return 0;
      return !strong || d === attachedDir(s) ? 15 : 0;
    case Block.StonePressurePlate:
    case Block.OakPressurePlate:
      if (!isOn(s, "powered")) return 0;
      return !strong || d === Dir.Down ? 15 : 0;
    case Block.RedstoneTorch:
      if (!isOn(s, "lit") || d === attachedDir(s)) return 0;
      return !strong || d === Dir.Up ? 15 : 0;
    case Block.Repeater:
      return isOn(s, "powered") && d === FACING_DIR[propertyOf(s, "facing")] ? 15 : 0;
    case Block.RedstoneWire: {
      const p = Number(propertyOf(s, "power"));
      if (strong || p === 0 || d === Dir.Up) return 0;
      if (d === Dir.Down) return p;
      // Into the sides it points to (all of them as a cross, connected nowhere)
      const sides = SIDES.filter((_, i) => isOn(s, SIDE_NAMES[i]));
      return sides.length === 0 || sides.includes(d) ? p : 0;
    }
  }
  return 0;
}

/** The power a solid block holds from what is around it: strongly (strong power only) or at all (dust too). */
export function heldPower(w: RedstoneWorld, x: number, y: number, z: number, strong: boolean): number {
  if (!conductor(w.get(x, y, z))) return 0;
  let m = 0;
  for (let d = 0; d < 6; d++) m = Math.max(m, emitted(w, x + DIR_X[d], y + DIR_Y[d], z + DIR_Z[d], d ^ 1, strong));
  return m;
}

/** The power reaching a block from one side (Dir from it): what that neighbor puts out, or the power it holds. */
export function powerFrom(w: RedstoneWorld, x: number, y: number, z: number, d: number): number {
  const nx = x + DIR_X[d];
  const ny = y + DIR_Y[d];
  const nz = z + DIR_Z[d];
  return Math.max(emitted(w, nx, ny, nz, d ^ 1, false), heldPower(w, nx, ny, nz, false));
}

/** The power reaching a block from all sides (lamps, doors). */
export function powerAt(w: RedstoneWorld, x: number, y: number, z: number): number {
  let m = 0;
  for (let d = 0; d < 6; d++) m = Math.max(m, powerFrom(w, x, y, z, d));
  return m;
}

/**
 * Dust's power and connections, as Minecraft's: from the power sources next to it and strongly powered
 * blocks, or one less than the strongest dust it connects to (beside it, a block up when nothing solid is
 * over it, a block down when the side isn't solid).
 */
export function wireState(w: RedstoneWorld, x: number, y: number, z: number, state: number): number {
  let power = 0;
  for (let d = 0; d < 6; d++) {
    const nx = x + DIR_X[d];
    const ny = y + DIR_Y[d];
    const nz = z + DIR_Z[d];
    if (STATE_BLOCK[w.get(nx, ny, nz)] === Block.RedstoneWire) continue;
    power = Math.max(power, emitted(w, nx, ny, nz, d ^ 1, false), heldPower(w, nx, ny, nz, true));
  }
  const covered = conductor(w.get(x, y + 1, z));
  const conns: Record<string, string> = {};
  SIDES.forEach((d, i) => {
    const nx = x + DIR_X[d];
    const nz = z + DIR_Z[d];
    const side = w.get(nx, y, nz);
    const solid = conductor(side);
    const up = !covered && solid ? w.get(nx, y + 1, nz) : 0;
    const down = !solid ? w.get(nx, y - 1, nz) : 0;
    const wireOf = (s: number): number => (STATE_BLOCK[s] === Block.RedstoneWire ? Number(propertyOf(s, "power")) - 1 : -1);
    power = Math.max(power, wireOf(side), wireOf(up), wireOf(down));
    conns[SIDE_NAMES[i]] = String(connectsTo(side, d) || STATE_BLOCK[up] === Block.RedstoneWire || STATE_BLOCK[down] === Block.RedstoneWire);
  });
  // A line, not a stub: dust connected one way runs on through the other side too, and powers what is there
  const ways = SIDE_NAMES.filter((n) => conns[n] === "true");
  if (ways.length === 1) conns[SIDE_NAMES[(SIDE_NAMES.indexOf(ways[0]) + 2) % 4]] = "true";
  return withProperties(state, { power: String(Math.max(0, Math.min(15, power))), ...conns });
}

/** Whether a repeater is locked: a powered repeater beside it faces into its side. */
function locked(w: RedstoneWorld, x: number, y: number, z: number, state: number): boolean {
  const f = FACING_DIR[propertyOf(state, "facing")];
  for (const d of SIDES) {
    if (d === f || d === (f ^ 1)) continue;
    const n = w.get(x + DIR_X[d], y, z + DIR_Z[d]);
    if (STATE_BLOCK[n] === Block.Repeater && isOn(n, "powered") && FACING_DIR[propertyOf(n, "facing")] === (d ^ 1)) return true;
  }
  return false;
}

/** A repeater's input: the power at its back. */
const repeaterInput = (w: RedstoneWorld, x: number, y: number, z: number, state: number): number => powerFrom(w, x, y, z, FACING_DIR[propertyOf(state, "facing")] ^ 1);

/** Whether a torch should be lit: the block it hangs on isn't powered. */
function torchShouldLight(w: RedstoneWorld, x: number, y: number, z: number, state: number): boolean {
  const d = attachedDir(state);
  return heldPower(w, x + DIR_X[d], y + DIR_Y[d], z + DIR_Z[d], false) === 0;
}

/**
 * Redstone's reactions to what changes around it (from BlockUpdates) and its delays (scheduled ticks).
 * `occupied` says whether something stands on a pressure plate.
 */
export class Redstone {
  occupied: (x: number, y: number, z: number, wood: boolean) => boolean = () => false;

  constructor(
    private readonly world: RedstoneWorld,
    private readonly ticks: WorldTicks,
  ) {}

  /** A block reacting to what is around it (BlockUpdates calls this for every update). */
  update(x: number, y: number, z: number, state: number): void {
    const w = this.world;
    const b = STATE_BLOCK[state];
    switch (b) {
      case Block.RedstoneWire: {
        const next = wireState(w, x, y, z, state);
        if (next !== state) w.set(x, y, z, next);
        return;
      }
      case Block.RedstoneTorch:
        if (torchShouldLight(w, x, y, z, state) !== isOn(state, "lit")) this.ticks.schedule(x, y, z, b, TORCH_DELAY);
        return;
      case Block.Repeater: {
        if (locked(w, x, y, z, state)) return;
        if (repeaterInput(w, x, y, z, state) > 0 !== isOn(state, "powered")) this.ticks.schedule(x, y, z, b, Number(propertyOf(state, "delay")) * 2);
        return;
      }
      case Block.RedstoneLamp: {
        const on = powerAt(w, x, y, z) > 0;
        if (on && !isOn(state, "lit")) w.set(x, y, z, withProperties(state, { lit: "true" }));
        else if (!on && isOn(state, "lit")) this.ticks.schedule(x, y, z, b, LAMP_OFF);
        return;
      }
      case Block.StoneButton:
      case Block.OakButton:
        if (isOn(state, "powered")) this.ticks.schedule(x, y, z, b, b === Block.StoneButton ? STONE_BUTTON : OAK_BUTTON);
        return;
      case Block.StonePressurePlate:
      case Block.OakPressurePlate:
        if (isOn(state, "powered")) this.ticks.schedule(x, y, z, b, PLATE_CHECK);
        return;
    }
    if (SHAPE[state] === "door") this.door(x, y, z, state);
    else if (SHAPE[state] === "trapdoor") {
      const on = powerAt(w, x, y, z) > 0;
      if (on !== isOn(state, "powered")) w.set(x, y, z, withProperties(state, { powered: String(on), open: String(on) }));
    }
  }

  /** A door opens while either half is powered, and shuts when neither is (both halves together). */
  private door(x: number, y: number, z: number, state: number): void {
    const w = this.world;
    const lower = propertyOf(state, "half") === "lower" ? y : y - 1;
    const on = powerAt(w, x, lower, z) > 0 || powerAt(w, x, lower + 1, z) > 0;
    if (on === isOn(state, "powered")) return;
    for (const yy of [lower, lower + 1]) {
      const s = w.get(x, yy, z);
      if (SHAPE[s] === "door") w.set(x, yy, z, withProperties(s, { powered: String(on), open: String(on) }));
    }
  }

  /** A delay run out: a torch turns, a repeater passes its input on, a lamp goes out, a button pops up. */
  scheduled(x: number, y: number, z: number, state: number): void {
    const w = this.world;
    switch (STATE_BLOCK[state]) {
      case Block.RedstoneTorch: {
        const lit = torchShouldLight(w, x, y, z, state);
        if (lit !== isOn(state, "lit")) w.set(x, y, z, withProperties(state, { lit: String(lit) }));
        return;
      }
      case Block.Repeater: {
        if (locked(w, x, y, z, state)) return;
        const on = repeaterInput(w, x, y, z, state) > 0;
        if (on !== isOn(state, "powered")) w.set(x, y, z, withProperties(state, { powered: String(on) }));
        return;
      }
      case Block.RedstoneLamp:
        if (isOn(state, "lit") && powerAt(w, x, y, z) === 0) w.set(x, y, z, withProperties(state, { lit: "false" }));
        return;
      case Block.StoneButton:
      case Block.OakButton:
        if (isOn(state, "powered")) w.set(x, y, z, withProperties(state, { powered: "false" }));
        return;
      case Block.StonePressurePlate:
      case Block.OakPressurePlate:
        if (!isOn(state, "powered")) return;
        if (this.occupied(x, y, z, STATE_BLOCK[state] === Block.OakPressurePlate)) this.ticks.schedule(x, y, z, STATE_BLOCK[state], PLATE_CHECK);
        else w.set(x, y, z, withProperties(state, { powered: "false" }));
    }
  }

  /** Something stepped on a pressure plate: it goes down. */
  step(x: number, y: number, z: number): void {
    const s = this.world.get(x, y, z);
    if (SHAPE[s] === "plate" && !isOn(s, "powered")) this.world.set(x, y, z, withProperties(s, { powered: "true" }));
  }

  /** The scheduled-tick behaviors of the blocks with delays, for WorldTicks. */
  behaviors(): Map<number, TickBehavior> {
    const tick: TickBehavior = { scheduled: (_w, x, y, z, state) => this.scheduled(x, y, z, state) };
    return new Map([Block.RedstoneTorch, Block.Repeater, Block.RedstoneLamp, Block.StoneButton, Block.OakButton, Block.StonePressurePlate, Block.OakPressurePlate].map((b) => [b, tick]));
  }
}

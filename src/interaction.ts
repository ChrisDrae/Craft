import { SimObject, type Vec3 } from "projector";
import { REACH, perform, type Action } from "./actions.js";
import { Block, blockOf, isBed } from "./blocks.js";
import { HOTBAR_SLOTS, INVENTORY_SLOTS, Inventory } from "./inventory.js";
import { ITEMS, Items, itemByName, type Food, type Item, type ItemStack } from "./items.js";
import { breakTime } from "./mining.js";
import type { Player } from "./player.js";
import { raycastVoxels, type VoxelHit } from "./raycast.js";
import { SELECTION } from "./shapes.js";
import type { Terrain } from "./terrain.js";
import type { PlayMode } from "./vitals.js";
import type { VoxelWorld } from "./world.js";

/** Seconds between repeated placements while the button is held, and between breaks in creative. */
const REPEAT = 0.25;
/** Seconds of pause after breaking a block in survival before the next one starts, as Minecraft's. */
const BREAK_PAUSE = 0.25;
/** Seconds of holding the right button it takes to eat. */
export const EAT_TIME = 1.6;
/** How far mobs can be hit, in survival and creative. */
const ATTACK_REACH = 3;
const CREATIVE_ATTACK_REACH = 5;
/** Knockback of a hit (blocks a second), and more for one struck while sprinting. */
const KNOCKBACK = 8;
const SPRINT_KNOCKBACK = 8;

/** How far a bow is drawn (0-1) after `seconds` of holding it, as Minecraft's. */
export function bowPower(seconds: number): number {
  const t = seconds;
  return Math.min(1, (t * t + 2 * t) / 3);
}

/** What the crosshair can hit in a block: fluids have no boxes, so the ray goes through them. */
const selectionOf = (state: number): Float64Array => SELECTION[state];

/** Blocks that do something for the player when used: a crafting table, chest or furnace opens, a bed is slept in. */
const OPENS = (block: number): boolean => block === Block.CraftingTable || block === Block.Chest || block === Block.Furnace || isBed(block);

/**
 * Breaking, placing and using blocks: finds the block under the crosshair every frame (outlined by the
 * terrain). The left button breaks it: at once in creative, in survival after as long as the block and the
 * held tool take (the progress shows as cracks), wearing the tool. The right one opens a crafting table,
 * chest or furnace (or lies down in a bed), opens or shuts a door or trapdoor, places the held block (in
 * survival using one up), repeating while the button is held, or eats the held food when the player is
 * hungry (held for EAT_TIME). The middle button picks the block aimed at: any block in creative, from the
 * inventory in survival. A spectator does none of it. What breaking or placing does to the blocks around
 * (torches coming off, water flowing in, fences connecting) is up to the block updates.
 */
export class BlockInteraction extends SimObject {
  target: VoxelHit | null = null;
  /** Where the crosshair meets the target, or null (then its middle counts). */
  hit: Vec3 | null = null;
  readonly inventory: Inventory;
  mode: PlayMode = "creative";
  /** Whether the player could eat now (hungry). */
  canEat: () => boolean = () => false;
  /** Called when the player has eaten something. */
  onEat: ((food: Food) => void) | null = null;
  /** How far eating has come (0-1), or null when not eating. */
  get eating(): number | null {
    return this.held === "eat" ? Math.min(1, this.eatTime / EAT_TIME) : null;
  }
  /** How far the bow is drawn (0-1), or null. */
  get drawing(): number | null {
    return this.held === "draw" ? bowPower(this.eatTime) : null;
  }
  /** The nearest mob along the crosshair within a reach: its id and distance, or null (the world gives it). */
  mobAt: (x: number, y: number, z: number, dx: number, dy: number, dz: number, reach: number) => { id: number; distance: number } | null = () => null;
  /** The mob under the crosshair (nearer than any block), or null. */
  targetMob: { id: number; distance: number } | null = null;
  /** Called when the player hits a mob: the damage, whether it was critical, the knockback. */
  onAttack: ((id: number, damage: number, crit: boolean, knockback: number) => void) | null = null;
  /** Called when the player uses what they hold on a mob (shears on a sheep); returns whether it did anything. */
  onUseMob: ((id: number, held: ItemStack | null) => boolean) | null = null;
  /** Called when the player looses an arrow, with how far the bow was drawn (0-1). */
  onShoot: ((power: number) => void) | null = null;
  /** Seconds since the last swing, for the strength of the next hit. */
  private sinceSwing: number = 10;
  /** Called with the selected slot when the selection or the hotbar's items change. */
  onSelect: ((slot: number) => void) | null = null;
  /** Called with every action that changed something, and what was held (a guest sends them to the host). */
  onAction: ((a: Action, held: ItemStack | null) => void) | null = null;
  /** Called with a block this player broke, as it was, and what they held: for its drops. */
  onBroken: ((x: number, y: number, z: number, state: number, held: ItemStack | null) => void) | null = null;
  /** Called when the player uses a crafting table, chest or furnace. */
  onOpen: ((x: number, y: number, z: number, state: number) => void) | null = null;
  /** The feet of the other players, whom blocks aren't placed into. */
  others: () => readonly Vec3[] = () => [];
  /** How far breaking the target has come (0-1), for the cracks; null when nothing is being broken. */
  progress: number | null = null;
  private readonly world: VoxelWorld;
  private readonly player: Player;
  private readonly terrain: Terrain;
  private readonly dir: Vec3 = { x: 0, y: 0, z: 1 };
  private readonly blockAt: (x: number, y: number, z: number) => number;
  private held: "break" | "place" | "eat" | "draw" | null = null;
  private timer: number = 0;
  private eatTime: number = 0;
  /** The block being broken (survival) and seconds spent on it. */
  private breaking: { x: number; y: number; z: number; state: number } | null = null;
  private elapsed: number = 0;

  constructor(world: VoxelWorld, player: Player, terrain: Terrain, inventory: Inventory = new Inventory()) {
    super();
    this.world = world;
    this.player = player;
    this.terrain = terrain;
    this.inventory = inventory;
    this.blockAt = (x, y, z) => world.get(x, y, z);
  }

  get selected(): number {
    return this.inventory.selected;
  }

  /** The block the held item places, or air. */
  get selectedBlock(): Block {
    const held = this.inventory.held;
    return held ? (ITEMS[held.item].block ?? Block.Air) : Block.Air;
  }

  select(slot: number): void {
    this.inventory.select(slot);
    this.onSelect?.(this.inventory.selected);
  }

  /**
   * Puts an item into the hotbar: selects a hotbar slot that has it; in creative otherwise puts it into the
   * selected slot; in survival brings it from the rest of the inventory, if it is there.
   */
  choose(item: Item): void {
    const slots = this.inventory.slots;
    const inHotbar = slots.findIndex((s, i) => i < HOTBAR_SLOTS && s?.item === item);
    if (inHotbar >= 0) {
      this.select(inHotbar);
      return;
    }
    if (this.mode === "creative") {
      this.inventory.put(this.selected, { item, count: ITEMS[item].maxStack, damage: 0 });
    } else {
      const from = slots.findIndex((s, i) => i >= HOTBAR_SLOTS && i < INVENTORY_SLOTS && s?.item === item);
      if (from < 0) return;
      const swap = slots[this.selected];
      this.inventory.put(this.selected, slots[from]);
      this.inventory.put(from, swap);
    }
    this.onSelect?.(this.selected);
  }

  /**
   * How strong a hit would be now (0-1): back to full as long after the last swing as the held item takes
   * to swing (a sword 0.625 seconds, a hand 0.25), as Minecraft's attack cooldown.
   */
  get attackStrength(): number {
    const held = this.inventory.held;
    const speed = held ? ITEMS[held.item].attackSpeed : 4;
    return Math.min(1, (this.sinceSwing + 0.025) * speed);
  }

  /**
   * Hits the mob under the crosshair, as Minecraft's: the held item's damage (a hand's 1) by how far it has
   * recovered from the last swing, half again when falling onto it (critical), knocked back more when
   * sprinting. Weapons wear a use a hit, other tools two.
   */
  private attackTarget(): void {
    const t = this.targetMob;
    if (!t) return;
    const held = this.inventory.held;
    const info = held ? ITEMS[held.item] : null;
    const strength = this.attackStrength;
    let damage = (info?.attack ?? 1) * (0.2 + strength * strength * 0.8);
    const p = this.player;
    const crit = strength > 0.9 && p.velocity.y < 0 && !p.onGround && !p.inWater && !p.onLadder && !p.flying;
    if (crit) damage *= 1.5;
    const knockback = KNOCKBACK + (p.sprinting && strength > 0.9 ? SPRINT_KNOCKBACK : 0);
    this.sinceSwing = 0;
    this.onAttack?.(t.id, damage, crit, knockback);
    if (this.mode === "survival" && info?.tool) this.inventory.wearHeld(info.tool.kind === "sword" ? 1 : 2);
  }

  /** Whether the player has arrows to shoot (any in creative). */
  private hasArrows(): boolean {
    return this.mode === "creative" || this.inventory.slots.some((s) => s?.item === Items.Arrow);
  }

  /** Looses an arrow from the drawn bow, if drawn far enough: one arrow used up and the bow worn in survival. */
  private loose(): void {
    const power = bowPower(this.eatTime);
    this.held = null;
    if (power < 0.1 || !this.hasArrows()) return;
    if (this.mode === "survival") {
      const i = this.inventory.slots.findIndex((s) => s?.item === Items.Arrow);
      const s = this.inventory.slots[i]!;
      this.inventory.put(i, s.count > 1 ? { ...s, count: s.count - 1 } : null);
      this.inventory.wearHeld(1);
    }
    this.onShoot?.(power);
  }

  /** A mouse button went down: 0 breaks (or hits), 1 picks the block aimed at, 2 uses, places, eats or draws. */
  press(button: number): void {
    if (this.mode === "spectator") return;
    if (button === 0 && this.targetMob) {
      this.attackTarget();
      return;
    }
    if (button === 2 && this.targetMob && this.onUseMob?.(this.targetMob.id, this.inventory.held)) {
      if (this.mode === "survival") this.inventory.wearHeld(1);
      return;
    }
    if (button === 0 && !this.target) this.sinceSwing = 0;
    if (button === 1) {
      if (this.target) this.choose(blockOf(this.target.block));
      return;
    }
    const action = button === 0 ? "break" : button === 2 ? "place" : null;
    if (!action) return;
    this.held = action;
    this.timer = REPEAT;
    if (action === "place" || this.mode === "creative") this.act(action);
    else this.timer = 0;
  }

  release(button: number): void {
    if (button === 2 && this.held === "draw") this.loose();
    if ((button === 0 && this.held === "break") || (button === 2 && (this.held === "place" || this.held === "eat"))) this.held = null;
    if (button === 0) this.stopBreaking();
  }

  /** Starts drawing the held bow, if there are arrows. */
  private startDrawing(): boolean {
    const held = this.inventory.held;
    if (!held || held.item !== Items.Bow || !this.hasArrows()) return false;
    this.held = "draw";
    this.eatTime = 0;
    return true;
  }

  /** Starts eating the held food, if it is food and the player is hungry. */
  private startEating(): boolean {
    const held = this.inventory.held;
    if (!held || !ITEMS[held.item].food || !this.canEat()) return false;
    this.held = "eat";
    this.eatTime = 0;
    return true;
  }

  /** Eats the held food: the player is fed, one is used up (in survival), a stew leaves its bowl. */
  private finishEating(): void {
    const held = this.inventory.held;
    const food = held ? ITEMS[held.item].food : null;
    if (!held || !food) return;
    if (this.mode === "survival") {
      this.inventory.useHeld(1);
      const left = food.leaves ? itemByName(food.leaves) : null;
      if (left !== null) {
        const bowl = { item: left, count: 1, damage: 0 };
        if (!this.inventory.held) this.inventory.put(this.selected, bowl);
        else this.inventory.add(bowl);
      }
    }
    this.onEat?.(food);
  }

  /** The action on the target with the held block, from where the player looks. */
  private action(act: Action["act"]): Action | null {
    const t = this.target;
    if (!t) return null;
    const hy = this.hit ? this.hit.y - t.y : 0.5;
    return { act, x: t.x, y: t.y, z: t.z, nx: t.nx, ny: t.ny, nz: t.nz, hy, block: this.selectedBlock, yaw: this.player.yaw };
  }

  /** Does an action (see actions.ts), and tells onAction if it did anything. */
  private apply(a: Action | null): boolean {
    const held = this.inventory.held;
    if (!a || !perform(this.world, a, [this.player.position, ...this.others()])) return false;
    this.onAction?.(a, held);
    return true;
  }

  /** Breaks the target block, wearing the tool in survival; onBroken gets what it was. */
  breakTarget(): boolean {
    const t = this.target;
    if (!t) return false;
    const state = this.world.get(t.x, t.y, t.z);
    const held = this.inventory.held;
    if (!this.apply(this.action("break"))) return false;
    if (this.mode === "survival" && breakTime(blockOf(state), held) > 0) this.inventory.wearHeld(held && ITEMS[held.item].tool?.kind === "sword" ? 2 : 1);
    this.onBroken?.(t.x, t.y, t.z, state, held);
    return true;
  }

  /** Opens or shuts the target if it's a door (both halves) or a trapdoor. Returns whether it was one. */
  useTarget(): boolean {
    return this.apply(this.action("use"));
  }

  /**
   * Places the held block against the face of the target, or adds it to the target (see placeBlock): not
   * where it has nothing to hold it up, the place is taken, or a player stands there. In survival it uses
   * one up.
   */
  placeAtTarget(): boolean {
    if (this.selectedBlock === Block.Air) return false;
    if (!this.apply(this.action("place"))) return false;
    if (this.mode === "survival") this.inventory.useHeld(1);
    return true;
  }

  /** Takes the held stack (one of it, or all) out of the hotbar, to throw. */
  throwHeld(all: boolean): ItemStack | null {
    const held = this.inventory.held;
    if (!held) return null;
    const n = all ? held.count : 1;
    this.inventory.useHeld(n);
    return { ...held, count: n };
  }

  override update(dt: number): void {
    this.sinceSwing += dt;
    if (this.held === "draw") {
      if (this.inventory.held?.item !== Items.Bow) this.held = null;
      else this.eatTime += dt;
      return;
    }
    if (this.held === "eat") {
      const held = this.inventory.held;
      if (!held || !ITEMS[held.item].food || !this.canEat()) {
        this.held = null;
        return;
      }
      this.eatTime += dt;
      if (this.eatTime >= EAT_TIME) {
        this.finishEating();
        // Still holding the button: on to the next one, if still hungry
        this.eatTime = 0;
      }
      return;
    }
    if (this.held === "break" && this.mode === "survival") {
      this.breakSurvival(dt);
      return;
    }
    if (!this.held) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer += REPEAT;
    this.act(this.held);
  }

  /** Survival breaking: time spent on the same block adds up until it breaks; another block starts over. */
  private breakSurvival(dt: number): void {
    if (this.timer > 0) {
      this.timer -= dt;
      return;
    }
    const t = this.target;
    if (!t) {
      this.stopBreaking();
      return;
    }
    const b = this.breaking;
    if (!b || b.x !== t.x || b.y !== t.y || b.z !== t.z || b.state !== t.block) {
      this.breaking = { x: t.x, y: t.y, z: t.z, state: t.block };
      this.elapsed = 0;
    }
    const time = breakTime(blockOf(t.block), this.inventory.held);
    if (time === Infinity) {
      this.progress = null;
      return;
    }
    this.elapsed += dt;
    this.progress = time > 0 ? Math.min(1, this.elapsed / time) : 1;
    if (this.elapsed >= time) {
      this.breakTarget();
      this.stopBreaking();
      this.timer = BREAK_PAUSE;
      this.sync();
    }
  }

  private stopBreaking(): void {
    this.breaking = null;
    this.elapsed = 0;
    this.progress = null;
  }

  /** After the player moved the camera: what the crosshair points at now (nothing for a spectator). */
  override sync(): void {
    const camera = this.sim?.camera;
    if (!camera) return;
    if (this.mode === "spectator" || this.player.asleep) {
      this.target = this.hit = this.terrain.target = null;
      this.targetMob = null;
      return;
    }
    const d = camera.getForward(this.dir);
    const e = camera.position;
    this.target = raycastVoxels(this.blockAt, selectionOf, e.x, e.y, e.z, d.x, d.y, d.z, REACH);
    // A mob nearer than the block is what the crosshair is on
    const reach = this.mode === "creative" ? CREATIVE_ATTACK_REACH : ATTACK_REACH;
    const mob = this.mobAt(e.x, e.y, e.z, d.x, d.y, d.z, Math.min(reach, this.target?.distance ?? reach));
    this.targetMob = mob;
    if (mob) this.target = null;
    const t = this.target;
    this.hit = t ? { x: e.x + d.x * t.distance, y: e.y + d.y * t.distance, z: e.z + d.z * t.distance } : null;
    this.terrain.target = t;
  }

  private act(action: "break" | "place"): void {
    if (action === "break") {
      this.breakTarget();
    } else {
      const t = this.target;
      if (t && OPENS(blockOf(t.block)) && this.onOpen) {
        // Not again while the button is held
        this.held = null;
        this.onOpen(t.x, t.y, t.z, t.block);
        return;
      }
      if (!this.useTarget() && !this.startDrawing() && !this.startEating()) this.placeAtTarget();
      if (this.held === "eat" || this.held === "draw") return;
    }
    // Aim again right away, so a held button acts on what is there now
    this.sync();
  }
}

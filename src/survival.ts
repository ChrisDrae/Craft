import { Block, FLUID, OPAQUE, STATE_BLOCK, isBed } from "./blocks.js";
import { ARMOR_SLOTS, type Inventory } from "./inventory.js";
import { ITEMS } from "./items.js";
import { EYE_HEIGHT, type Player } from "./player.js";
import { SPRINT_FOOD, VOID_DEPTH, Vitals, type Armor, type DamageSource, type Difficulty, type PlayMode, type Rules, type Surroundings } from "./vitals.js";
import type { VoxelWorld } from "./world.js";

/** Exhaustion per block sprinted and swum, per jump and per sprinting jump, and per block broken (Minecraft's). */
const SPRINTING = 0.1;
const SWIMMING = 0.01;
const JUMPING = 0.05;
const SPRINT_JUMPING = 0.2;
export const BREAKING = 0.005;
/** A cactus's sides, a pixel in from its cell: touching them hurts. */
const CACTUS_INSET = 1 / 16;

/**
 * The player's survival, game tick by game tick: what they are in and against (lava, water, a block at the
 * eyes, a cactus, the void) and how they moved go into their vitals; falls hurt when they land (half as
 * much on a bed); the armor they wear lessens the hurts it can and wears; hunger stops sprinting.
 */
export class Survival {
  readonly vitals: Vitals = new Vitals();
  mode: PlayMode = "survival";
  difficulty: Difficulty = "normal";
  /** Whether it rains on the player where they are (it puts fire out). */
  rainedOn: () => boolean = () => false;
  /** Called once when the player dies (vitals.cause says how). */
  onDeath: (() => void) | null = null;
  private died: boolean = false;

  constructor(
    private readonly world: VoxelWorld,
    private readonly player: Player,
    private readonly inventory: Inventory,
  ) {
    player.onLand = (distance, below) => this.land(distance, below);
  }

  get rules(): Rules {
    return { mode: this.mode, difficulty: this.difficulty };
  }

  /** The armor worn: its points and toughness, wearing every piece when it takes a hit. */
  armor(): Armor {
    let defense = 0;
    let toughness = 0;
    for (const i of ARMOR_SLOTS) {
      const s = this.inventory.slots[i];
      if (!s) continue;
      defense += ITEMS[s.item].defense;
      toughness += ITEMS[s.item].toughness;
    }
    return { defense, toughness, wear: (uses) => ARMOR_SLOTS.forEach((i) => this.inventory.wear(i, uses)) };
  }

  /** What the player is in and against now. */
  surroundings(): Surroundings {
    const p = this.player.position;
    const w = this.player.halfWidth;
    const out = { inLava: false, inWater: false, eyesInWater: false, inWall: false, onCactus: false, inVoid: p.y < VOID_DEPTH };
    if (this.player.noClip) return out;
    // Cells the player's box overlaps (a hair wider, for the cactus they press against)
    const pad = 0.01;
    for (let y = Math.floor(p.y); y <= Math.floor(p.y + this.player.height); y++) {
      for (let z = Math.floor(p.z - w - pad); z <= Math.floor(p.z + w + pad); z++) {
        for (let x = Math.floor(p.x - w - pad); x <= Math.floor(p.x + w + pad); x++) {
          const state = this.world.get(x, y, z);
          const fluid = FLUID[state];
          const inCell = p.x + w > x && p.x - w < x + 1 && p.z + w > z && p.z - w < z + 1;
          if (fluid === 2 && inCell) out.inLava = true;
          if (fluid === 1 && inCell) out.inWater = true;
          if (STATE_BLOCK[state] === Block.Cactus) {
            const i = CACTUS_INSET - pad;
            if (p.x + w > x + i && p.x - w < x + 1 - i && p.z + w > z + i && p.z - w < z + 1 - i) out.onCactus = true;
          }
        }
      }
    }
    if (this.rainedOn()) out.inWater = true;
    const eyes = this.world.get(Math.floor(p.x), Math.floor(p.y + EYE_HEIGHT), Math.floor(p.z));
    out.eyesInWater = FLUID[eyes] === 1;
    out.inWall = OPAQUE[eyes] === 1;
    return out;
  }

  /** One game tick. */
  tick(): void {
    const v = this.vitals;
    if (v.dead) return;
    const e = this.player.takeExertion();
    if (this.mode === "survival") v.exert(e.sprinted * SPRINTING + e.swum * SWIMMING + e.jumps * JUMPING + e.sprintJumps * SPRINT_JUMPING);
    v.tick(this.surroundings(), this.rules, this.armor());
    this.player.maySprint = this.mode !== "survival" || v.food > SPRINT_FOOD;
    this.checkDeath();
  }

  /** A hurt from outside (a mob, an arrow, an explosion): armor lessens it. Returns whether it landed. */
  hurt(amount: number, source: DamageSource, by: string | null): boolean {
    const landed = this.vitals.damage(amount, source, this.rules, this.armor(), by);
    this.checkDeath();
    return landed;
  }

  /** Landing after a fall: a point of damage for every block beyond three, half on a bed. */
  land(distance: number, below: number): void {
    const damage = Math.ceil((distance - 3) * (isBed(STATE_BLOCK[below]) ? 0.5 : 1));
    if (damage > 0) this.vitals.damage(damage, "fall", this.rules);
    this.checkDeath();
  }

  /** Back to life (respawned): full vitals. */
  revive(): void {
    this.vitals.reset();
    this.died = false;
  }

  private checkDeath(): void {
    if (!this.vitals.dead || this.died) return;
    this.died = true;
    this.onDeath?.();
  }
}

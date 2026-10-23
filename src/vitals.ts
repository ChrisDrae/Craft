import type { Food } from "./items.js";

/**
 * Staying alive, as Minecraft has it: health, hunger, air, burning and experience, with the rules that
 * change them every game tick. Kept apart from the player and the page, so the same rules run for the
 * player here and can be stepped in tests.
 */

/** How hard the world is: hunger and starving (and, with monsters, the damage they do). */
export type Difficulty = "peaceful" | "easy" | "normal" | "hard";
export const DIFFICULTIES: readonly Difficulty[] = ["peaceful", "easy", "normal", "hard"];

/** How a player plays now: the world's mode, or looking on after dying in hardcore. */
export type PlayMode = "survival" | "creative" | "spectator";

/** What hurts. */
export type DamageSource = "fall" | "drown" | "lava" | "fire" | "wall" | "void" | "starve" | "cactus";

export const MAX_HEALTH = 20;
export const MAX_FOOD = 20;
/** Ticks of air: 15 seconds under water before drowning starts. */
export const MAX_AIR = 300;
/** Ticks a player burns after leaving lava. */
const BURN_TIME = 300;
/** Food at or below which a player can't sprint. */
export const SPRINT_FOOD = 6;
/** Below this the world ends. */
export const VOID_DEPTH = -64;

/** How a player died, as everyone is told: "Alex drowned". */
export const DEATH_MESSAGES: Readonly<Record<DamageSource, string>> = {
  fall: "fell from a high place",
  drown: "drowned",
  lava: "tried to swim in lava",
  fire: "burned to death",
  wall: "suffocated in a wall",
  void: "fell out of the world",
  starve: "starved to death",
  cactus: "was pricked to death",
};

/** Hurts that armor lessens: not falling, drowning, burning, starving, suffocating or the void. */
const ARMORED: ReadonlySet<DamageSource> = new Set(["lava", "cactus"]);
/** Hurts that also make the player hungrier. */
const EXHAUSTING: ReadonlySet<DamageSource> = new Set(["lava", "cactus"]);

/** The armor a player wears: its points and toughness, and what wears it down. */
export interface Armor {
  defense: number;
  toughness: number;
  /** Takes uses off every piece worn. */
  wear(uses: number): void;
}

/** Minecraft's armor formula: each point takes 4% off, less against heavy hits unless the armor is tough. */
export function armorReduce(amount: number, defense: number, toughness: number): number {
  const f = Math.min(20, Math.max(defense / 5, defense - (4 * amount) / (toughness + 8)));
  return amount * (1 - f / 25);
}

/** What the player is in and around this tick, for the hurts. */
export interface Surroundings {
  /** In lava anywhere: it burns. */
  inLava: boolean;
  /** In water anywhere: it puts fire out. */
  inWater: boolean;
  eyesInWater: boolean;
  /** Eyes inside a solid block. */
  inWall: boolean;
  /** Touching a cactus. */
  onCactus: boolean;
  /** Below the bottom of the world. */
  inVoid: boolean;
}

export const NOWHERE: Surroundings = { inLava: false, inWater: false, eyesInWater: false, inWall: false, onCactus: false, inVoid: false };

/** What decides how the rules apply. */
export interface Rules {
  mode: PlayMode;
  difficulty: Difficulty;
}

/** Points of experience needed to reach a level from nothing. */
export function xpForLevel(level: number): number {
  if (level <= 16) return level * level + 6 * level;
  if (level <= 31) return 2.5 * level * level - 40.5 * level + 360;
  return 4.5 * level * level - 162.5 * level + 2220;
}

/** The level points of experience make, and how far into the next one (0-1). */
export function levelOf(xp: number): { level: number; progress: number } {
  let level = 0;
  while (xpForLevel(level + 1) <= xp) level++;
  const from = xpForLevel(level);
  return { level, progress: (xp - from) / (xpForLevel(level + 1) - from) };
}

/** The experience a player leaves where they die: 7 points a level, 100 at most. */
export function deathXp(xp: number): number {
  return Math.min(100, 7 * levelOf(xp).level);
}

/** A player's vitals as saves and messages keep them. */
export interface SavedVitals {
  health: number;
  food: number;
  saturation: number;
  exhaustion: number;
  air: number;
  fire: number;
  xp: number;
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/**
 * A player's vitals and the rules that change them, tick by tick:
 * - health, 20 points (10 hearts), taken by hurts and given back by a full stomach;
 * - hurts: falling (by the fall's height), drowning (2 a second once the air is out), lava (4, and it sets
 *   the player burning for 15 seconds), burning (1 a second), suffocating, cactus and the void; for half a
 *   second after a hit only a harder hit lands, and only by how much harder it is;
 * - hunger: activity adds exhaustion, which uses up saturation, then food; 18 or more food heals a point
 *   every 4 seconds (quicker with saturation to spare at 20), none starves (easy leaves 10 health, normal
 *   1, hard none); peaceful heals and feeds by itself;
 * - creative and spectators take no harm but the void's (spectators none), and don't get hungry.
 */
export class Vitals {
  health: number = MAX_HEALTH;
  food: number = MAX_FOOD;
  saturation: number = 5;
  exhaustion: number = 0;
  air: number = MAX_AIR;
  /** Ticks of burning left. */
  fire: number = 0;
  /** Experience gathered since the last death. */
  xp: number = 0;
  /** Ticks since the last hit landed, counting down from 20 (hits land again below 10); and that hit's damage. */
  hurt: number = 0;
  lastHurt: number = 0;
  /** What killed the player, once health is gone. */
  cause: DamageSource | null = null;
  /** Called with every hit that landed. */
  onHurt: ((amount: number, source: DamageSource) => void) | null = null;
  private foodTimer: number = 0;
  private age: number = 0;

  get dead(): boolean {
    return this.health <= 0;
  }

  /**
   * Takes damage from a source by the rules (see the class), armor lessening what it can. Returns whether
   * the hit landed.
   */
  damage(amount: number, source: DamageSource, rules: Rules, armor: Armor | null = null): boolean {
    if (this.dead || amount <= 0) return false;
    if (rules.mode === "spectator" || (rules.mode === "creative" && source !== "void")) return false;
    let dealt = amount;
    if (this.hurt > 10) {
      if (amount <= this.lastHurt) return false;
      dealt = amount - this.lastHurt;
      this.lastHurt = amount;
    } else {
      this.lastHurt = amount;
      this.hurt = 20;
    }
    if (armor && ARMORED.has(source) && armor.defense > 0) {
      armor.wear(Math.max(1, Math.floor(dealt / 4)));
      dealt = armorReduce(dealt, armor.defense, armor.toughness);
    }
    if (EXHAUSTING.has(source)) this.exert(0.1);
    this.health = Math.max(0, this.health - dealt);
    if (this.health <= 0) this.cause = source;
    this.onHurt?.(dealt, source);
    return true;
  }

  heal(amount: number): void {
    if (!this.dead) this.health = Math.min(MAX_HEALTH, this.health + amount);
  }

  /** Activity that makes the player hungrier (4 exhaustion is a point of saturation or food). */
  exert(exhaustion: number): void {
    this.exhaustion = Math.min(40, this.exhaustion + exhaustion);
  }

  /** Whether the player could eat now. */
  get hungry(): boolean {
    return this.food < MAX_FOOD;
  }

  eat(food: Food): void {
    this.food = Math.min(MAX_FOOD, this.food + food.hunger);
    this.saturation = Math.min(this.food, this.saturation + food.saturation);
  }

  /** One game tick of the rules, with what is around the player. */
  tick(around: Surroundings, rules: Rules, armor: Armor | null = null): void {
    if (this.dead) return;
    this.age++;
    if (this.hurt > 0) this.hurt--;
    const survival = rules.mode === "survival";
    // Air runs out with the eyes under water, and comes back quickly above it
    if (around.eyesInWater && survival) {
      if (--this.air <= -20) {
        this.air = 0;
        this.damage(2, "drown", rules);
      }
    } else {
      this.air = Math.min(MAX_AIR, this.air + 4);
    }
    // Lava burns, and sets the player burning; water puts it out
    if (around.inLava) {
      this.damage(4, "lava", rules, armor);
      if (survival) this.fire = Math.max(this.fire, BURN_TIME);
    }
    if (around.inWater || !survival) {
      this.fire = 0;
    } else if (this.fire > 0) {
      if (this.fire % 20 === 0) this.damage(1, "fire", rules);
      this.fire--;
    }
    if (around.inWall) this.damage(1, "wall", rules);
    if (around.onCactus) this.damage(1, "cactus", rules, armor);
    if (around.inVoid) this.damage(4, "void", rules);
    if (survival) this.hunger(rules.difficulty, rules);
  }

  private hunger(difficulty: Difficulty, rules: Rules): void {
    const peaceful = difficulty === "peaceful";
    if (this.exhaustion > 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else if (!peaceful) this.food = Math.max(0, this.food - 1);
    }
    if (peaceful) {
      if (this.age % 20 === 0) this.heal(1);
      if (this.age % 10 === 0 && this.food < MAX_FOOD) this.food++;
    }
    const hurt = this.health < MAX_HEALTH;
    if (hurt && this.saturation > 0 && this.food >= MAX_FOOD) {
      // Quick healing on a full stomach, using saturation
      if (++this.foodTimer >= 10) {
        const s = Math.min(this.saturation, 6);
        this.heal(s / 6);
        this.exert(s);
        this.foodTimer = 0;
      }
    } else if (hurt && this.food >= 18) {
      if (++this.foodTimer >= 80) {
        this.heal(1);
        this.exert(6);
        this.foodTimer = 0;
      }
    } else if (this.food <= 0) {
      if (++this.foodTimer >= 80) {
        const floor = difficulty === "hard" ? 0 : difficulty === "normal" ? 1 : 10;
        if (this.health > floor) this.damage(1, "starve", rules);
        this.foodTimer = 0;
      }
    } else {
      this.foodTimer = 0;
    }
  }

  /** Back to life, as after respawning: full health and food, no experience. */
  reset(): void {
    Object.assign(this, { health: MAX_HEALTH, food: MAX_FOOD, saturation: 5, exhaustion: 0, air: MAX_AIR, fire: 0, xp: 0, hurt: 0, lastHurt: 0, cause: null, foodTimer: 0 });
  }

  save(): SavedVitals {
    const { health, food, saturation, exhaustion, air, fire, xp } = this;
    return { health, food, saturation, exhaustion, air, fire, xp };
  }

  /** Saved vitals back, nonsense replaced by the fresh values. */
  load(s: Partial<SavedVitals> | null | undefined): void {
    this.reset();
    if (!s) return;
    this.health = clamp(s.health, 0, MAX_HEALTH, MAX_HEALTH);
    this.food = Math.round(clamp(s.food, 0, MAX_FOOD, MAX_FOOD));
    this.saturation = clamp(s.saturation, 0, this.food, 5);
    this.exhaustion = clamp(s.exhaustion, 0, 40, 0);
    this.air = Math.round(clamp(s.air, -20, MAX_AIR, MAX_AIR));
    this.fire = Math.round(clamp(s.fire, 0, 32767, 0));
    this.xp = Math.round(clamp(s.xp, 0, 2 ** 31 - 1, 0));
  }
}

/** Fresh vitals as saved: what players from before vitals start with. */
export const FRESH_VITALS: SavedVitals = new Vitals().save();

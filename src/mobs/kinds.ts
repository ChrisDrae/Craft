import type { ModelName } from "./models.js";

/** The kinds of mobs. */
export type MobKind = "zombie" | "skeleton" | "creeper" | "spider" | "pig" | "cow" | "sheep" | "chicken" | "slime";

export interface MobInfo {
  kind: MobKind;
  /** As players are told: "Alex was slain by Zombie". */
  label: string;
  /** Its box: width (and depth) and height, in blocks. */
  width: number;
  height: number;
  eyeHeight: number;
  health: number;
  /** Blocks a second walking (chasing and fleeing go faster). */
  speed: number;
  hostile: boolean;
  /** Damage of its hit on normal difficulty (melee mobs). */
  attack: number;
  /** Catches fire in daylight. */
  burns: boolean;
  model: ModelName;
  /** Items it drops: name, fewest, most. */
  drops: ReadonlyArray<readonly [string, number, number]>;
  /** Experience it leaves: fewest, most. */
  xp: readonly [number, number];
  /** What it follows when a player holds it. */
  tempt: readonly string[];
}

const ANIMAL_XP = [1, 3] as const;
const MONSTER_XP = [5, 5] as const;

/** Every kind, with Minecraft's numbers. */
export const MOBS: Readonly<Record<MobKind, MobInfo>> = {
  // A slime's box, health, attack and experience are for its smallest size; they grow with it (see Mob.size)
  zombie: { kind: "zombie", label: "Zombie", width: 0.6, height: 1.95, eyeHeight: 1.74, health: 20, speed: 2.3, hostile: true, attack: 3, burns: true, model: "zombie", drops: [["rotten_flesh", 0, 2]], xp: MONSTER_XP, tempt: [] },
  skeleton: { kind: "skeleton", label: "Skeleton", width: 0.6, height: 1.99, eyeHeight: 1.74, health: 20, speed: 2.5, hostile: true, attack: 2, burns: true, model: "skeleton", drops: [["bone", 0, 2], ["arrow", 0, 2]], xp: MONSTER_XP, tempt: [] },
  creeper: { kind: "creeper", label: "Creeper", width: 0.6, height: 1.7, eyeHeight: 1.5, health: 20, speed: 2.5, hostile: true, attack: 0, burns: false, model: "creeper", drops: [["gunpowder", 0, 2]], xp: MONSTER_XP, tempt: [] },
  spider: { kind: "spider", label: "Spider", width: 1.4, height: 0.9, eyeHeight: 0.65, health: 16, speed: 3, hostile: true, attack: 2, burns: false, model: "spider", drops: [["string", 0, 2], ["spider_eye", 0, 1]], xp: MONSTER_XP, tempt: [] },
  pig: { kind: "pig", label: "Pig", width: 0.9, height: 0.9, eyeHeight: 0.8, health: 10, speed: 1.6, hostile: false, attack: 0, burns: false, model: "pig", drops: [["porkchop", 1, 3]], xp: ANIMAL_XP, tempt: ["carrot", "potato"] },
  cow: { kind: "cow", label: "Cow", width: 0.9, height: 1.4, eyeHeight: 1.3, health: 10, speed: 1.4, hostile: false, attack: 0, burns: false, model: "cow", drops: [["beef", 1, 3], ["leather", 0, 2]], xp: ANIMAL_XP, tempt: ["wheat"] },
  sheep: { kind: "sheep", label: "Sheep", width: 0.9, height: 1.3, eyeHeight: 1.2, health: 8, speed: 1.4, hostile: false, attack: 0, burns: false, model: "sheep", drops: [["mutton", 1, 2]], xp: ANIMAL_XP, tempt: ["wheat"] },
  chicken: { kind: "chicken", label: "Chicken", width: 0.4, height: 0.7, eyeHeight: 0.64, health: 4, speed: 1.4, hostile: false, attack: 0, burns: false, model: "chicken", drops: [["chicken", 1, 1], ["feather", 0, 2]], xp: ANIMAL_XP, tempt: ["wheat_seeds", "pumpkin_seeds", "melon_seeds"] },
  slime: { kind: "slime", label: "Slime", width: 0.52, height: 0.52, eyeHeight: 0.325, health: 1, speed: 2, hostile: true, attack: 1, burns: false, model: "slime", drops: [], xp: [1, 1], tempt: [] },
};

export const MOB_KINDS = Object.keys(MOBS) as MobKind[];

/** The sizes slimes come in: big ones split into two to four of the next smaller when they die. */
export const SLIME_SIZES = [1, 2, 4] as const;

/** A sheep's wool color by chance, as Minecraft's: mostly white, some grays, black and brown, rarely pink (COLORS index). */
export function sheepColor(r: number): number {
  if (r < 0.05) return 15;
  if (r < 0.1) return 7;
  if (r < 0.15) return 8;
  if (r < 0.18) return 12;
  if (r < 0.1816) return 6;
  return 0;
}

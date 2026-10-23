import { describe, expect, it } from "vitest";
import { MAX_AIR, NOWHERE, Vitals, armorReduce, deathXp, levelOf, xpForLevel, type Difficulty, type PlayMode, type Surroundings } from "../src/vitals.js";

const rules = (mode: PlayMode = "survival", difficulty: Difficulty = "normal") => ({ mode, difficulty });

/** Vitals that don't heal by themselves (not enough food), to see the hurts alone. */
function unfed(): Vitals {
  const v = new Vitals();
  v.food = 17;
  v.saturation = 0;
  return v;
}

/** Ticks the vitals n times in the same surroundings. */
function run(v: Vitals, n: number, around: Partial<Surroundings> = {}, mode: PlayMode = "survival", difficulty: Difficulty = "normal"): void {
  for (let i = 0; i < n; i++) v.tick({ ...NOWHERE, ...around }, rules(mode, difficulty));
}

describe("hurts", () => {
  it("drowning starts when the air is out, 2 a second", () => {
    const v = unfed();
    run(v, MAX_AIR + 19, { eyesInWater: true });
    expect(v.health).toBe(20);
    run(v, 1, { eyesInWater: true });
    expect(v.health).toBe(18);
    run(v, 20, { eyesInWater: true });
    expect(v.health).toBe(16);
    // Air comes back four times as fast above the water
    run(v, 75);
    expect(v.air).toBe(MAX_AIR);
  });

  it("lava burns 4 at a time, twice a second, and sets the player burning until water puts it out", () => {
    const v = unfed();
    run(v, 1, { inLava: true });
    expect(v.health).toBe(16);
    run(v, 9, { inLava: true });
    expect(v.health).toBe(16);
    run(v, 1, { inLava: true });
    expect(v.health).toBe(12);
    expect(v.fire).toBe(299);
    // Out of the lava it keeps burning: a point a second
    run(v, 20);
    expect(v.health).toBe(11);
    run(v, 1, { inWater: true });
    expect(v.fire).toBe(0);
    expect(v.cause).toBeNull();
  });

  it("suffocating, cactus and the void hurt too, and death says what did it", () => {
    const walled = new Vitals();
    run(walled, 1, { inWall: true });
    expect(walled.health).toBe(19);
    const pricked = new Vitals();
    run(pricked, 400, { onCactus: true });
    expect(pricked.dead).toBe(true);
    expect(pricked.cause).toBe("cactus");
    const fallen = new Vitals();
    run(fallen, 200, { inVoid: true }, "creative");
    expect(fallen.cause).toBe("void");
  });

  it("only a harder hit lands within half a second of the last, and only by the difference", () => {
    const v = unfed();
    expect(v.damage(3, "fall", rules())).toBe(true);
    expect(v.damage(2, "fall", rules())).toBe(false);
    expect(v.damage(5, "fall", rules())).toBe(true);
    expect(v.health).toBe(15);
    run(v, 10);
    expect(v.damage(1, "fall", rules())).toBe(true);
    expect(v.health).toBe(14);
  });

  it("creative takes nothing but the void, spectators nothing at all", () => {
    const v = new Vitals();
    run(v, 400, { inLava: true, eyesInWater: true, inWall: true }, "creative");
    expect(v.health).toBe(20);
    expect(v.fire).toBe(0);
    expect(v.damage(10, "void", rules("creative"))).toBe(true);
    expect(v.damage(10, "void", rules("spectator"))).toBe(false);
  });

  it("armor lessens lava and cactus by its points, and wears", () => {
    // A full diamond set: 20 points, toughness 8
    expect(armorReduce(4, 20, 8)).toBeCloseTo(0.96);
    expect(armorReduce(4, 0, 0)).toBe(4);
    const v = new Vitals();
    let worn = 0;
    v.damage(4, "lava", rules(), { defense: 20, toughness: 8, wear: (n) => (worn += n) });
    expect(v.health).toBeCloseTo(19.04);
    expect(worn).toBe(1);
    // Not falls
    const w = new Vitals();
    w.damage(4, "fall", rules(), { defense: 20, toughness: 8, wear: () => {} });
    expect(w.health).toBe(16);
  });
});

describe("hunger", () => {
  it("exhaustion uses up saturation, then food", () => {
    const v = new Vitals();
    v.exert(4.5);
    run(v, 1);
    expect([v.saturation, v.food]).toEqual([4, 20]);
    v.saturation = 0;
    v.exert(4.5);
    run(v, 1);
    expect(v.food).toBe(19);
  });

  it("heals a point every 4 seconds from 18 food, quickly on a full stomach with saturation to spare", () => {
    const v = new Vitals();
    v.health = 10;
    v.food = 18;
    v.saturation = 0;
    run(v, 79);
    expect(v.health).toBe(10);
    run(v, 1);
    expect(v.health).toBe(11);
    expect(v.exhaustion).toBe(6);
    const full = new Vitals();
    full.health = 10;
    full.saturation = 5;
    run(full, 10);
    expect(full.health).toBeCloseTo(10 + 5 / 6);
  });

  it("starving stops at 10 health on easy, 1 on normal, and kills on hard", () => {
    const starve = (difficulty: Difficulty): Vitals => {
      const v = new Vitals();
      v.food = 0;
      v.saturation = 0;
      run(v, 80 * 25, {}, "survival", difficulty);
      return v;
    };
    expect(starve("easy").health).toBe(10);
    expect(starve("normal").health).toBe(1);
    expect(starve("hard").cause).toBe("starve");
  });

  it("peaceful feeds and heals by itself", () => {
    const v = new Vitals();
    v.health = 5;
    v.food = 5;
    v.exert(40);
    run(v, 200, {}, "survival", "peaceful");
    expect(v.food).toBe(20);
    expect(v.health).toBe(15);
  });

  it("eating fills food and saturation, saturation never above food", () => {
    const v = new Vitals();
    v.food = 10;
    v.saturation = 0;
    v.eat({ hunger: 5, saturation: 6 });
    expect([v.food, v.saturation]).toEqual([15, 6]);
    v.food = 2;
    v.saturation = 0;
    v.eat({ hunger: 2, saturation: 6 });
    expect([v.food, v.saturation]).toEqual([4, 4]);
  });

  it("creative doesn't get hungry", () => {
    const v = new Vitals();
    v.exert(40);
    run(v, 100, {}, "creative");
    expect(v.food).toBe(20);
  });
});

describe("experience", () => {
  it("levels as Minecraft's: 7 points to the first, 352 to the 16th, 1395 to the 30th", () => {
    expect(xpForLevel(1)).toBe(7);
    expect(xpForLevel(16)).toBe(352);
    expect(xpForLevel(30)).toBe(1395);
    expect(levelOf(0)).toEqual({ level: 0, progress: 0 });
    expect(levelOf(10).level).toBe(1);
    expect(levelOf(10).progress).toBeCloseTo(3 / 9);
    expect(levelOf(1395).level).toBe(30);
  });

  it("a death leaves 7 points a level, at most 100", () => {
    expect(deathXp(10)).toBe(7);
    expect(deathXp(352)).toBe(100);
    expect(deathXp(0)).toBe(0);
  });

  it("vitals come back from a save, nonsense made sense of", () => {
    const v = new Vitals();
    v.health = 7.5;
    v.food = 12;
    v.xp = 99;
    const back = new Vitals();
    back.load(v.save());
    expect(back.save()).toEqual(v.save());
    back.load({ health: 900, food: -3, xp: Number.NaN } as never);
    expect([back.health, back.food, back.xp]).toEqual([20, 0, 0]);
  });
});

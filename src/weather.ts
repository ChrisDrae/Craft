import type { Vec3 } from "projector";
import { BIOMES, Biome } from "./biomes.js";
import { FLUID } from "./blocks.js";
import { WORLD_HEIGHT } from "./chunk.js";
import { COLLISION } from "./shapes.js";
import type { VoxelWorld } from "./world.js";

/** What falls from the sky in a place. */
export type Precipitation = "rain" | "snow" | "none";

/** Above this height rain falls as snow anywhere (mountain tops). */
const SNOW_LINE = 150;
/** Biomes where nothing falls (it is too dry). */
const DRY: ReadonlySet<Biome> = new Set([Biome.Desert, Biome.Savanna]);

/** What falls in a biome at a height: snow where it is cold (or high), nothing where it is dry, rain elsewhere. */
export function precipitationAt(biome: Biome, y: number): Precipitation {
  if (DRY.has(biome)) return "none";
  return BIOMES[biome]?.cold || y > SNOW_LINE ? "snow" : "rain";
}

/** Whether rain stops at a block: anything solid stops it, and any fluid. */
const stopsRain = (state: number): boolean => COLLISION[state].length > 0 || FLUID[state] !== 0;

/** Where rain stops in a column: its highest block that rain doesn't fall through, or 0. */
export function rainTop(w: VoxelWorld, x: number, z: number): number {
  for (let y = WORLD_HEIGHT - 1; y > 0; y--) if (stopsRain(w.get(x, y, z))) return y;
  return 0;
}

/** Whether rain falls on (x, y, z) now: it rains, it falls there as rain (not snow, nor nothing), and nothing above keeps it off. */
export function rainsOn(w: VoxelWorld, weather: Weather, x: number, y: number, z: number): boolean {
  if (weather.rain < 0.2) return false;
  const biome = w.chunk(x >> 4, z >> 4)?.biomes[(z & 15) * 16 + (x & 15)];
  if (biome === undefined || precipitationAt(biome, y) !== "rain") return false;
  for (let yy = Math.max(0, y); yy < WORLD_HEIGHT; yy++) if (stopsRain(w.get(x, yy, z))) return false;
  return true;
}

/**
 * Where lightning strikes this tick: in a thunderstorm, in each loaded chunk one tick in 100,000 (as
 * Minecraft's), on top of a column of it chosen at random, if it rains there.
 */
export function lightningStrikes(w: VoxelWorld, weather: Weather, r: () => number = Math.random): Vec3[] {
  const out: Vec3[] = [];
  if (!weather.storm) return out;
  for (const chunk of w.chunks.values()) {
    if (r() >= 1e-5) continue;
    const x = chunk.cx * 16 + Math.floor(r() * 16);
    const z = chunk.cz * 16 + Math.floor(r() * 16);
    const y = rainTop(w, x, z) + 1;
    if (rainsOn(w, weather, x, y, z)) out.push({ x, y, z });
  }
  return out;
}

/** The weather as saves keep it. */
export interface SavedWeather {
  raining: boolean;
  thundering: boolean;
  /** Ticks until it starts or stops raining, and thundering. */
  rainTime: number;
  thunderTime: number;
}

/**
 * The weather, as Minecraft's: clear spells of 10 to 150 minutes and rain of 10 to 20 (snow where it is
 * cold), now and then a thunderstorm while it rains (its own timer). How much it rains and thunders fades
 * in and out (rain, thunder: 0-1), for the sky and the sounds. /weather sets it for a while.
 */
export class Weather {
  raining: boolean = false;
  thundering: boolean = false;
  rainTime: number;
  thunderTime: number;
  /** How hard it rains, and how dark the storm is, now (0-1). */
  rain: number = 0;
  thunder: number = 0;
  /** Called when it starts or stops raining or thundering. */
  onChange: (() => void) | null = null;

  constructor(private readonly random: () => number = Math.random) {
    this.rainTime = this.clearSpell();
    this.thunderTime = this.clearSpell();
  }

  private clearSpell(): number {
    return 12000 + Math.floor(this.random() * 168000);
  }

  /** A thunderstorm now, as Minecraft's: dark enough for lightning, and for sleeping by day. */
  get storm(): boolean {
    return this.rain > 0.2 && this.thunder > 0.9;
  }

  /** One game tick: the timers run down and the weather turns; rain and thunder fade toward what it is. */
  tick(): void {
    if (--this.thunderTime <= 0) {
      this.thundering = !this.thundering;
      this.thunderTime = this.thundering ? 3600 + Math.floor(this.random() * 12000) : this.clearSpell();
      this.onChange?.();
    }
    if (--this.rainTime <= 0) {
      this.raining = !this.raining;
      this.rainTime = this.raining ? 12000 + Math.floor(this.random() * 12000) : this.clearSpell();
      this.onChange?.();
    }
    this.fade();
  }

  /** Rain and thunder fade a hundredth a tick toward what the weather is (on a guest's side, all it does). */
  fade(): void {
    this.rain = Math.max(0, Math.min(1, this.rain + (this.raining ? 0.01 : -0.01)));
    // Thunder only darkens a rain
    this.thunder = Math.max(0, Math.min(1, this.thunder + (this.raining && this.thundering ? 0.01 : -0.01)));
  }

  /** Clear, rain or a thunderstorm for `ticks` (5 minutes by default), as /weather sets it; sleeping clears it. */
  set(kind: "clear" | "rain" | "thunder", ticks: number = 6000): void {
    this.raining = kind !== "clear";
    this.thundering = kind === "thunder";
    this.rainTime = ticks;
    this.thunderTime = ticks;
    this.onChange?.();
  }

  /** After a night's sleep the rain stops (and any storm), for a fresh clear spell. */
  clearUp(): void {
    if (!this.raining) return;
    this.raining = this.thundering = false;
    this.rainTime = this.clearSpell();
    this.thunderTime = this.clearSpell();
    this.onChange?.();
  }

  /** The weather as it is, at once, without fading in (a guest joining, told by its host). */
  show(raining: boolean, thundering: boolean): void {
    this.raining = raining;
    this.thundering = thundering;
    this.rain = raining ? 1 : 0;
    this.thunder = raining && thundering ? 1 : 0;
  }

  save(): SavedWeather {
    return { raining: this.raining, thundering: this.thundering, rainTime: this.rainTime, thunderTime: this.thunderTime };
  }

  load(s: Partial<SavedWeather> | null | undefined): void {
    if (!s) return;
    this.raining = s.raining === true;
    this.thundering = s.thundering === true;
    this.rainTime = Math.max(1, Math.floor(Number(s.rainTime)) || this.clearSpell());
    this.thunderTime = Math.max(1, Math.floor(Number(s.thunderTime)) || this.clearSpell());
    this.rain = this.raining ? 1 : 0;
    this.thunder = this.raining && this.thundering ? 1 : 0;
  }
}

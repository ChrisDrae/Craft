import { Biome } from "../biomes.js";
import { Octaves, clamp, lerp, smoothstep } from "./noise.js";

/** y of the highest water block. */
export const SEA_LEVEL = 63;

/**
 * The climate of a column, as Minecraft picks biomes and shapes land from it, each in about [-1, 1]:
 * continentalness (ocean far below 0, inland above), erosion (rugged below 0, flat above), weirdness
 * (rivers where it crosses 0; peaks and valleys from it), temperature and humidity.
 */
export interface Climate {
  continentalness: number;
  erosion: number;
  weirdness: number;
  temperature: number;
  humidity: number;
}

/** The land a climate makes: ground height, how far 3D noise moves the surface, and the biome. */
export interface LandShape {
  /** Height of the ground before 3D noise. */
  height: number;
  /** Blocks the 3D noise moves the surface up or down at most: cliffs and overhangs where large. */
  jag: number;
  biome: Biome;
  /** How much of a mountain this is, 0-1 (emeralds grow in mountains). */
  mountain: number;
}

/** Points (climate value, height) of a curve, interpolated linearly between them. */
function curve(points: ReadonlyArray<readonly [number, number]>, v: number): number {
  if (v <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (v <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((v - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

/** Ground height by continentalness: deep ocean, shelf, coast, rising inland. */
const COAST: ReadonlyArray<readonly [number, number]> = [
  [-1, 28],
  [-0.6, 36],
  [-0.35, 48],
  [-0.25, 57],
  [-0.2, 62],
  [-0.15, 64.5],
  [-0.1, 66],
  [0, 68],
  [0.3, 74],
  [0.6, 82],
  [1, 94],
];

/** Where ocean ends: continentalness below this is sea. */
const OCEAN = -0.25;
const DEEP_OCEAN = -0.6;
/** Coast where continentalness is below this (and above OCEAN): beaches. */
const COAST_END = -0.2;
/** Colder than this freezes (snowy plains, frozen rivers and oceans), hotter than HOT is desert. */
const FREEZING = -0.45;
const HOT = 0.5;

/** Samples the climate noises. Biome borders wander: temperature and humidity are read at shifted places. */
export class ClimateSampler {
  private readonly continentalness: Octaves;
  private readonly erosion: Octaves;
  private readonly weirdness: Octaves;
  private readonly temperature: Octaves;
  private readonly humidity: Octaves;
  private readonly shiftX: Octaves;
  private readonly shiftZ: Octaves;

  constructor(seed: string) {
    this.continentalness = new Octaves(`${seed}/continentalness`, 4, 1 / 1200, 2.5);
    this.erosion = new Octaves(`${seed}/erosion`, 3, 1 / 900, 2.5);
    this.weirdness = new Octaves(`${seed}/weirdness`, 3, 1 / 700, 2.5);
    this.temperature = new Octaves(`${seed}/temperature`, 3, 1 / 1100, 2.5);
    this.humidity = new Octaves(`${seed}/humidity`, 3, 1 / 900, 2.5);
    this.shiftX = new Octaves(`${seed}/shift x`, 2, 1 / 60, 24);
    this.shiftZ = new Octaves(`${seed}/shift z`, 2, 1 / 60, 24);
  }

  sample(x: number, z: number, out: Climate): Climate {
    const sx = x + this.shiftX.at2(x, z);
    const sz = z + this.shiftZ.at2(x, z);
    out.continentalness = clamp(this.continentalness.at2(x, z), -1, 1);
    out.erosion = clamp(this.erosion.at2(x, z), -1, 1);
    out.weirdness = clamp(this.weirdness.at2(x, z), -1, 1);
    out.temperature = clamp(this.temperature.at2(sx, sz), -1, 1);
    out.humidity = clamp(this.humidity.at2(sx, sz), -1, 1);
    return out;
  }
}

/**
 * The land of a climate, with no sharp edges anywhere (it is interpolated between columns): the coast
 * curve, hills where erosion is low, mountains where it is lowest far inland (peaks where weirdness says),
 * river valleys where weirdness crosses 0, swamps flattened to the water line.
 */
export function landShape(c: Climate): LandShape {
  const { continentalness: con, erosion: ero, weirdness: weird, temperature: temp, humidity: hum } = c;
  const inland = smoothstep(-0.2, -0.1, con);
  // Peaks and valleys: -1 in valleys (where rivers run), 1 on ridges
  const pv = 1 - 3 * Math.abs(Math.abs(weird) - 2 / 3);
  const hills = smoothstep(0.4, -0.4, ero);
  const mountain = smoothstep(0.1, 0.55, con) * smoothstep(-0.15, -0.65, ero);
  // Hills rise from the valleys, which lie a little below the land around them
  let height = curve(COAST, con) + inland * ((pv * 0.5 + 0.5) * (4 + 14 * hills) - 2) + mountain * (30 + 85 * smoothstep(-0.3, 0.9, pv));
  let jag = 3 + 6 * hills * inland + mountain * 26;

  const river = (1 - smoothstep(0.012, 0.045, Math.abs(weird))) * inland * (1 - smoothstep(0.35, 0.6, mountain));
  height = lerp(height, SEA_LEVEL - 5, river);
  jag *= 1 - 0.85 * river;

  const temperate = smoothstep(-0.3, -0.15, temp) * (1 - smoothstep(0.4, 0.55, temp));
  const swamp = smoothstep(0.3, 0.45, hum) * (1 - smoothstep(0.0, 0.15, con)) * temperate * inland * (1 - mountain);
  // Swamps lie at the water line, about half of them flooded
  const flat = smoothstep(0.15, 0.55, swamp);
  height = lerp(height, SEA_LEVEL - 0.2, flat);
  jag = lerp(jag, 1.6, flat);

  return { height, jag, biome: pickBiome(c, height, mountain, river, swamp), mountain };
}

/** The biome of a climate, given the land it makes. */
function pickBiome(c: Climate, height: number, mountain: number, river: number, swamp: number): Biome {
  const { continentalness: con, temperature: temp, humidity: hum } = c;
  const freezing = temp < FREEZING;
  if (con < OCEAN) return freezing ? Biome.FrozenOcean : con < DEEP_OCEAN ? Biome.DeepOcean : Biome.Ocean;
  if (river > 0.5) return freezing ? Biome.FrozenRiver : Biome.River;
  if (mountain > 0.45) return height > 150 || temp < -0.15 ? Biome.SnowyPeaks : Biome.StonyMountains;
  if (con < COAST_END && height < SEA_LEVEL + 6) return Biome.Beach;
  // Land that lies under the sea after all is sea
  if (height < SEA_LEVEL - 1 && swamp < 0.5) return freezing ? Biome.FrozenOcean : Biome.Ocean;
  if (mountain > 0.25) return Biome.StonyMountains;
  if (swamp > 0.5) return Biome.Swamp;
  if (freezing) return Biome.SnowyPlains;
  if (temp < -0.15) return hum < -0.35 ? Biome.Plains : Biome.Taiga;
  if (temp < 0.2) return hum < -0.3 ? Biome.Plains : hum < 0.05 ? Biome.Forest : hum < 0.35 ? Biome.BirchForest : Biome.DarkForest;
  if (temp < HOT) return hum < -0.25 ? Biome.Savanna : hum < 0.05 ? Biome.Plains : hum < 0.3 ? Biome.Forest : Biome.Jungle;
  return hum < 0 ? Biome.Desert : hum < 0.35 ? Biome.Savanna : Biome.Jungle;
}

import { Tint } from "./blocks.js";

/** A color as red, green and blue, 0-255. */
export type Rgb = readonly [number, number, number];

function hex(css: string): Rgb {
  const n = parseInt(css.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Biome ids, as chunks store them per column. Plains is 0, what chunks from before biomes have. */
export const Biome = {
  Plains: 0,
  Forest: 1,
  BirchForest: 2,
  DarkForest: 3,
  Taiga: 4,
  SnowyPlains: 5,
  Desert: 6,
  Savanna: 7,
  Jungle: 8,
  Swamp: 9,
  StonyMountains: 10,
  SnowyPeaks: 11,
  Beach: 12,
  River: 13,
  FrozenRiver: 14,
  Ocean: 15,
  DeepOcean: 16,
  FrozenOcean: 17,
} as const;
export type Biome = number;

export interface BiomeInfo {
  readonly id: Biome;
  /** Stable name, as saves store it: "birch_forest". */
  readonly name: string;
  /** What the player sees: "birch forest". */
  readonly label: string;
  /** Snow falls and water freezes here. */
  readonly cold: boolean;
  /** Colors Minecraft multiplies into its gray grass, leaf and water textures here. */
  readonly grass: Rgb;
  readonly foliage: Rgb;
  readonly water: Rgb;
}

const WATER = hex("#3f76e4");
const COLD_WATER = hex("#3d57d6");
const FROZEN_WATER = hex("#3938c9");

function biome(id: Biome, name: string, grass: string, foliage: string, water: Rgb = WATER, cold: boolean = false): BiomeInfo {
  return { id, name, label: name.replace(/_/g, " "), cold, grass: hex(grass), foliage: hex(foliage), water };
}

/** Every biome, indexed by its id, with Minecraft's colors for it. */
export const BIOMES: readonly BiomeInfo[] = [
  biome(Biome.Plains, "plains", "#91bd59", "#77ab2f"),
  biome(Biome.Forest, "forest", "#79c05a", "#59ae30"),
  biome(Biome.BirchForest, "birch_forest", "#88bb67", "#6ba941"),
  biome(Biome.DarkForest, "dark_forest", "#507a32", "#59ae30"),
  biome(Biome.Taiga, "taiga", "#86b783", "#68a464", COLD_WATER),
  biome(Biome.SnowyPlains, "snowy_plains", "#80b497", "#60a17b", COLD_WATER, true),
  biome(Biome.Desert, "desert", "#bfb755", "#aea42a"),
  biome(Biome.Savanna, "savanna", "#bfb755", "#aea42a"),
  biome(Biome.Jungle, "jungle", "#59c93c", "#30bb0b"),
  biome(Biome.Swamp, "swamp", "#6a7039", "#6a7039", hex("#617b64")),
  biome(Biome.StonyMountains, "stony_mountains", "#8ab689", "#6da36b", COLD_WATER),
  biome(Biome.SnowyPeaks, "snowy_peaks", "#80b497", "#60a17b", COLD_WATER, true),
  biome(Biome.Beach, "beach", "#91bd59", "#77ab2f"),
  biome(Biome.River, "river", "#8eb971", "#71a74d"),
  biome(Biome.FrozenRiver, "frozen_river", "#80b497", "#60a17b", FROZEN_WATER, true),
  biome(Biome.Ocean, "ocean", "#8eb971", "#71a74d"),
  biome(Biome.DeepOcean, "deep_ocean", "#8eb971", "#71a74d"),
  biome(Biome.FrozenOcean, "frozen_ocean", "#80b497", "#60a17b", FROZEN_WATER, true),
];

const BY_NAME: ReadonlyMap<string, Biome> = new Map(BIOMES.map((b) => [b.name, b.id]));

/** The biome with a stable name, or null. */
export function biomeByName(name: string): Biome | null {
  return BY_NAME.get(name) ?? null;
}

/** Fixed tints, whatever the biome: birch and spruce leaves, lily pads. */
const FIXED: Readonly<Record<number, Rgb>> = {
  [Tint.Birch]: hex("#80a755"),
  [Tint.Spruce]: hex("#619961"),
  [Tint.LilyPad]: hex("#208030"),
  // A stem yellows as it grows; redstone glows brighter the more power it carries (Minecraft's colors)
  ...Object.fromEntries(Array.from({ length: 8 }, (_, a) => [Tint.Stem + a, [a * 32, 255 - a * 8, a * 4] as Rgb])),
  ...Object.fromEntries(
    Array.from({ length: 16 }, (_, p) => {
      const f = p / 15;
      return [Tint.Redstone + p, [Math.round((f * 0.6 + (p > 0 ? 0.4 : 0.3)) * 255), Math.round(Math.max(0, f * f * 0.7 - 0.5) * 255), Math.round(Math.max(0, f * f * 0.6 - 0.7) * 255)] as Rgb];
    }),
  ),
};

/** The color of a tint (Tint) in a biome; white for none. */
export function tintColor(tint: number, biome: Biome): Rgb {
  const info = BIOMES[biome] ?? BIOMES[Biome.Plains];
  switch (tint) {
    case Tint.Grass:
      return info.grass;
    case Tint.Foliage:
      return info.foliage;
    case Tint.Water:
      return info.water;
    case Tint.None:
      return [255, 255, 255];
    default:
      return FIXED[tint];
  }
}

/**
 * A chunk's biomes as text, for saves: runs of "name count" in column order (x fastest, then z),
 * "plains 200,river 56". Short, and readable by any version that knows the names.
 */
export function encodeBiomes(biomes: Uint8Array): string {
  const runs: string[] = [];
  for (let i = 0; i < biomes.length; ) {
    let j = i;
    while (j < biomes.length && biomes[j] === biomes[i]) j++;
    runs.push(`${BIOMES[biomes[i]].name} ${j - i}`);
    i = j;
  }
  return runs.join(",");
}

/** The biomes from encodeBiomes into `out` (256 columns); unknown names, and anything missing, are plains. */
export function decodeBiomes(text: string, out: Uint8Array): Uint8Array {
  out.fill(Biome.Plains);
  let i = 0;
  for (const run of text ? text.split(",") : []) {
    const [name, count] = run.split(" ");
    const id = biomeByName(name) ?? Biome.Plains;
    const n = Math.min(Number(count) || 0, out.length - i);
    out.fill(id, i, i + n);
    i += n;
  }
  return out;
}

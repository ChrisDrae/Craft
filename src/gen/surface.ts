import { Biome } from "../biomes.js";
import { Block } from "../blocks.js";

/**
 * What the ground is made of near its surface, as Minecraft's surface rules decide it (simplified): `depth`
 * counts the solid blocks from the air or water above (0 for the top one), `steep` is the largest height
 * difference to a neighboring column, `wet` says whether water lies on it, `patch` is a number in [0, 1)
 * that varies slowly between columns (gravel and clay come in patches). Stone where it returns null.
 */
export function surfaceBlock(biome: Biome, y: number, depth: number, steep: number, wet: boolean, patch: number, filler: number): Block | null {
  if (wet) {
    if (depth > 2) return null;
    switch (biome) {
      case Biome.DeepOcean:
      case Biome.FrozenOcean:
      case Biome.StonyMountains:
      case Biome.SnowyPeaks:
        return Block.Gravel;
      case Biome.Ocean:
        return y < 45 ? Block.Gravel : Block.Sand;
      case Biome.River:
      case Biome.FrozenRiver:
        return patch < 0.2 ? Block.Clay : patch < 0.45 ? Block.Gravel : Block.Sand;
      case Biome.Swamp:
        return patch < 0.3 ? Block.Clay : Block.Dirt;
      case Biome.Desert:
      case Biome.Beach:
        return Block.Sand;
      default:
        return patch < 0.12 ? Block.Clay : patch < 0.5 ? Block.Sand : Block.Dirt;
    }
  }
  switch (biome) {
    case Biome.Desert:
    case Biome.Beach:
    case Biome.Ocean:
    case Biome.DeepOcean:
    case Biome.FrozenOcean:
      // Sand, and sandstone under it
      return depth <= filler ? Block.Sand : depth <= filler + 3 ? Block.Sandstone : null;
    case Biome.SnowyPeaks:
      return y >= 135 && depth <= 2 ? Block.SnowBlock : null;
    case Biome.StonyMountains:
      if (steep >= 3 || y > 125) return patch < 0.18 && depth <= 1 ? Block.Gravel : null;
      break;
    default:
      if (steep >= 4) return null;
  }
  return depth === 0 ? Block.Grass : depth <= filler ? Block.Dirt : null;
}

/** Whether snow lies and water freezes on a column of a biome, at the height of its top. */
export function freezes(cold: boolean, y: number): boolean {
  return cold || y >= 150;
}

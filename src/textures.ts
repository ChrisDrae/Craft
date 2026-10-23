import { Random, Texture } from "projector";
import { DESTROY_TILES, ITEM_TILES, ORB_TILES, PARTICLE_TILES, bedTiles, farmTiles, redstoneTiles, chestFromSheet, chestTiles, destroyStages, furnaceOn, itemTiles, orbTiles, orbsFromSheet, particleTiles, plantTiles } from "./itemTextures.js";
import { hex, jitter, paint, scale, type Rgb } from "./paint.js";
import { Atlas, TILE, type TilePixels } from "./atlas.js";
import { Biome, tintColor } from "./biomes.js";
import { BLOCKS, Block, COLORS, FACE_TILE, Face, TILE_NAMES, Tint, type Block as BlockId } from "./blocks.js";
import type { TileUVs } from "./chunkMesh.js";

/**
 * The textures in the atlas: the blocks' (TILE_NAMES, named after Minecraft's block texture files, in the
 * same order so blocks find them by index), then the items' ("item_stick") and the stages of cracks.
 */
export const TILES: readonly string[] = [...TILE_NAMES, ...ITEM_TILES, ...DESTROY_TILES, ...ORB_TILES, ...PARTICLE_TILES];
const TILE_AT: ReadonlyMap<string, number> = new Map(TILES.map((n, i) => [n, i]));

/** A texture's slot in the atlas (TILES), or -1. */
export function atlasIndex(name: string): number {
  return TILE_AT.get(name) ?? -1;
}
export type TileName = string;

/** The texture on a block state's face in direction `dir` (Dir), for a cube. */
export function tileFor(state: number, dir: number): TileName {
  return TILE_NAMES[FACE_TILE[state * 6 + dir]];
}

/** The texture that stands for a block in the hotbar and the block list: its side. */
export function iconTile(block: BlockId): TileName {
  return BLOCKS[block].textures[Face.Side];
}

/**
 * A block's icon from the tiles: its side, tinted as in plains where its color comes from the biome (the
 * grass overlay laid onto a grass block's side).
 */
export function iconPixels(tiles: ReadonlyMap<TileName, TilePixels>, block: BlockId): TilePixels | undefined {
  const tile = tiles.get(iconTile(block));
  if (!tile) return undefined;
  const info = BLOCKS[block];
  if (block === Block.Grass) {
    const fringe = tiles.get("grass_block_side_overlay");
    return fringe ? overlay(tile, tint(fringe, tintColor(Tint.Grass, Biome.Plains))) : tile;
  }
  return info.tint === Tint.None ? tile : tint(tile, tintColor(info.tint, Biome.Plains));
}

/**
 * Textures drawn gray and colored by the biome or a fixed tint (Tint), as Minecraft's are: Craft paints
 * its own in plains colors and takes the tint out again (untint).
 */
const TINTED: Readonly<Record<string, number>> = {
  grass_block_top: Tint.Grass,
  grass_block_side_overlay: Tint.Grass,
  short_grass: Tint.Grass,
  fern: Tint.Grass,
  tall_grass_top: Tint.Grass,
  tall_grass_bottom: Tint.Grass,
  large_fern_top: Tint.Grass,
  large_fern_bottom: Tint.Grass,
  sugar_cane: Tint.Grass,
  oak_leaves: Tint.Foliage,
  vine: Tint.Foliage,
  jungle_leaves: Tint.Foliage,
  acacia_leaves: Tint.Foliage,
  dark_oak_leaves: Tint.Foliage,
  birch_leaves: Tint.Birch,
  spruce_leaves: Tint.Spruce,
  lily_pad: Tint.LilyPad,
  water_still: Tint.Water,
};

/** Textures that move: frames per second shown, and how many frames Craft draws when it paints its own. */
export const ANIMATED: Readonly<Record<string, { fps: number; frames: number }>> = {
  water_still: { fps: 10, frames: 32 },
  lava_still: { fps: 6, frames: 20 },
};

/** Stone with patches of ore of a color. */
function ore(seed: string, color: Rgb): TilePixels {
  const stone = hex("#7f7f7f");
  const spots = new Random(`${seed}/spots`);
  const centers: Array<[number, number]> = [];
  for (let k = 0; k < 4; k++) centers.push([2 + spots.next() * 12, 2 + spots.next() * 12]);
  return paint(seed, (x, y, rnd) => {
    const near = centers.some(([cx, cy]) => Math.hypot(x - cx, y - cy) < 1.6 + rnd.next() * 0.9);
    return near ? scale(color, jitter(rnd, 0.35)) : scale(stone, jitter(rnd, 0.25));
  });
}

/** Bark with its grain running along the log; `marks` adds the dark patches of birch bark. */
function logSide(seed: string, bark: Rgb, marks: Rgb | null = null): TilePixels {
  const patches = new Random(`${seed}/marks`);
  const spots = Array.from({ length: 5 }, () => [Math.floor(patches.next() * 16), Math.floor(patches.next() * 16), 2 + Math.floor(patches.next() * 4)]);
  return paint(seed, (x, y, rnd) => {
    if (marks && spots.some(([sx, sy, w]) => y === sy && ((x - sx + 16) % 16) < w)) return scale(marks, jitter(rnd, 0.2));
    return scale(bark, (marks ? 1 : x % 4 === 0 ? 0.75 : 1) * jitter(rnd, marks ? 0.08 : 0.25));
  });
}

/** The end of a log: rings of wood inside a rim of bark. */
function logTop(seed: string, bark: Rgb, wood: Rgb): TilePixels {
  return paint(seed, (x, y, rnd) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 6.5) return scale(bark, jitter(rnd, 0.2));
    return scale(wood, (Math.floor(d) % 2 === 0 ? 1 : 0.85) * jitter(rnd, 0.08));
  });
}

/** Four boards with seams where they meet. */
function planks(seed: string, color: Rgb): TilePixels {
  const seams = new Random(seed);
  const offsets = [0, 1, 2, 3].map(() => Math.floor(seams.next() * 16));
  return paint(seed, (x, y, rnd) => {
    const board = Math.floor(y / 4);
    if (y % 4 === 3 || x === offsets[board]) return scale(color, 0.68);
    return scale(color, jitter(rnd, 0.12));
  });
}

/** Leaves with holes to see through, cut out by the material's alphaTest. */
function leaves(seed: string, color: Rgb, holes: number = 0.16): TilePixels {
  return paint(seed, (_x, _y, rnd) => (rnd.next() < holes ? [0, 0, 0, 0] : scale(color, jitter(rnd, 0.45))));
}

/** Rounded stones with dark mortar where two are equally close; `moss` grows over some of them. */
function cobble(seed: string, stone: Rgb, moss: Rgb | null = null): TilePixels {
  const stones = new Random(seed);
  const centers = Array.from({ length: 9 }, () => [stones.next() * 16, stones.next() * 16, 0.75 + stones.next() * 0.4, stones.next()]);
  return paint(seed, (x, y, rnd) => {
    let a = Infinity;
    let b = Infinity;
    let shade = 1;
    let mossy = false;
    for (const [cx, cy, k, m] of centers) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < a) {
        b = a;
        a = d;
        shade = k;
        mossy = m < 0.45;
      } else if (d < b) {
        b = d;
      }
    }
    if (moss && (mossy || b - a < 1) && rnd.next() < 0.75) return scale(moss, jitter(rnd, 0.3));
    return b - a < 1 ? scale(stone, 0.5) : scale(stone, shade * jitter(rnd, 0.15));
  });
}

/** Stone bricks in two rows, with moss or cracks if asked. */
function stoneBricks(seed: string, stone: Rgb, extra: "moss" | "cracks" | null = null): TilePixels {
  const crack = new Random(`${seed}/crack`);
  const path = Array.from({ length: 16 }, () => Math.floor(crack.next() * 3) - 1);
  return paint(seed, (x, y, rnd) => {
    const row = Math.floor(y / 8);
    if (y % 8 === 7 || (x + (row % 2 ? 8 : 0)) % 16 === 15) return scale(stone, 0.55);
    if (extra === "moss" && (y + x * 0.3) % 9 < 3 && rnd.next() < 0.7) return scale(hex("#5a7a3a"), jitter(rnd, 0.3));
    if (extra === "cracks") {
      let cy = 3;
      for (let i = 0; i <= x; i++) cy += path[i] * 0.5;
      if (Math.abs(y - (cy + 6)) < 0.6 && x > 2 && x < 13) return scale(stone, 0.4);
    }
    return scale(stone, jitter(rnd, 0.14));
  });
}

/** Blades of grass rising from the bottom of the tile, up to `full` rows high (all of it if `full` is 16). */
function blades(seed: string, color: Rgb, cover: number, full: number): TilePixels {
  const r = new Random(`${seed}/blades`);
  const heights = Array.from({ length: TILE }, () => (r.next() < cover ? Math.max(2, Math.floor(full * (0.3 + r.next() * 0.7))) : 0));
  return paint(seed, (x, y, rnd) => (heights[x] > 0 && y >= 16 - heights[x] ? scale(color, jitter(rnd, 0.3)) : [0, 0, 0, 0]));
}

/** A fern: leaflets on both sides of a stem bending away from the middle. */
function fern(seed: string, color: Rgb, top: number): TilePixels {
  return paint(seed, (x, y, rnd) => {
    if (y < top) return [0, 0, 0, 0];
    for (const stem of [4, 8, 12]) {
      const sx = stem + (stem - 8) * ((16 - y) / 24);
      const reach = (y - top) % 3 === 0 ? 2.5 : 1;
      if (Math.abs(x - sx) < reach * Math.min(1, (y - top + 2) / 6)) return scale(color, jitter(rnd, 0.3));
    }
    return [0, 0, 0, 0];
  });
}

/**
 * Pixel-art textures made in code, used when no Minecraft textures were imported. Seeded, so they look
 * the same every time.
 */
export function proceduralTiles(): Map<TileName, TilePixels> {
  const grass = hex("#62a83f");
  const dirt = hex("#86603f");
  const stone = hex("#7f7f7f");
  const bark = hex("#5f4a2e");
  const wood = hex("#a8895a");
  const tiles = new Map<TileName, TilePixels>();
  tiles.set("grass_block_top", paint("grass", (_x, _y, rnd) => scale(grass, rnd.next() < 0.1 ? 1.25 : jitter(rnd, 0.25))));
  const fringe = new Random("fringe");
  const depth = Array.from({ length: TILE }, () => 3 + Math.floor(fringe.next() * 3));
  tiles.set("grass_block_side", paint("grass side", (x, y, rnd) => (y < depth[x] ? scale(grass, jitter(rnd, 0.25)) : scale(dirt, jitter(rnd, 0.35)))));
  tiles.set("dirt", paint("dirt", (_x, _y, rnd) => scale(dirt, rnd.next() < 0.08 ? 0.7 : jitter(rnd, 0.35))));
  tiles.set("stone", paint("stone", (_x, y, rnd) => scale(stone, (y % 5 === 2 && rnd.next() < 0.4 ? 0.82 : 1) * jitter(rnd, 0.2))));
  tiles.set("sand", paint("sand", (_x, _y, rnd) => scale(hex("#dcd29c"), jitter(rnd, 0.12))));
  tiles.set("water_still", paint("water", (x, y, rnd) => scale(hex("#3d6fdc"), ((x + y * 3) % 11 === 0 ? 1.18 : 1) * jitter(rnd, 0.08))));
  tiles.set("oak_log", logSide("log", bark));
  tiles.set("oak_log_top", logTop("log top", bark, wood));
  tiles.set("oak_leaves", leaves("leaves", hex("#3e8a2a")));
  tiles.set("oak_planks", planks("planks", hex("#b38d55")));
  tiles.set("cobblestone", cobble("cobble", stone));
  tiles.set("mossy_cobblestone", cobble("cobble", stone, hex("#557a35")));
  // The other woods, as Minecraft colors them
  for (const [name, barkColor, rings, leaf, board, marks] of [
    ["birch", "#d8d7d2", "#c8b77a", "#6d9a4c", "#c5b47b", "#2a2a24"],
    ["spruce", "#3b2a17", "#735531", "#3f6640", "#735531", null],
    ["jungle", "#56461d", "#a5784e", "#2f8a1a", "#a0734d", null],
    ["acacia", "#676157", "#ad5d32", "#5f8a1f", "#ad5d32", null],
    ["dark_oak", "#3c2e1a", "#4c3318", "#2f6a1a", "#42291a", null],
  ] as const) {
    tiles.set(`${name}_log`, logSide(`${name} log`, hex(barkColor), marks ? hex(marks) : null));
    tiles.set(`${name}_log_top`, logTop(`${name} log top`, hex(barkColor), hex(rings)));
    tiles.set(`${name}_leaves`, leaves(`${name} leaves`, hex(leaf), name === "spruce" ? 0.1 : 0.16));
    tiles.set(`${name}_planks`, planks(`${name} planks`, hex(board)));
  }
  tiles.set(
    "bricks",
    paint("bricks", (x, y, rnd) => {
      const row = Math.floor(y / 4);
      const shift = row % 2 === 0 ? 0 : 4;
      if (y % 4 === 3 || (x + shift) % 8 === 7) return scale(hex("#bdb3a6"), jitter(rnd, 0.1));
      return scale(hex("#985040"), jitter(rnd, 0.18));
    }),
  );
  tiles.set("coal_ore", ore("coal", hex("#2a2a2a")));
  tiles.set("iron_ore", ore("iron", hex("#d8af93")));
  tiles.set("gold_ore", ore("gold", hex("#fcee4b")));
  tiles.set("copper_ore", ore("copper", hex("#e0804a")));
  tiles.set("redstone_ore", ore("redstone", hex("#d01010")));
  tiles.set("lapis_ore", ore("lapis", hex("#2a4ac8")));
  tiles.set("diamond_ore", ore("diamond", hex("#5ae8e0")));
  tiles.set("emerald_ore", ore("emerald", hex("#17dd62")));
  const sandstone = hex("#d8cb93");
  tiles.set("sandstone_top", paint("sandstone top", (_x, _y, rnd) => scale(sandstone, 1.04 * jitter(rnd, 0.08))));
  tiles.set("sandstone_bottom", paint("sandstone bottom", (_x, y, rnd) => scale(sandstone, (y % 4 === 0 ? 0.92 : 1) * jitter(rnd, 0.1))));
  tiles.set(
    "sandstone",
    paint("sandstone side", (_x, y, rnd) => {
      // A smooth band at the top, layers below, a darker band at the foot
      if (y < 3) return scale(sandstone, 1.06 * jitter(rnd, 0.05));
      if (y === 3 || y === 12) return scale(sandstone, 0.84);
      return scale(sandstone, (y > 12 ? 0.94 : 1) * jitter(rnd, 0.1));
    }),
  );
  tiles.set(
    "spawner",
    paint("spawner", (x, y, rnd) => {
      // A dark cage: bars to look between
      if (x % 5 === 0 || y % 5 === 0 || x === 15 || y === 15) return scale(hex("#26303c"), jitter(rnd, 0.3));
      return [0, 0, 0, 0];
    }),
  );
  tiles.set("bedrock", paint("bedrock", (_x, _y, rnd) => scale(hex("#55525a"), rnd.next() < 0.3 ? 0.45 : jitter(rnd, 0.6))));
  tiles.set(
    "torch",
    paint("torch", (x, y, rnd) => {
      // A stick two pixels wide in the middle, rows 6-15, burning at the top; the rest is cut out
      if (x < 7 || x > 8 || y < 6) return [0, 0, 0, 0];
      if (y === 6) return scale(hex("#fff3a8"), jitter(rnd, 0.1));
      if (y === 7) return scale(hex("#ffb52e"), jitter(rnd, 0.1));
      return scale(hex("#8a6a3a"), (x === 8 ? 0.8 : 1) * jitter(rnd, 0.15));
    }),
  );
  tiles.set(
    "glowstone",
    paint("glowstone", (_x, _y, rnd) => {
      const v = rnd.next();
      return scale(hex(v < 0.2 ? "#8a5a2a" : v < 0.6 ? "#e0b050" : "#ffe9a0"), jitter(rnd, 0.15));
    }),
  );
  for (const [name, frames] of animatedFrames()) tiles.set(name, frames[0]);
  const plank = hex("#b38d55");
  const dark = hex("#5f4a2e");
  tiles.set("gravel", paint("gravel", (_x, _y, rnd) => scale(hex(["#7d7470", "#9a908a", "#5e5650", "#867a70"][Math.floor(rnd.next() * 4)]), jitter(rnd, 0.15))));
  tiles.set(
    "glass",
    paint("glass", (x, y) => {
      // A frame, a few glints, the rest clear
      if (x === 0 || y === 0 || x === 15 || y === 15) return [214, 232, 238, 255];
      if ((x - y === 4 || x - y === 5) && x < 10) return [235, 245, 248, 255];
      return [0, 0, 0, 0];
    }),
  );
  tiles.set("ice", paint("ice", (x, y, rnd) => scale(hex("#91b7fd"), ((x + y) % 7 === 0 ? 1.15 : 1) * jitter(rnd, 0.08))));
  tiles.set("snow", paint("snow", (_x, _y, rnd) => scale(hex("#f2f7f7"), jitter(rnd, 0.06))));
  tiles.set("clay", paint("clay", (_x, _y, rnd) => scale(hex("#9fa4b0"), jitter(rnd, 0.12))));
  tiles.set("obsidian", paint("obsidian", (_x, _y, rnd) => scale(hex(rnd.next() < 0.15 ? "#3b2a52" : "#15121f"), jitter(rnd, 0.3))));
  tiles.set("stone_bricks", stoneBricks("stone bricks", stone));
  tiles.set("mossy_stone_bricks", stoneBricks("mossy stone bricks", stone, "moss"));
  tiles.set("cracked_stone_bricks", stoneBricks("cracked stone bricks", stone, "cracks"));
  tiles.set(
    "crafting_table_top",
    paint("table top", (x, y, rnd) => {
      if (x === 0 || y === 0 || x === 15 || y === 15) return scale(dark, jitter(rnd, 0.1));
      if (x % 5 === 0 || y % 5 === 0) return scale(plank, 0.6);
      return scale(plank, jitter(rnd, 0.12));
    }),
  );
  const tableSide = (seed: string, tool: (x: number, y: number) => boolean): TilePixels =>
    paint(seed, (x, y, rnd) => {
      if (y < 3) return scale(plank, jitter(rnd, 0.1));
      if (tool(x, y)) return scale(hex("#9a9a9a"), jitter(rnd, 0.1));
      return scale(dark, (x % 4 === 0 ? 0.8 : 1) * jitter(rnd, 0.15));
    });
  tiles.set("crafting_table_side", tableSide("table side", (x, y) => x >= 4 && x <= 11 && y === 6 + ((x * 3) % 4)));
  tiles.set("crafting_table_front", tableSide("table front", (x, y) => (x === 4 && y >= 5 && y <= 12) || (y === 5 && x >= 4 && x <= 10)));
  tiles.set("furnace_side", paint("furnace side", (_x, _y, rnd) => scale(stone, jitter(rnd, 0.25))));
  tiles.set("furnace_top", paint("furnace top", (x, y, rnd) => scale(stone, (x === 0 || y === 0 || x === 15 || y === 15 ? 0.7 : 1.1) * jitter(rnd, 0.15))));
  tiles.set(
    "furnace_front",
    paint("furnace front", (x, y, rnd) => {
      if (x >= 4 && x <= 11 && y >= 9 && y <= 13) return [20, 18, 18];
      if (x >= 4 && x <= 11 && y >= 3 && y <= 5) return scale(stone, 0.5);
      return scale(stone, jitter(rnd, 0.25));
    }),
  );
  const books = new Random("books");
  const spines = Array.from({ length: 32 }, () => hex(["#7a2a1a", "#2a4a7a", "#3a6a2a", "#7a6a2a", "#5a2a6a"][Math.floor(books.next() * 5)]));
  tiles.set(
    "bookshelf",
    paint("bookshelf", (x, y, rnd) => {
      if (y < 2 || y > 13 || y === 7 || y === 8) return scale(plank, jitter(rnd, 0.12));
      if (x === 0 || x === 15) return scale(dark, 1);
      const shelf = y < 7 ? 0 : 16;
      return scale(spines[shelf + Math.floor(x / 2)], (x % 2 ? 0.85 : 1) * jitter(rnd, 0.1));
    }),
  );
  tiles.set(
    "ladder",
    paint("ladder", (x, y, rnd) => {
      if (x === 2 || x === 3 || x === 12 || x === 13 || (y % 4 === 1 && x > 3 && x < 12)) return scale(hex("#8a6a3a"), jitter(rnd, 0.15));
      return [0, 0, 0, 0];
    }),
  );
  const doorPaint = (seed: string, window: boolean): TilePixels =>
    paint(seed, (x, y, rnd) => {
      if (window && x >= 3 && x <= 12 && y >= 2 && y <= 7 && x !== 7 && x !== 8) return [0, 0, 0, 0];
      if (x <= 1 || x >= 14 || y <= 1 || y >= 14) return scale(dark, jitter(rnd, 0.1));
      return scale(plank, (x % 4 === 0 ? 0.85 : 1) * jitter(rnd, 0.1));
    });
  tiles.set("oak_door_top", doorPaint("door top", true));
  tiles.set("oak_door_bottom", doorPaint("door bottom", false));
  tiles.set(
    "oak_trapdoor",
    paint("trapdoor", (x, y, rnd) => {
      if ((x === 4 || x === 11) && (y === 4 || y === 11)) return [0, 0, 0, 0];
      if (x <= 1 || x >= 14 || y <= 1 || y >= 14) return scale(dark, jitter(rnd, 0.1));
      return scale(plank, jitter(rnd, 0.12));
    }),
  );
  tiles.set("glass_pane_top", paint("pane top", (_x, _y, rnd) => scale(hex("#d6e8ee"), jitter(rnd, 0.05))));
  const flower = (seed: string, petals: string, center: string): TilePixels =>
    paint(seed, (x, y, rnd) => {
      if ((x === 7 || x === 8) && y >= 8) return scale(hex("#3e8a2a"), jitter(rnd, 0.2));
      if (x === 6 && y === 11) return scale(hex("#4e9a3a"), 1);
      const d = Math.hypot(x - 7.5, y - 5.5);
      if (d < 1.2) return scale(hex(center), 1);
      if (d < 3.2) return scale(hex(petals), jitter(rnd, 0.15));
      return [0, 0, 0, 0];
    });
  tiles.set("dandelion", flower("dandelion", "#f1d42c", "#d8a010"));
  tiles.set("poppy", flower("poppy", "#c8261a", "#2a2010"));
  tiles.set("cornflower", flower("cornflower", "#4a6ad8", "#2a3a8a"));
  tiles.set("oxeye_daisy", flower("oxeye daisy", "#ececdc", "#e8c020"));
  tiles.set("allium", flower("allium", "#b86ad8", "#d090f0"));
  tiles.set("azure_bluet", flower("azure bluet", "#dce4ec", "#e8d870"));
  tiles.set("blue_orchid", flower("blue orchid", "#2aa8d8", "#1a78a8"));
  tiles.set("lily_of_the_valley", flower("lily of the valley", "#f4f4f4", "#d8e8d0"));
  const grassGreen = hex("#5d9b3a");
  tiles.set("short_grass", blades("short grass", grassGreen, 0.7, 14));
  tiles.set("tall_grass_bottom", blades("tall grass bottom", grassGreen, 0.85, 16));
  tiles.set("tall_grass_top", blades("tall grass top", grassGreen, 0.6, 12));
  tiles.set("fern", fern("fern", hex("#5a8f3a"), 3));
  tiles.set("large_fern_bottom", fern("large fern bottom", hex("#5a8f3a"), 0));
  tiles.set("large_fern_top", fern("large fern top", hex("#5a8f3a"), 4));
  tiles.set(
    "dead_bush",
    paint("dead bush", (x, y, rnd) => {
      // Bare twigs fanning out from the foot
      const t = (16 - y) / 12;
      for (const lean of [-0.6, -0.2, 0.25, 0.7]) if (y > 4 && Math.abs(x - (7.5 + lean * (16 - y))) < 0.6 + t * 0.2) return scale(hex("#8a6a3a"), jitter(rnd, 0.25));
      return [0, 0, 0, 0];
    }),
  );
  tiles.set(
    "sugar_cane",
    paint("sugar cane", (x, y, rnd) => {
      // Three stalks with joints
      for (const sx of [2, 7, 12]) {
        if (x === sx || x === sx + 1) return scale(hex("#8ab45a"), ((y + sx) % 6 === 0 ? 0.7 : 1) * jitter(rnd, 0.12));
        if (x === sx + 2 && (y + sx) % 6 === 1) return scale(hex("#9ac46a"), 1);
      }
      return [0, 0, 0, 0];
    }),
  );
  tiles.set(
    "lily_pad",
    paint("lily pad", (x, y, rnd) => {
      // A round leaf with a notch cut toward its middle
      const dx = x - 7.5;
      const dy = y - 7.5;
      if (Math.hypot(dx, dy) > 7.5 || (dy > 0 && Math.abs(dx) < dy * 0.35)) return [0, 0, 0, 0];
      return scale(hex("#2a8a3a"), (Math.abs(dx) < 0.6 || Math.abs(dy) < 0.6 ? 0.8 : 1) * jitter(rnd, 0.2));
    }),
  );
  tiles.set(
    "vine",
    paint("vine", (x, y, rnd) => {
      // Strands wandering down, with leaves along them
      const strand = (x + Math.floor(Math.sin(y * 0.7 + x) * 1.5)) % 5 === 0;
      return strand || rnd.next() < 0.18 ? scale(hex("#3a7a2a"), jitter(rnd, 0.35)) : [0, 0, 0, 0];
    }),
  );
  const pumpkin = hex("#e08a1d");
  tiles.set("pumpkin_side", paint("pumpkin side", (x, _y, rnd) => scale(pumpkin, (x % 4 === 0 ? 0.78 : 1) * jitter(rnd, 0.1))));
  tiles.set(
    "pumpkin_top",
    paint("pumpkin top", (x, y, rnd) => {
      if (Math.abs(x - 7.5) < 1.5 && Math.abs(y - 7.5) < 1.5) return scale(hex("#6a5a2a"), jitter(rnd, 0.2));
      return scale(pumpkin, (Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) % 4 < 1 ? 0.85 : 1) * jitter(rnd, 0.1));
    }),
  );
  tiles.set(
    "oak_sapling",
    paint("sapling", (x, y, rnd) => {
      if (x === 7 && y >= 9) return scale(bark, jitter(rnd, 0.2));
      if (Math.hypot(x - 7, y - 6) < 4.2 && rnd.next() < 0.8) return scale(hex("#3e7a2a"), jitter(rnd, 0.35));
      return [0, 0, 0, 0];
    }),
  );
  const cactus = hex("#5a8a2e");
  tiles.set("cactus_side", paint("cactus side", (x, _y, rnd) => (x === 0 || x === 15 ? [0, 0, 0, 0] : scale(cactus, (x % 4 === 1 ? 0.75 : 1) * (rnd.next() < 0.05 ? 1.5 : 1) * jitter(rnd, 0.12)))));
  tiles.set("cactus_top", paint("cactus top", (x, y, rnd) => (x === 0 || y === 0 || x === 15 || y === 15 ? [0, 0, 0, 0] : scale(cactus, (Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) > 5 ? 0.8 : 1.1) * jitter(rnd, 0.1)))));
  tiles.set("cactus_bottom", paint("cactus bottom", (x, y, rnd) => (x === 0 || y === 0 || x === 15 || y === 15 ? [0, 0, 0, 0] : scale(cactus, 0.85 * jitter(rnd, 0.1)))));
  COLORS.forEach((c, i) => {
    const color = hex(BLOCKS[Block.WhiteWool + i].top);
    tiles.set(`${c}_wool`, paint(`${c} wool`, (x, y, rnd) => scale(color, ((x + y) % 2 ? 0.94 : 1.04) * jitter(rnd, 0.06))));
  });
  // The grass on a grass block's side, to lay over it tinted, and its snowy side
  const side = tiles.get("grass_block_side")!;
  tiles.set("grass_block_side_overlay", paint("grass side", (x, y) => (y < depth[x] ? [side[(y * TILE + x) * 4], side[(y * TILE + x) * 4 + 1], side[(y * TILE + x) * 4 + 2], 255] : [0, 0, 0, 0])));
  tiles.set("grass_block_snow", paint("snowy side", (x, y, rnd) => (y < depth[x] + 1 ? scale(hex("#f2f7f7"), jitter(rnd, 0.06)) : scale(dirt, jitter(rnd, 0.35)))));
  for (const [name, kind] of Object.entries(TINTED)) {
    const tile = tiles.get(name);
    if (tile) tiles.set(name, untint(tile, tintColor(kind, Biome.Plains)));
  }
  tiles.set("furnace_front_on", furnaceOn(tiles.get("furnace_front")!));
  for (const [name, tile] of [...chestTiles(), ...itemTiles(), ...destroyStages(), ...bedTiles(), ...plantTiles(), ...orbTiles(), ...particleTiles(), ...farmTiles(), ...redstoneTiles()]) tiles.set(name, tile);
  for (const name of TILES) if (!tiles.has(name)) throw new Error(`No procedural texture for ${name}`);
  return tiles;
}

/** Craft's own frames of the moving textures (ANIMATED): rippling water, churning lava. Each loops seamlessly. */
export function animatedFrames(): Map<TileName, TilePixels[]> {
  const out = new Map<TileName, TilePixels[]>();
  const loop = (name: string, color: (x: number, y: number, t: number) => [number, number, number]): void => {
    const n = ANIMATED[name].frames;
    out.set(
      name,
      Array.from({ length: n }, (_, f) => paint(name, (x, y) => color(x, y, (f / n) * Math.PI * 2))),
    );
  };
  const tau = Math.PI * 2;
  loop("water_still", (x, y, t) => {
    const wave = Math.sin((x / 16) * tau * 2 + t) * Math.cos((y / 16) * tau + t) * 0.5 + Math.sin(((x + y) / 16) * tau - t) * 0.5;
    return scale(hex("#3d6fdc"), 1 + wave * 0.1);
  });
  // Water is colored by the biome
  const water = tintColor(Tint.Water, Biome.Plains);
  out.set("water_still", out.get("water_still")!.map((f) => untint(f, water)));
  loop("lava_still", (x, y, t) => {
    const heat = (Math.sin((x / 16) * tau * 2 + t) * Math.sin((y / 16) * tau * 2 - t) + Math.cos(((x - y) / 16) * tau + t)) / 2;
    const k = Math.max(0, heat);
    return [212 + 43 * k, 96 + 110 * k, 14 + 40 * k];
  });
  return out;
}

/** A copy of a tile painted in a tint's colors with the tint taken out, for the mesh to put back by biome. */
function untint(tile: TilePixels, color: Rgb): TilePixels {
  const out = new Uint8ClampedArray(tile);
  for (let i = 0; i < out.length; i += 4) {
    for (let c = 0; c < 3; c++) out[i + c] = (out[i + c] * 255) / Math.max(1, color[c]);
  }
  return out;
}

/** A copy of the tile with its colors multiplied by a tint. */
export function tint(tile: TilePixels, color: Rgb): TilePixels {
  const out = new Uint8ClampedArray(tile);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = (out[i] * color[0]) / 255;
    out[i + 1] = (out[i + 1] * color[1]) / 255;
    out[i + 2] = (out[i + 2] * color[2]) / 255;
  }
  return out;
}

/** A copy of `base` with `top` drawn over it (alpha blended). */
export function overlay(base: TilePixels, top: TilePixels): TilePixels {
  const out = new Uint8ClampedArray(base);
  for (let i = 0; i < out.length; i += 4) {
    const a = top[i + 3] / 255;
    for (let c = 0; c < 3; c++) out[i + c] = top[i + c] * a + out[i + c] * (1 - a);
  }
  return out;
}

/**
 * Turns Minecraft's texture files into Craft's tiles: as they are (gray where the biome colors them, as
 * Craft's mesh does), but water made opaque (its material is translucent already). `files` maps file
 * names (without .png) to their first 16 x 16 frame.
 */
export function minecraftTiles(files: ReadonlyMap<string, TilePixels>): Map<TileName, TilePixels> {
  const tiles = new Map<TileName, TilePixels>();
  for (const name of TILES) {
    let tile = files.get(name);
    if (!tile) continue;
    if (name === "water_still") tile = waterTile(tile);
    // Leather armor is gray to be dyed; undyed, it is leather brown
    if (/^item_leather_(helmet|chestplate|leggings|boots)$/.test(name)) tile = tint(tile, hex("#a06540"));
    tiles.set(name, tile);
  }
  return tiles;
}

/** Minecraft's water made opaque (its material is translucent already). */
function waterTile(tile: TilePixels): TilePixels {
  const out = new Uint8ClampedArray(tile);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return out;
}

/** Where `npm run textures` puts the textures it imports (not part of builds). */
const IMPORTED = "textures/minecraft/";

/** Minecraft's phases of the moon, in the order they come: full the first night, then waning. */
export const MOON_PHASES = ["full_moon", "waning_gibbous", "third_quarter", "waning_crescent", "new_moon", "waxing_crescent", "first_quarter", "waxing_gibbous"] as const;

/** Images for the sky from Minecraft (any of them may be missing; Craft draws its own then). */
export interface SkyImages {
  sun: ImageBitmap | null;
  /** One per phase (MOON_PHASES order), or null. */
  moon: ImageBitmap[] | null;
  clouds: ImageBitmap | null;
  /** Rain and snow falling (environment/rain.png, snow.png). */
  rain: ImageBitmap | null;
  snow: ImageBitmap | null;
}

/**
 * The textures imported from Minecraft by `npm run textures`: block tiles (with procedural ones for any it
 * didn't have), the sky's images, the status bar's (hud_*) and the mobs' (mob_*) by name, and the version they came from. Null
 * when nothing was imported (or in a build, which leaves them out).
 */
export async function importedTextures(): Promise<{
  tiles: Map<TileName, TilePixels>;
  frames: Map<TileName, TilePixels[]>;
  sky: SkyImages;
  hud: Map<string, ImageBitmap>;
  mobs: Map<string, ImageBitmap>;
  version: string;
} | null> {
  let manifest: { version: string; textures: string[] };
  try {
    const response = await fetch(`${IMPORTED}manifest.json`);
    if (!response.ok) return null;
    manifest = await response.json();
  } catch {
    return null;
  }
  const images = new Map<string, ImageBitmap>();
  await Promise.all(
    manifest.textures.map(async (name) => {
      const response = await fetch(`${IMPORTED}${name}.png`);
      if (response.ok) images.set(name, await createImageBitmap(await response.blob()));
    }),
  );
  const files = new Map<string, TilePixels>();
  for (const [name, image] of images) if (!/^(sun|clouds|moon|chest_entity|experience_orb|hud_|mob_|weather_)/.test(name)) files.set(name, firstFrame(image));
  const tiles = proceduralTiles();
  for (const [name, tile] of minecraftTiles(files)) tiles.set(name, tile);
  // The chest's faces come out of its model's texture, and the orbs out of their sheet, at their own size
  const sheet = (image: ImageBitmap): Uint8ClampedArray => {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const g = canvas.getContext("2d")!;
    g.drawImage(image, 0, 0);
    return g.getImageData(0, 0, image.width, image.height).data;
  };
  const chest = images.get("chest_entity");
  if (chest) for (const [name, tile] of chestFromSheet(sheet(chest), chest.width)) tiles.set(name, tile);
  const orbs = images.get("experience_orb");
  if (orbs) for (const [name, tile] of orbsFromSheet(sheet(orbs), orbs.width)) tiles.set(name, tile);
  // The moving ones come as strips of frames, top to bottom
  const frames = animatedFrames();
  for (const name of Object.keys(ANIMATED)) {
    const image = images.get(name);
    if (!image) continue;
    const strip = Array.from({ length: Math.max(1, Math.floor(image.height / image.width)) }, (_, i) => frameAt(image, i));
    frames.set(name, name === "water_still" ? strip.map(waterTile) : strip);
  }
  const phases = MOON_PHASES.map((p) => images.get(`moon_${p}`));
  const moons = images.get("moon_phases");
  return {
    tiles,
    frames,
    sky: {
      sun: images.get("sun") ?? null,
      moon: phases.every((p) => p) ? (phases as ImageBitmap[]) : moons ? await moonSheet(moons) : null,
      clouds: images.get("clouds") ?? null,
      rain: images.get("weather_rain") ?? null,
      snow: images.get("weather_snow") ?? null,
    },
    hud: new Map([...images].filter(([name]) => name.startsWith("hud_"))),
    mobs: new Map([...images].filter(([name]) => name.startsWith("mob_"))),
    version: manifest.version,
  };
}

/** The phases from the moon sheet of older Minecraft versions: 4 x 2, in phase order. */
function moonSheet(sheet: ImageBitmap): Promise<ImageBitmap[]> {
  const w = sheet.width / 4;
  const h = sheet.height / 2;
  return Promise.all(MOON_PHASES.map((_, i) => createImageBitmap(sheet, (i % 4) * w, Math.floor(i / 4) * h, w, h)));
}

/** Frame i of an image's strip of square frames, scaled to a tile. */
function frameAt(image: ImageBitmap, i: number): TilePixels {
  const canvas = new OffscreenCanvas(TILE, TILE);
  const g = canvas.getContext("2d")!;
  // Resource packs with larger textures are averaged down; 16 pixel ones are copied as they are
  g.imageSmoothingEnabled = image.width > TILE;
  g.drawImage(image, 0, i * image.width, image.width, image.width, 0, 0, TILE, TILE);
  return g.getImageData(0, 0, TILE, TILE).data;
}

/** The top square of an image (the first frame of an animation strip), scaled to a tile. */
function firstFrame(image: ImageBitmap): TilePixels {
  return frameAt(image, 0);
}

/** Every tile in one atlas (slot i holds TILES[i]), and each tile's rectangle in it (u0, v0, u1, v1 at i * 4). */
export function blockAtlas(tiles: ReadonlyMap<TileName, TilePixels>): { atlas: Atlas; uvs: TileUVs } {
  const atlas = new Atlas(TILES.length);
  const uvs = new Float32Array(TILES.length * 4);
  TILES.forEach((name, i) => {
    const tile = tiles.get(name);
    if (!tile) throw new Error(`Missing texture ${name}`);
    atlas.put(i, tile);
    uvs.set(atlas.rect(i), i * 4);
  });
  return { atlas, uvs };
}

/**
 * The atlas as a texture: crisp pixels up close, mipmaps against shimmering in the distance. Moving
 * textures get their frames drawn in as time passes (animate).
 */
export class AtlasTexture {
  readonly texture: Texture;
  private readonly atlas: Atlas;
  private readonly canvas: HTMLCanvasElement;
  private readonly frames: ReadonlyMap<number, TilePixels[]>;
  private readonly shown: Map<number, number> = new Map();

  /** `frames`: the frames of the moving textures, by name. */
  constructor(atlas: Atlas, frames: ReadonlyMap<TileName, TilePixels[]> = new Map()) {
    this.atlas = atlas;
    this.canvas = document.createElement("canvas");
    this.canvas.width = atlas.width;
    this.canvas.height = atlas.height;
    this.canvas.getContext("2d")!.putImageData(new ImageData(atlas.pixels, atlas.width, atlas.height), 0, 0);
    this.texture = new Texture(this.canvas, { filter: "nearest", wrap: "clamp" });
    this.frames = new Map([...frames].map(([name, list]) => [TILES.indexOf(name), list]));
  }

  /** Shows the frames of the moving textures for a moment, in seconds. */
  animate(seconds: number): void {
    let changed = false;
    for (const [i, list] of this.frames) {
      const frame = Math.floor(seconds * ANIMATED[TILES[i]].fps) % list.length;
      if (this.shown.get(i) === frame) continue;
      this.shown.set(i, frame);
      this.atlas.put(i, list[frame]);
      const [x, y, w, h] = this.atlas.cell(i);
      const region = new ImageData(w, h);
      for (let row = 0; row < h; row++) region.data.set(this.atlas.pixels.subarray(((y + row) * this.atlas.width + x) * 4, ((y + row) * this.atlas.width + x + w) * 4), row * w * 4);
      this.canvas.getContext("2d")!.putImageData(region, x, y);
      changed = true;
    }
    if (changed) this.texture.markDirty();
  }
}

/** A tile as an image URL, for the hotbar. */
export function tileImage(tile: TilePixels): string {
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  canvas.getContext("2d")!.putImageData(new ImageData(tile, TILE, TILE), 0, 0);
  return canvas.toDataURL();
}

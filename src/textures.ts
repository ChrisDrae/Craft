import { Random, Texture } from "projector";
import { Atlas, TILE, type TilePixels } from "./atlas.js";
import { Block, FACE_LOOK, Face, STATE_COUNT, blockOf } from "./blocks.js";
import type { FaceUVs } from "./chunkMesh.js";

/** The textures Craft uses, named after Minecraft's block texture files. */
export const TILES = [
  "grass_block_top",
  "grass_block_side",
  "dirt",
  "stone",
  "sand",
  "water_still",
  "oak_log",
  "oak_log_top",
  "oak_leaves",
  "oak_planks",
  "cobblestone",
  "bricks",
  "coal_ore",
  "iron_ore",
  "gold_ore",
  "bedrock",
] as const;
export type TileName = (typeof TILES)[number];

/** The texture on a block state's face in direction `dir` (Dir). */
export function tileFor(state: number, dir: number): TileName {
  const look = FACE_LOOK[state * 6 + dir];
  const top = look === Face.Top;
  const bottom = look === Face.Bottom;
  switch (blockOf(state)) {
    case Block.Grass:
      return top ? "grass_block_top" : bottom ? "dirt" : "grass_block_side";
    case Block.Dirt:
      return "dirt";
    case Block.Sand:
      return "sand";
    case Block.Water:
      return "water_still";
    case Block.Log:
      return top || bottom ? "oak_log_top" : "oak_log";
    case Block.Leaves:
      return "oak_leaves";
    case Block.Planks:
      return "oak_planks";
    case Block.Cobblestone:
      return "cobblestone";
    case Block.Bricks:
      return "bricks";
    case Block.CoalOre:
      return "coal_ore";
    case Block.IronOre:
      return "iron_ore";
    case Block.GoldOre:
      return "gold_ore";
    case Block.Bedrock:
      return "bedrock";
    default:
      return "stone";
  }
}

type Rgb = [number, number, number];

function hex(css: string): Rgb {
  const n = parseInt(css.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A tile painted pixel by pixel: `paint` returns the color (and alpha) of (x, y). */
function paint(seed: string, color: (x: number, y: number, rnd: Random) => [number, number, number, number?]): TilePixels {
  const rnd = new Random(seed);
  const out = new Uint8ClampedArray(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const [r, g, b, a = 255] = color(x, y, rnd);
      const o = (y * TILE + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return out;
}

/** The color brightened or darkened by a factor. */
function scale(c: Rgb, k: number): [number, number, number] {
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** Random brightness around 1, spread `amount`. */
function jitter(rnd: Random, amount: number): number {
  return 1 + (rnd.next() - 0.5) * amount;
}

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
  tiles.set("oak_log", paint("log", (x, _y, rnd) => scale(bark, (x % 4 === 0 ? 0.75 : 1) * jitter(rnd, 0.25))));
  tiles.set(
    "oak_log_top",
    paint("log top", (x, y, rnd) => {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (d > 6.5) return scale(bark, jitter(rnd, 0.2));
      return scale(wood, (Math.floor(d) % 2 === 0 ? 1 : 0.85) * jitter(rnd, 0.08));
    }),
  );
  tiles.set(
    "oak_leaves",
    paint("leaves", (_x, _y, rnd) => {
      // Holes to see through, cut out by the material's alphaTest
      if (rnd.next() < 0.16) return [0, 0, 0, 0];
      return scale(hex("#3e8a2a"), jitter(rnd, 0.45));
    }),
  );
  const seams = new Random("planks");
  const offsets = [0, 1, 2, 3].map(() => Math.floor(seams.next() * 16));
  tiles.set(
    "oak_planks",
    paint("planks", (x, y, rnd) => {
      const board = Math.floor(y / 4);
      if (y % 4 === 3 || x === offsets[board]) return scale(hex("#b38d55"), 0.68);
      return scale(hex("#b38d55"), jitter(rnd, 0.12));
    }),
  );
  const stones = new Random("cobble");
  const centers = Array.from({ length: 9 }, () => [stones.next() * 16, stones.next() * 16, 0.75 + stones.next() * 0.4]);
  tiles.set(
    "cobblestone",
    paint("cobblestone", (x, y, rnd) => {
      // Rounded stones, with dark mortar where two are equally close
      let a = Infinity;
      let b = Infinity;
      let shade = 1;
      for (const [cx, cy, k] of centers) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < a) {
          b = a;
          a = d;
          shade = k;
        } else if (d < b) {
          b = d;
        }
      }
      return b - a < 1 ? scale(stone, 0.5) : scale(stone, shade * jitter(rnd, 0.15));
    }),
  );
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
  tiles.set("bedrock", paint("bedrock", (_x, _y, rnd) => scale(hex("#55525a"), rnd.next() < 0.3 ? 0.45 : jitter(rnd, 0.6))));
  return tiles;
}

/** Plains biome colors, which Minecraft multiplies into its grayscale grass, leaf and water textures. */
const GRASS_TINT = hex("#91bd59");
const FOLIAGE_TINT = hex("#77ab2f");
const WATER_TINT = hex("#3f76e4");

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
 * Turns Minecraft's texture files into Craft's tiles: grass, leaves and water tinted like a plains
 * biome, the grass overlay laid onto the grass side, and water made opaque (its material is translucent
 * already). `files` maps file names (without .png) to their first 16 x 16 frame.
 */
export function minecraftTiles(files: ReadonlyMap<string, TilePixels>): Map<TileName, TilePixels> {
  const tiles = new Map<TileName, TilePixels>();
  for (const name of TILES) {
    let tile = files.get(name);
    if (!tile) continue;
    if (name === "grass_block_top") tile = tint(tile, GRASS_TINT);
    if (name === "oak_leaves") tile = tint(tile, FOLIAGE_TINT);
    if (name === "water_still") {
      tile = tint(tile, WATER_TINT);
      for (let i = 3; i < tile.length; i += 4) tile[i] = 255;
    }
    const fringe = files.get("grass_block_side_overlay");
    if (name === "grass_block_side" && fringe) tile = overlay(tile, tint(fringe, GRASS_TINT));
    tiles.set(name, tile);
  }
  return tiles;
}

/** Where `npm run textures` puts the textures it imports (not part of builds). */
const IMPORTED = "textures/minecraft/";

/**
 * The textures imported from Minecraft by `npm run textures`, with procedural ones for any it didn't
 * have, and the version they came from. Null when nothing was imported (or in a build, which leaves
 * them out).
 */
export async function importedTiles(): Promise<{ tiles: Map<TileName, TilePixels>; version: string } | null> {
  let manifest: { version: string; textures: string[] };
  try {
    const response = await fetch(`${IMPORTED}manifest.json`);
    if (!response.ok) return null;
    manifest = await response.json();
  } catch {
    return null;
  }
  const files = new Map<string, TilePixels>();
  await Promise.all(
    manifest.textures.map(async (name) => {
      const response = await fetch(`${IMPORTED}${name}.png`);
      if (response.ok) files.set(name, firstFrame(await createImageBitmap(await response.blob())));
    }),
  );
  const tiles = proceduralTiles();
  for (const [name, tile] of minecraftTiles(files)) tiles.set(name, tile);
  return { tiles, version: manifest.version };
}

/** The top square of an image (the first frame of an animation strip), scaled to a tile. */
function firstFrame(image: ImageBitmap): TilePixels {
  const canvas = new OffscreenCanvas(TILE, TILE);
  const g = canvas.getContext("2d")!;
  // Resource packs with larger textures are averaged down; 16 pixel ones are copied as they are
  g.imageSmoothingEnabled = image.width > TILE;
  g.drawImage(image, 0, 0, image.width, image.width, 0, 0, TILE, TILE);
  return g.getImageData(0, 0, TILE, TILE).data;
}

/** Every tile in one atlas (slot i holds TILES[i]), and where each block state's faces find their tile in it. */
export function blockAtlas(tiles: ReadonlyMap<TileName, TilePixels>): { atlas: Atlas; uvs: FaceUVs } {
  const atlas = new Atlas(TILES.length);
  TILES.forEach((name, i) => {
    const tile = tiles.get(name);
    if (!tile) throw new Error(`Missing texture ${name}`);
    atlas.put(i, tile);
  });
  const uvs = new Float32Array(STATE_COUNT * 6 * 4);
  for (let state = 0; state < STATE_COUNT; state++) {
    for (let dir = 0; dir < 6; dir++) uvs.set(atlas.rect(TILES.indexOf(tileFor(state, dir))), (state * 6 + dir) * 4);
  }
  return { atlas, uvs };
}

/** The atlas as a texture: crisp pixels up close, mipmaps against shimmering in the distance. */
export function atlasTexture(atlas: Atlas): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = atlas.width;
  canvas.height = atlas.height;
  canvas.getContext("2d")!.putImageData(new ImageData(atlas.pixels, atlas.width, atlas.height), 0, 0);
  return new Texture(canvas, { filter: "nearest", wrap: "clamp" });
}

/** A tile as an image URL, for the hotbar. */
export function tileImage(tile: TilePixels): string {
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  canvas.getContext("2d")!.putImageData(new ImageData(tile, TILE, TILE), 0, 0);
  return canvas.toDataURL();
}

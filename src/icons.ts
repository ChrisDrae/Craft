import type { TilePixels } from "./atlas.js";
import { Biome, tintColor } from "./biomes.js";
import { BLOCKS, Block, Face, Tint } from "./blocks.js";
import { ITEMS, type Item } from "./items.js";
import { overlay, tint } from "./textures.js";

/** Pixels of an icon, square: enough for a 44 pixel slot on a sharp screen. */
const SIZE = 48;

/** How high each block shape stands in its icon (cubes are 1); shapes not listed are drawn flat. */
const HEIGHTS: Readonly<Record<string, number>> = { cube: 1, cactus: 1, stairs: 1, chest: 14 / 16, slab: 0.5, snow: 2 / 16, carpet: 1 / 16 };

/**
 * Item icons for the hotbar and inventory screens: blocks as small cubes seen from above at an angle,
 * their top, left and right faces from their own textures (tinted as in plains, shaded like the world's
 * faces); plants, torches, doors and the like, and items that aren't blocks, as their flat texture.
 * Without textures (Canvas 2D) there are none, and colors stand in.
 */
export class Icons {
  private readonly cache: Map<Item, string> = new Map();
  private readonly images: Map<TilePixels, HTMLCanvasElement> = new Map();

  constructor(private readonly tiles: ReadonlyMap<string, TilePixels> | null) {}

  /** A CSS background for an item's icon, or null where colors must stand in. */
  background(item: Item): string | null {
    if (!this.tiles) return null;
    let url = this.cache.get(item);
    if (!url) {
      url = this.draw(item);
      this.cache.set(item, url);
    }
    return `url(${url}) center / contain no-repeat`;
  }

  /** The texture of a block's face as its icon shows it: tinted as in plains, grass sides with their grass. */
  private face(block: Block, look: number): TilePixels | null {
    const info = BLOCKS[block];
    const tiles = this.tiles!;
    const tile = tiles.get(info.textures[look]);
    if (!tile) return null;
    if (block === Block.Grass) {
      if (look === Face.Top) return tint(tile, tintColor(Tint.Grass, Biome.Plains));
      const fringe = tiles.get("grass_block_side_overlay");
      return look === Face.Bottom || !fringe ? tile : overlay(tile, tint(fringe, tintColor(Tint.Grass, Biome.Plains)));
    }
    return info.tint === Tint.None ? tile : tint(tile, tintColor(info.tint, Biome.Plains));
  }

  private image(tile: TilePixels): HTMLCanvasElement {
    let canvas = this.images.get(tile);
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = canvas.height = 16;
      canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(tile), 16, 16), 0, 0);
      this.images.set(tile, canvas);
    }
    return canvas;
  }

  private draw(item: Item): string {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    const g = canvas.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    const info = ITEMS[item];
    const block = info.block;
    const height = block !== null ? HEIGHTS[BLOCKS[block].shape] : undefined;
    if (block !== null && height !== undefined) {
      this.cube(g, block, height);
    } else {
      // Flat: the item's texture, or the block's (a plant's, a door's, the top of tall grass)
      const look = block !== null && BLOCKS[block].shape === "tall" ? Face.Top : Face.Side;
      const tile = block !== null ? this.face(block, look) : this.tiles!.get(`item_${info.texture}`);
      if (tile) g.drawImage(this.image(tile), 4, 4, SIZE - 8, SIZE - 8);
    }
    return canvas.toDataURL();
  }

  /**
   * A block as a cube from above: the top a rhombus, the two sides below it, `height` of a block high
   * (slabs and carpets lower). The left side is shaded like the world's sides, the right one darker.
   */
  private cube(g: CanvasRenderingContext2D, block: Block, height: number): void {
    // Corners: the top's left, back, right and front; the sides go `h` pixels down from them
    const w = 21;
    const half = 11;
    const full = 22;
    const h = full * height;
    const dy = full - h;
    const left = { x: 3, y: 13 + dy };
    const front = { x: 3 + w, y: 13 + dy + half };
    const faces: Array<[number, number, () => void]> = [
      // Top: u toward the back corner, v toward the front one
      [Face.Top, 1, () => g.setTransform(w / 16, -half / 16, w / 16, half / 16, left.x, left.y)],
      [Face.Side, 0.8, () => g.setTransform(w / 16, half / 16, 0, h / 16, left.x, left.y)],
      [Face.Side, 0.6, () => g.setTransform(w / 16, -half / 16, 0, h / 16, front.x, front.y)],
    ];
    for (const [look, shade, place] of faces) {
      const tile = this.face(block, block === Block.Chest && shade === 0.8 ? Face.Front : look);
      if (!tile) continue;
      place();
      g.filter = `brightness(${shade})`;
      // Sides show their lower part when the block is less than a block high
      if (look === Face.Top) g.drawImage(this.image(tile), 0, 0);
      else g.drawImage(this.image(tile), 0, 16 * (1 - height), 16, 16 * height, 0, 0, 16, 16);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.filter = "none";
  }
}

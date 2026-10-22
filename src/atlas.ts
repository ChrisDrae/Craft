/** Edge length of a block texture in pixels. */
export const TILE = 16;
/**
 * Pixels of repeated edge around each tile. Mipmaps average neighboring pixels, so without them distant
 * blocks would bleed the colors of the tiles next to theirs in the atlas.
 */
export const GUTTER = 4;
const CELL = TILE + 2 * GUTTER;

/** 16 x 16 RGBA pixels, row by row from the top. */
export type TilePixels = Uint8ClampedArray<ArrayBuffer>;

/** Block textures packed into one image (RGBA pixels), each with a gutter of its own edge pixels. */
export class Atlas {
  readonly columns: number;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;

  constructor(tiles: number) {
    this.columns = Math.ceil(Math.sqrt(tiles));
    const rows = Math.ceil(tiles / this.columns);
    this.width = this.columns * CELL;
    this.height = rows * CELL;
    this.pixels = new Uint8ClampedArray(this.width * this.height * 4);
  }

  /** Copies a tile into slot `i`, repeating its edge pixels into the gutter around it. */
  put(i: number, tile: TilePixels): void {
    const ox = (i % this.columns) * CELL;
    const oy = Math.floor(i / this.columns) * CELL;
    for (let y = 0; y < CELL; y++) {
      const ty = Math.min(TILE - 1, Math.max(0, y - GUTTER));
      for (let x = 0; x < CELL; x++) {
        const tx = Math.min(TILE - 1, Math.max(0, x - GUTTER));
        const s = (ty * TILE + tx) * 4;
        const d = ((oy + y) * this.width + ox + x) * 4;
        this.pixels[d] = tile[s];
        this.pixels[d + 1] = tile[s + 1];
        this.pixels[d + 2] = tile[s + 2];
        this.pixels[d + 3] = tile[s + 3];
      }
    }
  }

  /** Slot i's cell in pixels, gutter included: x, y, width, height. */
  cell(i: number): [number, number, number, number] {
    return [(i % this.columns) * CELL, Math.floor(i / this.columns) * CELL, CELL, CELL];
  }

  /** Texture coordinates of slot i's tile: u0, v0 (top left), u1, v1 (bottom right). */
  rect(i: number): Float32Array {
    const x = (i % this.columns) * CELL + GUTTER;
    const y = Math.floor(i / this.columns) * CELL + GUTTER;
    return Float32Array.of(x / this.width, y / this.height, (x + TILE) / this.width, (y + TILE) / this.height);
  }
}

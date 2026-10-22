import { Random } from "projector";
import { TILE, type TilePixels } from "./atlas.js";

/** Painting 16 x 16 tiles pixel by pixel, for the textures Craft draws itself. */

export type Rgb = readonly [number, number, number];

export function hex(css: string): Rgb {
  const n = parseInt(css.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A tile painted pixel by pixel: `paint` returns the color (and alpha) of (x, y). */
export function paint(seed: string, color: (x: number, y: number, rnd: Random) => [number, number, number, number?]): TilePixels {
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
export function scale(c: Rgb, k: number): [number, number, number] {
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** Random brightness around 1, spread `amount`. */
export function jitter(rnd: Random, amount: number): number {
  return 1 + (rnd.next() - 0.5) * amount;
}


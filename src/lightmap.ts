import { Texture } from "projector";

/** Light levels per channel: 0-15. */
const LEVELS = 16;

/** How bright a light level looks, as Minecraft's curve: full at 15, falling off faster toward the dark. */
export function levelBrightness(level: number): number {
  const f = level / 15;
  return f / (4 - 3 * f);
}

/**
 * The color light of each block level (0-15) and sky level (0-15) gives at a moment of the day, at
 * ((sky * 16 + block) * 3): sky light scaled by `daylight` (0 at night, where moonlight is a tenth of the
 * day's and bluish, to 1), block light warm like a torch's, a little ambient light so caves aren't pure
 * black, then brightened like Minecraft's default brightness setting.
 */
export function lightMapColors(daylight: number, out: Float32Array = new Float32Array(LEVELS * LEVELS * 3)): Float32Array {
  const skyScale = 0.1 + 0.9 * daylight;
  const tintR = 0.6 + 0.4 * daylight;
  const tintG = 0.65 + 0.35 * daylight;
  for (let s = 0; s < LEVELS; s++) {
    const sky = levelBrightness(s) * skyScale;
    for (let b = 0; b < LEVELS; b++) {
      const block = levelBrightness(b);
      const rgb = [sky * tintR + block, sky * tintG + block * ((block * 0.6 + 0.4) * 0.6 + 0.4), sky + block * (block * block * 0.6 + 0.4)];
      const o = (s * LEVELS + b) * 3;
      for (let c = 0; c < 3; c++) {
        const v = Math.min(1, rgb[c]) * 0.96 + 0.03;
        out[o + c] = (v + (1 - (1 - v) ** 4)) / 2;
      }
    }
  }
  return out;
}

/**
 * The light map the terrain's material looks its light up in (Material.lightMap): a 16 x 16 texture with
 * block light along x and sky light along y, redrawn as the day goes by. Also kept as numbers, for what
 * draws without it (the Canvas 2D renderer, fog).
 */
export class LightMap {
  /** See lightMapColors. */
  readonly colors: Float32Array = new Float32Array(LEVELS * LEVELS * 3);
  readonly texture: Texture;
  private readonly canvas: HTMLCanvasElement;
  private readonly image: ImageData;
  private daylight: number = -1;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = LEVELS;
    this.image = new ImageData(LEVELS, LEVELS);
    // Blended between levels, so light across a face changes smoothly
    this.texture = new Texture(this.canvas, { filter: "linear", mipmaps: false, wrap: "clamp" });
    this.update(1);
  }

  /** Redraws the map for the daylight (0-1), if it changed enough to see. */
  update(daylight: number): void {
    if (Math.abs(daylight - this.daylight) < 0.002) return;
    this.daylight = daylight;
    lightMapColors(daylight, this.colors);
    const px = this.image.data;
    for (let i = 0; i < LEVELS * LEVELS; i++) {
      px[i * 4] = this.colors[i * 3] * 255;
      px[i * 4 + 1] = this.colors[i * 3 + 1] * 255;
      px[i * 4 + 2] = this.colors[i * 3 + 2] * 255;
      px[i * 4 + 3] = 255;
    }
    this.canvas.getContext("2d")!.putImageData(this.image, 0, 0);
    this.texture.markDirty();
  }

  /** The light's brightness (0-1) for packed light (sky * 16 + block). */
  brightness(light: number): number {
    const o = light * 3;
    return 0.3 * this.colors[o] + 0.59 * this.colors[o + 1] + 0.11 * this.colors[o + 2];
  }
}

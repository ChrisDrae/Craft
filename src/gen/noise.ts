import { PerlinNoise } from "projector";

/**
 * Fractal noise from independent Perlin layers (each with a permutation of its own, as Minecraft's octaves
 * are), each twice the frequency and half the weight of the last. Values come out in about [-1, 1], mostly
 * within ±0.5; `spread` scales them so thresholds can be set on a wider range.
 */
export class Octaves {
  private readonly layers: PerlinNoise[];
  private readonly offsets: number[];
  private readonly norm: number;

  constructor(
    seed: string,
    octaves: number,
    private readonly frequency: number,
    spread: number = 1,
  ) {
    this.layers = Array.from({ length: octaves }, (_, i) => new PerlinNoise(`${seed}/${i}`));
    // Off the lattice, where Perlin noise is always 0
    this.offsets = this.layers.map((_, i) => 0.31 + i * 0.173);
    let n = 0;
    for (let i = 0; i < octaves; i++) n += 0.5 ** i;
    this.norm = spread / n;
  }

  at2(x: number, z: number): number {
    let sum = 0;
    let f = this.frequency;
    let a = 1;
    for (let i = 0; i < this.layers.length; i++) {
      const o = this.offsets[i];
      sum += this.layers[i].noise2D(x * f + o, z * f + o) * a;
      f *= 2;
      a *= 0.5;
    }
    return sum * this.norm;
  }

  /** 3D, with the vertical frequency `squash` times the horizontal one. */
  at3(x: number, y: number, z: number, squash: number = 1): number {
    let sum = 0;
    let f = this.frequency;
    let a = 1;
    for (let i = 0; i < this.layers.length; i++) {
      const o = this.offsets[i];
      sum += this.layers[i].noise3D(x * f + o, y * f * squash + o, z * f + o) * a;
      f *= 2;
      a *= 0.5;
    }
    return sum * this.norm;
  }
}

/** A seed as a 32-bit integer, for the hashes. */
export function seedNumber(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

/** A deterministic number in [0, 1) for a column and a seed. */
export function hash2(x: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A deterministic number in [0, 1) for a block and a seed. */
export function hash3(x: number, y: number, z: number, seed: number): number {
  return hash2(x ^ Math.imul(y, 1442695041), z, seed);
}

/** A small seeded generator for features that need a run of numbers (a tree's shape, an ore vein). */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed | 0;
  }

  /** A number in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer from lo to hi, both included. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** 0 below a, 1 above b, smooth between. */
export function smoothstep(a: number, b: number, v: number): number {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

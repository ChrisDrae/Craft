import { Octaves } from "./noise.js";

/** Below this, caves fill with lava instead of air. */
export const LAVA_LEVEL = 10;

/**
 * Minecraft's noise caves, simplified: "cheese" caverns where one noise is high, "spaghetti" tunnels where
 * two noises are both near zero (the line where two surfaces cross), and ravines, tall narrow cuts along
 * the ridges of a 2D noise. All are functions of the position alone, so caves meet across chunk borders.
 */
export class Caves {
  private readonly cheese: Octaves;
  private readonly tunnelA: Octaves;
  private readonly tunnelB: Octaves;
  private readonly entrances: Octaves;
  private readonly ravine: Octaves;
  private readonly ravineMask: Octaves;
  private readonly ravineDepth: Octaves;

  constructor(seed: string) {
    this.cheese = new Octaves(`${seed}/cheese`, 2, 1 / 70, 4);
    this.tunnelA = new Octaves(`${seed}/tunnel a`, 1, 1 / 52, 4);
    this.tunnelB = new Octaves(`${seed}/tunnel b`, 1, 1 / 52, 4);
    this.entrances = new Octaves(`${seed}/entrances`, 2, 1 / 160, 2.5);
    this.ravine = new Octaves(`${seed}/ravine`, 2, 1 / 220, 2.5);
    this.ravineMask = new Octaves(`${seed}/ravine mask`, 2, 1 / 500, 2.5);
    this.ravineDepth = new Octaves(`${seed}/ravine depth`, 1, 1 / 300, 2.5);
  }

  /**
   * Where caves are, as a value interpolated between points 4 blocks apart: below 0 is cave. `height` is
   * the land's height there (before 3D noise): caverns stay well below it, tunnels only reach it where
   * the entrance noise lets them open to the surface.
   */
  value(x: number, y: number, z: number, height: number): number {
    if (y < 1) return 1;
    // Caverns, rarer toward the surface
    const cheese = 0.92 + Math.max(0, y - (height - 24)) * 0.04 - this.cheese.at3(x, y, z, 1.5);
    // Tunnels: thinner deep down, closed near the surface except at entrances
    const a = this.tunnelA.at3(x, y, z, 1.7);
    const b = this.tunnelB.at3(x + 1000, y, z, 1.7);
    let radius = 0.15 + Math.min(0.05, y / 1600);
    if (y > height - 8 && this.entrances.at2(x, z) < 0.45) radius = 0;
    const tunnel = (Math.sqrt(a * a + b * b) - radius) * 3;
    return Math.min(cheese, tunnel);
  }

  /** A ravine at a column: the y range it cuts (bottom, top), or null where none passes. */
  ravineAt(x: number, z: number): [number, number] | null {
    if (this.ravineMask.at2(x, z) < 0.75) return null;
    const ridge = Math.abs(this.ravine.at2(x, z));
    // Widest at mid height: how much of its height reaches out this far from the ridge line
    const reach = 1 - ridge / 0.04;
    if (reach <= 0) return null;
    const mid = 32 + this.ravineDepth.at2(x, z) * 8;
    const half = 24 * Math.sqrt(reach);
    return [Math.max(4, Math.round(mid - half)), Math.round(mid + half)];
  }
}

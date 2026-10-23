import { Block, FLUID, OPAQUE, STATE_BLOCK } from "./blocks.js";
import { resistanceOf } from "./mining.js";

/** What an explosion needs of the world. */
export interface BlastWorld {
  get(x: number, y: number, z: number): number;
}

/** A body an explosion can hurt: its feet, half its width, its height. */
export interface Body {
  position: { x: number; y: number; z: number };
  halfWidth: number;
  height: number;
}

/**
 * The blocks an explosion of `power` at (x, y, z) breaks, as Minecraft's: rays toward every point on the
 * surface of a 16 x 16 x 16 cube, each starting with 0.7 to 1.3 times the power and losing some every 0.3
 * blocks, more in blocks that resist (their blast resistance); a block is broken where a ray still has
 * strength. Fluids stop rays (they resist 100) and aren't broken.
 */
export function blastedBlocks(w: BlastWorld, x: number, y: number, z: number, power: number, random: () => number): Array<[number, number, number]> {
  const hit = new Map<string, [number, number, number]>();
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      for (let k = 0; k < 16; k++) {
        if (i !== 0 && i !== 15 && j !== 0 && j !== 15 && k !== 0 && k !== 15) continue;
        let dx = (i / 15) * 2 - 1;
        let dy = (j / 15) * 2 - 1;
        let dz = (k / 15) * 2 - 1;
        const len = Math.hypot(dx, dy, dz);
        dx /= len;
        dy /= len;
        dz /= len;
        let strength = power * (0.7 + random() * 0.6);
        let px = x;
        let py = y;
        let pz = z;
        while (strength > 0) {
          const bx = Math.floor(px);
          const by = Math.floor(py);
          const bz = Math.floor(pz);
          const state = w.get(bx, by, bz);
          if (state !== Block.Air) {
            strength -= (resistanceOf(STATE_BLOCK[state]) + 0.3) * 0.3;
            if (strength > 0 && FLUID[state] === 0) hit.set(`${bx},${by},${bz}`, [bx, by, bz]);
          }
          px += dx * 0.3;
          py += dy * 0.3;
          pz += dz * 0.3;
          strength -= 0.225;
        }
      }
    }
  }
  return [...hit.values()];
}

/** The share (0-1) of a body the blast at (x, y, z) reaches: points over its box with nothing solid on the way. */
function exposure(w: BlastWorld, x: number, y: number, z: number, b: Body): number {
  let seen = 0;
  let total = 0;
  const p = b.position;
  for (const fx of [-0.8, 0, 0.8]) {
    for (const fy of [0.1, 0.5, 0.9]) {
      for (const fz of [-0.8, 0, 0.8]) {
        total++;
        const tx = p.x + fx * b.halfWidth;
        const ty = p.y + fy * b.height;
        const tz = p.z + fz * b.halfWidth;
        const d = Math.hypot(tx - x, ty - y, tz - z);
        const steps = Math.ceil(d / 0.25);
        let clear = true;
        for (let s = 1; s < steps && clear; s++) {
          const t = s / steps;
          if (OPAQUE[w.get(Math.floor(x + (tx - x) * t), Math.floor(y + (ty - y) * t), Math.floor(z + (tz - z) * t))]) clear = false;
        }
        if (clear) seen++;
      }
    }
  }
  return seen / total;
}

/**
 * What an explosion does to a body, as Minecraft's: within twice its power, by how near and how exposed
 * the body is, the damage (before difficulty and armor) and the push away from the blast (blocks a second).
 */
export function blastOn(w: BlastWorld, x: number, y: number, z: number, power: number, b: Body): { damage: number; push: { x: number; y: number; z: number } } | null {
  const reach = power * 2;
  const p = b.position;
  const cx = p.x;
  const cy = p.y + b.height / 2;
  const cz = p.z;
  const d = Math.hypot(cx - x, cy - y, cz - z);
  if (d >= reach) return null;
  const impact = (1 - d / reach) * exposure(w, x, y, z, b);
  if (impact <= 0) return null;
  const damage = Math.floor(((impact * impact + impact) / 2) * 7 * reach + 1);
  const n = d > 0.001 ? d : 1;
  const k = impact * 20;
  return { damage, push: { x: ((cx - x) / n) * k, y: ((cy - y) / n) * k * 0.6 + impact * 4, z: ((cz - z) / n) * k } };
}

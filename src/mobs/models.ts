import { Mesh } from "projector";

/**
 * Mob models as Minecraft defines them: parts with a pivot and a rotation, made of boxes, each box
 * textured from a corner of the mob's texture in Minecraft's layout (the top and bottom in a row above the
 * four sides around it). Sizes are in pixels in Minecraft's model space, y down from 24 pixels over the
 * feet, the front toward -z. Craft's world is Minecraft's mirrored, so a model maps into Craft's with
 * every axis turned over (x' = -x, y' = 24 - y, z' = -z): the front toward +z, its right still its right,
 * its textures unmirrored. Rotations carry over as they are.
 */

/** A box: its texture's corner (u, v), its corner and size, how much it grows each way, mirrored (left limbs). */
export interface Cube {
  u: number;
  v: number;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  grow?: number;
  mirror?: boolean;
  /** Its color: for Canvas 2D, and the base of Craft's own skin. */
  color: string;
  /** A second layer over a part (a player's hat, jacket, sleeves): textured only, see-through where the skin is. */
  overlay?: boolean;
}

/** A part: its pivot, its rotation at rest (x, y, z in radians), its boxes. */
export interface Part {
  name: string;
  pivot: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  cubes: readonly Cube[];
}

export interface Model {
  /** The texture's size in pixels. */
  width: number;
  height: number;
  parts: readonly Part[];
}

/** Rotations of parts by name, replacing their rest rotations (Minecraft's setupAnim). */
export type Pose = Partial<Record<string, readonly [number, number, number]>>;

const cube = (u: number, v: number, x: number, y: number, z: number, w: number, h: number, d: number, color: string, more: Partial<Cube> = {}): Cube => ({ u, v, x, y, z, w, h, d, color, ...more });
const HALF_PI = Math.PI / 2;

/** A humanoid (zombie, skeleton): head, body, arms and legs, `limb` wide. */
function humanoid(height: number, limb: number, colors: { head: string; body: string; arm: string; leg: string }): Model {
  const l = limb;
  return {
    width: 64,
    height,
    parts: [
      { name: "head", pivot: [0, 0, 0], cubes: [cube(0, 0, -4, -8, -4, 8, 8, 8, colors.head)] },
      { name: "body", pivot: [0, 0, 0], cubes: [cube(16, 16, -4, 0, -2, 8, 12, 4, colors.body)] },
      { name: "right_arm", pivot: [-5, 2, 0], cubes: [cube(40, 16, l === 4 ? -3 : -1, -2, -l / 2, l, 12, l, colors.arm)] },
      { name: "left_arm", pivot: [5, 2, 0], cubes: [cube(40, 16, -1, -2, -l / 2, l, 12, l, colors.arm, { mirror: true })] },
      { name: "right_leg", pivot: [l === 4 ? -1.9 : -2, 12, 0], cubes: [cube(0, 16, -l / 2, 0, -l / 2, l, 12, l, colors.leg)] },
      { name: "left_leg", pivot: [l === 4 ? 1.9 : 2, 12, 0], cubes: [cube(0, 16, -l / 2, 0, -l / 2, l, 12, l, colors.leg, { mirror: true })] },
    ],
  };
}

/** Four legs of a quadruped, `height` pixels long, at their corners. */
function legs(height: number, x: number, hindZ: number, frontZ: number, color: string): Part[] {
  const leg = (name: string, px: number, pz: number, mirror: boolean): Part => ({ name, pivot: [px, 24 - height, pz], cubes: [cube(0, 16, -2, 0, -2, 4, height, 4, color, { mirror })] });
  return [leg("right_hind_leg", -x, hindZ, false), leg("left_hind_leg", x, hindZ, true), leg("right_front_leg", -x, frontZ, false), leg("left_front_leg", x, frontZ, true)];
}

/** A player: the humanoid with left limbs of their own, and a second layer (hat, jacket, sleeves, trousers). */
function player(): Model {
  const o = { overlay: true };
  return {
    width: 64,
    height: 64,
    parts: [
      { name: "head", pivot: [0, 0, 0], cubes: [cube(0, 0, -4, -8, -4, 8, 8, 8, "#c8a080"), cube(32, 0, -4, -8, -4, 8, 8, 8, "", { ...o, grow: 0.5 })] },
      { name: "body", pivot: [0, 0, 0], cubes: [cube(16, 16, -4, 0, -2, 8, 12, 4, "#3a8aa8"), cube(16, 32, -4, 0, -2, 8, 12, 4, "", { ...o, grow: 0.25 })] },
      { name: "right_arm", pivot: [-5, 2, 0], cubes: [cube(40, 16, -3, -2, -2, 4, 12, 4, "#c8a080"), cube(40, 32, -3, -2, -2, 4, 12, 4, "", { ...o, grow: 0.25 })] },
      { name: "left_arm", pivot: [5, 2, 0], cubes: [cube(32, 48, -1, -2, -2, 4, 12, 4, "#c8a080"), cube(48, 48, -1, -2, -2, 4, 12, 4, "", { ...o, grow: 0.25 })] },
      { name: "right_leg", pivot: [-1.9, 12, 0], cubes: [cube(0, 16, -2, 0, -2, 4, 12, 4, "#3a3a8a"), cube(0, 32, -2, 0, -2, 4, 12, 4, "", { ...o, grow: 0.25 })] },
      { name: "left_leg", pivot: [1.9, 12, 0], cubes: [cube(16, 48, -2, 0, -2, 4, 12, 4, "#3a3a8a"), cube(0, 48, -2, 0, -2, 4, 12, 4, "", { ...o, grow: 0.25 })] },
    ],
  };
}

/** A player's right arm alone, as the first-person hand. */
export const ARM: Model = { width: 64, height: 64, parts: [{ name: "right_arm", pivot: [0, 24, 0], cubes: [cube(40, 16, -2, -6, -2, 4, 12, 4, "#c8a080"), cube(40, 32, -2, -6, -2, 4, 12, 4, "", { overlay: true, grow: 0.25 })] }] };

export const MODELS = {
  player: player(),
  zombie: humanoid(64, 4, { head: "#4f7a3a", body: "#2a9a9a", arm: "#4f7a3a", leg: "#3a3a8a" }),
  skeleton: humanoid(32, 2, { head: "#c8c8c8", body: "#b8b8b8", arm: "#c8c8c8", leg: "#c8c8c8" }),
  creeper: {
    width: 64,
    height: 32,
    parts: [
      { name: "head", pivot: [0, 6, 0], cubes: [cube(0, 0, -4, -8, -4, 8, 8, 8, "#5aa83a")] },
      { name: "body", pivot: [0, 6, 0], cubes: [cube(16, 16, -4, 0, -2, 8, 12, 4, "#4a983a")] },
      ...legs(6, 2, 4, -4, "#4a983a"),
    ],
  },
  spider: {
    width: 64,
    height: 32,
    parts: [
      { name: "head", pivot: [0, 15, -3], cubes: [cube(32, 4, -4, -4, -8, 8, 8, 8, "#3a302a")] },
      { name: "neck", pivot: [0, 15, 0], cubes: [cube(0, 0, -3, -3, -3, 6, 6, 6, "#2a2420")] },
      { name: "body", pivot: [0, 15, 9], cubes: [cube(0, 12, -5, -4, -6, 10, 8, 12, "#3a302a")] },
      ...([
        ["right_hind_leg", -4, 2],
        ["left_hind_leg", 4, 2],
        ["right_middle_hind_leg", -4, 1],
        ["left_middle_hind_leg", 4, 1],
        ["right_middle_front_leg", -4, 0],
        ["left_middle_front_leg", 4, 0],
        ["right_front_leg", -4, -1],
        ["left_front_leg", 4, -1],
      ] as const).map(([name, x, z]): Part => ({ name, pivot: [x, 15, z], cubes: [cube(18, 0, x < 0 ? -15 : -1, -1, -1, 16, 2, 2, "#2a2420")] })),
    ],
  },
  pig: {
    width: 64,
    height: 64,
    parts: [
      { name: "head", pivot: [0, 12, -6], cubes: [cube(0, 0, -4, -4, -8, 8, 8, 8, "#f0a0a0"), cube(16, 16, -2, 0, -9, 4, 3, 1, "#e08888")] },
      { name: "body", pivot: [0, 11, 2], rotation: [HALF_PI, 0, 0], cubes: [cube(28, 8, -5, -10, -7, 10, 16, 8, "#f0a0a0")] },
      ...legs(6, 3, 7, -5, "#e89898"),
    ],
  },
  cow: {
    width: 64,
    height: 64,
    parts: [
      {
        name: "head",
        pivot: [0, 4, -8],
        cubes: [cube(0, 0, -4, -4, -6, 8, 8, 6, "#4a3a2a"), cube(22, 0, -5, -5, -4, 1, 3, 1, "#d8d0c0"), cube(22, 0, 4, -5, -4, 1, 3, 1, "#d8d0c0")],
      },
      { name: "body", pivot: [0, 5, 2], rotation: [HALF_PI, 0, 0], cubes: [cube(18, 4, -6, -10, -7, 12, 18, 10, "#4a3a2a"), cube(52, 0, -2, 2, -8, 4, 6, 1, "#e8a0a0")] },
      ...legs(12, 4, 7, -6, "#4a3a2a"),
    ],
  },
  sheep: {
    width: 64,
    height: 32,
    parts: [
      { name: "head", pivot: [0, 6, -8], cubes: [cube(0, 0, -3, -4, -6, 6, 6, 8, "#c8a890")] },
      { name: "body", pivot: [0, 5, 2], rotation: [HALF_PI, 0, 0], cubes: [cube(28, 8, -4, -10, -7, 8, 16, 6, "#c8a890")] },
      ...legs(12, 3, 7, -5, "#c8a890"),
    ],
  },
  /** A sheep's wool, a layer over it (sheep_wool.png), tinted by its color. */
  sheep_wool: {
    width: 64,
    height: 32,
    parts: [
      { name: "head", pivot: [0, 6, -8], cubes: [cube(0, 0, -3, -4, -4, 6, 6, 6, "#ffffff", { grow: 0.6 })] },
      { name: "body", pivot: [0, 5, 2], rotation: [HALF_PI, 0, 0], cubes: [cube(28, 8, -4, -10, -7, 8, 16, 6, "#ffffff", { grow: 1.75 })] },
      ...legs(6, 3, 7, -5, "#ffffff").map((p) => ({ ...p, pivot: [p.pivot[0], 12, p.pivot[2]] as const, cubes: p.cubes.map((c) => ({ ...c, grow: 0.5 })) })),
    ],
  },
  chicken: {
    width: 64,
    height: 32,
    parts: [
      {
        name: "head",
        pivot: [0, 15, -4],
        cubes: [cube(0, 0, -2, -6, -2, 4, 6, 3, "#f0f0f0"), cube(14, 0, -2, -4, -4, 4, 2, 2, "#e8b030"), cube(14, 4, -1, -2, -3, 2, 2, 2, "#d02020")],
      },
      { name: "body", pivot: [0, 16, 0], rotation: [HALF_PI, 0, 0], cubes: [cube(0, 9, -3, -4, -3, 6, 8, 6, "#f0f0f0")] },
      { name: "right_leg", pivot: [-2, 19, 1], cubes: [cube(26, 0, -1, 0, -3, 3, 5, 3, "#e8b030")] },
      { name: "left_leg", pivot: [1, 19, 1], cubes: [cube(26, 0, -1, 0, -3, 3, 5, 3, "#e8b030")] },
      { name: "right_wing", pivot: [-4, 13, 0], cubes: [cube(24, 13, 0, 0, -3, 1, 4, 6, "#e8e8e8")] },
      { name: "left_wing", pivot: [4, 13, 0], cubes: [cube(24, 13, -1, 0, -3, 1, 4, 6, "#e8e8e8")] },
    ],
  },
  /** A slime's insides: a cube, two eyes and a mouth (the outer cube is slime_outer, drawn see-through). */
  slime: {
    width: 64,
    height: 32,
    parts: [
      {
        name: "body",
        pivot: [0, 0, 0],
        cubes: [cube(0, 16, -3, 17, -3, 6, 6, 6, "#5aa84a"), cube(32, 0, -3.25, 18, -3.5, 2, 2, 2, "#1a2a1a"), cube(32, 4, 1.25, 18, -3.5, 2, 2, 2, "#1a2a1a"), cube(32, 8, 0, 21, -3.5, 1, 1, 1, "#1a2a1a")],
      },
    ],
  },
  slime_outer: {
    width: 64,
    height: 32,
    parts: [{ name: "body", pivot: [0, 0, 0], cubes: [cube(0, 0, -4, 16, -4, 8, 8, 8, "#7ad86a")] }],
  },
} satisfies Record<string, Model>;

export type ModelName = keyof typeof MODELS;

/**
 * How bright a face looks by the way it faces (a unit normal in Craft's space), as the world's faces:
 * tops full, sides along z 0.8 and along x 0.6, bottoms half.
 */
function shade(nx: number, ny: number, nz: number): number {
  return ny * ny * (ny > 0 ? 1 : 0.5) + nx * nx * 0.6 + nz * nz * 0.8;
}

/** Rotates (x, y, z) by Minecraft's part rotation (x first, then y, then z), into out at o. */
function rotate(x: number, y: number, z: number, rx: number, ry: number, rz: number, out: Float32Array, o: number): void {
  if (rx !== 0) {
    const c = Math.cos(rx);
    const s = Math.sin(rx);
    [y, z] = [y * c - z * s, y * s + z * c];
  }
  if (ry !== 0) {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    [x, z] = [x * c + z * s, -x * s + z * c];
  }
  if (rz !== 0) {
    const c = Math.cos(rz);
    const s = Math.sin(rz);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  out[o] = x;
  out[o + 1] = y;
  out[o + 2] = z;
}

/** A model made into a mesh once, then posed (pose()) frame by frame. */
export class PosedModel {
  readonly mesh: Mesh;
  /** Every box's 24 corners (4 per face) in its part's space, and which part it belongs to. */
  private readonly local: Float32Array;
  private readonly partOf: Uint16Array;
  /** Each face's base color (Canvas 2D) as 0-1 r, g, b. */
  private readonly faceColor: Float32Array;
  private readonly faceNormal: Float32Array;
  private readonly normals = new Float32Array(3);

  constructor(
    readonly model: Model,
    private readonly textured: boolean,
  ) {
    const corners: number[] = [];
    const parts: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const normals: number[] = [];
    const faces: number[][] = [];
    model.parts.forEach((part, p) => {
      for (const c of part.cubes) {
        // Without textures the second layer would only hide the first
        if (c.overlay && !textured) continue;
        const g = c.grow ?? 0;
        let [x0, x1] = [c.x - g, c.x + c.w + g];
        const [y0, y1, z0, z1] = [c.y - g, c.y + c.h + g, c.z - g, c.z + c.d + g];
        if (c.mirror) [x0, x1] = [x1, x0];
        const vtx = [
          [x0, y0, z0],
          [x1, y0, z0],
          [x1, y1, z0],
          [x0, y1, z0],
          [x0, y0, z1],
          [x1, y0, z1],
          [x1, y1, z1],
          [x0, y1, z1],
        ];
        const { u, v, w, h, d } = c;
        const [u0, u1, u2, u3, u4, u5] = [u, u + d, u + d + w, u + d + w + w, u + d + w + d, u + d + w + d + w];
        const [v0, v1, v2] = [v, v + d, v + d + h];
        // Minecraft's faces: corners, texture rectangle, normal (in its model space)
        const polys: Array<[number[], number, number, number, number, [number, number, number]]> = [
          [[5, 4, 0, 1], u1, v0, u2, v1, [0, -1, 0]],
          [[2, 3, 7, 6], u2, v1, u3, v0, [0, 1, 0]],
          [[0, 4, 7, 3], u0, v1, u1, v2, [-1, 0, 0]],
          [[1, 0, 3, 2], u1, v1, u2, v2, [0, 0, -1]],
          [[5, 1, 2, 6], u2, v1, u4, v2, [1, 0, 0]],
          [[4, 5, 6, 7], u4, v1, u5, v2, [0, 0, 1]],
        ];
        const rgb = c.overlay ? [1, 1, 1] : [1, 3, 5].map((i) => parseInt(c.color.slice(i, i + 2), 16) / 255);
        for (const [idx, pu0, pv0, pu1, pv1, n] of polys) {
          // Minecraft's corner order: (u1, v0), (u0, v0), (u0, v1), (u1, v1); a mirrored box turns it round
          let quad = idx.map((i, k): [number[], number, number] => [vtx[i], k === 0 || k === 3 ? pu1 : pu0, k < 2 ? pv0 : pv1]);
          if (c.mirror) quad = quad.reverse();
          // Craft's world turns every axis over: the winding turns round with it
          quad = quad.reverse();
          const start = corners.length / 3;
          for (const [[x, y, z], tu, tv] of quad) {
            corners.push(x, y, z);
            parts.push(p);
            uvs.push(tu / model.width, tv / model.height);
          }
          faces.push([start, start + 1, start + 2, start + 3]);
          colors.push(...rgb);
          normals.push(c.mirror && n[0] !== 0 ? -n[0] : n[0], n[1], n[2]);
        }
      }
    });
    this.local = Float32Array.from(corners);
    this.partOf = Uint16Array.from(parts);
    this.faceColor = Float32Array.from(colors);
    this.faceNormal = Float32Array.from(normals);
    this.mesh = new Mesh(new Float32Array(corners.length), faces, [], uvs);
    this.mesh.colors = new Float32Array(faces.length * 16);
  }

  /**
   * Poses the model: every part turned (its rest rotation, or the pose's), into Craft's space in blocks
   * with the feet at the origin. Colors: the light's `brightness`, shaded by the way faces face, reddened by
   * `red` (0-1, a hit), times `tint` (a sheep's wool).
   */
  pose(pose: Pose, brightness: number, red: number = 0, tint: readonly [number, number, number] = [1, 1, 1]): void {
    const parts = this.model.parts;
    const pos = this.mesh.positions;
    const rot = parts.map((p) => pose[p.name] ?? p.rotation ?? [0, 0, 0]);
    for (let i = 0; i < this.partOf.length; i++) {
      const p = this.partOf[i];
      const [rx, ry, rz] = rot[p];
      const o = i * 3;
      rotate(this.local[o], this.local[o + 1], this.local[o + 2], rx, ry, rz, pos, o);
      const pivot = parts[p].pivot;
      // Into Craft's space: every axis turned over, in blocks, the feet at y 0
      pos[o] = -(pos[o] + pivot[0]) / 16;
      pos[o + 1] = (24 - (pos[o + 1] + pivot[1])) / 16;
      pos[o + 2] = -(pos[o + 2] + pivot[2]) / 16;
    }
    const colors = this.mesh.colors!;
    const faces = this.faceNormal.length / 3;
    const n = this.normals;
    for (let f = 0; f < faces; f++) {
      const [rx, ry, rz] = rot[this.partOf[f * 4]];
      rotate(this.faceNormal[f * 3], this.faceNormal[f * 3 + 1], this.faceNormal[f * 3 + 2], rx, ry, rz, n, 0);
      // Minecraft's y is down: a normal toward -y faces up
      const k = brightness * shade(-n[0], -n[1], -n[2]);
      const base = this.textured ? [1, 1, 1] : [this.faceColor[f * 3], this.faceColor[f * 3 + 1], this.faceColor[f * 3 + 2]];
      // A hit turns it half red
      const r = base[0] * tint[0] * k * (1 - red * 0.5) + k * red * 0.5;
      const g = base[1] * tint[1] * k * (1 - red * 0.5);
      const b = base[2] * tint[2] * k * (1 - red * 0.5);
      for (let c = 0; c < 4; c++) colors.set([r, g, b, 1], (f * 4 + c) * 4);
    }
    this.mesh.markDirty();
  }
}

/** Craft's own skin for a model: every box's faces in its color, a little uneven, darker below. */
export function paintSkin(model: Model, details?: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = model.width;
  canvas.height = model.height;
  const g = canvas.getContext("2d")!;
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const part of model.parts) {
    for (const c of part.cubes) {
      // The second layer stays clear
      if (c.overlay) continue;
      const { u, v, w, h, d } = c;
      const rects: Array<[number, number, number, number, number]> = [
        [u + d, v, w, d, 1.08],
        [u + d + w, v, w, d, 0.8],
        [u, v + d, d, h, 0.95],
        [u + d, v + d, w, h, 1],
        [u + d + w, v + d, d, h, 0.95],
        [u + d + w + d, v + d, w, h, 0.9],
      ];
      const [r, gg, b] = [1, 3, 5].map((i) => parseInt(c.color.slice(i, i + 2), 16));
      for (const [x, y, rw, rh, k] of rects) {
        for (let py = y; py < y + rh; py++) {
          for (let px = x; px < x + rw; px++) {
            const j = k * (0.92 + rnd() * 0.16);
            g.fillStyle = `rgb(${Math.min(255, r * j)},${Math.min(255, gg * j)},${Math.min(255, b * j)})`;
            g.fillRect(px, py, 1, 1);
          }
        }
      }
    }
  }
  details?.(g);
  return canvas;
}

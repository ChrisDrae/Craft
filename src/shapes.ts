import { BLOCKS, Block, Dir, FACING_DIR, Face, STATE_BLOCK, STATE_COUNT, SHAPE, OPAQUE, propertyOf, tileIndex } from "./blocks.js";
import { FACE_CORNERS as CORNERS } from "./chunk.js";

/**
 * The shapes of the blocks that aren't full cubes, as Minecraft builds its block models: textured quads
 * from boxes (slabs, stairs, fences, doors) or crossed planes (plants). Derived per state: the quads to draw,
 * the boxes that stop entities and that the crosshair hits, which sides of the cell each state covers
 * completely (hiding the neighbor's face there), and what holds it up.
 */

/** One textured quad of a model. */
export interface Quad {
  /** Corners (x, y, z) in the block's own coordinates (0-1), wound so the normal points out. */
  corners: Float64Array;
  /** Where each corner lies on the texture: (u, v) in 0-1, v down. */
  uvs: Float64Array;
  /** The texture (TILE_NAMES index). */
  tile: number;
  /** The side of the cell (Dir) it lies on, so the neighbor there can hide it, or -1 inside the cell. */
  cull: number;
  /** The way it faces (Dir), for shading and the light it takes, or -1 (plants: unshaded, lit by their own block). */
  dir: number;
  /** Its color by biome (Tint), its block's. */
  tint: number;
}

/** A box in the block's own coordinates: min x, y, z, max x, y, z. */
type Box = [number, number, number, number, number, number];
const px = (v: number): number => v / 16;
const FULL: Box = [0, 0, 0, 1, 1, 1];

/**
 * Where a point of a face in direction d lies on its texture, as (u, v) in 0..1 with v down: sides upright
 * and not mirrored seen from outside, tops with u along x and v along z (the layout of Projector's
 * Mesh.box). (x, y, z) is the point's place in the block, 0..1 on each axis.
 */
export function cornerUV(d: number, x: number, y: number, z: number): [number, number] {
  switch (d) {
    case 0:
      return [z, 1 - y];
    case 1:
      return [1 - z, 1 - y];
    case 2:
      return [x, z];
    case 3:
      return [x, 1 - z];
    case 4:
      return [1 - x, 1 - y];
    default:
      return [x, 1 - y];
  }
}

/** Turns a box about the cell's vertical center axis in quarter turns: north (0) to east (1), south, west. */
function turn(box: Box, turns: number): Box {
  let [x0, y0, z0, x1, y1, z1] = box;
  for (let t = 0; t < turns; t++) [x0, z0, x1, z1] = [1 - z1, x0, 1 - z0, x1];
  return [x0, y0, z0, x1, y1, z1];
}

const TURNS: Readonly<Record<string, number>> = { north: 0, east: 1, south: 2, west: 3 };

/** Flips a box upside down within the cell. */
const flip = (b: Box): Box => [b[0], 1 - b[4], b[2], b[3], 1 - b[1], b[5]];

/**
 * The quads of a box's faces: textured by their position on it (the same pixel of the texture wherever the
 * box is), `tile(d)` choosing the texture per face. `faces` leaves faces out (by Dir).
 */
function boxQuads(box: Box, tile: (d: number) => number, faces: readonly number[] = [0, 1, 2, 3, 4, 5]): Quad[] {
  const [x0, y0, z0, x1, y1, z1] = box;
  const onSide = [x1 === 1, x0 === 0, y1 === 1, y0 === 0, z1 === 1, z0 === 0];
  return faces.map((d) => {
    const corners = new Float64Array(12);
    const uvs = new Float64Array(8);
    for (let k = 0; k < 4; k++) {
      const c = d * 12 + k * 3;
      const x = x0 + CORNERS[c] * (x1 - x0);
      const y = y0 + CORNERS[c + 1] * (y1 - y0);
      const z = z0 + CORNERS[c + 2] * (z1 - z0);
      corners.set([x, y, z], k * 3);
      uvs.set(cornerUV(d, x, y, z), k * 2);
    }
    return { corners, uvs, tile: tile(d), cull: onSide[d] ? d : -1, dir: d, tint: 0 };
  });
}

/** Two crossed planes through the cell, each seen from both sides: flowers, grass, saplings. */
function crossQuads(tile: number): Quad[] {
  const a = 0.5 - Math.SQRT1_2 / 2;
  const b = 1 - a;
  const quads: Quad[] = [];
  for (const [p, q] of [
    [
      [a, a],
      [b, b],
    ],
    [
      [a, b],
      [b, a],
    ],
  ]) {
    for (const [s, e] of [
      [p, q],
      [q, p],
    ]) {
      const corners = Float64Array.of(s[0], 0, s[1], e[0], 0, e[1], e[0], 1, e[1], s[0], 1, s[1]);
      quads.push({ corners, uvs: Float64Array.of(0, 1, 1, 1, 1, 0, 0, 0), tile, cull: -1, dir: -1, tint: 0 });
    }
  }
  return quads;
}

/** The look (Face) of a box face by direction: top, bottom, or a side. */
const lookOf = (d: number): number => (d === Dir.Up ? Face.Top : d === Dir.Down ? Face.Bottom : Face.Side);

/** A state's boxes, drawn (quads), stopping entities (collision) and hit by the crosshair (selection). */
interface Parts {
  quads: Quad[];
  collision: Box[];
  selection: Box[];
}

function boxes(block: number, list: Box[], collision: Box[] = list): Parts {
  const t = BLOCKS[block].textures.map(tileIndex);
  return { quads: list.flatMap((b) => boxQuads(b, (d) => t[lookOf(d)])), collision, selection: list };
}

/** Boxes of a fence, wall or pane: a post and arms toward the connected sides (north, east, south, west). */
function connected(state: number, post: Box | null, arm: (side: number) => Box[], tall: number): { draw: Box[]; stop: Box[] } {
  const draw: Box[] = post ? [post] : [];
  ["north", "east", "south", "west"].forEach((side, i) => {
    if (propertyOf(state, side) === "true") draw.push(...arm(i).map((b) => turn(b, i)));
  });
  // Fences and walls stop jumping over them: their boxes reach 1.5 high
  const stop = draw.map((b): Box => [b[0], b[1], b[2], b[3], tall, b[5]]);
  return { draw, stop };
}

/** Builds a state's parts, or null for cubes and fluids. */
function partsOf(state: number): Parts | null {
  const b = STATE_BLOCK[state];
  const info = BLOCKS[b];
  const prop = (name: string): string => propertyOf(state, name);
  if (info.shape === "cube" || info.shape === "fluid") return null;
  const t = info.textures.map(tileIndex);
  switch (info.shape) {
    case "cross":
      return { quads: crossQuads(t[Face.Side]), collision: [], selection: [[px(3), 0, px(3), px(13), px(13), px(13)]] };
    case "torch": {
      const standing: Box = [px(7), 0, px(7), px(9), px(10), px(9)];
      const facing = prop("facing");
      let box = standing;
      if (facing !== "up") {
        // On a wall: the same stick a little raised, its back a pixel from the wall (built facing south)
        box = turn([px(7), px(3.5), px(1), px(9), px(13.5), px(3)], (TURNS[facing] + 2) % 4);
      }
      // Its texture comes from the standing stick, wherever the stick is
      const quads = boxQuads(box, () => t[Face.Side]);
      const uvQuads = boxQuads(standing, () => t[Face.Side]);
      quads.forEach((q, i) => q.uvs.set(uvQuads[i].uvs));
      return { quads, collision: [], selection: [box] };
    }
    case "slab": {
      const type = prop("type");
      if (type === "double") return null;
      return boxes(b, [type === "top" ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1]]);
    }
    case "stairs": {
      // Built facing north (the high part on the north side), the bottom half
      const shape = prop("shape");
      const parts: Box[] = [[0, 0, 0, 1, 0.5, 1]];
      if (shape === "straight" || shape.startsWith("inner")) parts.push([0, 0.5, 0, 1, 1, 0.5]);
      if (shape === "inner_left") parts.push([0, 0.5, 0.5, 0.5, 1, 1]);
      if (shape === "inner_right") parts.push([0.5, 0.5, 0.5, 1, 1, 1]);
      if (shape === "outer_left") parts.push([0, 0.5, 0, 0.5, 1, 0.5]);
      if (shape === "outer_right") parts.push([0.5, 0.5, 0, 1, 1, 0.5]);
      const top = prop("half") === "top";
      return boxes(b, parts.map((p) => turn(top ? flip(p) : p, TURNS[prop("facing")])));
    }
    case "fence": {
      const { draw, stop } = connected(state, [px(6), 0, px(6), px(10), 1, px(10)], () => [
        [px(7), px(6), 0, px(9), px(9), px(6)],
        [px(7), px(12), 0, px(9), px(15), px(6)],
      ], 1.5);
      return { ...boxes(b, draw, stop), selection: draw };
    }
    case "wall": {
      const sides = ["north", "east", "south", "west"].map((s) => prop(s) === "true");
      // A post unless the wall runs straight through
      const straight = (sides[0] && sides[2] && !sides[1] && !sides[3]) || (sides[1] && sides[3] && !sides[0] && !sides[2]);
      const { draw, stop } = connected(state, straight ? null : [px(4), 0, px(4), px(12), 1, px(12)], () => [[px(5), 0, 0, px(11), px(14), px(8)]], 1.5);
      return { ...boxes(b, draw, stop), selection: draw };
    }
    case "pane": {
      const { draw } = connected(state, [px(7), 0, px(7), px(9), 1, px(9)], () => [[px(7), 0, 0, px(9), 1, px(8)]], 1);
      // Glass on the big faces, the pane's edge texture on the narrow ones
      const quads = draw.flatMap((box) =>
        boxQuads(box, (d) => {
          const wide = d < 2 ? box[5] - box[2] : d < 4 ? 0 : box[3] - box[0];
          return d === Dir.Up || d === Dir.Down || wide <= px(2) ? t[Face.Top] : t[Face.Side];
        }),
      );
      return { quads, collision: draw, selection: draw };
    }
    case "door": {
      // Built facing north, closed: the door in the cell's south edge, toward whoever placed it; open, it
      // swings against the side its hinge is on
      const open = prop("open") === "true";
      const hinge = prop("hinge");
      const box: Box = !open ? [0, 0, px(13), 1, 1, 1] : hinge === "left" ? [0, 0, 0, px(3), 1, 1] : [px(13), 0, 0, 1, 1, 1];
      const turned = turn(box, TURNS[prop("facing")]);
      const tile = prop("half") === "upper" ? t[Face.Top] : t[Face.Side];
      return { quads: boxQuads(turned, () => tile), collision: [turned], selection: [turned] };
    }
    case "trapdoor": {
      const open = prop("open") === "true";
      const box: Box = open ? [0, 0, px(13), 1, 1, 1] : prop("half") === "top" ? [0, px(13), 0, 1, 1, 1] : [0, 0, 0, 1, px(3), 1];
      const turned = turn(box, TURNS[prop("facing")]);
      return { quads: boxQuads(turned, () => t[Face.Side]), collision: [turned], selection: [turned] };
    }
    case "ladder": {
      // On the wall behind it (built facing north: the wall to the south), seen from both sides
      const plate = turn([0, 0, px(15.2), 1, 1, 1], TURNS[prop("facing")]);
      const front = FACING_DIR[prop("facing")];
      const quads = boxQuads(plate, () => t[Face.Side], [front, front ^ 1]);
      return { quads, collision: [turn([0, 0, px(13), 1, 1, 1], TURNS[prop("facing")])], selection: [plate] };
    }
    case "carpet":
      return boxes(b, [[0, 0, 0, 1, px(1), 1]]);
    case "snow": {
      const layers = Number(prop("layers"));
      // The top layer gives under foot: one layer less stops you
      return boxes(b, [[0, 0, 0, 1, px(layers * 2), 1]], layers > 1 ? [[0, 0, 0, 1, px((layers - 1) * 2), 1]] : []);
    }
    case "cactus": {
      const box: Box = [px(1), 0, px(1), px(15), 1, px(15)];
      return boxes(b, [box], [[px(1), 0, px(1), px(15), px(15), px(15)]]);
    }
    case "tall": {
      // The upper half shows the top texture
      const tile = prop("half") === "upper" ? t[Face.Top] : t[Face.Side];
      return { quads: crossQuads(tile), collision: [], selection: [[px(2), 0, px(2), px(14), 1, px(14)]] };
    }
    case "lilypad": {
      // A leaf lying on the water, seen from above and below
      const leaf: Box = [0, px(0.25), 0, 1, px(0.25), 1];
      return { quads: boxQuads(leaf, () => t[Face.Top], [Dir.Up, Dir.Down]), collision: [[0, 0, 0, 1, px(1.5), 1]], selection: [[0, 0, 0, 1, px(1.5), 1]] };
    }
  }
}

const PARTS: readonly (Parts | null)[] = Array.from({ length: STATE_COUNT }, (_, s) => {
  const parts = partsOf(s);
  for (const q of parts?.quads ?? []) q.tint = BLOCKS[STATE_BLOCK[s]].tint;
  return parts;
});

/** The quads of every state drawn as a model, or null (full cubes and fluids). */
export const MODELS: readonly (Quad[] | null)[] = PARTS.map((p) => p?.quads ?? null);

const flat = (list: Box[]): Float64Array => Float64Array.from(list.flat());
const NOTHING = new Float64Array(0);

/** Boxes that stop entities, per state (6 numbers each). */
export const COLLISION: readonly Float64Array[] = PARTS.map((p, s) => (p ? flat(p.collision) : BLOCKS[STATE_BLOCK[s]].solid ? flat([FULL]) : NOTHING));
/** Boxes the crosshair can hit, per state: everything but air and fluids. */
export const SELECTION: readonly Float64Array[] = PARTS.map((p, s) => {
  const shape = SHAPE[s];
  if (STATE_BLOCK[s] === Block.Air || shape === "fluid") return NOTHING;
  return p ? flat(p.selection) : flat([FULL]);
});

/**
 * Whether a state covers a side of its cell completely (at (state * 6 + dir)), hiding the face of the
 * neighbor there: full opaque cubes all round, opaque models where their quads fill the side (a slab's
 * bottom, the back of stairs). See-through blocks cover nothing.
 */
export const COVERS: Uint8Array = new Uint8Array(STATE_COUNT * 6);
for (let s = 0; s < STATE_COUNT; s++) {
  if (OPAQUE[s]) {
    COVERS.fill(1, s * 6, s * 6 + 6);
    continue;
  }
  const quads = MODELS[s];
  if (!quads || BLOCKS[STATE_BLOCK[s]].opacity !== "opaque") continue;
  for (let d = 0; d < 6; d++) {
    // Rasterize the side's quads on a 16 x 16 grid
    const grid = new Uint8Array(256);
    for (const q of quads) {
      if (q.cull !== d) continue;
      const c = q.corners;
      const axes = d < 2 ? [2, 1] : d < 4 ? [0, 2] : [0, 1];
      const lo = axes.map((a) => Math.min(c[a], c[3 + a], c[6 + a], c[9 + a]) * 16);
      const hi = axes.map((a) => Math.max(c[a], c[3 + a], c[6 + a], c[9 + a]) * 16);
      for (let v = Math.round(lo[1]); v < Math.round(hi[1]); v++) for (let u = Math.round(lo[0]); u < Math.round(hi[0]); u++) grid[v * 16 + u] = 1;
    }
    COVERS[s * 6 + d] = grid.every((g) => g === 1) ? 1 : 0;
  }
}

/**
 * Whether a side of a state (at (state * 6 + dir)) is a full solid face that torches, ladders and plants
 * can rest on and fences connect to: every side of a solid cube, glass and leaves too, and the sides that
 * a model's collision boxes fill (a slab's bottom, the back of stairs). Eight layers of snow make a full
 * block. Doors and trapdoors swing, so they hold nothing.
 */
export const STURDY: Uint8Array = new Uint8Array(STATE_COUNT * 6);
for (let s = 0; s < STATE_COUNT; s++) {
  if (SHAPE[s] === "door" || SHAPE[s] === "trapdoor") continue;
  const boxes = SHAPE[s] === "snow" && propertyOf(s, "layers") === "8" ? flat([FULL]) : COLLISION[s];
  for (let d = 0; d < 6; d++) {
    // Rasterize the boxes flush with the side on a 16 x 16 grid (a fence's extra half block doesn't count)
    const axis = d < 2 ? 0 : d < 4 ? 1 : 2;
    const [ua, va] = [0, 1, 2].filter((a) => a !== axis);
    const grid = new Uint8Array(256);
    for (let b = 0; b < boxes.length; b += 6) {
      const flush = (d & 1) === 0 ? boxes[b + 3 + axis] === 1 : boxes[b + axis] === 0;
      if (!flush) continue;
      const span = (a: number): [number, number] => [Math.round(Math.max(0, boxes[b + a]) * 16), Math.round(Math.min(1, boxes[b + 3 + a]) * 16)];
      const [u0, u1] = span(ua);
      const [v0, v1] = span(va);
      for (let v = v0; v < v1; v++) for (let u = u0; u < u1; u++) grid[v * 16 + u] = 1;
    }
    STURDY[s * 6 + d] = grid.every((g) => g === 1) ? 1 : 0;
  }
}

/**
 * The direction (Dir) of the block a state rests or hangs on, which it can't stay without, or -1:
 * torches and ladders on their wall (or the floor), plants, carpet, snow and cactus on the block below,
 * door halves on the block below (the upper half on the lower one).
 */
export const SUPPORT: Int8Array = Int8Array.from({ length: STATE_COUNT }, (_, s) => {
  const shape = SHAPE[s];
  if (shape === "torch") {
    const facing = propertyOf(s, "facing");
    return facing === "up" ? Dir.Down : FACING_DIR[facing] ^ 1;
  }
  if (shape === "ladder") return FACING_DIR[propertyOf(s, "facing")] ^ 1;
  if (shape === "cross" || shape === "carpet" || shape === "snow" || shape === "cactus" || shape === "door" || shape === "tall" || shape === "lilypad") return Dir.Down;
  return -1;
});

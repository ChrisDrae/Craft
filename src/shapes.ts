import { BLOCKS, Block, Dir, FACING_DIR, Face, STATE_BLOCK, STATE_COUNT, SHAPE, OPAQUE, Tint, propertyOf, tileIndex } from "./blocks.js";
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

/** The direction a face points after a quarter turn as turn() makes (north to east), by Dir. */
const TURN_DIR: readonly number[] = [Dir.PosZ, Dir.NegZ, Dir.Up, Dir.Down, Dir.NegX, Dir.PosX];

/** Quads turned like turn() turns boxes, their textures turning with them (a bed's pillow stays at its head). */
function turnQuads(quads: Quad[], turns: number): Quad[] {
  return quads.map((q) => {
    const corners = new Float64Array(q.corners);
    let { cull, dir } = q;
    for (let t = 0; t < turns; t++) {
      for (let k = 0; k < 12; k += 3) [corners[k], corners[k + 2]] = [1 - corners[k + 2], corners[k]];
      if (cull >= 0) cull = TURN_DIR[cull];
      if (dir >= 0) dir = TURN_DIR[dir];
    }
    return { ...q, corners, cull, dir };
  });
}

/** Quads moved by a function of their corners (a rotation), the directions they face mapped too (-1 for none). */
function moveQuads(quads: Quad[], move: (x: number, y: number, z: number) => [number, number, number], dirs: (d: number) => number): Quad[] {
  return quads.map((q) => {
    const c = q.corners;
    const corners = new Float64Array(12);
    for (let k = 0; k < 12; k += 3) corners.set(move(c[k], c[k + 1], c[k + 2]), k);
    return { ...q, corners, cull: q.cull >= 0 ? dirs(q.cull) : -1, dir: q.dir >= 0 ? dirs(q.dir) : -1 };
  });
}

/** Up onto the wall to the south (from the floor, a quarter turn about x), or onto the ceiling (half a turn about z). */
const ONTO_WALL = (x: number, y: number, z: number): [number, number, number] => [x, z, 1 - y];
const WALL_DIRS = [Dir.PosX, Dir.NegX, Dir.NegZ, Dir.PosZ, Dir.Up, Dir.Down];
const ONTO_CEILING = (x: number, y: number, z: number): [number, number, number] => [1 - x, 1 - y, z];
const CEILING_DIRS = [Dir.NegX, Dir.PosX, Dir.Down, Dir.Up, Dir.PosZ, Dir.NegZ];
const onto = (box: Box, face: string): Box => {
  if (face === "floor") return box;
  const a = face === "wall" ? ONTO_WALL(box[0], box[1], box[2]) : ONTO_CEILING(box[0], box[1], box[2]);
  const b = face === "wall" ? ONTO_WALL(box[3], box[4], box[5]) : ONTO_CEILING(box[3], box[4], box[5]);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
};
/** A floor model put on its face (floor, the south wall, the ceiling), then turned the way it faces. */
function attached(quads: Quad[], boxes: Box[], face: string, facing: string): { quads: Quad[]; boxes: Box[] } {
  const moved = face === "wall" ? moveQuads(quads, ONTO_WALL, (d) => WALL_DIRS[d]) : face === "ceiling" ? moveQuads(quads, ONTO_CEILING, (d) => CEILING_DIRS[d]) : quads;
  const turns = TURNS[facing];
  return { quads: turnQuads(moved, turns), boxes: boxes.map((b) => turn(onto(b, face), turns)) };
}

/** A model built pointing up, pointed to one of six facings (pistons). */
function pointed(quads: Quad[], list: Box[], facing: string): { quads: Quad[]; boxes: Box[] } {
  if (facing === "up") return { quads, boxes: list };
  return facing === "down" ? attached(quads, list, "ceiling", "north") : attached(quads, list, "wall", facing);
}

/**
 * A piston's arm: a rod 4 pixels square from 4 pixels into the base up to the head's plate, its sides
 * showing the band at the top of the piston's side, turned to run along it (as Minecraft's).
 */
function rodQuads(tile: number): Quad[] {
  const rod: Box = [px(6), px(-4), px(6), px(10), px(12), px(10)];
  return boxQuads(rod, () => tile, [Dir.PosX, Dir.NegX, Dir.PosZ, Dir.NegZ]).map((q) => {
    const c = q.corners;
    const uvs = new Float64Array(8);
    for (let k = 0; k < 4; k++) {
      const along = c[k * 3 + 1] + px(4);
      const across = (q.dir === Dir.PosX || q.dir === Dir.NegX ? c[k * 3 + 2] : c[k * 3]) - px(6);
      uvs.set([along, across], k * 2);
    }
    return { ...q, uvs };
  });
}

/** Four planes in a # (crops), each seen from both sides, sunk a pixel into the farmland below. */
function hashQuads(tile: number): Quad[] {
  const quads: Quad[] = [];
  const lo = -1 / 16;
  const hi = 15 / 16;
  for (const p of [4 / 16, 12 / 16]) {
    for (const [a, b] of [
      [
        [p, 0],
        [p, 1],
      ],
      [
        [p, 1],
        [p, 0],
      ],
    ]) {
      // Along z at x = p, and along x at z = p
      quads.push({ corners: Float64Array.of(a[0], lo, a[1], b[0], lo, b[1], b[0], hi, b[1], a[0], hi, a[1]), uvs: Float64Array.of(0, 1, 1, 1, 1, 0, 0, 0), tile, cull: -1, dir: -1, tint: 0 });
      quads.push({ corners: Float64Array.of(a[1], lo, a[0], b[1], lo, b[0], b[1], hi, b[0], a[1], hi, a[0]), uvs: Float64Array.of(0, 1, 1, 1, 1, 0, 0, 0), tile, cull: -1, dir: -1, tint: 0 });
    }
  }
  return quads;
}

/** A flat quad on the ground (redstone dust), over part of the cell (x0..x1, z0..z1), the same part of its tile. */
function groundQuad(tile: number, x0: number, z0: number, x1: number, z1: number): Quad {
  const y = 0.25 / 16;
  return { corners: Float64Array.of(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0), uvs: Float64Array.of(x0, z1, x1, z1, x1, z0, x0, z0), tile, cull: -1, dir: Dir.Up, tint: 0 };
}

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
  // A piston that hasn't pushed is a cube
  if (info.shape === "piston" && prop("extended") === "false") return null;
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
      // Its texture comes from the standing stick, wherever the stick is; a redstone torch's off is darker
      const tile = b === Block.RedstoneTorch && prop("lit") === "false" ? tileIndex("redstone_torch_off") : t[Face.Side];
      const quads = boxQuads(box, () => tile);
      const uvQuads = boxQuads(standing, () => tile);
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
    case "vine": {
      // A sheet on the wall behind, as a ladder's, but nothing to bump into
      const plate = turn([0, 0, px(15.2), 1, 1, 1], TURNS[prop("facing")]);
      const front = FACING_DIR[prop("facing")];
      return { quads: boxQuads(plate, () => t[Face.Side], [front, front ^ 1]), collision: [], selection: [plate] };
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
    case "chest": {
      // Built facing north; half of a double chest reaches to the side its other half is on
      const type = prop("type");
      const box: Box = [type === "right" ? 0 : px(1), 0, px(1), type === "left" ? 1 : px(15), px(14), px(15)];
      const turned = turn(box, TURNS[prop("facing")]);
      const front = FACING_DIR[prop("facing")];
      const quads = boxQuads(turned, (d) => (d === front ? t[Face.Front] : t[lookOf(d)]));
      return { quads, collision: [turned], selection: [turned] };
    }
    case "farmland": {
      // A pixel lower than a block; its top darker when wet
      const top = tileIndex(prop("moisture") === "7" ? "farmland_moist" : "farmland");
      const box: Box = [0, 0, 0, 1, px(15), 1];
      return { quads: boxQuads(box, (d) => (d === Dir.Up ? top : t[lookOf(d)])), collision: [box], selection: [box] };
    }
    case "crop": {
      const age = Number(prop("age"));
      const stage = b === Block.Wheat ? `wheat_stage${age}` : `${info.name}_stage${[0, 0, 1, 1, 2, 2, 2, 3][age]}`;
      return { quads: hashQuads(tileIndex(stage)), collision: [], selection: [[0, 0, 0, 1, px(2 + age * 2), 1]] };
    }
    case "stem": {
      if (info.properties.some((p) => p.name === "facing")) {
        // Bent toward its fruit (built toward the north)
        const quad = (a: number, c: number): Quad => ({ corners: Float64Array.of(0.5, 0, a, 0.5, 0, c, 0.5, px(10), c, 0.5, px(10), a), uvs: Float64Array.of(0, 1, 1, 1, 1, 6 / 16, 0, 6 / 16), tile: t[Face.Side], cull: -1, dir: -1, tint: 0 });
        return { quads: turnQuads([quad(0.5, 0), quad(0, 0.5)], TURNS[prop("facing")]), collision: [], selection: [[px(6), 0, px(6), px(10), px(10), px(10)]] };
      }
      const h = px((Number(prop("age")) + 1) * 2);
      const quads = crossQuads(t[Face.Side]).map((q) => {
        const corners = new Float64Array(q.corners);
        for (let k = 1; k < 12; k += 3) corners[k] *= h;
        const uvs = new Float64Array(q.uvs);
        for (let k = 1; k < 8; k += 2) uvs[k] = uvs[k] === 0 ? 1 - h : 1;
        return { ...q, corners, uvs };
      });
      return { quads, collision: [], selection: [[px(6), 0, px(6), px(10), Math.max(px(2), h), px(10)]] };
    }
    case "wire": {
      // Lines toward the sides it connects to; one line through if it connects one way, a cross if none
      const n = prop("north") === "true";
      const e = prop("east") === "true";
      const s = prop("south") === "true";
      const w = prop("west") === "true";
      const dot = tileIndex("redstone_dust_dot");
      const ns = tileIndex("redstone_dust_line0");
      const ew = tileIndex("redstone_dust_line1");
      const quads: Quad[] = [];
      const count = [n, e, s, w].filter(Boolean).length;
      if (count === 0 || ((n || s) && !e && !w)) quads.push(groundQuad(ns, 0, 0, 1, 1));
      if (count === 0 || ((e || w) && !n && !s)) quads.push(groundQuad(ew, 0, 0, 1, 1));
      if (count > 0 && (n || s) && (e || w)) {
        quads.push(groundQuad(dot, 0, 0, 1, 1));
        if (n) quads.push(groundQuad(ns, 0, 0, 1, 0.5));
        if (s) quads.push(groundQuad(ns, 0, 0.5, 1, 1));
        if (w) quads.push(groundQuad(ew, 0, 0, 0.5, 1));
        if (e) quads.push(groundQuad(ew, 0.5, 0, 1, 1));
      }
      return { quads, collision: [], selection: [[0, 0, 0, 1, px(1), 1]] };
    }
    case "lever": {
      // A cobblestone base and a handle leaning one way or the other (built on the floor, facing north)
      const base: Box = [px(5), 0, px(4), px(11), px(3), px(12)];
      const stone = tileIndex("cobblestone");
      const lean = prop("powered") === "true" ? -Math.PI / 4 : Math.PI / 4;
      const handle = moveQuads(
        boxQuads([px(7), px(1), px(7), px(9), px(11), px(9)], () => t[Face.Side]),
        (x, y, z) => {
          const dy = y - px(1);
          const dz = z - 0.5;
          return [x, px(1) + dy * Math.cos(lean) - dz * Math.sin(lean), 0.5 + dy * Math.sin(lean) + dz * Math.cos(lean)];
        },
        () => -1,
      );
      const { quads, boxes: sel } = attached([...boxQuads(base, () => stone), ...handle], [[px(4), 0, px(4), px(12), px(10), px(12)]], prop("face"), prop("facing"));
      return { quads, collision: [], selection: sel };
    }
    case "button": {
      const pressed = prop("powered") === "true";
      const box: Box = [px(5), 0, px(6), px(11), px(pressed ? 1 : 2), px(10)];
      const { quads, boxes: sel } = attached(boxQuads(box, (d) => t[lookOf(d)]), [box], prop("face"), prop("facing"));
      return { quads, collision: [], selection: sel };
    }
    case "plate": {
      const box: Box = [px(1), 0, px(1), px(15), px(prop("powered") === "true" ? 0.5 : 1), px(15)];
      return { quads: boxQuads(box, (d) => t[lookOf(d)]), collision: [], selection: [box] };
    }
    case "repeater": {
      // A thin slab with its arrow on top, two little torches (the back one where the delay puts it); built facing north
      const on = prop("powered") === "true";
      const slab: Box = [0, 0, 0, 1, px(2), 1];
      const top = tileIndex(on ? "repeater_on" : "repeater");
      const torch = tileIndex(on ? "redstone_torch" : "redstone_torch_off");
      const back = 6 + (Number(prop("delay")) - 1) * 2;
      const torches = [px(2), px(back)].flatMap((z0) => boxQuads([px(7), px(2), z0, px(9), px(7), z0 + px(2)], () => torch, [Dir.PosX, Dir.NegX, Dir.Up, Dir.PosZ, Dir.NegZ]));
      const quads = turnQuads([...boxQuads(slab, (d) => (d === Dir.Up ? top : t[lookOf(d)])), ...torches], TURNS[prop("facing")]);
      return { quads, collision: [slab], selection: [slab] };
    }
    case "piston": {
      // The base without its head: 12 pixels deep, its inside showing where the head was (built pointing up)
      const base: Box = [0, 0, 0, 1, px(12), 1];
      const inner = tileIndex("piston_inner");
      const { quads, boxes: list } = pointed(boxQuads(base, (d) => (d === Dir.Up ? inner : t[lookOf(d)])), [base], prop("facing"));
      return { quads, collision: list, selection: list };
    }
    case "piston_head": {
      // The plate, its face sticky or not, and the rod back into the base (built pointing up)
      const plate: Box = [0, px(12), 0, 1, 1, 1];
      const face = tileIndex(prop("type") === "sticky" ? "piston_top_sticky" : "piston_top");
      const side = t[Face.Side];
      const own = [...boxQuads(plate, (d) => (d === Dir.Up ? face : d === Dir.Down ? t[Face.Bottom] : side)), ...rodQuads(side)];
      const { quads, boxes: list } = pointed(own, [plate, [px(6), 0, px(6), px(10), px(12), px(10)]], prop("facing"));
      return { quads, collision: list, selection: list };
    }
    case "moving":
      return { quads: [], collision: [], selection: [] };
    case "hopper": {
      // A bowl (its floor 10 pixels up, walls 2 thick round it), a narrower box under it, and a spout
      const top = tileIndex("hopper_top");
      const inside = tileIndex("hopper_inside");
      const outside = t[Face.Side];
      const floor: Box = [0, px(10), 0, 1, px(11), 1];
      const walls: Box[] = [
        [0, px(11), 0, px(2), 1, 1],
        [px(14), px(11), 0, 1, 1, 1],
        [px(2), px(11), 0, px(14), 1, px(2)],
        [px(2), px(11), px(14), px(14), 1, 1],
      ];
      const middle: Box = [px(4), px(4), px(4), px(12), px(10), px(12)];
      const facing = prop("facing");
      const spout: Box = facing === "down" ? [px(6), 0, px(6), px(10), px(4), px(10)] : turn([px(6), px(4), 0, px(10), px(8), px(4)], TURNS[facing]);
      const quads = [
        ...boxQuads(floor, (d) => (d === Dir.Up ? inside : outside)),
        ...walls.flatMap((b) => boxQuads(b, (d) => (d === Dir.Up ? top : outside))),
        ...[middle, spout].flatMap((b) => boxQuads(b, () => outside)),
      ];
      const list = [floor, ...walls, middle, spout];
      return { quads, collision: list, selection: [[0, px(10), 0, 1, 1, 1], middle, spout] };
    }
    case "comparator": {
      // A thin slab with its arrow on top; two torches at the back lit while it sends power, one at the
      // front lit when it subtracts (built facing north, the way it sends power)
      const on = Number(prop("power")) > 0;
      const slab: Box = [0, 0, 0, 1, px(2), 1];
      const top = tileIndex(on ? "comparator_on" : "comparator");
      const torch = (lit: boolean): number => tileIndex(lit ? "redstone_torch" : "redstone_torch_off");
      const stick = (x: number, z: number, lit: boolean, h: number): Quad[] => boxQuads([px(x), px(2), px(z), px(x + 2), px(h), px(z + 2)], () => torch(lit), [Dir.PosX, Dir.NegX, Dir.Up, Dir.PosZ, Dir.NegZ]);
      const quads = turnQuads(
        [...boxQuads(slab, (d) => (d === Dir.Up ? top : t[lookOf(d)])), ...stick(3, 11, on, 7), ...stick(11, 11, on, 7), ...stick(7, 2, prop("mode") === "subtract", 5)],
        TURNS[prop("facing")],
      );
      return { quads, collision: [slab], selection: [slab] };
    }
    case "bed": {
      // Built facing north (the head toward -z), then turned. A side shows Minecraft's texture of the
      // opposite side: Craft's world is Minecraft's mirrored, and so the pillow stays at the head end
      const color = info.name.slice(0, -"_bed".length);
      const head = prop("part") === "head";
      const part = head ? "head" : "foot";
      const end = head ? Dir.NegZ : Dir.PosZ;
      const tiles: Record<number, number> = {
        [Dir.Up]: tileIndex(`${color}_bed_${part}_up`),
        [Dir.Down]: tileIndex("bed_down"),
        [Dir.PosX]: tileIndex(`${color}_bed_${part}_west`),
        [Dir.NegX]: tileIndex(`${color}_bed_${part}_east`),
        [end]: tileIndex(head ? "bed_head_north" : `${color}_bed_foot_south`),
      };
      const mattress: Box = [0, px(3), 0, 1, px(9), 1];
      // Two wooden legs at the end
      const z0 = head ? 0 : px(13);
      const legs: Box[] = [
        [0, 0, z0, px(3), px(3), z0 + px(3)],
        [px(13), 0, z0, 1, px(3), z0 + px(3)],
      ];
      const quads = [...boxQuads(mattress, (d) => tiles[d], [Dir.Up, Dir.Down, Dir.PosX, Dir.NegX, end]), ...legs.flatMap((b) => boxQuads(b, () => tiles[Dir.Down]))];
      const box: Box = [0, 0, 0, 1, px(9), 1];
      return { quads: turnQuads(quads, TURNS[prop("facing")]), collision: [box], selection: [box] };
    }
    case "lilypad": {
      // A leaf lying on the water, seen from above and below
      const leaf: Box = [0, px(0.25), 0, 1, px(0.25), 1];
      return { quads: boxQuads(leaf, () => t[Face.Top], [Dir.Up, Dir.Down]), collision: [[0, 0, 0, 1, px(1.5), 1]], selection: [[0, 0, 0, 1, px(1.5), 1]] };
    }
  }
}

/** The tint of a state's quads: its block's, but redstone's by its power and a stem's by its age. */
function tintOf(s: number): number {
  const b = STATE_BLOCK[s];
  if (b === Block.RedstoneWire) return Tint.Redstone + Number(propertyOf(s, "power"));
  if (b === Block.PumpkinStem || b === Block.MelonStem) return Tint.Stem + Number(propertyOf(s, "age"));
  if (b === Block.AttachedPumpkinStem || b === Block.AttachedMelonStem) return Tint.Stem + 7;
  return BLOCKS[b].tint;
}

const PARTS: readonly (Parts | null)[] = Array.from({ length: STATE_COUNT }, (_, s) => {
  const parts = partsOf(s);
  const tint = tintOf(s);
  for (const q of parts?.quads ?? []) q.tint = tint;
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
 * door halves on the block below (the upper half on the lower one), a bed's halves on each other.
 */
export const SUPPORT: Int8Array = Int8Array.from({ length: STATE_COUNT }, (_, s) => {
  const shape = SHAPE[s];
  if (shape === "torch") {
    const facing = propertyOf(s, "facing");
    return facing === "up" ? Dir.Down : FACING_DIR[facing] ^ 1;
  }
  if (shape === "ladder" || shape === "vine") return FACING_DIR[propertyOf(s, "facing")] ^ 1;
  // Levers and buttons on the floor, a wall (behind them) or the ceiling
  if (shape === "lever" || shape === "button") {
    const face = propertyOf(s, "face");
    return face === "floor" ? Dir.Down : face === "ceiling" ? Dir.Up : FACING_DIR[propertyOf(s, "facing")] ^ 1;
  }
  if (shape === "crop" || shape === "stem" || shape === "wire" || shape === "plate" || shape === "repeater" || shape === "comparator") return Dir.Down;
  // A bed's halves hold each other: the head lies the way it faces from the foot
  if (shape === "bed") return FACING_DIR[propertyOf(s, "facing")] ^ (propertyOf(s, "part") === "foot" ? 0 : 1);
  if (shape === "cross" || shape === "carpet" || shape === "snow" || shape === "cactus" || shape === "door" || shape === "tall" || shape === "lilypad") return Dir.Down;
  return -1;
});

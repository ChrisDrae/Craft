import { FLUID, SHAPE, propertyOf } from "../blocks.js";
import { COLLISION } from "../shapes.js";

/** What finding a path needs of the world. */
export interface PathWorld {
  get(x: number, y: number, z: number): number;
}

export interface PathNode {
  x: number;
  y: number;
  z: number;
}

/** Nodes looked at per search at most (Minecraft's budget), how far down a mob will drop, how far a path goes. */
const BUDGET = 600;
const MAX_DROP = 3;
const RANGE = 40;

/** The highest point of a state's collision boxes in its cell (0 for none). */
function topOf(state: number): number {
  const boxes = COLLISION[state];
  let top = 0;
  for (let i = 4; i < boxes.length; i += 6) top = Math.max(top, boxes[i]);
  return top;
}

/** Whether a body may be in a block: nothing in the way (an open door or trapdoor, a carpet underfoot), no lava. */
export function passable(state: number, feet: boolean): boolean {
  if (FLUID[state] === 2) return false;
  const shape = SHAPE[state];
  if ((shape === "door" || shape === "trapdoor") && propertyOf(state, "open") === "true") return true;
  const top = topOf(state);
  return top === 0 || (feet && top <= 0.2);
}

/** How a mob `cells` blocks tall can be with its feet in (x, y, z): standing, swimming, or not at all. */
export function standing(w: PathWorld, x: number, y: number, z: number, cells: number): "walk" | "swim" | null {
  for (let k = 0; k < cells; k++) if (!passable(w.get(x, y + k, z), k === 0)) return null;
  if (FLUID[w.get(x, y, z)] === 1) return "swim";
  // On the top of a block or slab; not on fences, which are too high to stand on
  const below = topOf(w.get(x, y - 1, z));
  return below >= 0.5 && below <= 1 ? "walk" : null;
}

const key = (x: number, y: number, z: number): number => ((x + 32768) * 65536 + (z + 32768)) * 256 + y;

interface Open extends PathNode {
  g: number;
  f: number;
  parent: Open | null;
}

/** A min-heap of open nodes by f. */
class Heap {
  private readonly items: Open[] = [];
  get size(): number {
    return this.items.length;
  }
  push(n: Open): void {
    const a = this.items;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): Open {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * A path for a mob `height` blocks tall from block (sx, sy, sz) (its feet) toward (tx, ty, tz), as Minecraft's
 * mobs find theirs: A* over the blocks it can stand or swim in, stepping up a block, dropping up to three,
 * through open doors, diagonally where both sides are clear. Within BUDGET nodes; when the goal can't be
 * reached, the way to the nearest point found. The start is left out; empty when there is nowhere to go.
 */
export function findPath(w: PathWorld, sx: number, sy: number, sz: number, tx: number, ty: number, tz: number, height: number): PathNode[] {
  const cells = Math.max(1, Math.ceil(height - 0.01));
  const h = (x: number, y: number, z: number): number => Math.hypot(x - tx, (y - ty) * 1.5, z - tz);
  const start: Open = { x: sx, y: sy, z: sz, g: 0, f: h(sx, sy, sz), parent: null };
  const open = new Heap();
  open.push(start);
  const best = new Map<number, number>([[key(sx, sy, sz), 0]]);
  let closest = start;
  let budget = BUDGET;
  while (open.size > 0 && budget-- > 0) {
    const n = open.pop();
    if (n.g > (best.get(key(n.x, n.y, n.z)) ?? Infinity)) continue;
    if (h(n.x, n.y, n.z) < h(closest.x, closest.y, closest.z)) closest = n;
    if (n.x === tx && n.z === tz && Math.abs(n.y - ty) <= 1) {
      closest = n;
      break;
    }
    for (const [dx, dz] of DIRS) {
      const x = n.x + dx;
      const z = n.z + dz;
      if (Math.abs(x - sx) > RANGE || Math.abs(z - sz) > RANGE) continue;
      const diagonal = dx !== 0 && dz !== 0;
      // Diagonally only where both sides are clear
      if (diagonal && (!standing(w, n.x + dx, n.y, n.z, cells) || !standing(w, n.x, n.y, n.z + dz, cells))) continue;
      const step = diagonal ? Math.SQRT2 : 1;
      const tries: Array<[number, number]> = [];
      const level = standing(w, x, n.y, z, cells);
      if (level) {
        tries.push([n.y, level === "swim" ? step * 2 : step]);
      } else if (!diagonal && standing(w, x, n.y + 1, z, cells) && passable(w.get(n.x, n.y + cells, n.z), false)) {
        // Up a block: room to jump overhead
        tries.push([n.y + 1, step + 1]);
      } else if (!diagonal && passable(w.get(x, n.y, z), true)) {
        // Down: through the air over the edge to the ground below
        for (let d = 1; d <= MAX_DROP; d++) {
          const y = n.y - d;
          if (!passable(w.get(x, y + cells - 1, z), false) && cells > 1) break;
          const there = standing(w, x, y, z, cells);
          if (there) {
            tries.push([y, step + d * 0.5]);
            break;
          }
          if (!passable(w.get(x, y, z), true)) break;
        }
      }
      for (const [y, cost] of tries) {
        const g = n.g + cost;
        const k = key(x, y, z);
        if (g >= (best.get(k) ?? Infinity)) continue;
        best.set(k, g);
        open.push({ x, y, z, g, f: g + h(x, y, z), parent: n });
      }
    }
  }
  const path: PathNode[] = [];
  for (let n: Open | null = closest; n && n !== start; n = n.parent) path.push({ x: n.x, y: n.y, z: n.z });
  return path.reverse();
}

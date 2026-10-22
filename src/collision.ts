import type { Vec3 } from "projector";

/** Blocks with boxes that stop entities (see COLLISION), such as the VoxelWorld. */
export interface ShapeQuery {
  /** The boxes of the block at (x, y, z): min x, y, z, max x, y, z each, in the block's own coordinates. */
  collisionBoxes(x: number, y: number, z: number): ArrayLike<number>;
}

/** Gap left between a box and the block it was stopped by, so it doesn't count as touching it next step. */
const SKIN = 1e-4;
/** Shrinks the box when finding the cells it covers, so a face lying on a cell border doesn't cover it. */
const EDGE = 1e-6;

/**
 * Moves an upright box by `delta` along one axis (0 x, 1 y, 2 z) and stops it against the blocks'
 * collision boxes. The box is centered on `pos` in x and z, `halfWidth` to each side, and reaches from
 * `pos.y` up to `pos.y + height`. Moves must be shorter than a block so nothing is skipped. Returns true on
 * a hit.
 */
export function moveAxis(
  world: ShapeQuery,
  pos: Vec3,
  halfWidth: number,
  height: number,
  axis: 0 | 1 | 2,
  delta: number,
): boolean {
  if (delta === 0) return false;
  if (axis === 0) pos.x += delta;
  else if (axis === 1) pos.y += delta;
  else pos.z += delta;

  const x0 = Math.floor(pos.x - halfWidth + EDGE);
  const x1 = Math.floor(pos.x + halfWidth - EDGE);
  // One cell lower too: fences and walls reach half a block above their own cell
  const y0 = Math.floor(pos.y + EDGE) - 1;
  const y1 = Math.floor(pos.y + height - EDGE);
  const z0 = Math.floor(pos.z - halfWidth + EDGE);
  const z1 = Math.floor(pos.z + halfWidth - EDGE);
  // The box face nearest to where the moving box came from
  let limit = delta > 0 ? Infinity : -Infinity;
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const boxes = world.collisionBoxes(x, y, z);
        for (let i = 0; i < boxes.length; i += 6) {
          const bx0 = x + boxes[i];
          const by0 = y + boxes[i + 1];
          const bz0 = z + boxes[i + 2];
          const bx1 = x + boxes[i + 3];
          const by1 = y + boxes[i + 4];
          const bz1 = z + boxes[i + 5];
          if (bx1 <= pos.x - halfWidth + EDGE || bx0 >= pos.x + halfWidth - EDGE) continue;
          if (by1 <= pos.y + EDGE || by0 >= pos.y + height - EDGE) continue;
          if (bz1 <= pos.z - halfWidth + EDGE || bz0 >= pos.z + halfWidth - EDGE) continue;
          if (delta > 0) limit = Math.min(limit, axis === 0 ? bx0 : axis === 1 ? by0 : bz0);
          else limit = Math.max(limit, axis === 0 ? bx1 : axis === 1 ? by1 : bz1);
        }
      }
    }
  }
  if (!Number.isFinite(limit)) return false;

  if (axis === 0) pos.x = delta > 0 ? limit - halfWidth - SKIN : limit + halfWidth + SKIN;
  else if (axis === 1) pos.y = delta > 0 ? limit - height - SKIN : limit + SKIN;
  else pos.z = delta > 0 ? limit - halfWidth - SKIN : limit + halfWidth + SKIN;
  return true;
}

/** Whether an upright box (as in moveAxis) overlaps the block cell (x, y, z). */
export function boxOverlapsCell(pos: Vec3, halfWidth: number, height: number, x: number, y: number, z: number): boolean {
  return (
    pos.x + halfWidth > x &&
    pos.x - halfWidth < x + 1 &&
    pos.y + height > y &&
    pos.y < y + 1 &&
    pos.z + halfWidth > z &&
    pos.z - halfWidth < z + 1
  );
}

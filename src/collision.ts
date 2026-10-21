import type { Vec3 } from "projector";

export interface SolidQuery {
  isSolid(x: number, y: number, z: number): boolean;
}

/** Gap left between a box and the block it was stopped by, so it doesn't count as touching it next step. */
const SKIN = 1e-4;
/** Shrinks the box when finding the cells it covers, so a face lying on a cell border doesn't cover it. */
const EDGE = 1e-6;

/**
 * Moves an upright box by `delta` along one axis (0 x, 1 y, 2 z) and stops it against solid blocks.
 * The box is centered on `pos` in x and z, `halfWidth` to each side, and reaches from `pos.y` up to
 * `pos.y + height`. Moves must be shorter than a block so nothing is skipped. Returns true on a hit.
 */
export function moveAxis(
  world: SolidQuery,
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
  const y0 = Math.floor(pos.y + EDGE);
  const y1 = Math.floor(pos.y + height - EDGE);
  const z0 = Math.floor(pos.z - halfWidth + EDGE);
  const z1 = Math.floor(pos.z + halfWidth - EDGE);
  // The block face nearest to where the box came from
  let limit = delta > 0 ? Infinity : -Infinity;
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (!world.isSolid(x, y, z)) continue;
        const cell = axis === 0 ? x : axis === 1 ? y : z;
        if (delta > 0) limit = Math.min(limit, cell);
        else limit = Math.max(limit, cell + 1);
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

export interface VoxelHit {
  x: number;
  y: number;
  z: number;
  /** Normal of the face the ray entered through: the neighbor there is where a block gets placed. */
  nx: number;
  ny: number;
  nz: number;
  /** The state of the block hit. */
  block: number;
  distance: number;
}

/**
 * Walks the grid cells along a ray (Amanatides & Woo) and returns the first block whose selection boxes
 * (see SELECTION) the ray hits, within `maxDistance`. A block that fills its cell is hit where the ray
 * enters the cell; smaller boxes where the ray meets them. The direction must be a unit vector. The cell
 * the ray starts in is skipped.
 */
export function raycastVoxels(
  blockAt: (x: number, y: number, z: number) => number,
  selection: (block: number) => ArrayLike<number>,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDistance: number,
): VoxelHit | null {
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const stepZ = Math.sign(dz);
  const deltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const deltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const deltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  // Distance along the ray to the next cell boundary on each axis
  let maxX = dx > 0 ? (x + 1 - ox) * deltaX : dx < 0 ? (ox - x) * deltaX : Infinity;
  let maxY = dy > 0 ? (y + 1 - oy) * deltaY : dy < 0 ? (oy - y) * deltaY : Infinity;
  let maxZ = dz > 0 ? (z + 1 - oz) * deltaZ : dz < 0 ? (oz - z) * deltaZ : Infinity;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (;;) {
    let t: number;
    if (maxX <= maxY && maxX <= maxZ) {
      x += stepX;
      t = maxX;
      maxX += deltaX;
      nx = -stepX;
      ny = 0;
      nz = 0;
    } else if (maxY <= maxZ) {
      y += stepY;
      t = maxY;
      maxY += deltaY;
      nx = 0;
      ny = -stepY;
      nz = 0;
    } else {
      z += stepZ;
      t = maxZ;
      maxZ += deltaZ;
      nx = 0;
      ny = 0;
      nz = -stepZ;
    }
    if (t > maxDistance) return null;
    const block = blockAt(x, y, z);
    const boxes = selection(block);
    if (boxes.length === 0) continue;
    if (isCube(boxes)) return { x, y, z, nx, ny, nz, block, distance: t };
    const hit = rayBoxes(boxes, ox - x, oy - y, oz - z, dx, dy, dz);
    if (hit && hit.distance <= maxDistance) return { x, y, z, nx: hit.nx, ny: hit.ny, nz: hit.nz, block, distance: hit.distance };
  }
}

function isCube(b: ArrayLike<number>): boolean {
  return b.length === 6 && b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 1 && b[4] === 1 && b[5] === 1;
}

/**
 * The nearest of the boxes a ray hits (slab method), with the normal of the face it enters through. The
 * ray starts at (ox, oy, oz) in the block's own coordinates.
 */
function rayBoxes(
  b: ArrayLike<number>,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
): { distance: number; nx: number; ny: number; nz: number } | null {
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  let best: { distance: number; nx: number; ny: number; nz: number } | null = null;
  for (let i = 0; i < b.length; i += 6) {
    let near = 0;
    let far = Infinity;
    let axis = -1;
    for (let a = 0; a < 3; a++) {
      const lo = b[i + a];
      const hi = b[i + 3 + a];
      if (d[a] === 0) {
        if (o[a] < lo || o[a] > hi) far = -1;
        continue;
      }
      const t0 = (lo - o[a]) / d[a];
      const t1 = (hi - o[a]) / d[a];
      const enter = Math.min(t0, t1);
      if (enter > near) {
        near = enter;
        axis = a;
      }
      far = Math.min(far, Math.max(t0, t1));
    }
    if (near > far || axis < 0 || (best && near >= best.distance)) continue;
    const sign = d[axis] > 0 ? -1 : 1;
    best = { distance: near, nx: axis === 0 ? sign : 0, ny: axis === 1 ? sign : 0, nz: axis === 2 ? sign : 0 };
  }
  return best;
}

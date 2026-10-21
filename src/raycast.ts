export interface VoxelHit {
  x: number;
  y: number;
  z: number;
  /** Normal of the face the ray entered through: the neighbor there is where a block gets placed. */
  nx: number;
  ny: number;
  nz: number;
  block: number;
  distance: number;
}

/**
 * Walks the grid cells along a ray (Amanatides & Woo) and returns the first block for which `hits` is
 * true, within `maxDistance`. The direction must be a unit vector. The cell the ray starts in is skipped.
 */
export function raycastVoxels(
  blockAt: (x: number, y: number, z: number) => number,
  hits: (block: number) => boolean,
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
    if (hits(block)) return { x, y, z, nx, ny, nz, block, distance: t };
  }
}

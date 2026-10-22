import { EMISSION, LIGHT_FILTER, LIGHT_SINK } from "./blocks.js";
import { CHUNK_SIZE, SECTIONS, SECTION_VOLUME, WORLD_HEIGHT, type Chunk } from "./chunk.js";

/**
 * Light levels as Minecraft has them, 0-15 per block in two channels: sky light, 15 wherever the sky is
 * straight above and one less per block away from there; and block light from torches and glowstone, one
 * less per block from the source. A block's light filter dims light entering it by that much more
 * (water, leaves); 15 stops it (opaque blocks); slabs and stairs let it in but not on (LIGHT_SINK). Light
 * is packed as sky * 16 + block.
 */

/** Full sky light and no block light: open air. */
export const OPEN_SKY = 0xf0;
const COLUMN = CHUNK_SIZE * CHUNK_SIZE;
const VOLUME = COLUMN * WORLD_HEIGHT;

/** What light updates need from the world (VoxelWorld). */
export interface LightWorld {
  get(x: number, y: number, z: number): number;
  getLight(x: number, y: number, z: number): number;
  /** Sets the packed light of a loaded block (and marks what must be drawn again); false outside. */
  setLight(x: number, y: number, z: number, light: number): boolean;
  chunk(cx: number, cz: number): Chunk | undefined;
}

// Working space for lighting a chunk, reused (one chunk at a time per thread)
const filter = new Uint8Array(VOLUME);
const skyLevel = new Uint8Array(VOLUME);
const blockLevel = new Uint8Array(VOLUME);
const tops = new Int16Array(COLUMN);
let queue = new Int32Array(1 << 16);

/** Puts a cell at position n of the queue (growing it if needed) and returns the new length. */
function enqueue(n: number, i: number): number {
  if (n === queue.length) {
    const grown = new Int32Array(queue.length * 2);
    grown.set(queue);
    queue = grown;
  }
  queue[n] = i;
  return n + 1;
}

/**
 * The level light comes into a block with, from a neighbor with `level` in direction d (3: from above),
 * through the block's filter f; 0 or less where it doesn't.
 */
function entering(level: number, f: number, d: number, sky: boolean): number {
  if (f === 15) return 0;
  // Sky light falls straight down through clear blocks undimmed (into slabs and stairs too)
  if (sky && d === 3 && level === 15 && (f === 0 || f === LIGHT_SINK)) return 15;
  return level - 1 - (f === LIGHT_SINK ? 0 : f);
}

/** Spreads the levels from the queued cells through the chunk (not beyond it). */
function spread(levels: Uint8Array, length: number, sky: boolean): void {
  let head = 0;
  let tail = length;
  const push = (j: number): void => {
    if (tail === queue.length) {
      // Compact what was used, or grow
      if (head > 0) {
        queue.copyWithin(0, head, tail);
        tail -= head;
        head = 0;
      } else {
        const grown = new Int32Array(queue.length * 2);
        grown.set(queue);
        queue = grown;
      }
    }
    queue[tail++] = j;
  };
  while (head < tail) {
    const i = queue[head++];
    const level = levels[i];
    if (level <= 1 || filter[i] === LIGHT_SINK) continue;
    const x = i & 15;
    const z = (i >> 4) & 15;
    const y = i >> 8;
    for (let d = 0; d < 6; d++) {
      let j: number;
      if (d === 0) {
        if (x === 15) continue;
        j = i + 1;
      } else if (d === 1) {
        if (x === 0) continue;
        j = i - 1;
      } else if (d === 2) {
        if (y === WORLD_HEIGHT - 1) continue;
        j = i + COLUMN;
      } else if (d === 3) {
        if (y === 0) continue;
        j = i - COLUMN;
      } else if (d === 4) {
        if (z === 15) continue;
        j = i + CHUNK_SIZE;
      } else {
        if (z === 0) continue;
        j = i - CHUNK_SIZE;
      }
      const next = entering(level, filter[j], d, sky);
      if (next > levels[j]) {
        levels[j] = next;
        push(j);
      }
    }
  }
}

/**
 * Lights a chunk on its own, as if every neighbor were solid: what the worker does for every chunk it
 * makes or reads. The light from and into the neighbors is joined when the chunk enters the world
 * (joinChunk).
 */
export function lightChunk(chunk: Chunk): void {
  filter.fill(0);
  skyLevel.fill(0);
  blockLevel.fill(0);
  let n = 0;
  for (let s = 0; s < SECTIONS; s++) {
    const blocks = chunk.sections[s].blocks;
    if (!blocks) continue;
    const base = s * SECTION_VOLUME;
    for (let i = 0; i < SECTION_VOLUME; i++) {
      const b = blocks[i];
      if (b === 0) continue;
      filter[base + i] = LIGHT_FILTER[b];
      const e = EMISSION[b];
      if (e > 0) {
        blockLevel[base + i] = e;
        n = enqueue(n, base + i);
      }
    }
  }
  spread(blockLevel, n, false);

  // Straight down from the top of the world until something dims the light: full sky light
  for (let c = 0; c < COLUMN; c++) {
    let y = WORLD_HEIGHT - 1;
    while (y >= 0 && filter[y * COLUMN + c] === 0) {
      skyLevel[y * COLUMN + c] = 15;
      y--;
    }
    tops[c] = y + 1;
  }
  // Spread from the lit cells next to unlit ones: beside a lower neighbor column, and above the first blocker
  n = 0;
  for (let c = 0; c < COLUMN; c++) {
    const x = c & 15;
    const z = c >> 4;
    let reach = tops[c] + 1;
    if (x > 0) reach = Math.max(reach, tops[c - 1]);
    if (x < 15) reach = Math.max(reach, tops[c + 1]);
    if (z > 0) reach = Math.max(reach, tops[c - CHUNK_SIZE]);
    if (z < 15) reach = Math.max(reach, tops[c + CHUNK_SIZE]);
    for (let y = tops[c]; y < Math.min(reach, WORLD_HEIGHT); y++) n = enqueue(n, y * COLUMN + c);
  }
  spread(skyLevel, n, true);

  // Back into the sections, as one value where a whole section has the same light
  for (let s = 0; s < SECTIONS; s++) {
    const section = chunk.sections[s];
    const base = s * SECTION_VOLUME;
    const first = (skyLevel[base] << 4) | blockLevel[base];
    let uniform = true;
    for (let i = 1; i < SECTION_VOLUME && uniform; i++) uniform = ((skyLevel[base + i] << 4) | blockLevel[base + i]) === first;
    if (uniform) {
      section.light = null;
      section.lightFill = first;
      continue;
    }
    const light = section.light ?? new Uint8Array(SECTION_VOLUME);
    for (let i = 0; i < SECTION_VOLUME; i++) light[i] = (skyLevel[base + i] << 4) | blockLevel[base + i];
    section.light = light;
  }
}

/** Light at a block of a chunk, by local coordinates. */
export function chunkLight(chunk: Chunk, x: number, y: number, z: number): number {
  const s = chunk.sections[y >> 4];
  return s.light ? s.light[((y & 15) << 8) | (z << 4) | x] : s.lightFill;
}

const DX = [1, -1, 0, 0, 0, 0];
const DY = [0, 0, 1, -1, 0, 0];
const DZ = [0, 0, 0, 0, 1, -1];

/** Cells waiting in a light update: positions and (for removals) the level they had. */
class Cells {
  x: number[] = [];
  y: number[] = [];
  z: number[] = [];
  level: number[] = [];
  head: number = 0;

  push(x: number, y: number, z: number, level: number = 0): void {
    this.x.push(x);
    this.y.push(y);
    this.z.push(z);
    this.level.push(level);
  }

  get empty(): boolean {
    return this.head >= this.x.length;
  }

  clear(): void {
    this.x.length = this.y.length = this.z.length = this.level.length = 0;
    this.head = 0;
  }
}

const channelOf = (light: number, sky: boolean): number => (sky ? light >> 4 : light & 15);
const withChannel = (light: number, sky: boolean, level: number): number => (sky ? (light & 15) | (level << 4) : (light & 0xf0) | level);

/** Spreads light outward from the queued cells across loaded chunks, raising what is darker. */
function spreadWorld(world: LightWorld, cells: Cells, sky: boolean): void {
  while (!cells.empty) {
    const i = cells.head++;
    const x = cells.x[i];
    const y = cells.y[i];
    const z = cells.z[i];
    const level = channelOf(world.getLight(x, y, z), sky);
    if (level <= 1 || LIGHT_FILTER[world.get(x, y, z)] === LIGHT_SINK) continue;
    for (let d = 0; d < 6; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      const nz = z + DZ[d];
      if (ny < 0 || ny >= WORLD_HEIGHT) continue;
      const next = entering(level, LIGHT_FILTER[world.get(nx, ny, nz)], d, sky);
      const light = world.getLight(nx, ny, nz);
      if (next > channelOf(light, sky) && world.setLight(nx, ny, nz, withChannel(light, sky, next))) cells.push(nx, ny, nz);
    }
  }
  cells.clear();
}

const removing = new Cells();
const adding = new Cells();

/**
 * Takes away the light that came through the queued cells (each with the level it had), and queues the
 * cells next to the dark area that still have light of their own, to fill it in again.
 */
function unspreadWorld(world: LightWorld, sky: boolean): void {
  while (!removing.empty) {
    const i = removing.head++;
    const x = removing.x[i];
    const y = removing.y[i];
    const z = removing.z[i];
    const level = removing.level[i];
    for (let d = 0; d < 6; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      const nz = z + DZ[d];
      if (ny < 0 || ny >= WORLD_HEIGHT) continue;
      const light = world.getLight(nx, ny, nz);
      const n = channelOf(light, sky);
      if (n === 0) continue;
      if (n < level || (sky && d === 3 && level === 15 && n === 15)) {
        if (world.setLight(nx, ny, nz, withChannel(light, sky, 0))) removing.push(nx, ny, nz, n);
      } else {
        adding.push(nx, ny, nz);
      }
    }
  }
  removing.clear();
}

/**
 * Brings the light up to date after the block at (x, y, z) changed (the new block already in place): the
 * light that came through the block is taken away and filled in again from what remains, and a block
 * that gives off light lights its surroundings.
 */
export function relight(world: LightWorld, x: number, y: number, z: number): void {
  for (const sky of [true, false]) {
    const light = world.getLight(x, y, z);
    const old = channelOf(light, sky);
    const own = sky ? 0 : EMISSION[world.get(x, y, z)];
    if (old > 0) {
      world.setLight(x, y, z, withChannel(light, sky, 0));
      removing.push(x, y, z, old);
      unspreadWorld(world, sky);
    }
    if (own > 0) {
      world.setLight(x, y, z, withChannel(world.getLight(x, y, z), sky, own));
      adding.push(x, y, z);
    }
    // The neighbors light the block again if it lets light through now
    for (let d = 0; d < 6; d++) {
      const ny = y + DY[d];
      if (ny >= 0 && ny < WORLD_HEIGHT) adding.push(x + DX[d], ny, z + DZ[d]);
    }
    spreadWorld(world, adding, sky);
  }
}

/**
 * Joins the light of a chunk that just entered the world with its neighbors': wherever light can flow
 * across a border to a darker block, it spreads from there (into this chunk, the neighbors and beyond).
 */
export function joinChunk(world: LightWorld, chunk: Chunk): void {
  const ox = chunk.cx * CHUNK_SIZE;
  const oz = chunk.cz * CHUNK_SIZE;
  for (const sky of [true, false]) {
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const other = world.chunk(chunk.cx + dx, chunk.cz + dz);
      if (!other) continue;
      for (let s = 0; s < SECTIONS; s++) {
        const a = chunk.sections[s];
        const b = other.sections[s];
        // The same light on both sides can't flow anywhere
        if (!a.light && !b.light && a.lightFill === b.lightFill) continue;
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
          const y = s * CHUNK_SIZE + ly;
          for (let k = 0; k < CHUNK_SIZE; k++) {
            // This chunk's border block and the one across in the neighbor
            const ax = dx === 1 ? 15 : dx === -1 ? 0 : k;
            const az = dz === 1 ? 15 : dz === -1 ? 0 : k;
            const bx = dx === 0 ? ax : 15 - ax;
            const bz = dz === 0 ? az : 15 - az;
            const la = channelOf(chunkLight(chunk, ax, y, az), sky);
            const lb = channelOf(chunkLight(other, bx, y, bz), sky);
            if (la - 1 > lb) adding.push(ox + ax, y, oz + az);
            else if (lb - 1 > la) adding.push(ox + ax + dx, y, oz + az + dz);
          }
        }
      }
    }
    spreadWorld(world, adding, sky);
  }
}

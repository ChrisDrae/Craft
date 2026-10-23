import { Biome } from "../biomes.js";
import { Block, stateOf } from "../blocks.js";
import { Rng } from "./noise.js";
import type { BlockWriter } from "./writer.js";

/** The kinds of trees, by the shape they grow in. */
export type TreeKind = "oak" | "big_oak" | "swamp_oak" | "birch" | "spruce" | "jungle" | "mega_jungle" | "acacia" | "dark_oak";

/** How far from its trunk a tree reaches at most: chunks look for trees this far outside themselves. */
export const TREE_REACH = 5;

/** What grows in a biome: trees per column and their kinds by weight, and plants per column. */
interface Vegetation {
  trees: number;
  kinds: ReadonlyArray<readonly [TreeKind, number]>;
  plants: ReadonlyArray<readonly [Block, number]>;
}

const FLOWERS: ReadonlyArray<readonly [Block, number]> = [
  [Block.Dandelion, 0.006],
  [Block.Poppy, 0.006],
];

/** Mushrooms in shady, damp places. */
const MUSHROOMS: ReadonlyArray<readonly [Block, number]> = [
  [Block.BrownMushroom, 0.004],
  [Block.RedMushroom, 0.002],
];

const VEGETATION: Readonly<Record<number, Vegetation>> = {
  [Biome.Plains]: {
    trees: 0.0015,
    kinds: [["oak", 9], ["big_oak", 1]],
    plants: [[Block.ShortGrass, 0.25], [Block.TallGrass, 0.02], ...FLOWERS, [Block.OxeyeDaisy, 0.004], [Block.AzureBluet, 0.004], [Block.Cornflower, 0.004], [Block.Pumpkin, 0.0005]],
  },
  [Biome.Forest]: { trees: 0.05, kinds: [["oak", 7], ["birch", 2], ["big_oak", 1]], plants: [[Block.ShortGrass, 0.12], ...FLOWERS, [Block.LilyOfTheValley, 0.004]] },
  [Biome.BirchForest]: { trees: 0.05, kinds: [["birch", 1]], plants: [[Block.ShortGrass, 0.12], ...FLOWERS, [Block.Allium, 0.004], [Block.LilyOfTheValley, 0.003]] },
  [Biome.DarkForest]: { trees: 0.1, kinds: [["dark_oak", 6], ["oak", 1], ["big_oak", 1]], plants: [[Block.ShortGrass, 0.06], [Block.Fern, 0.02], ...MUSHROOMS] },
  [Biome.Taiga]: { trees: 0.06, kinds: [["spruce", 1]], plants: [[Block.Fern, 0.1], [Block.LargeFern, 0.015], [Block.ShortGrass, 0.06], [Block.Pumpkin, 0.0005], ...MUSHROOMS] },
  [Biome.SnowyPlains]: { trees: 0.0012, kinds: [["spruce", 1]], plants: [] },
  [Biome.Desert]: { trees: 0, kinds: [], plants: [[Block.DeadBush, 0.006], [Block.Cactus, 0.006]] },
  [Biome.Savanna]: { trees: 0.006, kinds: [["acacia", 4], ["oak", 1]], plants: [[Block.ShortGrass, 0.4], [Block.TallGrass, 0.06], [Block.Dandelion, 0.003]] },
  [Biome.Jungle]: { trees: 0.12, kinds: [["jungle", 6], ["mega_jungle", 1]], plants: [[Block.Fern, 0.12], [Block.ShortGrass, 0.2], [Block.LargeFern, 0.03], [Block.Melon, 0.004]] },
  [Biome.Swamp]: { trees: 0.012, kinds: [["swamp_oak", 1]], plants: [[Block.ShortGrass, 0.15], [Block.BlueOrchid, 0.008], ...MUSHROOMS] },
  [Biome.StonyMountains]: { trees: 0.004, kinds: [["spruce", 2], ["oak", 1]], plants: [[Block.ShortGrass, 0.05]] },
  [Biome.River]: { trees: 0, kinds: [], plants: [[Block.ShortGrass, 0.1]] },
};

/** Trees per column in a biome. */
export function treeChance(biome: Biome): number {
  return VEGETATION[biome]?.trees ?? 0;
}

/** The kind of tree a biome grows, by a number in [0, 1). */
export function treeKind(biome: Biome, pick: number): TreeKind {
  const kinds = VEGETATION[biome].kinds;
  const total = kinds.reduce((n, [, w]) => n + w, 0);
  let t = pick * total;
  for (const [kind, w] of kinds) {
    if (t < w) return kind;
    t -= w;
  }
  return kinds[kinds.length - 1][0];
}

/** The plant a column grows in a biome, by a number in [0, 1), or null. */
export function plantFor(biome: Biome, pick: number): Block | null {
  let t = pick;
  for (const [plant, chance] of VEGETATION[biome]?.plants ?? []) {
    if (t < chance) return plant;
    t -= chance;
  }
  return null;
}

const log = (block: Block, axis: string = "y"): number => stateOf(block, { axis });

/** Leaves in a rough ball (or a flat disc when `flat`), only into air, corners left out at random. */
function blob(w: BlockWriter, rng: Rng, cx: number, cy: number, cz: number, r: number, leaves: number, flat: boolean = false): void {
  const ry = flat ? 1 : Math.ceil(r);
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++) {
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        const d = Math.hypot(dx, flat ? dy * 2 : dy, dz);
        if (d > r + 0.3 || (d > r - 0.5 && rng.next() < 0.4)) continue;
        w.fill(cx + dx, cy + dy, cz + dz, leaves);
      }
    }
  }
}

/** Layers of leaves around a trunk top, Minecraft's oak crown: two wide layers, two narrow ones. */
function crown(w: BlockWriter, rng: Rng, x: number, top: number, z: number, leaves: number, wide: number = 2): void {
  for (let dy = -2; dy <= 1; dy++) {
    const r = dy < 0 ? wide : 1;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const corner = Math.abs(dx) === r && Math.abs(dz) === r;
        if (corner && (dy === 1 || rng.next() < 0.5)) continue;
        w.fill(x + dx, top + dy, z + dz, leaves);
      }
    }
  }
}

function trunk(w: BlockWriter, x: number, y: number, z: number, height: number, wood: Block, thick: boolean = false): void {
  for (let k = 0; k < height; k++) {
    w.set(x, y + k, z, log(wood));
    if (thick) {
      w.set(x + 1, y + k, z, log(wood));
      w.set(x, y + k, z + 1, log(wood));
      w.set(x + 1, y + k, z + 1, log(wood));
    }
  }
}

/**
 * Grows a tree with its trunk standing on the ground at (x, y, z) (y is the first block above the
 * ground): the parts of it inside the writer's chunk. Its shape comes from `seed` alone, so every chunk
 * it reaches into grows the same tree.
 */
/**
 * Vines on a tree, as Minecraft's jungles and swamps have them: hanging from the sides of its leaves (and
 * climbing its trunk), one to four blocks down, on about a quarter of the open sides.
 */
function hangVines(w: BlockWriter, rng: Rng, x: number, y0: number, z: number, r: number, h: number, leaves: Block, wood: Block): void {
  const sides: ReadonlyArray<readonly [number, number, string]> = [
    [1, 0, "east"],
    [-1, 0, "west"],
    [0, 1, "south"],
    [0, -1, "north"],
  ];
  for (let y = y0; y <= y0 + h; y++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const b = w.get(x + dx, y, z + dz);
        if (b !== leaves && !(b === wood && y > y0 - 3)) continue;
        for (const [sx, sz, facing] of sides) {
          if (rng.next() > 0.25) continue;
          const vx = x + dx + sx;
          const vz = z + dz + sz;
          const length = rng.int(1, 4);
          for (let k = 0; k < length && w.get(vx, y - k, vz) === Block.Air; k++) w.set(vx, y - k, vz, stateOf(Block.Vine, { facing }));
        }
      }
    }
  }
}

export function growTree(w: BlockWriter, kind: TreeKind, x: number, y: number, z: number, seed: number): void {
  const rng = new Rng(seed);
  switch (kind) {
    case "oak":
    case "birch":
    case "swamp_oak": {
      const wood = kind === "birch" ? Block.BirchLog : Block.Log;
      const leaves = kind === "birch" ? Block.BirchLeaves : Block.Leaves;
      const height = kind === "birch" ? rng.int(5, 7) : rng.int(4, 6);
      crown(w, rng, x, y + height, z, leaves, kind === "swamp_oak" ? 3 : 2);
      trunk(w, x, y, z, height, wood);
      if (kind === "swamp_oak") hangVines(w, rng, x, y + height - 3, z, 4, 5, leaves, wood);
      return;
    }
    case "spruce": {
      const height = rng.int(7, 10);
      const top = y + height;
      w.fill(x, top + 1, z, Block.SpruceLeaves);
      // Rings from the top down, wider every other one and wider toward the bottom
      for (let k = 0; k <= height - 3; k++) {
        const r = k === 0 ? 1 : (k % 2 === 1 ? 1 : 2) + Math.min(1, Math.floor(k / 5));
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) + Math.abs(dz) > r + (r > 1 ? 1 : 0) || (dx === 0 && dz === 0)) continue;
            w.fill(x + dx, top - k, z + dz, Block.SpruceLeaves);
          }
        }
      }
      w.fill(x, top, z, Block.SpruceLeaves);
      trunk(w, x, y, z, height, Block.SpruceLog);
      return;
    }
    case "jungle": {
      const height = rng.int(8, 12);
      crown(w, rng, x, y + height, z, Block.JungleLeaves, 3);
      trunk(w, x, y, z, height, Block.JungleLog);
      hangVines(w, rng, x, y + height - 3, z, 4, 5, Block.JungleLeaves, Block.JungleLog);
      return;
    }
    case "mega_jungle": {
      // A 2 x 2 trunk, a big crown and a couple of branches with leaves
      const height = rng.int(16, 24);
      blob(w, rng, x, y + height, z, 4.2, Block.JungleLeaves, true);
      blob(w, rng, x, y + height + 2, z, 2.8, Block.JungleLeaves, true);
      for (let b = 0; b < 2; b++) {
        const by = y + rng.int(Math.floor(height / 2), height - 4);
        const dx = rng.next() < 0.5 ? -1 : 2;
        const dz = rng.next() < 0.5 ? -1 : 2;
        w.set(x + dx, by, z + dz, log(Block.JungleLog));
        blob(w, rng, x + dx, by + 1, z + dz, 2, Block.JungleLeaves, true);
      }
      trunk(w, x, y, z, height, Block.JungleLog, true);
      return;
    }
    case "acacia": {
      // Straight, then leaning one way, with a flat crown
      const height = rng.int(5, 7);
      const lean = rng.int(1, 2);
      const sx = rng.next() < 0.5 ? -1 : 1;
      const sz = rng.next() < 0.5 ? -1 : 1;
      let tx = x;
      let tz = z;
      for (let k = 0; k < height; k++) {
        if (k >= height - lean) {
          tx += sx;
          tz += sz;
        }
        w.set(tx, y + k, tz, log(Block.AcaciaLog));
      }
      const top = y + height;
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (Math.abs(dx) + Math.abs(dz) <= 4) w.fill(tx + dx, top, tz + dz, Block.AcaciaLeaves);
          if (Math.abs(dx) + Math.abs(dz) <= 1) w.fill(tx + dx, top + 1, tz + dz, Block.AcaciaLeaves);
        }
      }
      return;
    }
    case "dark_oak": {
      const height = rng.int(6, 8);
      const top = y + height;
      for (let dy = -1; dy <= 1; dy++) {
        const r = dy === -1 ? 3.6 : dy === 0 ? 3 : 2;
        for (let dz = -4; dz <= 5; dz++) {
          for (let dx = -4; dx <= 5; dx++) {
            if (Math.hypot(dx - 0.5, dz - 0.5) <= r) w.fill(x + dx, top + dy, z + dz, Block.DarkOakLeaves);
          }
        }
      }
      trunk(w, x, y, z, height, Block.DarkOakLog, true);
      return;
    }
    case "big_oak": {
      // A tall trunk with branches, each ending in a ball of leaves
      const height = rng.int(9, 12);
      blob(w, rng, x, y + height, z, 2.6, Block.Leaves);
      const branches = rng.int(3, 4);
      for (let b = 0; b < branches; b++) {
        const angle = rng.next() * Math.PI * 2;
        const by = y + rng.int(Math.floor(height / 2), height - 2);
        const length = rng.int(2, 3);
        const dx = Math.cos(angle);
        const dz = Math.sin(angle);
        const axis = Math.abs(dx) > Math.abs(dz) ? "x" : "z";
        for (let s = 1; s <= length; s++) w.set(x + Math.round(dx * s), by + Math.floor(s / 2), z + Math.round(dz * s), log(Block.Log, axis));
        blob(w, rng, x + Math.round(dx * length), by + Math.floor(length / 2) + 1, z + Math.round(dz * length), 2, Block.Leaves);
      }
      trunk(w, x, y, z, height, Block.Log);
      return;
    }
  }
}

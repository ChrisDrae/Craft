import { describe, expect, it } from "vitest";
import { BIOMES, Biome } from "../src/biomes.js";
import { BLOCKS, Block, FLUID, LEAFY, STATE_BLOCK } from "../src/blocks.js";
import { CHUNK_SIZE, Chunk, WORLD_HEIGHT } from "../src/chunk.js";
import { LAVA_LEVEL } from "../src/gen/caves.js";
import { TerrainGenerator } from "../src/generator.js";
import { VoxelWorld } from "../src/world.js";

const generator = new TerrainGenerator("craft");

/** The nearest column of one of the biomes to the origin, searched outward in rings. */
function find(biomes: readonly Biome[], g: TerrainGenerator = generator): { x: number; z: number } {
  for (let r = 0; r < 200; r++) {
    for (let i = -r; i <= r; i++) {
      for (const [x, z] of [[i, -r], [i, r], [-r, i], [r, i]]) {
        if (biomes.includes(g.biomeAt(x * 32, z * 32))) return { x: x * 32, z: z * 32 };
      }
    }
  }
  throw new Error("No such biome near the origin");
}

/** The chunks within `radius` chunks of block (x, z), generated. */
function around(x: number, z: number, radius: number, g: TerrainGenerator = generator): VoxelWorld {
  const world = new VoxelWorld(g);
  world.loadAround(x, z, radius, Infinity);
  return world;
}

const chunkOf = (v: number): number => Math.floor(v / CHUNK_SIZE);

describe("terrain", () => {
  it("is the same for the same seed, whatever order the chunks are made in", () => {
    const alone = new Chunk(3, -2);
    new TerrainGenerator("same").generate(alone);
    // Another generator, busy with other chunks first (its caches filled differently)
    const busy = new TerrainGenerator("same");
    for (const [cx, cz] of [[2, -2], [4, -1], [-5, 7], [3, -3]]) busy.generate(new Chunk(cx, cz));
    const later = new Chunk(3, -2);
    busy.generate(later);
    expect(later.sections.map((s) => s.blocks)).toEqual(alone.sections.map((s) => s.blocks));
    expect(later.biomes).toEqual(alone.biomes);
    const other = new Chunk(3, -2);
    new TerrainGenerator("other").generate(other);
    expect(other.sections.map((s) => s.blocks)).not.toEqual(alone.sections.map((s) => s.blocks));
  });

  it("has every biome within a few thousand blocks", () => {
    const seen = new Set<Biome>();
    for (let x = -6000; x <= 6000; x += 64) for (let z = -6000; z <= 6000; z += 64) seen.add(generator.biomeAt(x, z));
    expect([...seen].map((b) => BIOMES[b].name).sort()).toEqual(BIOMES.map((b) => b.name).sort());
  });

  it("keeps bedrock at the bottom and lava deep down, and opens caves to the surface somewhere", () => {
    const land = find([Biome.Plains, Biome.Forest, Biome.Taiga, Biome.Savanna]);
    const world = around(land.x, land.z, 4);
    let openings = 0;
    for (const chunk of world.chunks.values()) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          expect(chunk.get(x, 0, z)).toBe(Block.Bedrock);
          expect(chunk.get(x, WORLD_HEIGHT - 1, z)).toBe(Block.Air);
          for (let y = LAVA_LEVEL + 1; y < 60; y++) expect(FLUID[chunk.get(x, y, z)]).not.toBe(2);
          // Where the ground lies lower than the terrain's surface, a cave has cut into it
          const top = generator.topAt(chunk.cx * CHUNK_SIZE + x, chunk.cz * CHUNK_SIZE + z);
          if (top > 64 && chunk.get(x, top, z) === Block.Air && chunk.get(x, top - 1, z) === Block.Air && chunk.get(x, top - 2, z) === Block.Air) openings++;
        }
      }
    }
    expect(openings).toBeGreaterThan(0);
  }, 30000);

  it("lays ores by depth: coal high, then copper, iron, gold, and diamonds rare at the bottom", () => {
    const ys = new Map<Block, number[]>();
    let chunks = 0;
    for (let k = 0; chunks < 24 && k < 2000; k++) {
      const cx = (k % 40) * 3 - 60;
      const cz = Math.floor(k / 40) * 5 - 60;
      if (generator.topAt(cx * 16 + 8, cz * 16 + 8) < 70) continue;
      const chunk = new Chunk(cx, cz);
      generator.generate(chunk);
      chunks++;
      for (let y = 0; y < WORLD_HEIGHT; y++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          for (let x = 0; x < CHUNK_SIZE; x++) {
            const b = STATE_BLOCK[chunk.get(x, y, z)];
            if (!BLOCKS[b].name.endsWith("_ore")) continue;
            if (!ys.has(b)) ys.set(b, []);
            ys.get(b)!.push(y);
            if (b === Block.EmeraldOre) expect([Biome.StonyMountains, Biome.SnowyPeaks]).toContain(chunk.biomes[z * 16 + x]);
          }
        }
      }
    }
    const median = (b: Block): number => {
      const list = [...ys.get(b)!].sort((p, q) => p - q);
      return list[list.length >> 1];
    };
    expect(Math.max(...ys.get(Block.DiamondOre)!)).toBeLessThanOrEqual(16);
    const diamonds = ys.get(Block.DiamondOre)!.length / chunks;
    expect(diamonds).toBeGreaterThan(1);
    expect(diamonds).toBeLessThan(8);
    expect(Math.max(...ys.get(Block.GoldOre)!)).toBeLessThanOrEqual(40);
    expect(Math.max(...ys.get(Block.RedstoneOre)!)).toBeLessThanOrEqual(22);
    const order = [Block.CoalOre, Block.CopperOre, Block.IronOre, Block.GoldOre, Block.DiamondOre].map(median);
    expect(order).toEqual([...order].sort((p, q) => q - p));
  });

  it("grows trees whole across chunk borders", () => {
    for (const biomes of [[Biome.Forest, Biome.DarkForest], [Biome.Jungle], [Biome.Taiga], [Biome.Savanna]]) {
      const spot = find(biomes);
      const world = around(spot.x, spot.z, 3);
      let crossing = 0;
      for (const chunk of world.chunks.values()) {
        for (let y = 1; y < WORLD_HEIGHT - 6; y++) {
          for (let z = 0; z < CHUNK_SIZE; z++) {
            for (let x = 0; x < CHUNK_SIZE; x++) {
              const b = STATE_BLOCK[chunk.get(x, y, z)];
              if (!BLOCKS[b].name.endsWith("_log") || STATE_BLOCK[chunk.get(x, y + 1, z)] === b) continue;
              const wx = chunk.cx * CHUNK_SIZE + x;
              const wz = chunk.cz * CHUNK_SIZE + z;
              // The top of every trunk and branch has leaves above it, also in the chunk next door
              let leaves = 0;
              for (let dy = 0; dy <= 4; dy++) for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if (LEAFY[world.get(wx + dx, y + dy, wz + dz)]) leaves++;
              const inside = [wx - 3, wx + 3].every((v) => world.chunk(chunkOf(v), chunkOf(wz)) && world.chunk(chunkOf(v), chunkOf(wz - 3)) && world.chunk(chunkOf(v), chunkOf(wz + 3)));
              if (!inside) continue;
              expect(leaves, `${BLOCKS[b].name} at ${wx} ${y} ${wz}`).toBeGreaterThan(0);
              if (chunkOf(wx - 3) !== chunkOf(wx + 3) || chunkOf(wz - 3) !== chunkOf(wz + 3)) crossing++;
            }
          }
        }
      }
      expect(crossing, BIOMES[biomes[0]].name).toBeGreaterThan(2);
    }
  }, 30000);

  it("builds dungeons, wells and ruins whole across chunk borders", () => {
    const sites = generator.structures(-3000, -3000, 3000, 3000);
    for (const name of ["dungeon", "well", "ruins"]) {
      // One that crosses a chunk border
      const found = sites.find((s) => s.name === name && chunkOf(s.site.x - s.reach) !== chunkOf(s.site.x + s.reach));
      expect(found, name).toBeDefined();
      const { x, y, z, seed } = found!.site;
      const world = around(x, z, 1);
      if (name === "dungeon") {
        expect(world.get(x, y, z)).toBe(Block.Spawner);
        const rx = 2 + (seed & 1);
        const rz = 2 + ((seed >> 1) & 1);
        for (const [dx, dz] of [[-rx, -rz], [rx, -rz], [-rx, rz], [rx, rz]]) for (let dy = 0; dy < 4; dy++) expect(world.get(x + dx, y + dy, z + dz)).toBe(Block.Air);
      } else if (name === "well") {
        expect(world.get(x, y, z)).toBe(Block.Water);
        for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) for (const dy of [1, 2]) expect(world.get(x + dx, y + dy, z + dz)).toBe(Block.Sandstone);
        expect(world.get(x, y + 3, z)).toBe(Block.Sandstone);
      } else {
        const old = [Block.Cobblestone, Block.MossyCobblestone, Block.StoneBricks, Block.MossyStoneBricks, Block.CrackedStoneBricks];
        for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) expect(old).toContain(world.get(x + dx, y, z + dz));
      }
    }
  });
});

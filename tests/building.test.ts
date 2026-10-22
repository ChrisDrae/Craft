import { describe, expect, it } from "vitest";
import { Block, Dir, OPAQUE, propertyOf, stateName, stateOf } from "../src/blocks.js";
import { moveAxis } from "../src/collision.js";
import { blockBehaviors } from "../src/fluids.js";
import { BlockInteraction } from "../src/interaction.js";
import { Player } from "../src/player.js";
import { COVERS, STURDY } from "../src/shapes.js";
import type { Terrain } from "../src/terrain.js";
import { WorldTicks } from "../src/ticks.js";
import { BlockUpdates } from "../src/updates.js";
import { flatWorld } from "./helpers.js";

/** Yaws looking along each facing (yaw 0 looks south, along +z). */
const LOOK = { south: 0, east: Math.PI / 2, north: Math.PI, west: -Math.PI / 2 };

/**
 * A stone floor (top at y 9) with block updates running, and a player standing well away from where the
 * tests build, placing and using blocks the way the mouse does.
 */
function site() {
  const world = flatWorld(10, 1);
  const ticks = new WorldTicks(world, blockBehaviors());
  const updates = new BlockUpdates(world, ticks);
  world.onChanged = (x, y, z) => updates.changed(x, y, z);
  const player = new Player(world, { x: 12.5, y: 10, z: 12.5 });
  const hands = new BlockInteraction(world, player, { target: null } as unknown as Terrain);
  const aimAt = (x: number, y: number, z: number, normal: [number, number, number], hy: number): void => {
    const [nx, ny, nz] = normal;
    hands.target = { x, y, z, nx, ny, nz, block: world.get(x, y, z), distance: 2 };
    hands.hit = { x: x + 0.5 + nx / 2, y: y + hy, z: z + 0.5 + nz / 2 };
  };
  /** Places a block against a face of (x, y, z): the top by default, low on a side face unless `hy` says. */
  const place = (block: Block, x: number, y: number, z: number, normal: [number, number, number] = [0, 1, 0], opts: { look?: keyof typeof LOOK; hy?: number } = {}): boolean => {
    hands.choose(block);
    player.yaw = LOOK[opts.look ?? "south"];
    aimAt(x, y, z, normal, opts.hy ?? (normal[1] > 0 ? 1 : normal[1] < 0 ? 0 : 0.25));
    return hands.placeAtTarget();
  };
  const use = (x: number, y: number, z: number): boolean => {
    aimAt(x, y, z, [0, 1, 0], 0.5);
    return hands.useTarget();
  };
  const name = (x: number, y: number, z: number): string => stateName(world.get(x, y, z));
  return { world, player, place, use, name };
}

describe("fences, panes and walls", () => {
  it("connect to each other and to solid blocks, glass too, but not to plants or doors", () => {
    const { world, place } = site();
    place(Block.OakFence, 0, 9, 0);
    place(Block.OakFence, 1, 9, 0);
    world.set(0, 10, -1, Block.Glass);
    const fence = world.get(0, 10, 0);
    expect([propertyOf(fence, "north"), propertyOf(fence, "east"), propertyOf(fence, "south"), propertyOf(fence, "west")]).toEqual(["true", "true", "false", "false"]);
    place(Block.Dandelion, -1, 9, 0);
    expect(world.get(-1, 10, 0)).toBe(Block.Air); // Not on stone
    world.set(-1, 9, 0, Block.Grass);
    place(Block.Dandelion, -1, 9, 0);
    expect(world.get(-1, 10, 0)).toBe(Block.Dandelion);
    expect(propertyOf(world.get(0, 10, 0), "west")).toBe("false");
    // Taking the neighbor away disconnects
    world.set(1, 10, 0, Block.Air);
    expect(propertyOf(world.get(0, 10, 0), "east")).toBe("false");
  });

  it("panes join to glass and walls to fences of their own kind only", () => {
    const { world, place } = site();
    world.set(0, 10, 0, Block.Glass);
    place(Block.GlassPane, 1, 9, 0);
    place(Block.CobblestoneWall, 1, 9, 1);
    place(Block.OakFence, 2, 9, 1);
    expect(propertyOf(world.get(1, 10, 0), "west")).toBe("true");
    // A pane and a wall: neither is solid, nor of the other's kind
    expect(propertyOf(world.get(1, 10, 0), "south")).toBe("false");
    expect(propertyOf(world.get(1, 10, 1), "east")).toBe("false");
  });

  it("stand a block and a half high, so they can't be jumped over", () => {
    const { world, place } = site();
    place(Block.OakFence, 0, 9, 0);
    const feet = { x: 0.5, y: 13, z: 0.5 };
    moveAxis(world, feet, 0.3, 1.8, 1, -3);
    expect(feet.y).toBeCloseTo(11.5, 3);
    // Walking into it from the side stops at the post, not at the cell
    const walker = { x: -1.5, y: 10.0001, z: 0.5 };
    expect(moveAxis(world, walker, 0.3, 1.8, 0, 2)).toBe(true);
    expect(walker.x).toBeCloseTo(6 / 16 - 0.3, 3);
  });
});

describe("stairs", () => {
  it("face the way the player looks, upside down against a ceiling or high on a wall", () => {
    const { name, place } = site();
    place(Block.OakStairs, 0, 9, 0, [0, 1, 0], { look: "north" });
    expect(name(0, 10, 0)).toBe("oak_stairs[facing=north,half=bottom,shape=straight]");
    place(Block.OakStairs, 0, 10, 0, [1, 0, 0], { look: "west", hy: 0.75 });
    expect(name(1, 10, 0)).toBe("oak_stairs[facing=west,half=top,shape=straight]");
  });

  it("turn corners with the stairs behind and in front of them, as Minecraft does", () => {
    const { name, place } = site();
    place(Block.OakStairs, 0, 9, 0, [0, 1, 0], { look: "north" });
    // Stairs behind it, running across: an outer corner
    place(Block.OakStairs, 0, 9, -1, [0, 1, 0], { look: "east" });
    expect(name(0, 10, 0)).toBe("oak_stairs[facing=north,half=bottom,shape=outer_right]");
    // In front, running across: an inner corner
    place(Block.OakStairs, 5, 9, 0, [0, 1, 0], { look: "north" });
    place(Block.OakStairs, 5, 9, 1, [0, 1, 0], { look: "west" });
    expect(name(5, 10, 0)).toBe("oak_stairs[facing=north,half=bottom,shape=inner_left]");
    // Halves don't mix
    place(Block.OakStairs, 9, 9, 0, [0, 1, 0], { look: "north" });
    place(Block.OakStairs, 9, 10, -1, [1, 0, 0], { look: "east", hy: 0.75 });
    expect(name(9, 10, 0)).toBe("oak_stairs[facing=north,half=bottom,shape=straight]");
  });

  it("cover their back and bottom, so those faces of the neighbors are hidden, and hold torches there", () => {
    const north = stateOf(Block.OakStairs, { facing: "north" });
    expect([Dir.NegZ, Dir.Down, Dir.Up, Dir.PosZ, Dir.PosX].map((d) => COVERS[north * 6 + d])).toEqual([1, 1, 0, 0, 0]);
    expect([Dir.NegZ, Dir.Down, Dir.Up].map((d) => STURDY[north * 6 + d])).toEqual([1, 1, 0]);
  });
});

describe("slabs", () => {
  it("go in the bottom or top half and make a double slab when another is put on", () => {
    const { world, name, place } = site();
    place(Block.StoneSlab, 0, 9, 0);
    expect(name(0, 10, 0)).toBe("stone_slab[type=bottom]");
    place(Block.StoneSlab, 0, 10, 0);
    expect(name(0, 10, 0)).toBe("stone_slab[type=double]");
    expect(OPAQUE[world.get(0, 10, 0)]).toBe(1);
    place(Block.StoneSlab, 0, 10, 0, [1, 0, 0], { hy: 0.75 });
    expect(name(1, 10, 0)).toBe("stone_slab[type=top]");
    // A different slab doesn't merge: it goes on top
    place(Block.OakSlab, 0, 10, 0);
    expect(name(0, 11, 0)).toBe("oak_slab[type=bottom]");
  });

  it("a top slab holds a torch on its top but not a bottom slab", () => {
    const { world, place } = site();
    place(Block.StoneSlab, 0, 9, 0);
    expect(place(Block.Torch, 0, 10, 0)).toBe(false);
    place(Block.StoneSlab, 2, 10, 0, [0, 1, 0]);
    world.set(4, 10, 0, stateOf(Block.StoneSlab, { type: "top" }));
    expect(place(Block.Torch, 4, 10, 0)).toBe(true);
  });
});

describe("doors and trapdoors", () => {
  it("doors stand two high, open and shut both halves together, and come off whole", () => {
    const { world, name, place, use } = site();
    expect(place(Block.OakDoor, 0, 9, 0, [0, 1, 0], { look: "north" })).toBe(true);
    expect(name(0, 10, 0)).toBe("oak_door[facing=north,half=lower,open=false,hinge=left]");
    expect(name(0, 11, 0)).toBe("oak_door[facing=north,half=upper,open=false,hinge=left]");
    use(0, 11, 0);
    expect(propertyOf(world.get(0, 10, 0), "open")).toBe("true");
    expect(propertyOf(world.get(0, 11, 0), "open")).toBe("true");
    use(0, 10, 0);
    expect(propertyOf(world.get(0, 11, 0), "open")).toBe("false");
    world.set(0, 10, 0, Block.Air);
    expect(world.get(0, 11, 0)).toBe(Block.Air);
    // Not under a low ceiling
    world.set(3, 11, 0, Block.Stone);
    expect(place(Block.OakDoor, 3, 9, 0)).toBe(false);
  });

  it("trapdoors go in the top or bottom half and open in place", () => {
    const { world, name, place, use } = site();
    place(Block.OakTrapdoor, 0, 9, 0, [0, 1, 0], { look: "east" });
    expect(name(0, 10, 0)).toBe("oak_trapdoor[facing=east,half=bottom,open=false]");
    use(0, 10, 0);
    expect(propertyOf(world.get(0, 10, 0), "open")).toBe("true");
    world.set(0, 10, 3, Block.Stone);
    place(Block.OakTrapdoor, 0, 10, 3, [0, 0, 1], { hy: 0.75 });
    expect(propertyOf(world.get(0, 10, 4), "half")).toBe("top");
  });
});

describe("chests", () => {
  it("pair up side by side facing the same way, left and right halves, a third staying alone", () => {
    const { world, name } = site();
    const chest = stateOf(Block.Chest, { facing: "north" });
    world.set(0, 10, 0, chest);
    world.set(1, 10, 0, chest);
    // Facing north, seen from the north: east is on the right
    expect(name(0, 10, 0)).toBe("chest[facing=north,type=left]");
    expect(name(1, 10, 0)).toBe("chest[facing=north,type=right]");
    world.set(2, 10, 0, chest);
    expect(name(2, 10, 0)).toBe("chest[facing=north,type=single]");
    // Facing another way: no pair
    world.set(0, 10, 3, chest);
    world.set(1, 10, 3, stateOf(Block.Chest, { facing: "south" }));
    expect(name(0, 10, 3)).toBe("chest[facing=north,type=single]");
    // Taking one half away leaves the other alone
    world.set(1, 10, 0, Block.Air);
    expect(name(0, 10, 0)).toBe("chest[facing=north,type=single]");
  });
});

describe("what holds blocks up", () => {
  it("torches stand on floors and hang on walls, not ceilings, and come off with their wall", () => {
    const { world, name, place } = site();
    world.set(0, 10, 0, Block.Glass);
    expect(place(Block.Torch, 0, 10, 0, [1, 0, 0])).toBe(true);
    expect(name(1, 10, 0)).toBe("torch[facing=east]");
    expect(place(Block.Torch, 0, 10, 0)).toBe(true);
    world.set(5, 12, 0, Block.Stone);
    expect(place(Block.Torch, 5, 12, 0, [0, -1, 0])).toBe(false);
    world.set(0, 10, 0, Block.Air);
    expect(world.get(1, 10, 0)).toBe(Block.Air);
    expect(world.get(0, 11, 0)).toBe(Block.Air);
  });

  it("ladders hang on walls only, plants grow on grass and dirt and leave with it", () => {
    const { world, place } = site();
    world.set(0, 10, 0, Block.Planks);
    expect(place(Block.Ladder, 0, 9, 3)).toBe(false);
    expect(place(Block.Ladder, 0, 10, 0, [0, 0, 1])).toBe(true);
    world.set(3, 9, 3, Block.Dirt);
    expect(place(Block.OakSapling, 3, 9, 3)).toBe(true);
    world.set(3, 9, 3, Block.Sand);
    expect(world.get(3, 10, 3)).toBe(Block.Air);
    expect(place(Block.Cactus, 3, 9, 3)).toBe(true);
    expect(place(Block.Cactus, 3, 10, 3)).toBe(true);
  });

  it("short grass gives way to what is placed on it, snow stacks up to eight layers", () => {
    const { world, name, place, player } = site();
    world.set(0, 9, 0, Block.Grass);
    world.set(0, 10, 0, Block.ShortGrass);
    place(Block.Cobblestone, 0, 10, 0);
    expect(world.get(0, 10, 0)).toBe(Block.Cobblestone);
    place(Block.Snow, 3, 9, 0);
    for (let i = 0; i < 9; i++) place(Block.Snow, 3, 10, 0);
    expect(name(3, 10, 0)).toBe("snow[layers=8]");
    expect(name(3, 11, 0)).toBe("snow[layers=1]");
    // Snow is a layer less solid than it looks: two layers don't hold the feet up at all
    world.set(6, 10, 0, stateOf(Block.Snow, { layers: "2" }));
    const feet = { x: 6.5, y: 11, z: 0.5 };
    moveAxis(world, feet, 0.3, 1.8, 1, -2);
    expect(feet.y).toBeCloseTo(10 + 1 / 8, 3);
    expect(player.position.y).toBe(10);
  });

  it("tall grass stands two high and goes whole; sugar cane wants water beside it; lily pads float on still water", () => {
    const { world, name, place } = site();
    world.set(0, 9, 0, Block.Grass);
    expect(place(Block.TallGrass, 0, 9, 0)).toBe(true);
    expect(name(0, 11, 0)).toBe("tall_grass[half=upper]");
    world.set(0, 10, 0, Block.Air);
    expect(world.get(0, 11, 0)).toBe(Block.Air);
    // Sugar cane only on ground next to water, then on itself
    world.set(3, 9, 3, Block.Sand);
    expect(place(Block.SugarCane, 3, 9, 3)).toBe(false);
    world.set(4, 9, 3, Block.Water);
    expect(place(Block.SugarCane, 3, 9, 3)).toBe(true);
    expect(place(Block.SugarCane, 3, 10, 3)).toBe(true);
    world.set(3, 9, 3, Block.Air);
    expect(world.get(3, 10, 3)).toBe(Block.Air);
    expect(world.get(3, 11, 3)).toBe(Block.Air);
    // A lily pad goes when its water does; dead bushes grow on sand
    world.set(6, 9, 6, Block.Water);
    world.set(6, 10, 6, Block.LilyPad);
    world.set(6, 9, 6, Block.Stone);
    expect(world.get(6, 10, 6)).toBe(Block.Air);
    world.set(8, 9, 8, Block.Sand);
    expect(place(Block.DeadBush, 8, 9, 8)).toBe(true);
    expect(place(Block.Dandelion, 8, 9, 9)).toBe(false);
  });

  it("grass shows snow on its sides while snow lies on it", () => {
    const { world, name, place } = site();
    world.set(0, 9, 0, Block.Grass);
    place(Block.Snow, 0, 9, 0);
    expect(name(0, 9, 0)).toBe("grass_block[snowy=true]");
    world.set(0, 10, 0, Block.Air);
    expect(name(0, 9, 0)).toBe("grass_block[snowy=false]");
  });

  it("solid blocks aren't placed where the player stands, torches and plants are", () => {
    const { world, place, player } = site();
    const [x, z] = [Math.floor(player.position.x), Math.floor(player.position.z)];
    expect(place(Block.Stone, x, 9, z)).toBe(false);
    expect(place(Block.Torch, x, 9, z)).toBe(true);
    expect(world.get(x, 10, z)).toBe(stateOf(Block.Torch, { facing: "up" }));
  });
});

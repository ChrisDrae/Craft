import { describe, expect, it } from "vitest";
import { Simulation } from "projector";
import { Block } from "../src/blocks.js";
import { boxOverlapsCell, moveAxis } from "../src/collision.js";
import { PLAYER_HALF_WIDTH, PLAYER_HEIGHT, Player } from "../src/player.js";
import { flatWorld } from "./helpers.js";

describe("moveAxis", () => {
  it("lands on the ground", () => {
    const world = flatWorld(10);
    const pos = { x: 0.5, y: 10.2, z: 0.5 };
    expect(moveAxis(world, pos, 0.3, 1.8, 1, -0.5)).toBe(true);
    expect(pos.y).toBeCloseTo(10, 3);
    expect(pos.y).toBeGreaterThan(10);
  });

  it("stops at a wall and slides along the ground", () => {
    const world = flatWorld(10);
    world.set(2, 10, 0, Block.Stone);
    const pos = { x: 1.5, y: 10.0001, z: 0.5 };
    expect(moveAxis(world, pos, 0.3, 1.8, 0, 0.5)).toBe(true);
    expect(pos.x).toBeCloseTo(2 - 0.3, 3);
    // Walking along z right next to the wall and on the ground touches neither
    expect(moveAxis(world, pos, 0.3, 1.8, 2, 0.5)).toBe(false);
    expect(pos.z).toBeCloseTo(1);
  });

  it("bumps its head on a ceiling", () => {
    const world = flatWorld(10);
    world.set(0, 12, 0, Block.Stone);
    const pos = { x: 0.5, y: 10.0001, z: 0.5 };
    expect(moveAxis(world, pos, 0.3, 1.8, 1, 0.5)).toBe(true);
    expect(pos.y + 1.8).toBeCloseTo(12, 3);
  });

  it("ignores water", () => {
    const world = flatWorld(10);
    world.set(0, 10, 0, Block.Water);
    const pos = { x: 0.5, y: 10.0001, z: 0.5 };
    expect(moveAxis(world, pos, 0.3, 1.8, 0, 0.5)).toBe(false);
  });

  it("stops at the boxes of a block shape, not its cell", () => {
    // A bottom slab at (0, 10, 0) on otherwise empty ground
    const slab = Float64Array.of(0, 0, 0, 1, 0.5, 1);
    const shapes = { collisionBoxes: (x: number, y: number, z: number) => (x === 0 && y === 10 && z === 0 ? slab : new Float64Array(0)) };
    const falling = { x: 0.5, y: 11.2, z: 0.5 };
    expect(moveAxis(shapes, falling, 0.3, 1.8, 1, -0.9)).toBe(true);
    expect(falling.y).toBeCloseTo(10.5, 3);
    // Above the slab's top the cell is free to walk through
    const above = { x: -0.5, y: 10.6, z: 0.5 };
    expect(moveAxis(shapes, above, 0.3, 1.8, 0, 0.8)).toBe(false);
    // Lower down, the slab's side stops the box
    const beside = { x: -0.5, y: 10, z: 0.5 };
    expect(moveAxis(shapes, beside, 0.3, 1.8, 0, 0.8)).toBe(true);
    expect(beside.x).toBeCloseTo(-0.3, 3);
  });

  it("knows which cells a box overlaps", () => {
    const pos = { x: 0.5, y: 10, z: 0.5 };
    expect(boxOverlapsCell(pos, 0.3, 1.8, 0, 10, 0)).toBe(true);
    expect(boxOverlapsCell(pos, 0.3, 1.8, 0, 11, 0)).toBe(true);
    expect(boxOverlapsCell(pos, 0.3, 1.8, 0, 12, 0)).toBe(false);
    expect(boxOverlapsCell(pos, 0.3, 1.8, 0, 9, 0)).toBe(false);
    expect(boxOverlapsCell(pos, 0.3, 1.8, 1, 10, 0)).toBe(false);
  });
});

describe("Player", () => {
  function setup(): { sim: Simulation; player: Player; world: ReturnType<typeof flatWorld> } {
    const world = flatWorld(10);
    const sim = new Simulation();
    const player = sim.add(new Player(world, { x: 0.5, y: 12, z: 0.5 }));
    return { sim, player, world };
  }

  it("falls and comes to rest on the ground", () => {
    const { sim, player } = setup();
    for (let i = 0; i < 120; i++) sim.frame(1 / 60);
    expect(player.onGround).toBe(true);
    expect(player.position.y).toBeCloseTo(10, 2);
  });

  it("jumps high enough to climb one block but not two", () => {
    const { sim, player } = setup();
    for (let i = 0; i < 60; i++) sim.frame(1 / 60);
    let peak = 0;
    player.onGround = true;
    player.velocity.y = 8.4;
    for (let i = 0; i < 60; i++) {
      sim.frame(1 / 60);
      peak = Math.max(peak, player.position.y - 10);
    }
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(2);
    expect(player.position.y).toBeCloseTo(10, 2);
  });

  it("moves the camera to its eyes and looks where the yaw says", () => {
    const { sim, player } = setup();
    player.yaw = 0.7;
    player.pitch = 0;
    sim.frame(1 / 60);
    const f = sim.camera.getForward({ x: 0, y: 0, z: 0 });
    const r = sim.camera.getRight({ x: 0, y: 0, z: 0 });
    // The movement code's ground-plane forward and right
    expect(f.x).toBeCloseTo(Math.sin(0.7));
    expect(f.z).toBeCloseTo(Math.cos(0.7));
    expect(r.x).toBeCloseTo(Math.cos(0.7));
    expect(r.z).toBeCloseTo(-Math.sin(0.7));
    expect(sim.camera.position.y).toBeCloseTo(player.position.y + 1.62);
  });

  it("waits in the air while the chunk under it isn't loaded", () => {
    const { sim, player, world } = setup();
    player.position.x = 40.5;
    for (let i = 0; i < 60; i++) sim.frame(1 / 60);
    expect(player.position.y).toBe(12);
    world.load(2, 0);
    for (let i = 0; i < 120; i++) sim.frame(1 / 60);
    expect(player.position.y).toBeCloseTo(10, 2);
  });

  it("can't be overlapped by its own box size constants", () => {
    expect(PLAYER_HALF_WIDTH * 2).toBeLessThan(1);
    expect(PLAYER_HEIGHT).toBeLessThan(2);
  });
});

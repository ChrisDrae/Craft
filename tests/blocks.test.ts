import { describe, expect, it } from "vitest";
import {
  BLOCKS,
  Block,
  Dir,
  FACE_LOOK,
  FACE_TURN,
  Face,
  SOLID,
  STATE_COUNT,
  blockOf,
  placementState,
  propertyOf,
  stateByName,
  stateName,
  stateOf,
} from "../src/blocks.js";

describe("block states", () => {
  it("gives every block's default state the block's own id", () => {
    for (const b of BLOCKS) {
      expect(stateOf(b.id)).toBe(b.id);
      expect(blockOf(b.id)).toBe(b.id);
      expect(b.states[0]).toBe(b.id);
    }
  });

  it("has a state per value of a log's axis, after the defaults", () => {
    const log = BLOCKS[Block.Log];
    expect(log.states).toHaveLength(3);
    expect(STATE_COUNT).toBe(BLOCKS.length + 2);
    for (const axis of ["x", "y", "z"]) {
      const s = stateOf(Block.Log, { axis });
      expect(blockOf(s)).toBe(Block.Log);
      expect(propertyOf(s, "axis")).toBe(axis);
      expect(SOLID[s]).toBe(1);
    }
    expect(stateOf(Block.Log, { axis: "y" })).toBe(Block.Log);
    expect(() => stateOf(Block.Log, { axis: "w" })).toThrow();
  });

  it("names every state so saves can find it again", () => {
    expect(stateName(Block.Stone)).toBe("stone");
    expect(stateName(stateOf(Block.Log, { axis: "x" }))).toBe("oak_log[axis=x]");
    for (let s = 0; s < STATE_COUNT; s++) expect(stateByName(stateName(s))).toBe(s);
    // Left-out properties take their defaults; unknown blocks and values are refused
    expect(stateByName("oak_log")).toBe(Block.Log);
    expect(stateByName("diamond_block")).toBeNull();
    expect(stateByName("oak_log[axis=w]")).toBeNull();
    expect(stateByName("stone[axis=x]")).toBeNull();
  });

  it("lays logs along the face they are placed against", () => {
    expect(propertyOf(placementState(Block.Log, 1, 0, 0), "axis")).toBe("x");
    expect(propertyOf(placementState(Block.Log, 0, -1, 0), "axis")).toBe("y");
    expect(propertyOf(placementState(Block.Log, 0, 0, -1), "axis")).toBe("z");
    expect(placementState(Block.Stone, 1, 0, 0)).toBe(Block.Stone);
  });

  it("shows the rings at the ends of a log and turns its bark along it", () => {
    const look = (s: number, d: number): number => FACE_LOOK[s * 6 + d];
    const turn = (s: number, d: number): number => FACE_TURN[s * 6 + d];
    const upright = Block.Log;
    const alongX = stateOf(Block.Log, { axis: "x" });
    const alongZ = stateOf(Block.Log, { axis: "z" });
    expect([look(upright, Dir.Up), look(upright, Dir.PosX)]).toEqual([Face.Top, Face.Side]);
    expect([look(alongX, Dir.PosX), look(alongX, Dir.NegX), look(alongX, Dir.Up)]).toEqual([Face.Top, Face.Top, Face.Side]);
    expect([look(alongZ, Dir.NegZ), look(alongZ, Dir.PosX)]).toEqual([Face.Top, Face.Side]);
    expect([0, 1, 2, 3, 4, 5].map((d) => turn(upright, d))).toEqual([0, 0, 0, 0, 0, 0]);
    expect([0, 1, 2, 3, 4, 5].map((d) => turn(alongX, d))).toEqual([0, 0, 1, 1, 1, 1]);
    expect([0, 1, 2, 3, 4, 5].map((d) => turn(alongZ, d))).toEqual([1, 1, 0, 0, 0, 0]);
    // Grass keeps its top, sides and dirt bottom
    expect([look(Block.Grass, Dir.Up), look(Block.Grass, Dir.NegZ), look(Block.Grass, Dir.Down)]).toEqual([Face.Top, Face.Side, Face.Bottom]);
  });
});

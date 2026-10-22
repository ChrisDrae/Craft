import { SimObject, type Vec3 } from "projector";
import { BLOCKS, Block, FLUID, HOTBAR, SHAPE, SOLID, blockOf, propertyOf, withProperties } from "./blocks.js";
import { boxOverlapsCell } from "./collision.js";
import { placementState } from "./placement.js";
import { PLAYER_HALF_WIDTH, PLAYER_HEIGHT, type Player } from "./player.js";
import { raycastVoxels, type VoxelHit } from "./raycast.js";
import { SELECTION } from "./shapes.js";
import type { Terrain } from "./terrain.js";
import { standsOn, supported } from "./updates.js";
import type { VoxelWorld } from "./world.js";

/** How far away blocks can be broken or placed, in blocks. */
const REACH = 6;
/** Seconds between repeated breaks or placements while a button is held. */
const REPEAT = 0.25;

/** What the crosshair can hit in a block: fluids have no boxes, so the ray goes through them. */
const selectionOf = (state: number): Float64Array => SELECTION[state];

/** A block placing takes the place of: air, fluid, or a replaceable one (short grass). */
function makesRoom(state: number): boolean {
  return state === Block.Air || FLUID[state] !== 0 || BLOCKS[blockOf(state)].replaceable;
}

/**
 * Breaking, placing and using blocks: finds the block under the crosshair every frame (outlined by the
 * terrain), breaks it with the left button, and with the right one opens or shuts a door or trapdoor or
 * places the selected hotbar block against it, repeating while the button is held. The middle button picks
 * the block aimed at into the hotbar. What breaking or placing does to the blocks around (torches coming
 * off, water flowing in, fences connecting) is up to the block updates.
 */
export class BlockInteraction extends SimObject {
  target: VoxelHit | null = null;
  /** Where the crosshair meets the target, or null (then its middle counts). */
  hit: Vec3 | null = null;
  /** The blocks in hotbar slots 1-9. */
  readonly hotbar: Block[] = [...HOTBAR];
  /** Hotbar slot, 0-8. */
  selected: number = 0;
  /** Called with the selected slot when the selection or the hotbar's blocks change. */
  onSelect: ((slot: number) => void) | null = null;
  private readonly world: VoxelWorld;
  private readonly player: Player;
  private readonly terrain: Terrain;
  private readonly dir: Vec3 = { x: 0, y: 0, z: 1 };
  private readonly blockAt: (x: number, y: number, z: number) => number;
  private held: "break" | "place" | null = null;
  private timer: number = 0;

  constructor(world: VoxelWorld, player: Player, terrain: Terrain) {
    super();
    this.world = world;
    this.player = player;
    this.terrain = terrain;
    this.blockAt = (x, y, z) => world.get(x, y, z);
  }

  get selectedBlock(): Block {
    return this.hotbar[this.selected];
  }

  select(slot: number): void {
    const n = this.hotbar.length;
    this.selected = ((slot % n) + n) % n;
    this.onSelect?.(this.selected);
  }

  /** Puts a block into the selected hotbar slot, or selects the slot that already has it. */
  choose(block: Block): void {
    const slot = this.hotbar.indexOf(block);
    if (slot >= 0) {
      this.select(slot);
      return;
    }
    this.hotbar[this.selected] = block;
    this.onSelect?.(this.selected);
  }

  /** A mouse button went down: 0 breaks, 1 picks the block aimed at, 2 uses or places. */
  press(button: number): void {
    if (button === 1) {
      if (this.target) this.choose(blockOf(this.target.block));
      return;
    }
    const action = button === 0 ? "break" : button === 2 ? "place" : null;
    if (!action) return;
    this.held = action;
    this.timer = REPEAT;
    this.act(action);
  }

  release(button: number): void {
    if ((button === 0 && this.held === "break") || (button === 2 && this.held === "place")) this.held = null;
  }

  /** Breaks the target block; the block updates deal with what that does around it. */
  breakTarget(): boolean {
    const t = this.target;
    if (!t || !BLOCKS[blockOf(t.block)].breakable) return false;
    return this.world.set(t.x, t.y, t.z, Block.Air);
  }

  /** Opens or shuts the target if it's a door (both halves) or a trapdoor. Returns whether it was one. */
  useTarget(): boolean {
    const t = this.target;
    if (!t) return false;
    const shape = SHAPE[t.block];
    if (shape !== "door" && shape !== "trapdoor") return false;
    const open = propertyOf(t.block, "open") === "true" ? "false" : "true";
    if (shape === "door") {
      // The other half moves with it
      const other = propertyOf(t.block, "half") === "lower" ? t.y + 1 : t.y - 1;
      const there = this.world.get(t.x, other, t.z);
      if (blockOf(there) === blockOf(t.block)) this.world.set(t.x, other, t.z, withProperties(there, { open }));
    }
    this.world.set(t.x, t.y, t.z, withProperties(t.block, { open }));
    return true;
  }

  /**
   * Places the selected block against the face of the target (see placementState), or adds it to the
   * target: a slab on a slab of its kind makes a double slab, snow on snow a thicker layer, and short
   * grass gives way to it. Nothing happens where the block has nothing to hold it up, the place is taken,
   * or the player stands there.
   */
  placeAtTarget(): boolean {
    const t = this.target;
    if (!t) return false;
    const w = this.world;
    const block = this.selectedBlock;
    const hy = this.hit ? this.hit.y - t.y : 0.5;
    const target = blockOf(t.block);

    if (target === block && SHAPE[t.block] === "slab") {
      const type = propertyOf(t.block, "type");
      if ((type === "bottom" && t.ny > 0) || (type === "top" && t.ny < 0)) return w.set(t.x, t.y, t.z, withProperties(t.block, { type: "double" }));
    }
    if (target === block && block === Block.Snow && t.ny > 0) {
      const layers = Number(propertyOf(t.block, "layers"));
      if (layers < 8) return w.set(t.x, t.y, t.z, withProperties(t.block, { layers: String(layers + 1) }));
    }

    const state = placementState(block, { nx: t.nx, ny: t.ny, nz: t.nz, hy }, this.player.yaw);
    if (state === null) return false;
    // Short grass gives way: the block goes in its place
    const inPlace = BLOCKS[target].replaceable;
    const x = inPlace ? t.x : t.x + t.nx;
    const y = inPlace ? t.y : t.y + t.ny;
    const z = inPlace ? t.z : t.z + t.nz;
    if (!makesRoom(w.get(x, y, z))) return false;
    // Doors and tall plants are two blocks high, on ground that holds them
    const twoHigh = SHAPE[state] === "door" || SHAPE[state] === "tall";
    if (twoHigh) {
      if (!makesRoom(w.get(x, y + 1, z)) || !standsOn(w, x, y, z, state)) return false;
    } else if (!supported(w, x, y, z, state)) {
      return false;
    }
    if (SOLID[state] && (this.standsIn(x, y, z) || (twoHigh && this.standsIn(x, y + 1, z)))) return false;
    if (!w.set(x, y, z, state)) return false;
    if (twoHigh) w.set(x, y + 1, z, withProperties(state, { half: "upper" }));
    return true;
  }

  private standsIn(x: number, y: number, z: number): boolean {
    return boxOverlapsCell(this.player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT, x, y, z);
  }

  override update(dt: number): void {
    if (!this.held) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer += REPEAT;
    this.act(this.held);
  }

  /** After the player moved the camera: what the crosshair points at now. */
  override sync(): void {
    const camera = this.sim?.camera;
    if (!camera) return;
    const d = camera.getForward(this.dir);
    const e = camera.position;
    this.target = raycastVoxels(this.blockAt, selectionOf, e.x, e.y, e.z, d.x, d.y, d.z, REACH);
    const t = this.target;
    this.hit = t ? { x: e.x + d.x * t.distance, y: e.y + d.y * t.distance, z: e.z + d.z * t.distance } : null;
    this.terrain.target = t;
  }

  private act(action: "break" | "place"): void {
    if (action === "break") this.breakTarget();
    else if (!this.useTarget()) this.placeAtTarget();
    // Aim again right away, so a held button acts on what is there now
    this.sync();
  }
}

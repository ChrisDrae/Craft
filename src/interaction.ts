import { SimObject, type Vec3 } from "projector";
import { REACH, perform, type Action } from "./actions.js";
import { HOTBAR, blockOf, type Block } from "./blocks.js";
import type { Player } from "./player.js";
import { raycastVoxels, type VoxelHit } from "./raycast.js";
import { SELECTION } from "./shapes.js";
import type { Terrain } from "./terrain.js";
import type { VoxelWorld } from "./world.js";
/** Seconds between repeated breaks or placements while a button is held. */
const REPEAT = 0.25;

/** What the crosshair can hit in a block: fluids have no boxes, so the ray goes through them. */
const selectionOf = (state: number): Float64Array => SELECTION[state];

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
  /** Called with every action that changed something (a guest sends them to the host). */
  onAction: ((a: Action) => void) | null = null;
  /** The feet of the other players, whom blocks aren't placed into. */
  others: () => readonly Vec3[] = () => [];
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

  /** The action on the target with the selected block, from where the player looks. */
  private action(act: Action["act"]): Action | null {
    const t = this.target;
    if (!t) return null;
    const hy = this.hit ? this.hit.y - t.y : 0.5;
    return { act, x: t.x, y: t.y, z: t.z, nx: t.nx, ny: t.ny, nz: t.nz, hy, block: this.selectedBlock, yaw: this.player.yaw };
  }

  /** Does an action (see actions.ts), and tells onAction if it did anything. */
  private apply(a: Action | null): boolean {
    if (!a || !perform(this.world, a, [this.player.position, ...this.others()])) return false;
    this.onAction?.(a);
    return true;
  }

  /** Breaks the target block; the block updates deal with what that does around it. */
  breakTarget(): boolean {
    return this.apply(this.action("break"));
  }

  /** Opens or shuts the target if it's a door (both halves) or a trapdoor. Returns whether it was one. */
  useTarget(): boolean {
    return this.apply(this.action("use"));
  }

  /**
   * Places the selected block against the face of the target, or adds it to the target (see
   * placeBlock): not where it has nothing to hold it up, the place is taken, or a player stands there.
   */
  placeAtTarget(): boolean {
    return this.apply(this.action("place"));
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

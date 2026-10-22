import { SimObject, type Vec3 } from "projector";
import { BLOCKS, Block, HOTBAR } from "./blocks.js";
import { boxOverlapsCell } from "./collision.js";
import { PLAYER_HALF_WIDTH, PLAYER_HEIGHT, type Player } from "./player.js";
import { raycastVoxels, type VoxelHit } from "./raycast.js";
import type { Terrain } from "./terrain.js";
import type { VoxelWorld } from "./world.js";

/** How far away blocks can be broken or placed, in blocks. */
const REACH = 6;
/** Seconds between repeated breaks or placements while a button is held. */
const REPEAT = 0.25;

/** Water can't be aimed at: the ray goes through it. */
const targetable = (block: number): boolean => block !== Block.Air && block !== Block.Water;

/**
 * Breaking and placing blocks: finds the block under the crosshair every frame (outlined by the
 * terrain), breaks it with the left button and places the selected hotbar block against it with the
 * right one, repeating while the button is held.
 */
export class BlockInteraction extends SimObject {
  target: VoxelHit | null = null;
  /** Hotbar slot, 0-8. */
  selected: number = 0;
  /** Called with the new slot when the selection changes. */
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
    return HOTBAR[this.selected];
  }

  select(slot: number): void {
    const n = HOTBAR.length;
    this.selected = ((slot % n) + n) % n;
    this.onSelect?.(this.selected);
  }

  /** A mouse button went down: 0 breaks, 2 places. */
  press(button: number): void {
    const action = button === 0 ? "break" : button === 2 ? "place" : null;
    if (!action) return;
    this.held = action;
    this.timer = REPEAT;
    this.act(action);
  }

  release(button: number): void {
    if ((button === 0 && this.held === "break") || (button === 2 && this.held === "place")) this.held = null;
  }

  /** Breaks the target block. Water flows into the hole if it borders water. */
  breakTarget(): boolean {
    const t = this.target;
    if (!t || !BLOCKS[t.block].breakable) return false;
    const w = this.world;
    const wet =
      w.get(t.x, t.y + 1, t.z) === Block.Water ||
      w.get(t.x + 1, t.y, t.z) === Block.Water ||
      w.get(t.x - 1, t.y, t.z) === Block.Water ||
      w.get(t.x, t.y, t.z + 1) === Block.Water ||
      w.get(t.x, t.y, t.z - 1) === Block.Water;
    return w.set(t.x, t.y, t.z, wet ? Block.Water : Block.Air);
  }

  /** Places the selected block against the face of the target, unless the player stands there. */
  placeAtTarget(): boolean {
    const t = this.target;
    if (!t) return false;
    const x = t.x + t.nx;
    const y = t.y + t.ny;
    const z = t.z + t.nz;
    const there = this.world.get(x, y, z);
    if (there !== Block.Air && there !== Block.Water) return false;
    if (boxOverlapsCell(this.player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT, x, y, z)) return false;
    return this.world.set(x, y, z, this.selectedBlock);
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
    this.target = raycastVoxels(this.blockAt, targetable, e.x, e.y, e.z, d.x, d.y, d.z, REACH);
    this.terrain.target = this.target;
  }

  private act(action: "break" | "place"): void {
    if (action === "break") this.breakTarget();
    else this.placeAtTarget();
    // Aim again right away, so a held button acts on what is there now
    this.sync();
  }
}

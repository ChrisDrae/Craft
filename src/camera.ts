import { SimObject, quat, type Vec3 } from "projector";
import type { Player } from "./player.js";
import { raycastVoxels } from "./raycast.js";
import { SELECTION } from "./shapes.js";
import type { VoxelWorld } from "./world.js";

/** How far behind (or in front of) the player the camera stays in third person. */
const THIRD_PERSON = 4;

/** Seeing the player from: their eyes, behind them, or in front looking back (F5 goes round). */
export type Perspective = "first" | "behind" | "front";

/**
 * What Minecraft does to the view beyond where the eyes are: it bobs with each step (side to side, up and
 * down, a little roll), widens when sprinting or flying, tilts when hurt, and in third person stands
 * back from the player (in front of them, looking back) as far as walls allow. Runs after the player
 * and the crosshair's aim, which stay at the eyes.
 */
export class CameraEffects extends SimObject {
  perspective: Perspective = "first";
  bobbing: boolean = true;
  fovEffects: boolean = true;
  /** The field of view from the settings, in radians. */
  fov: number = (70 * Math.PI) / 180;
  /** Ticks left of the last hit's flash (20 down to 10 tilts the view). */
  hurt: () => number = () => 0;
  /** Distance walked, as Minecraft counts it for the bobbing and the steps (0.6 a block). */
  walked: number = 0;
  private bob: number = 0;
  private fovScale: number = 1;
  private readonly last: Vec3;
  private readonly roll = quat.create();
  private readonly v: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly world: VoxelWorld,
    private readonly player: Player,
  ) {
    super();
    this.last = { ...player.position };
  }

  override update(dt: number): void {
    const p = this.player;
    const moved = Math.hypot(p.position.x - this.last.x, p.position.z - this.last.z);
    Object.assign(this.last, p.position);
    const grounded = p.onGround && !p.flying && !p.asleep && moved < 1;
    if (grounded) this.walked += moved * 0.6;
    const speed = dt > 0 ? Math.min(1, moved / dt / 4.3) : 0;
    this.bob += ((grounded ? speed : 0) - this.bob) * Math.min(1, dt * 10);
    const target = this.fovEffects ? (p.sprinting ? 1.15 : 1) * (p.flying ? 1.1 : 1) : 1;
    this.fovScale += (target - this.fovScale) * Math.min(1, dt * 8);
  }

  override sync(): void {
    const camera = this.sim?.camera;
    if (!camera || this.player.asleep) return;
    camera.fov = this.fov * this.fovScale;
    const c = camera.position;
    // Third person: back along the view (or forward and turned round) as far as nothing is in the way
    if (this.perspective !== "first") {
      const f = camera.getForward(this.v);
      const sign = this.perspective === "behind" ? -1 : 1;
      const hit = raycastVoxels((x, y, z) => this.world.get(x, y, z), (s) => SELECTION[s], c.x, c.y, c.z, f.x * sign, f.y * sign, f.z * sign, THIRD_PERSON);
      const d = Math.max(0.5, (hit?.distance ?? THIRD_PERSON) - 0.25);
      c.x += f.x * sign * d;
      c.y += f.y * sign * d;
      c.z += f.z * sign * d;
      if (this.perspective === "front") camera.setYawPitch(this.player.yaw + Math.PI, -this.player.pitch);
    }
    // A step's bob: to the side and down, and a little roll, as Minecraft's
    let roll = 0;
    if (this.bobbing && this.perspective === "first") {
      const phase = this.walked * Math.PI;
      const g = this.bob * 0.1;
      const r = camera.getRight(this.v);
      const side = Math.sin(phase) * g * 0.5;
      c.x += r.x * side;
      c.z += r.z * side;
      c.y -= Math.abs(Math.cos(phase) * g);
      roll += Math.sin(phase) * g * 3 * (Math.PI / 180) * 10;
    }
    // A hit tilts the view, and it comes back
    const hurt = this.hurt();
    if (this.fovEffects && hurt > 10) roll += Math.sin(((20 - hurt) / 10) * Math.PI) * ((14 * Math.PI) / 180);
    if (roll !== 0) {
      quat.setAxisAngle(this.roll, { x: 0, y: 0, z: 1 }, roll);
      quat.multiply(camera.rotation, camera.rotation, this.roll);
    }
  }
}

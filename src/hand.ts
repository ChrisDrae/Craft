import { Layer, Material, MeshNode, SimObject, Transform, quat, type Mesh, type Quat, type Texture, type Vec3 } from "projector";
import type { TileUVs } from "./chunkMesh.js";
import { BLOCKS, Block } from "./blocks.js";
import { ITEMS, type Item, type ItemStack } from "./items.js";
import { itemMesh } from "./itemView.js";
import type { LightMap } from "./lightmap.js";
import { ARM, PosedModel } from "./mobs/models.js";
import type { VoxelWorld } from "./world.js";

/** Seconds a swing takes, and changing what is held. */
const SWING = 0.3;
const EQUIP = 0.2;
/** Block items held as cubes, others as their picture (as ItemView's). */
const CUBES: ReadonlySet<string> = new Set(["cube", "cactus", "stairs", "chest", "slab", "bed"]);

/** Turns a point by a rotation, into out. */
function turn(q: Quat, v: Vec3, out: Vec3): Vec3 {
  return quat.rotateVec3(out, q, v);
}

/**
 * The first-person hand, as Minecraft's: the right arm when the hand is empty, otherwise what it holds (a
 * small cube for a block, a picture for an item), low on the right of the view, in front of everything
 * (Projector's Front layer) and as bright as where the player stands. It swings when used, dips and comes
 * back up when what it holds changes, raises food to the mouth while eating and draws a bow back.
 */
export class Hand extends SimObject {
  /** What the hand holds. */
  held: () => ItemStack | null = () => null;
  /** Whether it shows (first person, not a spectator, not asleep). */
  showing: () => boolean = () => true;
  /** How far eating and drawing a bow have come, or null. */
  using: () => { eating: number | null; drawing: number | null } = () => ({ eating: null, drawing: null });
  private readonly arm: PosedModel;
  private readonly armNode: MeshNode;
  private readonly itemMaterial: Material;
  private itemNode: MeshNode | null = null;
  private item: Item | null = null;
  private swingTime: number = SWING;
  private equip: number = 1;
  private time: number = 0;
  private readonly meshes: Map<Item, Mesh> = new Map();
  private readonly local = quat.create();
  private readonly tmp = quat.create();
  private readonly v: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly world: VoxelWorld,
    private readonly lightMap: LightMap,
    private readonly atlas: { texture: Texture; uvs: TileUVs } | null,
    /** The player's skin, for the arm. */
    skin: Material,
    textured: boolean,
  ) {
    super();
    this.arm = new PosedModel(ARM, textured);
    this.armNode = new MeshNode(this.arm.mesh, skin, new Transform());
    this.armNode.layer = Layer.Front;
    this.itemMaterial = atlas ? new Material({ color: "#ffffff", shading: "unlit", map: atlas.texture, alphaTest: 0.5, side: "double" }) : new Material({ color: "#ffffff", shading: "flat" });
  }

  protected override onAttach(): void {
    this.addNode(this.armNode, false);
  }

  /** Swings the hand (a hit, a placed block, a use). */
  swing(): void {
    this.swingTime = 0;
  }

  override update(dt: number): void {
    this.time += dt;
    this.swingTime = Math.min(SWING, this.swingTime + dt);
    const held = this.held();
    const item = held?.item ?? null;
    if (item !== this.item) {
      this.item = item;
      this.equip = 0;
      if (this.itemNode) this.removeResource(this.itemNode);
      this.itemNode = null;
      if (item !== null) {
        let mesh = this.meshes.get(item);
        if (!mesh) {
          mesh = itemMesh(item, this.atlas);
          this.meshes.set(item, mesh);
        }
        const material = this.atlas ? this.itemMaterial : new Material({ color: ITEMS[item].color, shading: "flat" });
        this.itemNode = this.addNode(new MeshNode(mesh, material, new Transform()), false);
        this.itemNode.layer = Layer.Front;
      }
    }
    this.equip = Math.min(1, this.equip + dt / EQUIP);
  }

  /** After the camera has its place for the frame: the hand in front of it. */
  override sync(): void {
    const camera = this.sim?.camera;
    const shown = this.showing();
    this.armNode.visible = shown && this.item === null;
    if (this.itemNode) this.itemNode.visible = shown;
    if (!camera || !shown) return;
    const c = camera.position;
    const light = this.world.getLight(Math.floor(c.x), Math.floor(c.y), Math.floor(c.z));
    const brightness = Math.max(0.1, this.lightMap.brightness(light));
    // Minecraft's swing: out and up, a turn, back; the dip of changing what is held
    const p = this.swingTime / SWING;
    const s1 = Math.sin(Math.sqrt(p) * Math.PI);
    const dx = -0.25 * s1;
    const dy = 0.12 * Math.sin(Math.sqrt(p) * Math.PI * 2) - (1 - this.equip) * 0.5;
    const dz = 0.15 * Math.sin(p * Math.PI);
    const { eating, drawing } = this.using();
    const place = (node: MeshNode, x: number, y: number, z: number, yaw: number, pitch: number, roll: number, scale: number): void => {
      // The hand's own turn in the camera's frame, then the camera's
      quat.setAxisAngle(this.local, { x: 0, y: 1, z: 0 }, yaw);
      quat.setAxisAngle(this.tmp, { x: 1, y: 0, z: 0 }, pitch);
      quat.multiply(this.local, this.local, this.tmp);
      quat.setAxisAngle(this.tmp, { x: 0, y: 0, z: 1 }, roll);
      quat.multiply(this.local, this.local, this.tmp);
      const t = node.transform;
      quat.multiply(t.rotation, camera.rotation, this.local);
      turn(camera.rotation, { x, y, z }, this.v);
      t.position = { x: c.x + this.v.x, y: c.y + this.v.y, z: c.z + this.v.z };
      t.scale = { x: scale, y: scale, z: scale };
    };
    if (this.item === null) {
      this.arm.pose({}, brightness);
      place(this.armNode, 0.5 + dx, -0.5 + dy, 0.5 + dz, -0.35 - s1 * 0.6, -1.75 - s1 * 0.8, 0.1, 1);
      return;
    }
    const node = this.itemNode!;
    node.material.color = this.atlas ? `rgb(${Math.round(brightness * 255)},${Math.round(brightness * 255)},${Math.round(brightness * 255)})` : node.material.color;
    const info = ITEMS[this.item];
    const cube = info.block !== null && CUBES.has(BLOCKS[info.block as Block].shape);
    // Food to the mouth, bobbing; a bow pulled back as it is drawn
    const eat = eating ?? 0;
    const ex = eat > 0 ? -0.3 : 0;
    const ey = eat > 0 ? 0.12 + Math.abs(Math.sin(this.time * 18)) * 0.03 : 0;
    const pull = drawing ?? 0;
    if (cube) place(node, 0.45 + dx + ex, -0.42 + dy + ey, 0.75 + dz - pull * 0.1, Math.PI / 4 - s1 * 0.5, 0.3 - s1 * 0.9, 0, 1.6);
    else place(node, 0.4 + dx + ex, -0.32 + dy + ey, 0.6 + dz - pull * 0.15, -Math.PI / 2.5 + (drawing !== null ? 0.6 : 0), -0.2 - s1 * 1.1, 0.4, 1.3);
  }
}

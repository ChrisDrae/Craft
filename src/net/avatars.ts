import { Material, MeshNode, SimObject, Texture, Transform, quat, type PerspectiveCamera, type Quat, type Vec3 } from "projector";
import type { LightMap } from "../lightmap.js";
import { MODELS, PosedModel, paintSkin } from "../mobs/models.js";
import type { VoxelWorld } from "../world.js";
import type { PlayerView } from "./protocol.js";

/** How quickly a figure catches up with where its player was last said to be (per second). */
const FOLLOW = 12;
/** Name tags farther than this aren't shown. */
const TAG_DISTANCE = 48;
/** Minecraft's default skins, one of which each player wears (by their id) when Minecraft's textures were imported. */
export const SKINS = ["steve", "alex", "ari", "efe", "kai", "makena", "noor", "sunny", "zuri"] as const;

/** A number from a player's id, the same every time. */
function hashOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

/** A player's own shirt color, from their id (for Craft's own skins). */
function shirtOf(id: string): string {
  const hue = (hashOf(id) % 360) / 360;
  const f = (n: number): number => {
    const k = (n + hue * 12) % 12;
    return Math.round((0.42 - 0.3 * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
  };
  return `rgb(${f(0)},${f(8)},${f(4)})`;
}

/** Craft's own skin for a player: a face, their shirt (its sleeves on the arms), trousers. */
function craftSkin(id: string): HTMLCanvasElement {
  const canvas = paintSkin(MODELS.player, (g) => {
    g.fillStyle = shirtOf(id);
    g.fillRect(16, 20, 24, 12);
    g.fillRect(20, 16, 16, 4);
    for (const [x, y] of [
      [40, 20],
      [32, 52],
    ])
      g.fillRect(x, y, 16, 4);
    g.fillStyle = "#3a2a1a";
    g.fillRect(8, 8, 8, 2);
    g.fillRect(0, 8, 8, 3);
    g.fillRect(16, 8, 16, 3);
    g.fillRect(8, 0, 8, 8);
    g.fillStyle = "#ffffff";
    g.fillRect(9, 12, 2, 1);
    g.fillRect(13, 12, 2, 1);
    g.fillStyle = "#3050a0";
    g.fillRect(10, 12, 1, 1);
    g.fillRect(13, 12, 1, 1);
    g.fillStyle = "#8a5a4a";
    g.fillRect(10, 14, 4, 1);
  });
  return canvas;
}

/** Someone to draw: a player's view, and how they move, for their legs. */
interface Figure {
  posed: PosedModel;
  node: MeshNode;
  shown: Vec3;
  yaw: number;
  pitch: number;
  limbSwing: number;
  limbAmount: number;
  tag: HTMLElement | null;
}

/**
 * Players, drawn as Minecraft's: its player model (PosedModel), in one of Minecraft's default skins by
 * their id when its textures were imported and a skin of Craft's in their own shirt color otherwise;
 * walking as they move, their head turned and tilted the way they look, gliding toward where they were
 * last said to be, as bright as the light where they stand; with their names over their heads. Also the
 * player here, seen from outside (third person), without a name.
 */
export class Avatars extends SimObject {
  /** Who to show: the other players. */
  players: () => readonly PlayerView[] = () => [];
  /** The player here, when seen from outside (third person), or null. */
  self: () => (PlayerView & { headYaw?: number }) | null = () => null;
  private readonly figures: Map<string, Figure> = new Map();
  private readonly skins: Map<string, Material> = new Map();
  private readonly turn: Quat = quat.create();

  constructor(
    private readonly world: VoxelWorld,
    private readonly lightMap: LightMap,
    /** Where the name tags go: an element over the canvas. */
    private readonly tags: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    /** Minecraft's images (mob_player_<skin>), or null; whether there are textures at all (WebGL). */
    private readonly imported: ReadonlyMap<string, ImageBitmap> | null = null,
    private readonly textured: boolean = false,
  ) {
    super();
  }

  /** The material of a player's skin (the first-person arm wears it too). */
  skinFor(id: string): Material {
    const imported = this.imported ? SKINS.map((s) => this.imported!.get(`mob_player_${s}`)).filter((i): i is ImageBitmap => !!i) : [];
    const key = imported.length > 0 ? `mc${hashOf(id) % imported.length}` : id;
    let m = this.skins.get(key);
    if (m) return m;
    if (!this.textured) {
      m = new Material({ color: "#ffffff", shading: "unlit" });
    } else {
      let canvas: HTMLCanvasElement;
      if (imported.length > 0) {
        const image = imported[hashOf(id) % imported.length];
        canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext("2d")!.drawImage(image, 0, 0);
      } else {
        canvas = craftSkin(id);
      }
      m = new Material({ color: "#ffffff", shading: "unlit", map: new Texture(canvas, { filter: "nearest", wrap: "clamp" }), alphaTest: 0.1 });
    }
    this.skins.set(key, m);
    return m;
  }

  override update(dt: number): void {
    const seen = new Set<string>();
    const me = this.self();
    const list: Array<PlayerView & { here?: boolean }> = [...this.players(), ...(me ? [{ ...me, here: true }] : [])];
    for (const p of list) {
      seen.add(p.id);
      let f = this.figures.get(p.id);
      if (!f) f = this.add(p, !p.here);
      if (f.tag) f.tag.textContent = p.name;
      // Glide toward the last position heard; jump if it's far (a teleport, or just arrived). The player
      // here is where they are.
      const k = p.here ? 1 : 1 - Math.exp(-FOLLOW * dt);
      const far = Math.hypot(p.x - f.shown.x, p.y - f.shown.y, p.z - f.shown.z) > 8;
      const x = far ? p.x : f.shown.x + (p.x - f.shown.x) * k;
      const z = far ? p.z : f.shown.z + (p.z - f.shown.z) * k;
      const walked = far ? 0 : Math.hypot(x - f.shown.x, z - f.shown.z);
      f.limbSwing += walked * 2.5;
      f.limbAmount += (Math.min(1, dt > 0 ? walked / dt / 4.3 : 0) - f.limbAmount) * Math.min(1, dt * 10);
      f.shown.x = x;
      f.shown.y = far ? p.y : f.shown.y + (p.y - f.shown.y) * k;
      f.shown.z = z;
      let dy = p.yaw - f.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      f.yaw += far ? dy : dy * k;
      f.pitch += (p.pitch - f.pitch) * k;
      this.place(f);
    }
    for (const [id, f] of this.figures) {
      if (seen.has(id)) continue;
      this.removeResource(f.node);
      f.tag?.remove();
      this.figures.delete(id);
    }
  }

  private add(p: PlayerView, tagged: boolean): Figure {
    const posed = new PosedModel(MODELS.player, this.textured);
    const node = this.addNode(new MeshNode(posed.mesh, this.skinFor(p.id), new Transform()), false);
    let tag: HTMLElement | null = null;
    if (tagged) {
      tag = document.createElement("div");
      tag.className = "nametag";
      this.tags.append(tag);
    }
    const f: Figure = { posed, node, shown: { x: p.x, y: p.y, z: p.z }, yaw: p.yaw, pitch: p.pitch, limbSwing: 0, limbAmount: 0, tag };
    this.figures.set(p.id, f);
    return f;
  }

  /** Puts a figure where its player is, turned their way, walking, lit like the place they stand. */
  private place(f: Figure): void {
    const { x, y, z } = f.shown;
    const t = f.node.transform;
    t.position = { x, y, z };
    quat.setAxisAngle(this.turn, { x: 0, y: 1, z: 0 }, f.yaw);
    quat.copy(t.rotation, this.turn);
    const light = this.world.getLight(Math.floor(x), Math.floor(y + 1.5), Math.floor(z));
    const brightness = Math.max(0.1, this.lightMap.brightness(light));
    const swing = (phase: number, k: number): number => Math.cos(f.limbSwing * 0.6662 + phase) * k * f.limbAmount;
    f.posed.pose(
      {
        head: [-f.pitch, 0, 0],
        right_arm: [swing(Math.PI, 1), 0, 0],
        left_arm: [swing(0, 1), 0, 0],
        right_leg: [swing(0, 1.4), 0, 0],
        left_leg: [swing(Math.PI, 1.4), 0, 0],
      },
      brightness,
    );
  }

  /** After the camera moved: the name tags over the heads, where they show on screen. */
  override sync(): void {
    const camera = this.sim?.camera;
    if (!camera) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    for (const f of this.figures.values()) if (f.tag) this.placeTag(f, f.tag, camera, width, height);
  }

  private placeTag(f: Figure, tag: HTMLElement, camera: PerspectiveCamera, width: number, height: number): void {
    // Into the camera's frame: the inverse of its rotation
    const c = camera.position;
    const d = { x: f.shown.x - c.x, y: f.shown.y + 2.05 - c.y, z: f.shown.z - c.z };
    const inverse = quat.conjugate(quat.create(), camera.rotation);
    const v = quat.rotateVec3({ x: 0, y: 0, z: 0 }, inverse, d);
    const distance = Math.hypot(d.x, d.y, d.z);
    if (v.z < 0.1 || distance > TAG_DISTANCE) {
      tag.hidden = true;
      return;
    }
    const s = (camera.focalLength * height) / 2;
    tag.hidden = false;
    tag.style.transform = `translate(${width / 2 + (v.x / v.z) * s}px, ${height / 2 - (v.y / v.z) * s}px) translate(-50%, -100%)`;
  }
}

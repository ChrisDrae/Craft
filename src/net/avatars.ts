import { Material, Mesh, MeshNode, SimObject, Transform, quat, type PerspectiveCamera, type Quat, type Vec3 } from "projector";
import type { LightMap } from "../lightmap.js";
import type { VoxelWorld } from "../world.js";
import type { PlayerView } from "./protocol.js";

/** Minecraft's player is 32 pixels tall in its model, and 1.8 blocks in the world. */
const PX = 1.8 / 32;
/** How quickly a figure catches up with where its player was last said to be (per second). */
const FOLLOW = 12;
/** Name tags farther than this aren't shown. */
const TAG_DISTANCE = 48;

/** A part of the figure: its size and where its middle sits above the feet (pixels), and its color. */
interface Part {
  size: [number, number, number];
  at: [number, number, number];
  color: "skin" | "shirt" | "pants";
  head?: boolean;
}

const PARTS: Part[] = [
  { size: [8, 8, 8], at: [0, 28, 0], color: "skin", head: true },
  { size: [8, 12, 4], at: [0, 18, 0], color: "shirt" },
  { size: [4, 12, 4], at: [-6, 18, 0], color: "shirt" },
  { size: [4, 12, 4], at: [6, 18, 0], color: "shirt" },
  { size: [4, 12, 4], at: [-2, 6, 0], color: "pants" },
  { size: [4, 12, 4], at: [2, 6, 0], color: "pants" },
];

/** A player's own shirt color, from their id. */
function shirtOf(id: string): [number, number, number] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = (h % 360) / 360;
  // HSL with fixed saturation and lightness to RGB
  const f = (n: number): number => {
    const k = (n + hue * 12) % 12;
    return 0.42 - 0.3 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

const SKIN: [number, number, number] = [0.78, 0.6, 0.45];
const PANTS: [number, number, number] = [0.22, 0.27, 0.5];

interface Figure {
  nodes: Array<{ node: MeshNode; part: Part; base: [number, number, number] }>;
  shown: Vec3;
  yaw: number;
  pitch: number;
  tag: HTMLElement;
  brightness: number;
}

const css = (c: readonly number[], k: number): string => `rgb(${c.map((v) => Math.round(Math.min(1, v * k) * 255)).join(",")})`;

/**
 * The other players, drawn as simple figures of boxes (head, body, arms, legs) in their own shirt color,
 * turned the way they look, gliding toward where they were last said to be, as bright as the light where
 * they stand; with their names over their heads.
 */
export class Avatars extends SimObject {
  /** Who to show: the other players. */
  players: () => readonly PlayerView[] = () => [];
  private readonly figures: Map<string, Figure> = new Map();
  private readonly turn: Quat = quat.create();
  private readonly tilt: Quat = quat.create();

  constructor(
    private readonly world: VoxelWorld,
    private readonly lightMap: LightMap,
    /** Where the name tags go: an element over the canvas. */
    private readonly tags: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
  ) {
    super();
  }

  override update(dt: number): void {
    const seen = new Set<string>();
    for (const p of this.players()) {
      seen.add(p.id);
      let f = this.figures.get(p.id);
      if (!f) f = this.add(p);
      f.tag.textContent = p.name;
      // Glide toward the last position heard; jump if it's far (a teleport, or just arrived)
      const k = 1 - Math.exp(-FOLLOW * dt);
      const far = Math.hypot(p.x - f.shown.x, p.y - f.shown.y, p.z - f.shown.z) > 8;
      f.shown.x = far ? p.x : f.shown.x + (p.x - f.shown.x) * k;
      f.shown.y = far ? p.y : f.shown.y + (p.y - f.shown.y) * k;
      f.shown.z = far ? p.z : f.shown.z + (p.z - f.shown.z) * k;
      let dy = p.yaw - f.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      f.yaw += far ? dy : dy * k;
      f.pitch += (p.pitch - f.pitch) * k;
      this.place(f);
    }
    for (const [id, f] of this.figures) {
      if (seen.has(id)) continue;
      for (const { node } of f.nodes) this.removeResource(node);
      f.tag.remove();
      this.figures.delete(id);
    }
  }

  private add(p: PlayerView): Figure {
    const shirt = shirtOf(p.id);
    const nodes = PARTS.map((part) => {
      // Sleeves a shade darker than the shirt, so the arms show
      const sleeve = part.color === "shirt" && part.at[0] !== 0;
      const base: [number, number, number] = part.color === "skin" ? SKIN : part.color === "pants" ? PANTS : sleeve ? [shirt[0] * 0.8, shirt[1] * 0.8, shirt[2] * 0.8] : shirt;
      const mesh = Mesh.box(part.size[0] * PX, part.size[1] * PX, part.size[2] * PX);
      const node = this.addNode(new MeshNode(mesh, new Material({ color: css(base, 1), shading: "flat" }), new Transform()), false);
      return { node, part, base };
    });
    const tag = document.createElement("div");
    tag.className = "nametag";
    this.tags.append(tag);
    const f: Figure = { nodes, shown: { x: p.x, y: p.y, z: p.z }, yaw: p.yaw, pitch: p.pitch, tag, brightness: -1 };
    this.figures.set(p.id, f);
    return f;
  }

  /** Puts a figure's parts where its player is, turned their way, lit like the place they stand. */
  private place(f: Figure): void {
    const { x, y, z } = f.shown;
    const sin = Math.sin(f.yaw);
    const cos = Math.cos(f.yaw);
    quat.setAxisAngle(this.turn, { x: 0, y: 1, z: 0 }, f.yaw);
    const light = this.world.getLight(Math.floor(x), Math.floor(y + 1.5), Math.floor(z));
    const brightness = Math.round(Math.max(0.15, this.lightMap.brightness(light)) * 20) / 20;
    for (const { node, part, base } of f.nodes) {
      // The part's offset turned with the player: x to their right, z ahead (yaw 0 looks along +z)
      const [ox, oy, oz] = part.at;
      const t = node.transform;
      t.position = { x: x + (ox * cos + oz * sin) * PX, y: y + oy * PX, z: z + (-ox * sin + oz * cos) * PX };
      if (part.head) {
        quat.setAxisAngle(this.tilt, { x: 1, y: 0, z: 0 }, -f.pitch);
        quat.multiply(t.rotation, this.turn, this.tilt);
      } else {
        quat.copy(t.rotation, this.turn);
      }
      if (brightness !== f.brightness) node.material.color = css(base, brightness);
    }
    f.brightness = brightness;
  }

  /** After the camera moved: the name tags over the heads, where they show on screen. */
  override sync(): void {
    const camera = this.sim?.camera;
    if (!camera) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    for (const f of this.figures.values()) this.placeTag(f, camera, width, height);
  }

  private placeTag(f: Figure, camera: PerspectiveCamera, width: number, height: number): void {
    // Into the camera's frame: the inverse of its rotation
    const c = camera.position;
    const d = { x: f.shown.x - c.x, y: f.shown.y + 2.05 - c.y, z: f.shown.z - c.z };
    const inverse = quat.conjugate(quat.create(), camera.rotation);
    const v = quat.rotateVec3({ x: 0, y: 0, z: 0 }, inverse, d);
    const distance = Math.hypot(d.x, d.y, d.z);
    if (v.z < 0.1 || distance > TAG_DISTANCE) {
      f.tag.hidden = true;
      return;
    }
    const s = (camera.focalLength * height) / 2;
    f.tag.hidden = false;
    f.tag.style.transform = `translate(${width / 2 + (v.x / v.z) * s}px, ${height / 2 - (v.y / v.z) * s}px) translate(-50%, -100%)`;
  }
}

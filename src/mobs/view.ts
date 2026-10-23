import { Material, Mesh, MeshNode, SimObject, Texture, Transform, quat } from "projector";
import { BLOCKS, Block } from "../blocks.js";
import type { LightMap } from "../lightmap.js";
import type { VoxelWorld } from "../world.js";
import type { MobKind } from "./kinds.js";
import { MODELS, PosedModel, paintSkin, type ModelName, type Pose } from "./models.js";

/** A mob (or an arrow) to draw, where it is between ticks. */
export interface ShownMob {
  id: number;
  kind: MobKind | "arrow";
  x: number;
  y: number;
  z: number;
  yaw: number;
  headYaw: number;
  pitch: number;
  /** The walk: how far, and how fast (0-1). */
  limbSwing: number;
  limbAmount: number;
  /** A hit's red (0-1); ticks into dying (0 alive); a creeper's swelling (0-1). */
  hurt: number;
  dying: number;
  swell: number;
  /** A sheep's wool color (COLORS index), and whether it was sheared. */
  color: number;
  sheared: boolean;
  /** Ticks alive, for idle motion. */
  age: number;
  /** A baby: drawn half the size. */
  baby?: boolean;
}

/** Minecraft's walk: legs swing by the distance walked, as far as the walking is fast. */
const swing = (s: ShownMob, phase: number = 0, k: number = 1.4): number => Math.cos(s.limbSwing * 0.6662 + phase) * k * s.limbAmount;
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** The parts' rotations for a mob now: heads turned and tilted, legs walking, a chicken's wings, a spider's eight legs. */
function poseOf(kind: MobKind, s: ShownMob): Pose {
  const head: [number, number, number] = [-s.pitch, wrap(s.headYaw - s.yaw), 0];
  const pi = Math.PI;
  switch (kind) {
    case "zombie":
      return {
        head,
        right_arm: [-pi / 2 + swing(s, 0, 0.1) - 0.1, 0, Math.sin(s.age * 0.067) * 0.05 + 0.05],
        left_arm: [-pi / 2 + swing(s, pi, 0.1) - 0.1, 0, -Math.sin(s.age * 0.067) * 0.05 - 0.05],
        right_leg: [swing(s), 0, 0],
        left_leg: [swing(s, pi), 0, 0],
      };
    case "skeleton":
      return {
        head,
        right_arm: [swing(s, pi, 1), 0, 0.05],
        left_arm: [swing(s, 0, 1), 0, -0.05],
        right_leg: [swing(s), 0, 0],
        left_leg: [swing(s, pi), 0, 0],
      };
    case "chicken": {
      const flap = s.limbAmount > 0.05 ? (Math.sin(s.age * 1.5) + 1) * 0.6 : 0;
      return { head, right_leg: [swing(s), 0, 0], left_leg: [swing(s, pi), 0, 0], right_wing: [0, 0, flap], left_wing: [0, 0, -flap] };
    }
    case "spider": {
      const q = pi / 4;
      const legs: Pose = { head };
      const names = ["hind", "middle_hind", "middle_front", "front"];
      const ys = [q, q / 2, -q / 2, -q];
      const zs = [q, q * 0.74, q * 0.74, q];
      names.forEach((n, i) => {
        const walk = -Math.cos(s.limbSwing * 0.6662 * 2 + [0, pi, pi / 2, pi * 1.5][i]) * 0.4 * s.limbAmount;
        const lift = Math.abs(Math.sin(s.limbSwing * 0.6662 + [0, pi, pi / 2, pi * 1.5][i]) * 0.4) * s.limbAmount;
        legs[`right_${n}_leg`] = [0, ys[i] + walk, -zs[i] + lift];
        legs[`left_${n}_leg`] = [0, -ys[i] - walk, zs[i] - lift];
      });
      return legs;
    }
    default:
      // Creepers and the four-legged: diagonal legs together
      return {
        head,
        right_hind_leg: [swing(s), 0, 0],
        left_hind_leg: [swing(s, pi), 0, 0],
        right_front_leg: [swing(s, pi), 0, 0],
        left_front_leg: [swing(s), 0, 0],
      };
  }
}

/** The arrow: two crossed planes along +z, its shaft from Minecraft's arrow texture (the first 16 x 5 pixels). */
function arrowMesh(): Mesh {
  const l = 0.3;
  const w = 0.08;
  const u1 = 16 / 32;
  const v1 = 5 / 32;
  const uv = [0, v1, u1, v1, u1, 0, 0, 0];
  const mesh = new Mesh(
    [0, -w, -l, 0, -w, l, 0, w, l, 0, w, -l, -w, 0, -l, w, 0, -l, w, 0, l, -w, 0, l],
    [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ],
    [],
    [...uv, ...uv],
  );
  return mesh;
}

/** Craft's own arrow texture, in the layout of Minecraft's: a wooden shaft, a gray head, white feathers. */
function paintArrow(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#8a6a3a";
  g.fillRect(2, 2, 12, 1);
  g.fillStyle = "#e8e8e8";
  g.fillRect(0, 1, 4, 3);
  g.fillStyle = "#9a9a9a";
  g.fillRect(13, 1, 3, 3);
  return canvas;
}

/** What Craft paints on its own skins beyond the colors of their boxes: faces, mostly. */
const DETAILS: Partial<Record<ModelName, (g: CanvasRenderingContext2D) => void>> = {
  zombie: (g) => {
    g.fillStyle = "#1a2a12";
    g.fillRect(9, 12, 2, 1);
    g.fillRect(13, 12, 2, 1);
    g.fillRect(10, 14, 4, 1);
    // Sleeves of the shirt on the arms
    g.fillStyle = "#2a9a9a";
    g.fillRect(40, 20, 16, 4);
  },
  skeleton: (g) => {
    g.fillStyle = "#3a3a3a";
    g.fillRect(9, 11, 2, 2);
    g.fillRect(13, 11, 2, 2);
    g.fillRect(10, 14, 4, 1);
    g.fillStyle = "#6a6a6a";
    for (let y = 22; y < 31; y += 2) g.fillRect(21, y, 6, 1);
  },
  creeper: (g) => {
    g.fillStyle = "#101010";
    g.fillRect(9, 11, 2, 2);
    g.fillRect(13, 11, 2, 2);
    g.fillRect(11, 13, 2, 3);
    g.fillRect(10, 14, 1, 2);
    g.fillRect(13, 14, 1, 2);
  },
  spider: (g) => {
    g.fillStyle = "#c01010";
    g.fillRect(41, 15, 2, 1);
    g.fillRect(45, 15, 2, 1);
    g.fillRect(42, 13, 1, 1);
    g.fillRect(45, 13, 1, 1);
  },
  pig: (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(8, 10, 1, 1);
    g.fillRect(15, 10, 1, 1);
    g.fillStyle = "#101010";
    g.fillRect(9, 10, 1, 1);
    g.fillRect(14, 10, 1, 1);
    g.fillStyle = "#a05050";
    g.fillRect(18, 18, 1, 1);
    g.fillRect(20, 18, 1, 1);
  },
  cow: (g) => {
    g.fillStyle = "#101010";
    g.fillRect(7, 9, 1, 1);
    g.fillRect(12, 9, 1, 1);
    g.fillStyle = "#d8c8b8";
    g.fillRect(8, 11, 4, 3);
    g.fillStyle = "#f0f0f0";
    for (const [x, y, w, h] of [
      [30, 16, 5, 6],
      [40, 22, 4, 4],
      [34, 26, 6, 3],
    ])
      g.fillRect(x, y, w, h);
  },
  sheep: (g) => {
    g.fillStyle = "#101010";
    g.fillRect(9, 10, 1, 1);
    g.fillRect(12, 10, 1, 1);
  },
  chicken: (g) => {
    g.fillStyle = "#101010";
    g.fillRect(3, 4, 1, 1);
    g.fillRect(6, 4, 1, 1);
  },
};

/** The texture of a model: Minecraft's imported image (mob_<model>), or Craft's own skin. */
function skinOf(name: ModelName, imported: ReadonlyMap<string, ImageBitmap> | null): HTMLCanvasElement {
  const image = imported?.get(`mob_${name}`);
  if (!image) return paintSkin(MODELS[name], DETAILS[name]);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.drawImage(image, 0, 0);
  return canvas;
}

interface Drawn {
  kind: MobKind | "arrow";
  node: MeshNode;
  posed: PosedModel | null;
  wool: { node: MeshNode; posed: PosedModel } | null;
}

/**
 * The mobs and arrows, drawn as Minecraft's: each mob one mesh of its model's boxes, posed every frame
 * (PosedModel), as bright as the light where it stands, red for a moment when hit, falling over when it
 * dies; a creeper swells before it blows; a sheep wears its wool, colored, until shorn. On Canvas 2D the
 * boxes are flat-colored.
 */
export class MobRenderer extends SimObject {
  /** The mobs to draw. */
  mobs: () => Iterable<ShownMob> = () => [];
  private readonly drawn: Map<number, Drawn> = new Map();
  private readonly materials: Map<string, Material> = new Map();
  private readonly turn = quat.create();
  private readonly tilt = quat.create();

  constructor(
    private readonly world: VoxelWorld,
    private readonly lightMap: LightMap,
    /** Minecraft's mob images, or null for Craft's skins; textures at all (WebGL), or flat colors. */
    private readonly imported: ReadonlyMap<string, ImageBitmap> | null,
    private readonly textured: boolean,
  ) {
    super();
  }

  private material(name: ModelName | "arrow"): Material {
    let m = this.materials.get(name);
    if (m) return m;
    if (!this.textured) {
      m = new Material({ color: "#ffffff", shading: "unlit", side: name === "arrow" ? "double" : "front" });
    } else {
      const arrow = this.imported?.get("mob_arrow");
      const canvas = name === "arrow" ? (arrow ? skinOfImage(arrow) : paintArrow()) : skinOf(name, this.imported);
      const map = new Texture(canvas, { filter: "nearest", wrap: "clamp" });
      m = new Material({ color: "#ffffff", shading: "unlit", map, alphaTest: 0.1, side: name === "arrow" || name === "sheep_wool" ? "double" : "front" });
    }
    this.materials.set(name, m);
    return m;
  }

  private make(s: ShownMob): Drawn {
    if (s.kind === "arrow") {
      const mesh = arrowMesh();
      mesh.colors = new Float32Array(32).fill(1);
      return { kind: "arrow", node: this.addNode(new MeshNode(mesh, this.material("arrow"), new Transform()), false), posed: null, wool: null };
    }
    const model = MODELS[s.kind];
    const posed = new PosedModel(model, this.textured);
    const node = this.addNode(new MeshNode(posed.mesh, this.material(s.kind), new Transform()), false);
    let wool: Drawn["wool"] = null;
    if (s.kind === "sheep") {
      const woolPosed = new PosedModel(MODELS.sheep_wool, this.textured);
      wool = { posed: woolPosed, node: this.addNode(new MeshNode(woolPosed.mesh, this.material("sheep_wool"), new Transform()), false) };
    }
    return { kind: s.kind, node, posed, wool };
  }

  override update(): void {
    const seen = new Set<number>();
    for (const s of this.mobs()) {
      seen.add(s.id);
      let d = this.drawn.get(s.id);
      if (!d || d.kind !== s.kind) {
        if (d) this.forget(d);
        d = this.make(s);
        this.drawn.set(s.id, d);
      }
      this.place(d, s);
    }
    for (const [id, d] of this.drawn) {
      if (seen.has(id)) continue;
      this.forget(d);
      this.drawn.delete(id);
    }
  }

  private forget(d: Drawn): void {
    this.removeResource(d.node);
    if (d.wool) this.removeResource(d.wool.node);
  }

  private place(d: Drawn, s: ShownMob): void {
    const light = this.world.getLight(Math.floor(s.x), Math.floor(s.y + 0.5), Math.floor(s.z));
    const brightness = Math.max(0.08, this.lightMap.brightness(light));
    const t = d.node.transform;
    t.position = { x: s.x, y: s.y, z: s.z };
    quat.setAxisAngle(this.turn, { x: 0, y: 1, z: 0 }, s.yaw);
    if (d.kind === "arrow") {
      quat.setAxisAngle(this.tilt, { x: 1, y: 0, z: 0 }, -s.pitch);
      quat.multiply(t.rotation, this.turn, this.tilt);
      const colors = (d.node.mesh as Mesh).colors!;
      for (let i = 0; i < colors.length; i += 4) colors.set([brightness, brightness, brightness, 1], i);
      (d.node.mesh as Mesh).markDirty();
      return;
    }
    // Dying: it falls over onto its side, as Minecraft's mobs do
    const fall = s.dying > 0 ? Math.min(1, Math.sqrt((s.dying / 20) * 1.6)) * (Math.PI / 2) : 0;
    quat.setAxisAngle(this.tilt, { x: 0, y: 0, z: 1 }, fall);
    quat.multiply(t.rotation, this.turn, this.tilt);
    // A creeper about to blow swells, and flashes white
    const swell = s.swell;
    const grow = 1 + Math.sin(swell * 100) * swell * 0.01;
    const k = (1 + swell * 0.4 * grow) * (s.baby ? 0.5 : 1);
    t.scale = { x: k, y: (1 + swell * 0.1 * grow) * (s.baby ? 0.5 : 1), z: k };
    const flash = swell > 0 && Math.floor(swell * 10) % 2 === 1 ? 1.6 : 1;
    const pose = poseOf(d.kind, s);
    d.posed!.pose(pose, brightness * flash, s.hurt);
    if (d.wool) {
      const wt = d.wool.node.transform;
      wt.position = t.position;
      wt.scale = t.scale;
      quat.copy(wt.rotation, t.rotation);
      d.wool.node.visible = !s.sheared;
      if (!s.sheared) {
        const hex = BLOCKS[Block.WhiteWool + s.color].top;
        const tint = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
        d.wool.posed.pose(pose, brightness, s.hurt, tint);
      }
    }
  }
}

function skinOfImage(image: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.drawImage(image, 0, 0);
  return canvas;
}

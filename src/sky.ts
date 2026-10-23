import { Layer, Material, Mesh, MeshNode, PerlinNoise, Random, SimObject, Texture, quat, type PerspectiveCamera, type TextureSource } from "projector";
import type { LightMap } from "./lightmap.js";
import { MOON_PHASES, type SkyImages } from "./textures.js";
import { TICKS_PER_SECOND, type WorldTicks } from "./ticks.js";

/** Game ticks in a day: 20 minutes. The day starts at sunrise; noon is at 6000, midnight at 18000. */
export const DAY = 24000;
/** Height of the clouds. */
const CLOUD_Y = 192;
/** Blocks per pixel of the cloud texture, as in Minecraft. */
const CLOUD_PIXEL = 12;
/** Blocks per second the clouds drift west. */
const CLOUD_DRIFT = 0.6;
const DOME = 500;
const SUN_DISTANCE = 400;

type Rgb = [number, number, number];

/**
 * Where the sun is in its daily circle, 0 at noon to 1 (0.25 sunset, 0.5 midnight, 0.75 sunrise), as
 * Minecraft has it: a little longer by day than a plain fraction of the time.
 */
export function celestialAngle(time: number): number {
  const f = (((time / DAY - 0.25) % 1) + 1) % 1;
  return f + (1 - (Math.cos(f * Math.PI) + 1) / 2 - f) / 3;
}

/** How much daylight there is, 0 at night to 1 by day, with dusk and dawn between. */
export function daylightAt(angle: number): number {
  return Math.min(1, Math.max(0, Math.cos(angle * Math.PI * 2) * 2 + 0.5));
}

/** How strongly the stars show, 0 by day to 0.5 at night (Minecraft's curve). */
function starsAt(angle: number): number {
  const f = Math.min(1, Math.max(0, 1 - (Math.cos(angle * Math.PI * 2) * 2 + 0.25)));
  return f * f * 0.5;
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgb = (hex: number): Rgb => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const ZENITH_DAY = rgb(0x78a7ff);
const HORIZON_DAY = rgb(0xc0d8ff);
const ZENITH_NIGHT = rgb(0x02040c);
const HORIZON_NIGHT = rgb(0x0a0e1c);
const GLOW = rgb(0xff8a3a);

/** A CSS color from 0-1 channels. */
export function css(c: Rgb): string {
  return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;
}

function canvas(size: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!);
  return c;
}

/** A sun on black, for additive drawing: a white-hot square in a yellow halo, like Minecraft's. */
function drawnSun(): HTMLCanvasElement {
  return canvas(32, (g) => {
    g.fillStyle = "#000";
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = "#c08a20";
    g.fillRect(6, 6, 20, 20);
    g.fillStyle = "#ffe680";
    g.fillRect(9, 9, 14, 14);
    g.fillStyle = "#fffbe6";
    g.fillRect(11, 11, 10, 10);
  });
}

/** The moon in a phase (MOON_PHASES order) on black: a gray square lit from one side by the phase. */
function drawnMoon(phase: number): HTMLCanvasElement {
  return canvas(32, (g) => {
    g.fillStyle = "#000";
    g.fillRect(0, 0, 32, 32);
    // 0 full, 4 new; waning loses the right side first, waxing gains it back from the right
    const lit = 1 - Math.abs(phase - 4) / 4;
    const width = Math.round(16 * lit);
    if (width === 0) return;
    g.fillStyle = "#c8ccd8";
    g.fillRect(phase <= 4 ? 8 : 24 - width, 8, width, 16);
    g.fillStyle = "#9aa0b0";
    g.fillRect(phase <= 4 ? 11 : 26 - width, 12, Math.max(1, width / 4), 3);
  });
}

/** Cloud cover: white where clouds are, clear elsewhere, from noise. */
function drawnClouds(): HTMLCanvasElement {
  const noise = new PerlinNoise("clouds");
  return canvas(64, (g) => {
    const img = g.createImageData(64, 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        // Tiles seamlessly: noise on a torus
        const a = (x / 64) * Math.PI * 2;
        const b = (y / 64) * Math.PI * 2;
        const v = noise.noise3D(Math.cos(a) * 2 + 5, Math.sin(a) * 2 + Math.cos(b) * 2, Math.sin(b) * 2);
        const o = (y * 64 + x) * 4;
        img.data.fill(255, o, o + 3);
        img.data[o + 3] = v > 0.12 ? 255 : 0;
      }
    }
    g.putImageData(img, 0, 0);
  });
}

/** A square of side 2 * half in the plane y = height, facing up and down. */
function square(half: number, height: number): Mesh {
  return new Mesh([-half, height, -half, half, height, -half, half, height, half, -half, height, half], [[0, 1, 2, 3]], [], [0, 0, 1, 0, 1, 1, 0, 1]);
}

/** Small squares facing the center at random places on a sphere: stars. */
function starMesh(count: number, radius: number): Mesh {
  const rnd = new Random("stars");
  const positions: number[] = [];
  const faces: number[][] = [];
  for (let i = 0; i < count; i++) {
    // An even spread over the sphere
    const y = rnd.next() * 2 - 1;
    const a = rnd.next() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    const dir = [r * Math.cos(a), y, r * Math.sin(a)];
    // Two directions across it
    const up = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = [up[1] * dir[2] - up[2] * dir[1], up[2] * dir[0] - up[0] * dir[2], up[0] * dir[1] - up[1] * dir[0]];
    const ul = Math.hypot(u[0], u[1], u[2]);
    const v = [dir[1] * u[2] - dir[2] * u[1], dir[2] * u[0] - dir[0] * u[2], dir[0] * u[1] - dir[1] * u[0]];
    const size = (0.15 + rnd.next() * 0.1) * (radius / 100);
    const base = positions.length / 3;
    for (const [su, sv] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      for (let k = 0; k < 3; k++) positions.push(dir[k] * radius + ((u[k] / ul) * su + v[k] / ul * sv) * size);
    }
    faces.push([base, base + 1, base + 2, base + 3]);
  }
  return new Mesh(positions, faces, []);
}

/**
 * The sky over the terrain through the day: a dome graded from the zenith to the horizon (with a glow
 * toward a rising or setting sun), the sun, the moon in the day's phase, stars at night and clouds
 * drifting at CLOUD_Y. They follow the camera, ignore fog and are drawn behind everything (the clouds
 * with the world). The day's light goes into the light map; `horizon` is the color fog fades to.
 */
export class Sky extends SimObject {
  /** 0 at night to 1 by day. */
  daylight: number = 1;
  /** The sky's color at the horizon now (0-1 channels): fog and the background take it. */
  horizon: Rgb = HORIZON_DAY;
  /** Blocks around the camera the clouds reach. */
  cloudReach: number = 192;
  /** How hard it rains and storms (0-1), and a lightning flash (0-1, fading), for the sky's colors and light. */
  weather: () => { rain: number; thunder: number } = () => ({ rain: 0, thunder: 0 });
  flash: number = 0;
  private readonly ticks: WorldTicks;
  private readonly lightMap: LightMap;
  private readonly dome: MeshNode;
  private readonly sun: MeshNode;
  private readonly moon: MeshNode;
  private readonly stars: MeshNode;
  private readonly clouds: MeshNode;
  private readonly moonPhases: Texture[];
  private readonly turn = quat.create();
  private cloudCenter: { x: number; z: number } | null = null;
  private cloudPeriod: number;
  private lastTick: number = -1;

  constructor(ticks: WorldTicks, lightMap: LightMap, images: SkyImages | null) {
    super({ name: "sky" });
    this.ticks = ticks;
    this.lightMap = lightMap;
    const unlit = { color: "#ffffff", shading: "unlit", fog: false, depthWrite: false, side: "double" } as const;
    const glow = (source: TextureSource): Material => new Material({ ...unlit, map: new Texture(source, { filter: "nearest", mipmaps: false, wrap: "clamp" }), blending: "additive" });

    const dome = Mesh.sphere(DOME, 32, 16);
    dome.colors = new Float32Array(dome.faceIndices.length * 4).fill(1);
    this.dome = this.addNode(new MeshNode(dome, new Material(unlit)), false);
    this.dome.layer = Layer.Background;

    this.sun = this.addNode(new MeshNode(square(60, SUN_DISTANCE), glow(images?.sun ?? drawnSun())), false);
    this.moonPhases = MOON_PHASES.map((_, i) => new Texture(images?.moon?.[i] ?? drawnMoon(i), { filter: "nearest", mipmaps: false, wrap: "clamp" }));
    this.moon = this.addNode(new MeshNode(square(40, -SUN_DISTANCE), glow(this.moonPhases[0].source)), false);
    this.stars = this.addNode(new MeshNode(starMesh(1500, 450), new Material({ ...unlit, opacity: 0 })), false);
    for (const n of [this.sun, this.moon, this.stars]) n.layer = Layer.Background;

    const cloudImage = images?.clouds ?? drawnClouds();
    this.cloudPeriod = cloudImage.width * CLOUD_PIXEL;
    const cloudMaterial = new Material({
      ...unlit,
      map: new Texture(cloudImage, { filter: "nearest", mipmaps: false, wrap: "repeat" }),
      alphaTest: 0.5,
      opacity: 0.8,
    });
    this.clouds = this.addNode(new MeshNode(new Mesh([0, 0, 0, 1, 0, 0, 1, 0, 1], [[0, 1, 2]]), cloudMaterial), false);
  }

  /** After the player moved the camera (the sky is added after the player). */
  override sync(): void {
    const camera = this.sim?.camera;
    if (camera) this.follow(camera);
  }

  /** The sky around the camera at this moment. */
  follow(camera: PerspectiveCamera): void {
    const time = this.ticks.time + this.ticks.partial;
    const angle = celestialAngle(time);
    // Rain and storms darken the day, as Minecraft's: up to five sixteenths each
    const { rain, thunder } = this.weather();
    this.daylight = daylightAt(angle) * (1 - rain * 0.3125) * (1 - thunder * 0.3125);
    const e = camera.position;

    // The sun, moon and stars turn about the north-south axis: up at noon, set in the west (-x)
    quat.setAxisAngle(this.turn, { x: 0, y: 0, z: 1 }, angle * Math.PI * 2);
    for (const n of [this.sun, this.moon, this.stars, this.dome]) {
      n.transform.position.x = e.x;
      n.transform.position.y = e.y;
      n.transform.position.z = e.z;
    }
    for (const n of [this.sun, this.moon, this.stars]) quat.copy(n.transform.rotation, this.turn);
    const stars = starsAt(angle) * (1 - rain);
    this.stars.visible = stars > 0.01;
    this.stars.material.opacity = stars;
    // The sun and moon behind the rain clouds
    this.sun.visible = this.moon.visible = rain < 0.9;
    this.sun.material.opacity = this.moon.material.opacity = 1 - rain;
    this.moon.material.map = this.moonPhases[Math.floor(time / DAY) % 8];

    // Colors only change with the time: once a tick is enough
    const tick = Math.floor(time);
    if (tick !== this.lastTick || this.flash > 0) {
      this.lastTick = tick;
      this.paintDome(angle, rain);
      // A lightning flash lights everything for a moment
      this.lightMap.update(Math.min(1, this.daylight + this.flash));
      const c = (0.12 + 0.88 * this.daylight) * (1 - rain * 0.4);
      this.clouds.material.color = css([c, c, c * 0.95 + 0.05]);
    }
    this.moveClouds(e.x, e.y, e.z, time / TICKS_PER_SECOND);
  }

  /** Colors the dome for a moment of the day (grayer in the rain), and sets `horizon`. */
  private paintDome(angle: number, rain: number = 0): void {
    const day = Math.min(1, this.daylight + this.flash);
    const gray = (c: Rgb): Rgb => {
      const l = (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) * 0.6;
      return mix(c, [l, l, l], rain * 0.7);
    };
    const zenith = gray(mix(ZENITH_NIGHT, ZENITH_DAY, day));
    const horizon = gray(mix(HORIZON_NIGHT, HORIZON_DAY, day));
    this.horizon = horizon;
    // The glow is strongest with the sun at the horizon, toward it
    const c = Math.cos(angle * Math.PI * 2);
    const glow = Math.max(0, 1 - Math.abs(c) / 0.4) * 0.85;
    const sunX = -Math.sin(angle * Math.PI * 2) >= 0 ? 1 : -1;
    const mesh = this.dome.mesh;
    const p = mesh.positions;
    const fi = mesh.faceIndices;
    const colors = mesh.colors!;
    for (let k = 0; k < fi.length; k++) {
      const v = fi[k] * 3;
      const len = Math.hypot(p[v], p[v + 1], p[v + 2]) || 1;
      const dy = p[v + 1] / len;
      const dx = p[v] / len;
      let col = dy >= 0 ? mix(horizon, zenith, Math.min(1, dy / 0.6) ** 0.8) : mix(horizon, [horizon[0] * 0.4, horizon[1] * 0.4, horizon[2] * 0.45], Math.min(1, -dy * 3));
      const toward = Math.max(0, dx * sunX);
      const g = glow * toward ** 2 * (1 - Math.min(1, Math.abs(dy) * 2.5)) ** 2;
      if (g > 0) col = mix(col, GLOW, g);
      colors[k * 4] = col[0];
      colors[k * 4 + 1] = col[1];
      colors[k * 4 + 2] = col[2];
    }
    mesh.markDirty();
  }

  /**
   * Keeps the cloud layer around the camera, drifting west. The texture is fixed to the layer, which
   * moves with the drift; when the camera wanders off the middle, the layer is laid out anew around it
   * with texture coordinates that continue the old ones.
   */
  private moveClouds(ex: number, ey: number, ez: number, seconds: number): void {
    const drift = -seconds * CLOUD_DRIFT;
    const reach = this.cloudReach;
    const c = this.cloudCenter;
    if (!c || Math.abs(ex - drift - c.x) > reach / 4 || Math.abs(ez - c.z) > reach / 4) {
      const center = { x: Math.round((ex - drift) / CLOUD_PIXEL) * CLOUD_PIXEL, z: Math.round(ez / CLOUD_PIXEL) * CLOUD_PIXEL };
      this.cloudCenter = center;
      this.clouds.mesh = this.cloudLayer(center.x, center.z, reach);
    }
    const center = this.cloudCenter!;
    this.clouds.transform.position.x = center.x + drift;
    this.clouds.transform.position.y = CLOUD_Y;
    this.clouds.transform.position.z = center.z;
    // Under the clouds they show from below, above them from above: both sides are drawn
    this.clouds.visible = Math.abs(ey - CLOUD_Y) > 0.5;
  }

  /** A square grid of the cloud texture around (cx, cz), fading out toward its edge. */
  private cloudLayer(cx: number, cz: number, reach: number): Mesh {
    const cells = 24;
    const step = (reach * 2) / cells;
    const positions: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const faces: number[][] = [];
    const period = this.cloudPeriod;
    const corner = (i: number, j: number): void => {
      const x = -reach + i * step;
      const z = -reach + j * step;
      positions.push(x, 0, z);
      const r = Math.hypot(x, z) / reach;
      colors.push(1, 1, 1, Math.max(0, Math.min(1, (1 - r) * 3)));
      uvs.push((x + cx) / period, (z + cz) / period);
    };
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const base = positions.length / 3;
        corner(i, j);
        corner(i + 1, j);
        corner(i + 1, j + 1);
        corner(i, j + 1);
        faces.push([base, base + 1, base + 2, base + 3]);
      }
    }
    const mesh = new Mesh(positions, faces, [], uvs);
    mesh.colors = Float32Array.from(colors);
    return mesh;
  }
}

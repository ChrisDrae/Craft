import { Material, Mesh, MeshNode, SimObject, Texture, Transform } from "projector";
import { WORLD_HEIGHT } from "./chunk.js";
import type { LightMap } from "./lightmap.js";
import { precipitationAt, rainTop, type Weather } from "./weather.js";
import type { VoxelWorld } from "./world.js";

/** Columns of rain around the camera, as far as this, and how high above and below it they reach. */
const RADIUS = 10;
const ABOVE = 12;
const BELOW = 10;
const COLUMNS = (RADIUS * 2 + 1) ** 2;

/** Craft's own rain and snow: streaks and flakes in four columns, as Minecraft's images have them. */
function paintFall(snow: boolean): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;
  const g = canvas.getContext("2d")!;
  let seed = snow ? 5 : 3;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < (snow ? 220 : 160); i++) {
    const x = Math.floor(rnd() * 64);
    const y = Math.floor(rnd() * 256);
    if (snow) {
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.fillRect(x, y, 2, 2);
    } else {
      g.fillStyle = "rgba(200,215,255,0.6)";
      g.fillRect(x, y, 1, 6 + Math.floor(rnd() * 6));
    }
  }
  return canvas;
}

function canvasOf(image: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.drawImage(image, 0, 0);
  return canvas;
}

/** A mesh of `n` quads, rewritten every frame. */
function quads(n: number): Mesh {
  const faces: number[][] = [];
  for (let i = 0; i < n; i++) faces.push([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 3]);
  const mesh = new Mesh(new Float32Array(n * 12), faces, [], new Float32Array(n * 8));
  mesh.colors = new Float32Array(n * 16).fill(1);
  return mesh;
}

/**
 * Rain and snow as Minecraft draws them: on every column around the camera where they fall (snow where it
 * is cold, nothing where it is dry), a sheet of falling streaks turned to the camera, from where the sky
 * meets the ground to above the head, scrolling down (snow slowly, drifting); as bright as the sky there.
 * Lightning bolts flicker for a moment.
 */
export class Precipitation extends SimObject {
  weather: () => Weather | null = () => null;
  private readonly rain: { mesh: Mesh; node: MeshNode };
  private readonly snow: { mesh: Mesh; node: MeshNode };
  private readonly bolt: { mesh: Mesh; node: MeshNode };
  private readonly heights: Int16Array = new Int16Array(COLUMNS).fill(-1);
  private readonly heightAt: Int32Array = new Int32Array(COLUMNS * 2);
  private next: number = 0;
  private time: number = 0;
  private boltLeft: number = 0;

  constructor(
    private readonly world: VoxelWorld,
    private readonly lightMap: LightMap,
    images: { rain: ImageBitmap | null; snow: ImageBitmap | null },
  ) {
    super();
    const sheet = (canvas: HTMLCanvasElement): { mesh: Mesh; node: MeshNode } => {
      const mesh = quads(COLUMNS);
      const material = new Material({ color: "#ffffff", shading: "unlit", map: new Texture(canvas, { filter: "nearest", wrap: "repeat" }), opacity: 0.85, side: "double", alphaTest: 0.02 });
      return { mesh, node: new MeshNode(mesh, material, new Transform()) };
    };
    this.rain = sheet(images.rain ? canvasOf(images.rain) : paintFall(false));
    this.snow = sheet(images.snow ? canvasOf(images.snow) : paintFall(true));
    const boltMesh = quads(16);
    this.bolt = { mesh: boltMesh, node: new MeshNode(boltMesh, new Material({ color: "#f0f4ff", shading: "unlit", side: "double", fog: false }), new Transform()) };
  }

  protected override onAttach(): void {
    for (const s of [this.rain, this.snow, this.bolt]) this.addNode(s.node, false);
  }

  /** A lightning bolt from the sky down to (x, y, z). */
  strike(x: number, y: number, z: number): void {
    this.boltLeft = 0.3;
    // A jagged line of segments, wandering on the way down
    const m = this.bolt.mesh;
    let px = x;
    let pz = z;
    const top = Math.min(WORLD_HEIGHT + 40, y + 120);
    for (let i = 0; i < 16; i++) {
      const y1 = top - ((top - y) * i) / 16;
      const y0 = top - ((top - y) * (i + 1)) / 16;
      const nx = i === 15 ? x : px + (Math.random() - 0.5) * 3;
      const nz = i === 15 ? z : pz + (Math.random() - 0.5) * 3;
      const w = 0.15;
      m.positions.set([px - w, y1, pz, px + w, y1, pz, nx + w, y0, nz, nx - w, y0, nz], i * 12);
      px = nx;
      pz = nz;
    }
    m.markDirty();
  }

  /** How high the ground is for rain in a column (none where the world isn't loaded). */
  private ground(x: number, z: number): number {
    return this.world.isLoaded(x, z) ? rainTop(this.world, x, z) : WORLD_HEIGHT;
  }

  override update(dt: number): void {
    this.time += dt;
    this.boltLeft = Math.max(0, this.boltLeft - dt);
    this.bolt.node.visible = this.boltLeft > 0 && Math.floor(this.boltLeft * 30) % 3 !== 0;
  }

  override sync(): void {
    const camera = this.sim?.camera;
    const weather = this.weather();
    const level = weather?.rain ?? 0;
    this.rain.node.visible = this.snow.node.visible = false;
    if (!camera || level <= 0.01) return;
    const c = camera.position;
    const cx = Math.floor(c.x);
    const cz = Math.floor(c.z);
    // The columns' ground, a few found again every frame
    for (let k = 0; k < 40; k++) {
      const i = this.next;
      this.next = (this.next + 1) % COLUMNS;
      const x = cx + (i % (RADIUS * 2 + 1)) - RADIUS;
      const z = cz + Math.floor(i / (RADIUS * 2 + 1)) - RADIUS;
      this.heights[i] = this.ground(x, z);
      this.heightAt[i * 2] = x;
      this.heightAt[i * 2 + 1] = z;
    }
    let rainQuads = 0;
    let snowQuads = 0;
    for (let i = 0; i < COLUMNS; i++) {
      const dx = (i % (RADIUS * 2 + 1)) - RADIUS;
      const dz = Math.floor(i / (RADIUS * 2 + 1)) - RADIUS;
      if (dx * dx + dz * dz > RADIUS * RADIUS) continue;
      const x = cx + dx;
      const z = cz + dz;
      // Grounds found for another column (the camera moved) are found again soon
      const known = this.heightAt[i * 2] === x && this.heightAt[i * 2 + 1] === z;
      const ground = known ? this.heights[i] : this.ground(x, z);
      const y0 = Math.max(ground + 1, Math.floor(c.y) - BELOW);
      const y1 = Math.floor(c.y) + ABOVE;
      if (y0 >= y1) continue;
      const biome = this.world.chunk(x >> 4, z >> 4)?.biomes[(z & 15) * 16 + (x & 15)] ?? 0;
      const kind = precipitationAt(biome, y0);
      if (kind === "none") continue;
      const sheet = kind === "snow" ? this.snow : this.rain;
      const q = kind === "snow" ? snowQuads++ : rainQuads++;
      // Turned to the camera, through the column's middle
      const mx = x + 0.5;
      const mz = z + 0.5;
      let ax = mz - c.z;
      let az = -(mx - c.x);
      const len = Math.hypot(ax, az) || 1;
      ax = (ax / len) * 0.5;
      az = (az / len) * 0.5;
      sheet.mesh.positions.set([mx - ax, y0, mz - az, mx + ax, y0, mz + az, mx + ax, y1, mz + az, mx - ax, y1, mz - az], q * 12);
      // Each column its own quarter of the image, at its own offset, falling
      const hash = (Math.imul(x, 3121) ^ Math.imul(z, 418711)) >>> 0;
      const u0 = (hash & 3) / 4;
      const fall = kind === "snow" ? this.time * 0.15 : this.time * 1.6;
      const v0 = (y0 / 32 + ((hash >> 2) & 15) / 16 + fall) % 1;
      const v1 = v0 - (y1 - y0) / 32;
      const drift = kind === "snow" ? Math.sin(this.time * 0.5 + (hash & 7)) * 0.05 : 0;
      sheet.mesh.uvs!.set([u0 + drift, v0, u0 + 0.25 + drift, v0, u0 + 0.25 + drift, v1, u0 + drift, v1], q * 8);
      const light = Math.max(0.25, this.lightMap.brightness(this.world.getLight(x, Math.min(WORLD_HEIGHT - 1, y1), z)));
      for (let k = 0; k < 4; k++) sheet.mesh.colors!.set([light, light, light, 1], (q * 4 + k) * 4);
    }
    for (const [sheet, n] of [
      [this.rain, rainQuads],
      [this.snow, snowQuads],
    ] as const) {
      sheet.mesh.positions.fill(0, n * 12);
      sheet.mesh.markDirty();
      sheet.node.visible = n > 0;
      sheet.node.material.opacity = 0.85 * level;
    }
  }
}

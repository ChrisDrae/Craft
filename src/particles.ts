import { Material, Mesh, MeshNode, SimObject, Transform, type Texture, type Vec3 } from "projector";
import { Biome, tintColor } from "./biomes.js";
import { Dir, FACE_TILE, FACE_TINT, SHAPE, SOLID, Tint } from "./blocks.js";
import type { TileUVs } from "./chunkMesh.js";
import type { LightMap } from "./lightmap.js";
import { atlasIndex } from "./textures.js";
import type { VoxelWorld } from "./world.js";

/** Particles drawn at once at most. */
const CAPACITY = 1200;
const GRAVITY = 16;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  /** Its picture: atlas tiles it runs through over its life (one for most), and the part of the tile. */
  tiles: readonly number[];
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  tint: readonly [number, number, number];
  gravity: number;
  /** Stops on blocks (pieces, drops); passes through (smoke). */
  collide: boolean;
  /** As bright as its own light (flames), not the world's. */
  glow: boolean;
  /** Slows by this much a second (smoke drifts to a stop). */
  drag: number;
}

const WHITE: readonly [number, number, number] = [1, 1, 1];

/**
 * Particles, as Minecraft's: the pieces a broken block crumbles into (its own texture, in bits), dust under
 * running feet, splashes, smoke and flames over torches and lit furnaces, the puffs of an explosion, the
 * stars of a critical hit. All of them one mesh of quads turned to the camera every frame, one draw call.
 * WebGL only; `amount` thins them out (Options).
 */
export class Particles extends SimObject {
  /** All, fewer, or the fewest (1, 0.5, 0.15). */
  amount: number = 1;
  private readonly list: Particle[] = [];
  private readonly mesh: Mesh;
  private readonly node: MeshNode;
  private readonly right: Vec3 = { x: 1, y: 0, z: 0 };
  private readonly up: Vec3 = { x: 0, y: 1, z: 0 };

  constructor(
    private readonly world: VoxelWorld,
    private readonly lightMap: LightMap,
    private readonly atlas: { texture: Texture; uvs: TileUVs },
  ) {
    super();
    const faces: number[][] = [];
    for (let i = 0; i < CAPACITY; i++) faces.push([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 3]);
    this.mesh = new Mesh(new Float32Array(CAPACITY * 12), faces, [], new Float32Array(CAPACITY * 8));
    this.mesh.colors = new Float32Array(CAPACITY * 16);
    const material = new Material({ color: "#ffffff", shading: "unlit", map: atlas.texture, alphaTest: 0.1, side: "double" });
    this.node = new MeshNode(this.mesh, material, new Transform());
  }

  protected override onAttach(): void {
    this.addNode(this.node, false);
  }

  private add(p: Omit<Particle, "age">): void {
    if (this.list.length >= CAPACITY) this.list.shift();
    this.list.push({ ...p, age: 0 });
  }

  /** How many of `n` to make at this amount (at least one when any). */
  private some(n: number): number {
    return Math.max(this.amount > 0 ? 1 : 0, Math.round(n * this.amount));
  }

  /** A random 4 x 4 pixel piece of a tile, as Minecraft's block pieces. */
  private piece(): [number, number, number, number] {
    const u = Math.floor(Math.random() * 12) / 16;
    const v = Math.floor(Math.random() * 12) / 16;
    return [u, v, u + 4 / 16, v + 4 / 16];
  }

  /** The texture and tint of a block's pieces: its side (a plant's picture). */
  private blockLook(state: number): { tile: number; tint: readonly [number, number, number] } {
    const d = SHAPE[state] === "cube" ? Dir.PosX : Dir.Up;
    const tile = FACE_TILE[state * 6 + d];
    const t = FACE_TINT[state * 6 + d];
    return { tile, tint: t === Tint.None ? WHITE : (tintColor(t, Biome.Plains).map((c) => c / 255) as [number, number, number]) };
  }

  /** A broken block crumbles: pieces from all through it, flying apart. */
  breakBlock(x: number, y: number, z: number, state: number): void {
    const { tile, tint } = this.blockLook(state);
    const n = this.amount >= 1 ? 3 : this.amount >= 0.5 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        for (let k = 0; k < n; k++) {
          const px = x + (i + 0.5) / n;
          const py = y + (j + 0.5) / n;
          const pz = z + (k + 0.5) / n;
          const [u0, v0, u1, v1] = this.piece();
          this.add({ x: px, y: py, z: pz, vx: (px - x - 0.5) * 4 + (Math.random() - 0.5) * 1.5, vy: (py - y - 0.5) * 4 + Math.random() * 2, vz: (pz - z - 0.5) * 4 + (Math.random() - 0.5) * 1.5, life: 0.25 + Math.random() * 1.2, size: 0.06 + Math.random() * 0.05, tiles: [tile], u0, v0, u1, v1, tint, gravity: GRAVITY, collide: true, glow: false, drag: 0 });
        }
      }
    }
  }

  /** Bits flying off the face of a block being broken. */
  hitBlock(x: number, y: number, z: number, state: number, nx: number, ny: number, nz: number): void {
    const { tile, tint } = this.blockLook(state);
    for (let i = 0; i < this.some(2); i++) {
      const [u0, v0, u1, v1] = this.piece();
      const px = x + 0.5 + nx * 0.55 + (nx === 0 ? (Math.random() - 0.5) * 0.9 : 0);
      const py = y + 0.5 + ny * 0.55 + (ny === 0 ? (Math.random() - 0.5) * 0.9 : 0);
      const pz = z + 0.5 + nz * 0.55 + (nz === 0 ? (Math.random() - 0.5) * 0.9 : 0);
      this.add({ x: px, y: py, z: pz, vx: nx * 1.5 + (Math.random() - 0.5), vy: ny * 1.5 + Math.random(), vz: nz * 1.5 + (Math.random() - 0.5), life: 0.3 + Math.random() * 0.4, size: 0.05, tiles: [tile], u0, v0, u1, v1, tint, gravity: GRAVITY, collide: true, glow: false, drag: 0 });
    }
  }

  /** Dust kicked up under running feet, from the block underfoot. */
  footstep(x: number, y: number, z: number, state: number): void {
    if (this.amount < 0.5 || Math.random() > 0.5) return;
    const { tile, tint } = this.blockLook(state);
    const [u0, v0, u1, v1] = this.piece();
    this.add({ x: x + (Math.random() - 0.5) * 0.5, y: y + 0.1, z: z + (Math.random() - 0.5) * 0.5, vx: (Math.random() - 0.5) * 1.5, vy: 1.5, vz: (Math.random() - 0.5) * 1.5, life: 0.4, size: 0.05, tiles: [tile], u0, v0, u1, v1, tint, gravity: GRAVITY, collide: true, glow: false, drag: 0 });
  }

  private sprite(name: string, x: number, y: number, z: number, more: Partial<Particle>): void {
    this.add({ x, y, z, vx: 0, vy: 0, vz: 0, life: 1, size: 0.1, tiles: [atlasIndex(name)], u0: 0, v0: 0, u1: 1, v1: 1, tint: WHITE, gravity: 0, collide: false, glow: false, drag: 0, ...more });
  }

  /** Smoke rising (a torch's, a furnace's, a mob gone): Minecraft's puffs, shrinking as they fade. */
  smoke(x: number, y: number, z: number, big: boolean = false, dark: number = 0.25): void {
    const frames = Array.from({ length: 8 }, (_, i) => atlasIndex(`particle_generic_${7 - i}`));
    const g = 1 - dark;
    this.add({ x, y, z, vx: (Math.random() - 0.5) * 0.2, vy: 0.4 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.2, life: 0.8 + Math.random() * 1.2, size: big ? 0.25 : 0.1, tiles: frames, u0: 0, v0: 0, u1: 1, v1: 1, tint: [g, g, g], gravity: -0.2, collide: false, glow: false, drag: 1 });
  }

  /** A small flame over a torch or in a furnace. */
  flame(x: number, y: number, z: number): void {
    this.sprite("particle_flame", x, y, z, { vy: 0.05, life: 0.4 + Math.random() * 0.4, size: 0.06, glow: true });
  }

  /** Droplets where something falls into water. */
  splash(x: number, y: number, z: number): void {
    for (let i = 0; i < this.some(14); i++) {
      this.sprite(`particle_splash_${i % 4}`, x + (Math.random() - 0.5) * 0.8, y, z + (Math.random() - 0.5) * 0.8, { vx: (Math.random() - 0.5) * 2, vy: 3 + Math.random() * 2, vz: (Math.random() - 0.5) * 2, gravity: GRAVITY, life: 0.6, size: 0.06, collide: true });
    }
  }

  /** Stars around a critical hit. */
  crit(x: number, y: number, z: number): void {
    for (let i = 0; i < this.some(12); i++) {
      this.sprite("particle_critical_hit", x, y, z, { vx: (Math.random() - 0.5) * 6, vy: Math.random() * 4, vz: (Math.random() - 0.5) * 6, gravity: GRAVITY / 2, life: 0.5, size: 0.08, drag: 2 });
    }
  }

  /** An explosion: a burst of puffs, and smoke after. */
  explosion(x: number, y: number, z: number, power: number): void {
    const frames = Array.from({ length: 16 }, (_, i) => atlasIndex(`particle_explosion_${i}`));
    for (let i = 0; i < this.some(power * 6); i++) {
      this.add({ x: x + (Math.random() - 0.5) * power * 1.5, y: y + (Math.random() - 0.5) * power, z: z + (Math.random() - 0.5) * power * 1.5, vx: 0, vy: 0, vz: 0, life: 0.5 + Math.random() * 0.3, size: 0.6 + Math.random() * 0.4, tiles: frames, u0: 0, v0: 0, u1: 1, v1: 1, tint: WHITE, gravity: 0, collide: false, glow: true, drag: 0 });
    }
    for (let i = 0; i < this.some(power * 4); i++) this.smoke(x + (Math.random() - 0.5) * power, y + Math.random() * power * 0.5, z + (Math.random() - 0.5) * power, true, 0.5);
  }

  /** A mob gone in a puff of white. */
  poof(x: number, y: number, z: number): void {
    for (let i = 0; i < this.some(10); i++) this.smoke(x + (Math.random() - 0.5) * 0.8, y + Math.random() * 1.2, z + (Math.random() - 0.5) * 0.8, true, 0);
  }

  /** A heart rising over an animal in love. */
  heart(x: number, y: number, z: number): void {
    this.sprite("particle_heart", x, y, z, { vx: (Math.random() - 0.5) * 0.4, vy: 0.4 + Math.random() * 0.2, vz: (Math.random() - 0.5) * 0.4, life: 0.8, size: 0.1, drag: 1 });
  }

  /** Green sparkles all about a block that bone meal made grow. */
  glint(x: number, y: number, z: number): void {
    for (let i = 0; i < this.some(15); i++) {
      this.sprite("particle_glint", x + Math.random(), y + Math.random(), z + Math.random(), { vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4, vz: (Math.random() - 0.5) * 0.4, life: 0.5 + Math.random(), size: 0.06 });
    }
  }

  /** A drop of lava spat out of a lava pool. */
  lava(x: number, y: number, z: number): void {
    this.sprite("particle_lava", x, y, z, { vx: (Math.random() - 0.5) * 2, vy: 3 + Math.random() * 2, vz: (Math.random() - 0.5) * 2, gravity: GRAVITY, life: 1.2, size: 0.08, glow: true, collide: true });
  }

  /** Crumbs of what is being eaten, in front of the mouth. */
  crumbs(x: number, y: number, z: number, tile: number): void {
    for (let i = 0; i < this.some(3); i++) {
      const [u0, v0, u1, v1] = this.piece();
      this.add({ x, y, z, vx: (Math.random() - 0.5) * 2, vy: 1 + Math.random(), vz: (Math.random() - 0.5) * 2, life: 0.5, size: 0.05, tiles: [tile], u0, v0, u1, v1, tint: WHITE, gravity: GRAVITY, collide: true, glow: false, drag: 0 });
    }
  }

  override update(dt: number): void {
    // Moving, falling, landing, fading
    const w = this.world;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.list.splice(i, 1);
        continue;
      }
      p.vy -= p.gravity * dt;
      if (p.drag > 0) {
        const k = Math.exp(-p.drag * dt);
        p.vx *= k;
        p.vz *= k;
      }
      const nx = p.x + p.vx * dt;
      const ny = p.y + p.vy * dt;
      const nz = p.z + p.vz * dt;
      if (p.collide && SOLID[w.get(Math.floor(nx), Math.floor(ny - p.size), Math.floor(nz))]) {
        // Landed: it lies where it fell
        p.vx *= 0.3;
        p.vz *= 0.3;
        p.vy = 0;
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        continue;
      }
      p.x = nx;
      p.y = ny;
      p.z = nz;
    }
    this.draw();
  }

  /** Every particle a square turned to the camera, as bright as the light where it is. */
  private draw(): void {
    const camera = this.sim?.camera;
    if (!camera) return;
    camera.getRight(this.right);
    camera.getUp(this.up);
    const pos = this.mesh.positions;
    const uvs = this.mesh.uvs!;
    const colors = this.mesh.colors!;
    const r = this.right;
    const u = this.up;
    const atlas = this.atlas.uvs;
    let q = 0;
    for (const p of this.list) {
      const t = p.age / p.life;
      const tile = p.tiles[Math.min(p.tiles.length - 1, Math.floor(t * p.tiles.length))];
      const s = p.size;
      const o = q * 12;
      // Corners: bottom left, bottom right, top right, top left
      const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ];
      corners.forEach(([a, b], k) => {
        pos[o + k * 3] = p.x + (r.x * a + u.x * b) * s;
        pos[o + k * 3 + 1] = p.y + (r.y * a + u.y * b) * s;
        pos[o + k * 3 + 2] = p.z + (r.z * a + u.z * b) * s;
      });
      const a0 = atlas[tile * 4];
      const b0 = atlas[tile * 4 + 1];
      const aw = atlas[tile * 4 + 2] - a0;
      const bh = atlas[tile * 4 + 3] - b0;
      const uo = q * 8;
      uvs.set([a0 + p.u0 * aw, b0 + p.v1 * bh, a0 + p.u1 * aw, b0 + p.v1 * bh, a0 + p.u1 * aw, b0 + p.v0 * bh, a0 + p.u0 * aw, b0 + p.v0 * bh], uo);
      const light = p.glow ? 1 : Math.max(0.1, this.lightMap.brightness(this.world.getLight(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))));
      for (let k = 0; k < 4; k++) colors.set([p.tint[0] * light, p.tint[1] * light, p.tint[2] * light, 1], (q * 4 + k) * 4);
      q++;
    }
    // The rest: nothing to draw
    pos.fill(0, q * 12);
    this.node.visible = q > 0;
    this.mesh.markDirty();
  }
}

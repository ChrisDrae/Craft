import { Layer, Material, clipPolygonNear, clipSegmentNear, type CustomNode, type EmitContext, type Scene, type Vec3 } from "projector";
import { DIR_X, DIR_Y, DIR_Z, Dir, FLUID, OPAQUE, STATE_COUNT, faceMaterial } from "./blocks.js";
import { CHUNK_SIZE, FACE_CORNERS as CORNERS, MODEL_FACE } from "./chunk.js";
import { ownHeight } from "./fluids.js";
import { MODELS } from "./shapes.js";
import type { LightMap } from "./lightmap.js";
import type { VoxelHit } from "./raycast.js";
import { css } from "./sky.js";
import type { VoxelWorld } from "./world.js";

/** Fog shades per face style; each is one fill style, so this bounds the batch count. */
const FOG_LEVELS = 24;
/** Brightness steps from light levels per face style, for the same reason (twice: by sky or by torch light). */
const LIGHT_STEPS = 8;
/** The color of torchlight, which faces lit more by blocks than by the sky take on. */
const WARM = [1, 0.84, 0.62];
/**
 * Projected quads grow by this many pixels around their center. Neighbors drawn in different batches
 * would otherwise leave anti-aliased hairlines between them where the sky shows through.
 */
const SEAM = 0.4;

export interface VoxelStats {
  chunks: number;
  faces: number;
}

/** What every quad of a frame is drawn against: the range (squared) and the camera's position. */
interface Frame {
  range2: number;
  ex: number;
  ey: number;
  ez: number;
}

/**
 * Draws the voxel world: every exposed face of the chunks in view, emitted straight into the render
 * queue. Faces are culled per chunk (distance, view frustum) and per face (facing away, off screen).
 * All faces of a block are sorted at the distance of the block's center, which is a correct painter's
 * order for a grid of unit cubes; sorting faces by their own centers draws tops and sides out of order.
 */
export class VoxelNode implements CustomNode {
  readonly kind = "custom" as const;
  visible: boolean = true;
  layer: number = Layer.World;
  /** Faces farther than this (in blocks) are not drawn. */
  renderDistance: number = 48;
  /** The block to outline, if any. */
  target: VoxelHit | null = null;
  /** Light levels to brightness; without it every face is fully lit. */
  lightMap: LightMap | null = null;
  readonly stats: VoxelStats = { chunks: 0, faces: 0 };
  private readonly world: VoxelWorld;
  private readonly scene: Scene;
  /** Style ids by (state, direction, fog level, light step), -1 until used; refilled every frame. */
  private readonly styles: Int32Array = new Int32Array(STATE_COUNT * 6 * FOG_LEVELS * LIGHT_STEPS * 2);
  /** Each face material at every light step, made on first use. */
  private readonly dimmed: Map<Material, Material[]> = new Map();
  private readonly corners: Float64Array = new Float64Array(12);
  private readonly view: Float64Array = new Float64Array(12);
  private readonly clipped: Float64Array = new Float64Array(24);
  private readonly screen: Float64Array = new Float64Array(16);
  private readonly segment: Float64Array = new Float64Array(6);
  private readonly forward: Vec3 = { x: 0, y: 0, z: 1 };
  private outlineStyle: number = -1;

  constructor(world: VoxelWorld, scene: Scene) {
    this.world = world;
    this.scene = scene;
  }

  emit(ctx: EmitContext): void {
    const camera = ctx.camera;
    const v = camera.viewMatrix;
    const p = ctx.proj;
    const near = p.near;
    const ex = camera.position.x;
    const ey = camera.position.y;
    const ez = camera.position.z;
    camera.getForward(this.forward);
    this.styles.fill(-1);
    const fog = this.scene.fog;
    // Fully fogged faces look just like the sky behind them
    const range = fog ? Math.min(this.renderDistance, fog.far) : this.renderDistance;
    const range2 = range * range;
    // Frustum side planes through the camera: |x| <= z * tanX and |y| <= z * tanY in view space
    const tanX = p.cx / p.sx;
    const tanY = p.cy / p.sy;
    const normX = Math.sqrt(1 + tanX * tanX);
    const normY = Math.sqrt(1 + tanY * tanY);
    const half = CHUNK_SIZE / 2;
    const frame: Frame = { range2, ex, ey, ez };
    let chunks = 0;
    let drawn = 0;

    for (const chunk of this.world.chunks.values()) {
      const ox = chunk.cx * CHUNK_SIZE;
      const oz = chunk.cz * CHUNK_SIZE;
      const gx = Math.max(Math.abs(ox + half - ex) - half, 0);
      const gz = Math.max(Math.abs(oz + half - ez) - half, 0);
      if (gx * gx + gz * gz > range2) continue;
      if (chunk.dirty) this.world.buildFaces(chunk);
      const [minY, maxY] = chunk.faceBounds();
      if (maxY < minY) continue;

      // Bounding sphere of the chunk's faces against the frustum
      const hy = (maxY + 1 - minY) / 2;
      const r = Math.sqrt(2 * half * half + hy * hy);
      const sx = ox + half;
      const sy = minY + hy;
      const sz = oz + half;
      const vx = v[0] * sx + v[4] * sy + v[8] * sz + v[12];
      const vy = v[1] * sx + v[5] * sy + v[9] * sz + v[13];
      const vz = v[2] * sx + v[6] * sy + v[10] * sz + v[14];
      if (vz < near - r) continue;
      if ((Math.abs(vx) - tanX * vz) / normX > r || (Math.abs(vy) - tanY * vz) / normY > r) continue;
      chunks++;

      for (let s = 0; s < chunk.sections.length; s++) {
        const section = chunk.sections[s];
        const faces = section.faces;
        for (let i = 0; i < section.faceCount; i++) {
          const f = faces[i];
          const x = ox + (f & 15);
          const z = oz + ((f >> 4) & 15);
          const y = s * CHUNK_SIZE + ((f >> 8) & 15);
          const d = (f >> 12) & 7;
          const state = f >>> 16;
          const corners = this.corners;
          if (d === MODEL_FACE) {
            for (const q of MODELS[state]!) {
              corners.set(q.corners);
              // Lit by the block it faces, unless that one is solid; plants by their own
              let lx = x;
              let ly = y;
              let lz = z;
              if (q.dir >= 0 && !OPAQUE[this.world.get(x + DIR_X[q.dir], y + DIR_Y[q.dir], z + DIR_Z[q.dir])]) {
                lx += DIR_X[q.dir];
                ly += DIR_Y[q.dir];
                lz += DIR_Z[q.dir];
              }
              if (this.quad(ctx, frame, x, y, z, state, q.dir >= 0 ? q.dir : Dir.Up, lx, ly, lz)) drawn++;
            }
            continue;
          }
          // A cube's face; a fluid's top at its surface (full under more of the same fluid)
          let top = 1;
          if (FLUID[state] !== 0 && FLUID[this.world.get(x, y + 1, z)] !== FLUID[state]) top = ownHeight(state);
          for (let k = 0; k < 12; k += 3) {
            corners[k] = CORNERS[d * 12 + k];
            corners[k + 1] = CORNERS[d * 12 + k + 1] * top;
            corners[k + 2] = CORNERS[d * 12 + k + 2];
          }
          if (this.quad(ctx, frame, x, y, z, state, d, x + DIR_X[d], y + DIR_Y[d], z + DIR_Z[d])) drawn++;
        }
      }
    }

    if (this.target) this.emitOutline(ctx, this.target);
    this.stats.chunks = chunks;
    this.stats.faces = drawn;
  }

  /**
   * Draws the quad in this.corners (relative to block (x, y, z)) if it faces the camera and is in range and
   * on screen: projected, clipped at the near plane, grown by SEAM, styled by the state's look in direction
   * d and the light at block (lx, ly, lz), and sorted at the distance of the block's center.
   */
  private quad(ctx: EmitContext, frame: Frame, x: number, y: number, z: number, state: number, d: number, lx: number, ly: number, lz: number): boolean {
    const c = this.corners;
    const v = ctx.camera.viewMatrix;
    const p = ctx.proj;
    const near = p.near;
    // Only quads whose outer side the camera is on (Newell normal against the direction to the camera)
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let k = 0; k < 4; k++) {
      const a = k * 3;
      const b = ((k + 1) % 4) * 3;
      nx += (c[a + 1] - c[b + 1]) * (c[a + 2] + c[b + 2]);
      ny += (c[a + 2] - c[b + 2]) * (c[a] + c[b]);
      nz += (c[a] - c[b]) * (c[a + 1] + c[b + 1]);
    }
    if (nx * (frame.ex - x - c[0]) + ny * (frame.ey - y - c[1]) + nz * (frame.ez - z - c[2]) <= 0) return false;

    const cx = x + 0.5 - frame.ex;
    const cy = y + 0.5 - frame.ey;
    const cz = z + 0.5 - frame.ez;
    const dist2 = cx * cx + cy * cy + cz * cz;
    if (dist2 > frame.range2) return false;

    const view = this.view;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let k = 0; k < 12; k += 3) {
      const wx = x + c[k];
      const wy = y + c[k + 1];
      const wz = z + c[k + 2];
      const qz = v[2] * wx + v[6] * wy + v[10] * wz + v[14];
      view[k] = v[0] * wx + v[4] * wy + v[8] * wz + v[12];
      view[k + 1] = v[1] * wx + v[5] * wy + v[9] * wz + v[13];
      view[k + 2] = qz;
      if (qz < minZ) minZ = qz;
      if (qz > maxZ) maxZ = qz;
    }
    if (maxZ < near) return false;
    let src = view;
    let n = 4;
    if (minZ < near) {
      n = clipPolygonNear(near, view, 4, this.clipped);
      if (n < 3) return false;
      src = this.clipped;
    }

    const screen = this.screen;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let mx = 0;
    let my = 0;
    for (let k = 0; k < n; k++) {
      const qz = src[k * 3 + 2];
      const px = p.cx + (p.sx * src[k * 3]) / qz;
      const py = p.cy - (p.sy * src[k * 3 + 1]) / qz;
      screen[k * 2] = px;
      screen[k * 2 + 1] = py;
      mx += px;
      my += py;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    if (maxX < 0 || minX > p.width || maxY < 0 || minY > p.height) return false;
    mx /= n;
    my /= n;
    for (let k = 0; k < n; k++) {
      const ux = screen[k * 2] - mx;
      const uy = screen[k * 2 + 1] - my;
      const len = Math.hypot(ux, uy);
      if (len > 0) {
        screen[k * 2] += (ux / len) * SEAM;
        screen[k * 2 + 1] += (uy / len) * SEAM;
      }
    }

    const depth = Math.sqrt(dist2);
    let step = LIGHT_STEPS - 1;
    if (this.lightMap) {
      const light = this.world.getLight(lx, ly, lz);
      step = Math.round(this.lightMap.brightness(light) * (LIGHT_STEPS - 1));
      // Steps past LIGHT_STEPS are torchlit
      if ((light & 15) > light >> 4) step += LIGHT_STEPS;
    }
    ctx.queue.pushPolygon(this.layer, this.styleFor(ctx, state, d, depth, step), depth, screen, n);
    return true;
  }

  /**
   * Lit, fogged style of a block face. The scene lights are directional and hemisphere only (no
   * highlights), so the surface point matters only for fog, and litStyle fogs by view depth. A point
   * straight ahead at the face's distance gives it fog by distance instead, so the fog doesn't shift
   * as the view turns.
   */
  private styleFor(ctx: EmitContext, state: number, d: number, distance: number, step: number): number {
    const fog = this.scene.fog;
    let level = 0;
    if (fog) {
      const t = (distance - fog.near) / (fog.far - fog.near);
      level = t <= 0 ? 0 : t >= 1 ? FOG_LEVELS - 1 : Math.round(t * (FOG_LEVELS - 1));
    }
    const key = ((state * 6 + d) * FOG_LEVELS + level) * LIGHT_STEPS + step;
    let style = this.styles[key];
    if (style < 0) {
      const at = fog ? fog.near + (level / (FOG_LEVELS - 1)) * (fog.far - fog.near) : 1;
      const e = ctx.camera.position;
      const f = this.forward;
      style = ctx.litStyle(this.dim(faceMaterial(state, d), step), DIR_X[d], DIR_Y[d], DIR_Z[d], e.x + f.x * at, e.y + f.y * at, e.z + f.z * at);
      this.styles[key] = style;
    }
    return style;
  }

  /** A material at a light step: its color darkened in proportion, and warmer if lit by torches. */
  private dim(material: Material, step: number): Material {
    if (step === LIGHT_STEPS - 1) return material;
    let steps = this.dimmed.get(material);
    if (!steps) {
      const hex = parseInt(material.color.slice(1), 16);
      const base: [number, number, number] = [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
      steps = Array.from({ length: LIGHT_STEPS * 2 }, (_, s) => {
        const k = (s % LIGHT_STEPS) / (LIGHT_STEPS - 1);
        const tint = s >= LIGHT_STEPS ? WARM : [1, 1, 1];
        return new Material({ color: css([base[0] * k * tint[0], base[1] * k * tint[1], base[2] * k * tint[2]]), shading: material.shading, opacity: material.opacity });
      });
      this.dimmed.set(material, steps);
    }
    return steps[step];
  }

  /**
   * Outlines the faces of the target block that face the camera, sorted just in front of the block so
   * nearer blocks still cover the outline.
   */
  private emitOutline(ctx: EmitContext, t: VoxelHit): void {
    if (this.outlineStyle < 0) this.outlineStyle = ctx.style(null, "#141414", 2, 0.85);
    const e = ctx.camera.position;
    const depth = Math.hypot(t.x + 0.5 - e.x, t.y + 0.5 - e.y, t.z + 0.5 - e.z) - 0.01;
    const grow = 0.002;
    for (let d = 0; d < 6; d++) {
      const facing =
        DIR_X[d] * (e.x - (t.x + 0.5)) + DIR_Y[d] * (e.y - (t.y + 0.5)) + DIR_Z[d] * (e.z - (t.z + 0.5)) > 0.5;
      if (!facing) continue;
      const c = d * 12;
      for (let k = 0; k < 4; k++) {
        const a = c + k * 3;
        const b = c + ((k + 1) % 4) * 3;
        this.outlineSegment(
          ctx,
          depth,
          t.x + CORNERS[a] * (1 + 2 * grow) - grow,
          t.y + CORNERS[a + 1] * (1 + 2 * grow) - grow,
          t.z + CORNERS[a + 2] * (1 + 2 * grow) - grow,
          t.x + CORNERS[b] * (1 + 2 * grow) - grow,
          t.y + CORNERS[b + 1] * (1 + 2 * grow) - grow,
          t.z + CORNERS[b + 2] * (1 + 2 * grow) - grow,
        );
      }
    }
  }

  private outlineSegment(ctx: EmitContext, depth: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    const v = ctx.camera.viewMatrix;
    const p = ctx.proj;
    const s = this.segment;
    s[0] = v[0] * ax + v[4] * ay + v[8] * az + v[12];
    s[1] = v[1] * ax + v[5] * ay + v[9] * az + v[13];
    s[2] = v[2] * ax + v[6] * ay + v[10] * az + v[14];
    s[3] = v[0] * bx + v[4] * by + v[8] * bz + v[12];
    s[4] = v[1] * bx + v[5] * by + v[9] * bz + v[13];
    s[5] = v[2] * bx + v[6] * by + v[10] * bz + v[14];
    if (!clipSegmentNear(p.near, s)) return;
    ctx.queue.pushLine(
      this.layer,
      this.outlineStyle,
      depth,
      p.cx + (p.sx * s[0]) / s[2],
      p.cy - (p.sy * s[1]) / s[2],
      p.cx + (p.sx * s[3]) / s[5],
      p.cy - (p.sy * s[4]) / s[5],
    );
  }
}

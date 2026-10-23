import { BIOMES, type Biome } from "../biomes.js";
import { stateName } from "../blocks.js";
import { DAY } from "../sky.js";

/** What the debug screen shows. */
export interface DebugInfo {
  /** Seconds of the last frames. */
  frames: readonly number[];
  renderer: string;
  stats: { primitives: number; batches: number; ms: number };
  position: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  biome: Biome | null;
  sky: number;
  block: number;
  target: { x: number; y: number; z: number; state: number } | null;
  time: number;
  chunks: number;
  mobs: number;
  mode: string;
  sharing: string;
}

/** The way a yaw looks, as Minecraft's debug screen says it. */
function facing(yaw: number): string {
  const d = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
  return ["south (towards +Z)", "east (towards +X)", "north (towards -Z)", "west (towards -X)"][d];
}

/**
 * The debug screen's lines, as Minecraft's F3: frames a second and the slowest, what the renderer drew,
 * where the player is (block, chunk, which way, biome, light), the block looked at, the time, what is
 * loaded, how the world is shared.
 */
export function debugLines(i: DebugInfo): string[] {
  const n = i.frames.length || 1;
  const avg = i.frames.reduce((a, b) => a + b, 0) / n;
  const worst = Math.max(0, ...i.frames);
  const p = i.position;
  const bx = Math.floor(p.x);
  const by = Math.floor(p.y);
  const bz = Math.floor(p.z);
  const deg = (r: number): string => ((r * 180) / Math.PI).toFixed(1);
  const t = i.target;
  return [
    `Craft (${i.mode}, ${i.sharing})`,
    `${Math.round(1 / Math.max(avg, 1e-3))} fps, slowest frame ${(worst * 1000).toFixed(1)} ms`,
    `${i.renderer}: ${i.stats.primitives} drawn, ${i.stats.batches} batches, ${i.stats.ms.toFixed(1)} ms`,
    `${i.chunks} chunks loaded, ${i.mobs} mobs`,
    "",
    `XYZ: ${p.x.toFixed(3)} / ${p.y.toFixed(5)} / ${p.z.toFixed(3)}`,
    `Block: ${bx} ${by} ${bz} [${bx & 15} ${by & 15} ${bz & 15}]`,
    `Chunk: ${bx >> 4} ${by >> 4} ${bz >> 4}`,
    `Facing: ${facing(i.yaw)} (${deg(i.yaw)} / ${deg(-i.pitch)})`,
    `Biome: ${i.biome === null ? "?" : BIOMES[i.biome].name}`,
    `Light: ${Math.max(i.sky, i.block)} (${i.sky} sky, ${i.block} block)`,
    `Day ${Math.floor(i.time / DAY)}, time ${i.time % DAY}`,
    "",
    t ? `Targeted block: ${t.x}, ${t.y}, ${t.z}` : "",
    t ? stateName(t.state) : "",
  ].filter((l, k, all) => l !== "" || (k > 0 && all[k - 1] !== ""));
}

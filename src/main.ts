import { Canvas2DBackend, DirectionalLight, HemisphereLight, Simulation, type Fog, type Vec3 } from "projector";
import { BLOCKS, HOTBAR } from "./blocks.js";
import { WORLD_HEIGHT } from "./chunk.js";
import { SEA_LEVEL, TerrainGenerator } from "./generator.js";
import { Hud } from "./hud.js";
import { BlockInteraction } from "./interaction.js";
import { Player } from "./player.js";
import { Terrain } from "./terrain.js";
import { VoxelWorld } from "./world.js";
import "./style.css";

const SKY = "#8fbcf0";
const UNDERWATER = "#21467f";

function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`Missing #${id}`);
  return el;
}

const canvas = element("canvas", HTMLCanvasElement);
const overlay = element("play", HTMLElement);
const hotbarEl = element("hotbar", HTMLElement);
const blockName = element("block-name", HTMLElement);
const underwaterEl = element("underwater", HTMLElement);
const hudEl = element("hud", HTMLElement);

const seed = new URLSearchParams(location.search).get("seed") ?? "craft";
const generator = new TerrainGenerator(seed);
const world = new VoxelWorld(generator);

const backend = new Canvas2DBackend(canvas, { pixelRatio: Math.min(1, globalThis.devicePixelRatio || 1) });
const sim = new Simulation({
  canvas,
  backend,
  orbit: false,
  keyboard: ["Space"],
  camera: { fov: (70 * Math.PI) / 180, near: 0.05 },
  scene: { background: SKY },
});
// Tops in full light, sides a step or two darker depending on the sun, bottoms darkest
sim.scene.ambient.intensity = 0.3;
sim.scene.lights = [
  new HemisphereLight("#d6e6ff", "#8a7a66", 0.4),
  new DirectionalLight({ x: -0.5, y: -1, z: -0.35 }, 0.45),
];

/** Nearest dry land to the origin, searched outward in a square spiral. */
function findLand(): { x: number; z: number } {
  for (let r = 0; r < 64; r++) {
    for (let i = -r; i <= r; i++) {
      for (const [x, z] of [[i, -r], [i, r], [-r, i], [r, i]]) {
        if (generator.surfaceHeight(x * 8, z * 8) - 1 >= SEA_LEVEL + 2) return { x: x * 8, z: z * 8 };
      }
    }
  }
  return { x: 0, z: 0 };
}

const land = findLand();
const spawn: Vec3 = { x: land.x + 0.5, y: WORLD_HEIGHT, z: land.z + 0.5 };
const player = new Player(world, spawn);
const terrain = sim.add(new Terrain(world, sim.scene, player.position));
sim.add(player);
const interaction = sim.add(new BlockInteraction(world, player, terrain.node));
terrain.loadAll();
// Stand on the highest block of the spawn column (a tree, maybe)
let ground = WORLD_HEIGHT - 1;
while (ground > 0 && !world.isSolid(land.x, ground, land.z)) ground--;
player.position.y = ground + 1;

// Sky and fog, and the view under water
function skyFog(): Fog {
  const d = terrain.node.renderDistance;
  return { color: SKY, near: d * 0.5, far: d };
}
sim.scene.fog = skyFog();
let underwater = false;
sim.onUpdate(() => {
  if (player.eyeInWater === underwater) return;
  underwater = player.eyeInWater;
  sim.scene.background = underwater ? UNDERWATER : SKY;
  sim.scene.fog = underwater ? { color: UNDERWATER, near: 1, far: 14 } : skyFog();
  underwaterEl.hidden = !underwater;
});

// Pointer lock: click to play, Esc to get the mouse back. Where the browser refuses pointer lock (some
// embedded or automated browsers), dragging looks around and a click without dragging acts instead.
const locked = (): boolean => document.pointerLockElement === canvas;
let dragMode = false;
let drag: { x: number; y: number; button: number; moved: boolean } | null = null;

function setPlaying(on: boolean): void {
  player.controls = on;
  overlay.hidden = on;
  interaction.release(0);
  interaction.release(2);
}

overlay.addEventListener("click", () => {
  Promise.resolve(canvas.requestPointerLock()).catch(() => {
    dragMode = true;
    setPlaying(true);
  });
});
document.addEventListener("pointerlockchange", () => setPlaying(locked()));
document.addEventListener("mousemove", (e) => {
  if (locked()) {
    player.look(e.movementX, e.movementY);
  } else if (drag) {
    player.look(e.movementX, e.movementY);
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
  }
});
canvas.addEventListener("mousedown", (e) => {
  if (locked()) interaction.press(e.button);
  else if (dragMode && player.controls) drag = { x: e.clientX, y: e.clientY, button: e.button, moved: false };
});
window.addEventListener("mouseup", (e) => {
  if (drag && !drag.moved) interaction.press(drag.button);
  drag = null;
  interaction.release(e.button);
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener(
  "wheel",
  (e) => {
    if (player.controls && e.deltaY !== 0) interaction.select(interaction.selected + Math.sign(e.deltaY));
  },
  { passive: true },
);
window.addEventListener("keydown", (e) => {
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit) interaction.select(Number(digit[1]) - 1);
  if (e.code === "F3") {
    e.preventDefault();
    hudEl.hidden = !hudEl.hidden;
  }
  if (e.code === "Escape" && dragMode) setPlaying(false);
});

// Hotbar
const slots = HOTBAR.map((block, i) => {
  const slot = document.createElement("div");
  slot.className = "slot";
  const info = BLOCKS[block];
  slot.style.setProperty("--top", info.top);
  slot.style.setProperty("--side", info.side);
  slot.title = info.name;
  const key = document.createElement("span");
  key.textContent = String(i + 1);
  slot.append(key);
  hotbarEl.append(slot);
  return slot;
});
let nameTimer = 0;
interaction.onSelect = (slot) => {
  slots.forEach((el, i) => el.classList.toggle("selected", i === slot));
  blockName.textContent = BLOCKS[HOTBAR[slot]].name;
  blockName.classList.add("shown");
  clearTimeout(nameTimer);
  nameTimer = window.setTimeout(() => blockName.classList.remove("shown"), 1200);
};
slots[0].classList.add("selected");

// Stats and settings
const hud = new Hud(
  hudEl,
  "Craft",
  "WASD move · Space jump/swim · Shift sprint\nLeft click break · Right click place\n1-9 / wheel pick block · F3 hide this",
);
hud.slider("view distance", 16, 96, 8, terrain.node.renderDistance, (v) => {
  terrain.node.renderDistance = v;
  if (!underwater) sim.scene.fog = skyFog();
});
const ratios = ["0.5", "0.75", "1", "1.5", "2"] as const;
hud.select("pixel ratio", ratios, String(backend.pixelRatio) as (typeof ratios)[number], (v) =>
  backend.setSize(backend.width, backend.height, Number(v)),
);
sim.onAfterRender(() => {
  const s = sim.stats;
  const p = player.position;
  const t = interaction.target;
  hud.stat("fps", Math.round(s.fps));
  hud.stat("render ms", s.renderMs);
  hud.stat("faces", terrain.node.stats.faces);
  hud.stat("draw batches", s.batches);
  hud.stat("chunks", `${terrain.node.stats.chunks} / ${world.chunks.size}`);
  hud.stat("position", `${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`);
  hud.stat("looking at", t ? BLOCKS[t.block].name : "-");
  hud.flush();
});

sim.start();
// For poking at the running game from the browser console
Object.assign(globalThis, { craft: { sim, world, player, interaction, terrain } });

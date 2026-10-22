import { Canvas2DBackend, DirectionalLight, HemisphereLight, Simulation, WebGLBackend, type Fog, type RenderBackend, type Vec3 } from "projector";
import { BLOCKS, Dir, HOTBAR } from "./blocks.js";
import { WORLD_HEIGHT } from "./chunk.js";
import { SEA_LEVEL, TerrainGenerator } from "./generator.js";
import { BlockInteraction } from "./interaction.js";
import { Player } from "./player.js";
import { Terrain, type TerrainTextures } from "./terrain.js";
import { atlasTexture, blockAtlas, importedTiles, proceduralTiles, tileFor, tileImage } from "./textures.js";
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

// ?seed=... picks another world, ?view=16..160 the view distance in blocks, ?renderer=canvas the flat-colored
// Canvas 2D renderer instead of textured WebGL
const params = new URLSearchParams(location.search);
const seed = params.get("seed") ?? "craft";
const generator = new TerrainGenerator(seed);
const world = new VoxelWorld(generator);

/** WebGL2 with textures where it works, Canvas 2D otherwise or when asked for. */
function createBackend(): RenderBackend {
  if (params.get("renderer") !== "canvas") {
    try {
      return new WebGLBackend(canvas, { pixelRatio: Math.min(2, globalThis.devicePixelRatio || 1) });
    } catch (e) {
      console.warn("Craft: no WebGL2, drawing with Canvas 2D.", e);
    }
  }
  return new Canvas2DBackend(canvas, { pixelRatio: Math.min(1, globalThis.devicePixelRatio || 1) });
}

const backend = createBackend();
const textured = backend instanceof WebGLBackend;
const view = Math.min(160, Math.max(16, Number(params.get("view")) || (textured ? 96 : 48)));
// Minecraft's own textures when they were imported (npm run textures), Craft's procedural ones otherwise
const imported = textured ? await importedTiles() : null;
if (imported) console.info(`Craft: block textures from Minecraft ${imported.version}`);
const tiles = textured ? (imported?.tiles ?? proceduralTiles()) : null;
let textures: TerrainTextures | null = null;
if (tiles) {
  const { atlas, uvs } = blockAtlas(tiles);
  textures = { texture: atlasTexture(atlas), uvs };
}
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
const terrain = sim.add(new Terrain(world, sim.scene, player.position, textures));
terrain.renderDistance = view;
sim.add(player);
const interaction = sim.add(new BlockInteraction(world, player, terrain));
terrain.loadAll();
// Stand on the highest block of the spawn column (a tree, maybe)
let ground = WORLD_HEIGHT - 1;
while (ground > 0 && !world.isSolid(land.x, ground, land.z)) ground--;
player.position.y = ground + 1;

// Sky and fog, and the view under water
function skyFog(): Fog {
  const d = terrain.renderDistance;
  return { color: SKY, near: d * 0.5, far: d, mode: "distance" };
}
sim.scene.fog = skyFog();
let underwater = false;
sim.onUpdate(() => {
  if (player.eyeInWater === underwater) return;
  underwater = player.eyeInWater;
  sim.scene.background = underwater ? UNDERWATER : SKY;
  sim.scene.fog = underwater ? { color: UNDERWATER, near: 1, far: 14, mode: "distance" } : skyFog();
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
  if (e.code === "Escape" && dragMode) setPlaying(false);
});

// Hotbar
const slots = HOTBAR.map((block, i) => {
  const slot = document.createElement("div");
  slot.className = "slot";
  const info = BLOCKS[block];
  slot.style.setProperty("--top", info.top);
  slot.style.setProperty("--side", info.side);
  const tile = tiles?.get(tileFor(block, Dir.PosX));
  if (tile) slot.style.setProperty("--icon", `url(${tileImage(tile)}) center / cover`);
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

sim.start();
// For poking at the running game from the browser console
Object.assign(globalThis, { craft: { sim, backend, world, player, interaction, terrain } });

import { Canvas2DBackend, DirectionalLight, HemisphereLight, Simulation, WebGLBackend, type RenderBackend } from "projector";
import { FURNACE_FUEL, FURNACE_INPUT, FURNACE_OUTPUT, furnaceAccepts, loadEntity, takeXp, tickFurnaces, type BlockEntity } from "./blockEntities.js";
import { BLOCKS, Block, DIR_X, DIR_Z, FACING_DIR, FLUID, HOTBAR, LEFT_OF, RIGHT_OF, SHAPE, SOLID, STATE_BLOCK, blockOf, isBed, propertyOf } from "./blocks.js";
import { Sounds, soundGroup, type SoundCategory } from "./audio.js";
import { CameraEffects } from "./camera.js";
import { MESHING } from "./chunkMesh.js";
import { runCommand, type CommandContext } from "./commands.js";
import { Hand } from "./hand.js";
import { Particles } from "./particles.js";
import { levelOf } from "./vitals.js";
import { WORLD_HEIGHT, type ChunkGenerator } from "./chunk.js";
import { Drops } from "./drops.js";
import { Icons } from "./icons.js";
import { HOTBAR_SLOTS, INVENTORY_SLOTS, PLAYER_SLOTS, arraySlot, type Slot } from "./inventory.js";
import { ITEMS, Items, loadStack, saveStack, stack, type Item, type ItemStack } from "./items.js";
import { ItemView } from "./itemView.js";
import { dropsOf, xpOf } from "./mining.js";
import { DirectSupply, WorkerSupply, type ChunkSupply } from "./chunkSupply.js";
import { SEA_LEVEL, TerrainGenerator } from "./generator.js";
import { BlockInteraction } from "./interaction.js";
import { LightMap } from "./lightmap.js";
import { MOBS, MOB_KINDS } from "./mobs/kinds.js";
import { ARROW, Flag, Mobs, type MobPlayer } from "./mobs/mobs.js";
import { segmentHitsBox } from "./mobs/arrow.js";
import { MobRenderer, type ShownMob } from "./mobs/view.js";
import { Player } from "./player.js";
import { Avatars } from "./net/avatars.js";
import type { Connection } from "./net/connection.js";
import { GuestSession } from "./net/guest.js";
import { HostSession, type Guest } from "./net/host.js";
import { ORB, type GuestState, type PlayerView } from "./net/protocol.js";
import { Hosting } from "./net/rtc.js";
import type { GameMode, GuestRecord, PlayerLife, PlayerRecord, Position, WorldMeta } from "./save/format.js";
import type { WorldStore } from "./save/store.js";
import { WorldSave } from "./save/worldSave.js";
import { playerId, viewDistance, type KeyAction, type Settings } from "./settings.js";
import { DAY, Sky, css } from "./sky.js";
import { BREAKING, Survival } from "./survival.js";
import { Terrain, type TerrainTextures } from "./terrain.js";
import { blockBehaviors } from "./fluids.js";
import { AtlasTexture, animatedFrames, atlasIndex, blockAtlas, importedTextures, proceduralTiles } from "./textures.js";
import { TICKS_PER_SECOND, WorldTicks } from "./ticks.js";
import { BlockUpdates } from "./updates.js";
import { formatWhen, h } from "./ui/dom.js";
import { debugLines } from "./ui/debug.js";
import { Hud, hudSprites } from "./ui/hud.js";
import { ItemScreen } from "./ui/items.js";
import { optionsScreen } from "./ui/options.js";
import { DIFFICULTIES, deathMessage, deathXp, type DamageSource, type Difficulty, type PlayMode } from "./vitals.js";
import { VoxelWorld } from "./world.js";

/** Times of day a player may sleep (Minecraft's: from dusk to just before dawn). */
const NIGHT_START = 12542;
const NIGHT_END = 23459;
/** Ticks everyone must lie in bed before the night passes. */
const SLEEP_TICKS = 100;
/** The id mobs know the player here by (the host's own player, to guests too). */
const LOCAL = "host";
/** Milliseconds between the host's mob updates, over which a guest moves them. */
const MOB_UPDATES = 100;
/** Particles by the setting: all, fewer, the fewest. */
const PARTICLES: Readonly<Record<Settings["particles"], number>> = { all: 1, decreased: 0.5, minimal: 0.15 };
/** Lines of chat shown while it is open. */
const CHAT_LINES = 12;

/** A key's name as players know it: "KeyW" is W, "ShiftLeft" Shift. */
export function keyName(code: string): string {
  return code.replace(/^Key|^Digit/, "").replace(/(Left|Right)$/, "").replace("Slash", "/");
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number): number => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/** The color of water seen from inside, in full light. */
const UNDERWATER: [number, number, number] = [0x21 / 255, 0x46 / 255, 0x7f / 255];
/** Radians per pixel of mouse movement at 100% sensitivity. */
const LOOK_SPEED = 0.0025;

/** A saved world to play: its store, metadata, player (null before the first save) and saved chunks. */
export interface SavedWorld {
  store: WorldStore;
  meta: WorldMeta;
  player: PlayerRecord | null;
  chunks: Array<[number, number]>;
}

export interface GameOptions {
  canvas: HTMLCanvasElement;
  /** Where the menus go. */
  menu: HTMLElement;
  /** The options, changed in place by the Options screen. */
  settings: Settings;
  /** The renderer for this page: the option's, unless the address says otherwise. */
  renderer: Settings["renderer"];
  /**
   * The world to play: a saved one, a seed for quick play (nothing saved), or a friend's world joined
   * over a connection to its host.
   */
  world: SavedWorld | { seed: string; mode?: GameMode; difficulty?: Difficulty } | { guest: Connection };
}

/** A guest's world makes nothing itself: its chunks come from the host. */
const NOTHING: ChunkGenerator = { generate: () => {} };

/** A guest as the save keeps them. */
type GuestData = Omit<GuestRecord, "format" | "world">;

function recordOf(g: Guest): GuestData {
  return { id: g.id, name: g.name, ...g.state, position: { ...g.state.position }, inventory: [...g.state.inventory], vitals: { ...g.state.vitals } };
}

function stateOf(r: GuestData): GuestState {
  const { position, yaw, pitch, selected, inventory, vitals, bed, spectating, flying, mode, spawn } = r;
  return { position: { ...position }, yaw, pitch, selected, inventory: [...inventory], vitals: { ...vitals }, bed, spectating, flying, mode, spawn };
}

function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`Missing #${id}`);
  return el;
}

/** WebGL2 with textures where it works and is wanted, Canvas 2D otherwise. */
function createBackend(canvas: HTMLCanvasElement, renderer: Settings["renderer"]): RenderBackend {
  if (renderer !== "canvas") {
    try {
      return new WebGLBackend(canvas, { pixelRatio: Math.min(2, globalThis.devicePixelRatio || 1) });
    } catch (e) {
      console.warn("Craft: no WebGL2, drawing with Canvas 2D.", e);
    }
  }
  return new Canvas2DBackend(canvas, { pixelRatio: Math.min(1, globalThis.devicePixelRatio || 1) });
}

/** Nearest dry land to the origin, searched outward in a square spiral. */
function findLand(generator: TerrainGenerator): { x: number; z: number } {
  for (let r = 0; r < 64; r++) {
    for (let i = -r; i <= r; i++) {
      for (const [x, z] of [[i, -r], [i, r], [-r, i], [r, i]]) {
        if (generator.surfaceHeight(x * 8, z * 8) - 1 >= SEA_LEVEL + 2) return { x: x * 8, z: z * 8 };
      }
    }
  }
  return { x: 0, z: 0 };
}

/** Plays a world in the page until the player quits to the title (a page load). */
export async function startGame(options: GameOptions): Promise<void> {
  const { canvas, menu, settings } = options;
  const saved = "store" in options.world ? options.world : null;
  const joined = "guest" in options.world ? options.world.guest : null;
  const seed = saved ? saved.meta.seed : "seed" in options.world ? options.world.seed : "";
  const hotbarEl = element("hotbar", HTMLElement);
  const blockName = element("block-name", HTMLElement);
  const underwaterEl = element("underwater", HTMLElement);
  const crosshair = element("crosshair", HTMLElement);
  const hurtEl = element("hurt", HTMLElement);
  const burningEl = element("burning", HTMLElement);
  const sleepEl = element("sleep", HTMLElement);
  const eatingEl = element("eating", HTMLElement);
  const chatEl = element("chat", HTMLFormElement);
  const chatInput = element("chat-input", HTMLInputElement);
  const chatLog = element("chatlog", HTMLElement);
  const debugEl = element("debug", HTMLElement);
  MESHING.smooth = settings.smoothLighting;
  document.documentElement.style.setProperty("--gui", String(settings.guiScale));

  const backend = createBackend(canvas, options.renderer);
  const textured = backend instanceof WebGLBackend;
  // ?view=16..160 overrides the setting for this page; ?textures=craft leaves imported textures out
  const pageParams = new URLSearchParams(location.search);
  const urlView = Number(pageParams.get("view"));
  const view = (): number => (urlView >= 16 ? Math.min(160, urlView) : viewDistance(settings, textured));
  // Minecraft's own textures when they were imported (npm run textures), Craft's procedural ones otherwise
  const imported = textured && pageParams.get("textures") !== "craft" ? await importedTextures() : null;
  if (imported) console.info(`Craft: textures from Minecraft ${imported.version}`);
  const tiles = textured ? (imported?.tiles ?? proceduralTiles()) : null;
  // Light levels to colors, redrawn through the day
  const lightMap = new LightMap();
  let textures: TerrainTextures | null = null;
  let atlasTexture: AtlasTexture | null = null;
  if (tiles) {
    const { atlas, uvs } = blockAtlas(tiles);
    atlasTexture = new AtlasTexture(atlas, imported?.frames ?? animatedFrames());
    textures = { texture: atlasTexture.texture, uvs, lightMap: lightMap.texture };
  }
  const sim = new Simulation({
    canvas,
    backend,
    orbit: false,
    keyboard: ["Space"],
    camera: { fov: (settings.fov * Math.PI) / 180, near: 0.05 },
    scene: { background: css(UNDERWATER) },
  });
  // Tops in full light, sides a step or two darker depending on the sun, bottoms darkest
  sim.scene.ambient.intensity = 0.3;
  sim.scene.lights = [new HemisphereLight("#d6e6ff", "#8a7a66", 0.4), new DirectionalLight({ x: -0.5, y: -1, z: -0.35 }, 0.45)];

  const generator = joined ? null : new TerrainGenerator(seed);
  const world = new VoxelWorld(generator ?? NOTHING);
  const player = new Player(world, { x: 0.5, y: WORLD_HEIGHT, z: 0.5 });
  player.sensitivity = LOOK_SPEED * settings.sensitivity;
  const terrain = sim.add(new Terrain(world, sim.scene, player.position, textures));
  terrain.renderDistance = view();
  terrain.lightMap = lightMap;
  // A guest's chunks all come from the host
  let chunks: ChunkSupply = joined ? { requestAround: () => {} } : new DirectSupply();
  if (!joined) {
    try {
      chunks = new WorkerSupply(seed);
    } catch (e) {
      console.warn("Craft: no module workers, generating chunks on the main thread.", e);
    }
  }
  sim.add(player);
  // Fluids flow and sand falls on scheduled ticks; every block change updates the blocks around it (on a
  // guest's side the host does all that, and the changes come from there)
  const ticks = sim.add(new WorldTicks(world, joined ? new Map() : blockBehaviors(), seed));
  /** This world shared with friends, once opened to them. */
  let host: HostSession | null = null;
  if (!joined) {
    const updates = new BlockUpdates(world, ticks);
    world.onChanged = (x, y, z) => {
      updates.changed(x, y, z);
      host?.changed(x, y, z);
    };
  }
  if (atlasTexture) {
    const animated = atlasTexture;
    sim.onUpdate(() => animated.animate((ticks.time + ticks.partial) / TICKS_PER_SECOND));
  }
  const interaction = sim.add(new BlockInteraction(world, player, terrain));
  const inventory = interaction.inventory;
  let mode: GameMode = saved ? saved.meta.mode : "seed" in options.world ? (options.world.mode ?? "survival") : "survival";
  let difficulty: Difficulty = saved ? saved.meta.difficulty : "seed" in options.world ? (options.world.difficulty ?? "normal") : "normal";
  let hardcore = saved ? saved.meta.hardcore : false;
  // Health, hunger and the rest, ticked with the world (paused with it)
  const survival = new Survival(world, player, inventory);
  /** The bed the player last slept in (its head): where they come back after dying. */
  let bed: Position | null = null;
  /** Died in hardcore: looking on. */
  let spectating = false;
  /** The player's own game mode (/gamemode) instead of the world's, and their own spawn point (/spawnpoint). */
  let personal: PlayMode | null = null;
  let ownSpawn: Position | null = null;
  /** Sets everything that follows from how the player plays now. */
  function applyMode(): void {
    const playing: PlayMode = spectating ? "spectator" : (personal ?? mode);
    survival.mode = interaction.mode = playing;
    survival.difficulty = difficulty;
    player.mayFly = playing !== "survival";
    player.noClip = playing === "spectator";
    if (playing === "spectator") player.flying = true;
    if (playing === "survival") player.flying = false;
    hotbarEl.hidden = playing === "spectator";
  }
  applyMode();
  /** The friend's world this is, if joined. */
  let guest: GuestSession | null = null;
  if (joined) {
    guest = sim.add(new GuestSession(joined, { world, ticks, id: playerId(), name: settings.name || "Guest", view: terrain.radius }));
    const session = guest;
    terrain.onUnload = (chunk) => session.drop(chunk);
    session.onReplace = (chunk) => terrain.drop(chunk);
    interaction.onAction = (a, held) => {
      session.act(a, held);
      actionEffect(a);
    };
    sim.onUpdate((dt) => session.report(dt, player));
  }

  // Items lying about: they fall and are picked up where the world runs (alone, or the host); a guest is
  // told where they are and asks for those it walks into
  const drops = sim.add(new Drops(world));
  /** Whether the player picks things up: alive and not looking on. */
  const collecting = (): boolean => !survival.vitals.dead && !spectating;
  drops.collectors = () =>
    guest
      ? []
      : [...(collecting() ? [{ position: player.position, take: (s: ItemStack) => pickUp(s), xp: (n: number) => gainXp(n) }] : []), ...(host?.collectors() ?? [])];
  const icons = new Icons(tiles);
  const itemView = sim.add(new ItemView(world, lightMap, textures ? { texture: textures.texture, uvs: textures.uvs } : null));
  itemView.drops = () =>
    guest
      ? guest.drops.filter((d) => d[4] !== ORB).map(([id, x, y, z, item, count]) => ({ id, item, count, position: { x, y, z } }))
      : [...drops.items.values()].map((d) => ({ id: d.id, item: d.stack.item, count: d.stack.count, position: d.position }));
  itemView.orbs = () =>
    guest
      ? guest.drops.filter((d) => d[4] === ORB).map(([id, x, y, z, , xp]) => ({ id, xp, position: { x, y, z } }))
      : [...drops.orbs.values()].map((o) => ({ id: o.id, xp: o.xp, position: o.position }));
  itemView.cracking = () => {
    const t = interaction.target;
    const p = interaction.progress;
    return t && p !== null ? { x: t.x, y: t.y, z: t.z, state: t.block, progress: p } : null;
  };
  // Mobs live where the world does (alone, or the host): monsters come after the players, animals wander.
  // A guest draws what the host tells it, between its updates
  const mobs = joined
    ? null
    : new Mobs({
        world,
        drops,
        players: () => mobPlayers(),
        difficulty: () => difficulty,
        time: () => ticks.time,
        onHurtPlayer: (id, amount, source, by, push) => (id === LOCAL ? hurtHere(amount, source, by, push) : host?.hurt(id, amount, source, by, push)),
        onExplosion: (x, y, z, power) => {
          host?.exploded(x, y, z, power);
          explosionEffect(x, y, z, power);
        },
        onSound: (event, x, y, z, category) => {
          sounds.play(event, category, { x, y, z });
          host?.sound(event, x, y, z, category);
        },
        onArrowPickup: (id) => (id === LOCAL ? inventory.add(stack(Items.Arrow)) === null : (host?.give(id, { item: "arrow", count: 1 }) ?? false)),
      });
  /** The players as mobs see them: the one here and the guests. */
  function mobPlayers(): MobPlayer[] {
    const here: MobPlayer = {
      id: LOCAL,
      position: player.position,
      targetable: interaction.mode === "survival" && !survival.vitals.dead,
      held: inventory.held ? ITEMS[inventory.held.item].name : null,
    };
    const guests = (host?.guests ?? []).map((g) => ({
      id: g.id,
      position: g.state.position,
      targetable: mode === "survival" && !g.state.spectating && g.state.vitals.health > 0,
      held: g.state.inventory[g.state.selected]?.item ?? null,
    }));
    return [here, ...guests];
  }
  /** The player here hurt by a mob, an arrow or an explosion: armor lessens it, and it pushes them. */
  function hurtHere(amount: number, source: DamageSource, by: string, push: { x: number; y: number; z: number }): void {
    if (!survival.hurt(amount, source, by || null)) return;
    player.velocity.x += push.x;
    player.velocity.z += push.z;
    player.velocity.y = Math.max(player.velocity.y, push.y);
  }
  const mobView = sim.add(new MobRenderer(world, lightMap, imported?.mobs ?? null, textured));
  mobView.mobs = () => (guest ? guestMobs() : localMobs());
  /** The mobs here, between their last tick and this one. */
  function* localMobs(): Iterable<ShownMob> {
    const k = ticks.partial;
    for (const m of mobs!.mobs.values()) {
      yield {
        id: m.id,
        kind: m.kind,
        x: lerp(m.prev.x, m.position.x, k),
        y: lerp(m.prev.y, m.position.y, k),
        z: lerp(m.prev.z, m.position.z, k),
        yaw: lerpAngle(m.prevYaw, m.yaw, k),
        headYaw: m.headYaw,
        pitch: m.pitch,
        limbSwing: m.limbSwing,
        limbAmount: m.limbAmount,
        hurt: m.hurt > 0 ? 1 : 0,
        dying: m.dying > 0 ? m.dying + k : 0,
        swell: m.fuse / 30,
        color: m.color,
        sheared: m.sheared,
        age: m.age + k,
      };
    }
    for (const a of mobs!.arrows.values()) {
      yield { ...STILL, id: a.id, kind: "arrow", x: lerp(a.prev.x, a.position.x, k), y: lerp(a.prev.y, a.position.y, k), z: lerp(a.prev.z, a.position.z, k), yaw: a.yaw, pitch: a.pitch };
    }
  }
  const STILL: Omit<ShownMob, "id" | "kind" | "x" | "y" | "z" | "yaw" | "pitch"> = { headYaw: 0, limbSwing: 0, limbAmount: 0, hurt: 0, dying: 0, swell: 0, color: 0, sheared: false, age: 0 };
  /** A guest's mobs: moved from where they were shown toward where the host last said, over its update. */
  interface GuestMob extends ShownMob {
    from: [number, number, number, number];
    to: [number, number, number, number];
    at: number;
  }
  const shownMobs = new Map<number, GuestMob>();
  let mobsSeen = 0;
  function* guestMobs(): Iterable<ShownMob> {
    const session = guest!;
    const now = performance.now();
    if (session.mobsAt !== mobsSeen) {
      mobsSeen = session.mobsAt;
      const fresh = new Set<number>();
      for (const [id, kind, x, y, z, yaw, headYaw, pitch, flags, extra] of session.mobs) {
        fresh.add(id);
        const name = kind === ARROW ? "arrow" : MOB_KINDS[kind];
        const m: GuestMob = shownMobs.get(id) ?? { ...STILL, id, kind: name, x, y, z, yaw, pitch, from: [x, y, z, yaw], to: [x, y, z, yaw], at: now };
        m.from = [m.x, m.y, m.z, m.yaw];
        m.to = [x, y, z, yaw];
        m.at = now;
        m.headYaw = headYaw;
        m.pitch = pitch;
        m.hurt = flags & Flag.Hurt ? 1 : 0;
        m.dying = flags & Flag.Dying ? Math.max(m.dying, extra) : 0;
        m.swell = name === "creeper" ? extra / 30 : 0;
        m.color = name === "sheep" ? extra : 0;
        m.sheared = (flags & Flag.Sheared) !== 0;
        shownMobs.set(id, m);
      }
      for (const id of [...shownMobs.keys()]) if (!fresh.has(id)) shownMobs.delete(id);
    }
    for (const m of shownMobs.values()) {
      const t = Math.min(1, (now - m.at) / MOB_UPDATES);
      const x = lerp(m.from[0], m.to[0], t);
      const z = lerp(m.from[2], m.to[2], t);
      // The legs walk as far as it moved
      const walked = Math.hypot(x - m.x, z - m.z);
      m.limbSwing += walked * 2.5;
      m.limbAmount += (Math.min(1, walked * 15) - m.limbAmount) * 0.2;
      m.x = x;
      m.y = lerp(m.from[1], m.to[1], t);
      m.z = z;
      m.yaw = lerpAngle(m.from[3], m.to[3], t);
      m.age += 1 / 3;
      if (m.dying > 0) m.dying += 1 / 3;
      yield m;
    }
  }
  // The crosshair finds mobs; hitting, shooting and shearing them
  interaction.mobAt = (x, y, z, dx, dy, dz, reach) => {
    if (mobs) {
      const hit = mobs.raycast(x, y, z, dx, dy, dz, reach);
      return hit ? { id: hit.mob.id, distance: hit.distance } : null;
    }
    let best: { id: number; distance: number } | null = null;
    for (const m of shownMobs.values()) {
      if (m.kind === "arrow" || m.dying > 0) continue;
      const info = MOBS[m.kind];
      const w = info.width / 2;
      const t = segmentHitsBox({ x, y, z }, { x: x + dx * reach, y: y + dy * reach, z: z + dz * reach }, { x: m.x - w, y: m.y, z: m.z - w }, { x: m.x + w, y: m.y + info.height, z: m.z + w });
      if (t !== null && (!best || t * reach < best.distance)) best = { id: m.id, distance: t * reach };
    }
    return best;
  };
  interaction.onAttack = (id, damage, crit, knockback) => {
    const strong = interaction.attackStrength > 0.9 || damage > 3;
    sounds.play(crit ? "entity.player.attack.crit" : strong ? "entity.player.attack.strong" : "entity.player.attack.weak", "players", player.position);
    if (crit) {
      const d = sim.camera.getForward({ x: 0, y: 0, z: 0 });
      particles?.crit(player.position.x + d.x * 2, player.eyeY + d.y * 2 - 0.5, player.position.z + d.z * 2);
    }
    if (guest) {
      guest.attack(id, damage, crit, knockback);
      return;
    }
    const mob = mobs!.mobs.get(id);
    if (mob) mobs!.strike(mob, damage, mobPlayers()[0], knockback);
  };
  interaction.onUseMob = (id, held) => {
    if (!held || held.item !== Items.Shears) return false;
    if (guest) {
      const m = shownMobs.get(id);
      if (m?.kind !== "sheep" || m.sheared) return false;
      guest.useMob(id, held);
      return true;
    }
    const mob = mobs!.mobs.get(id);
    return mob ? mobs!.shear(mob) : false;
  };
  interaction.onShoot = (power) => {
    const d = sim.camera.getForward({ x: 0, y: 0, z: 0 });
    const from = { x: player.position.x + d.x * 0.3, y: player.eyeY - 0.1 + d.y * 0.3, z: player.position.z + d.z * 0.3 };
    const speed = power * 3 * 20;
    const velocity = { x: d.x * speed, y: d.y * speed, z: d.z * speed };
    const crit = power >= 1;
    sounds.play("entity.arrow.shoot", "players", player.position, 1, 1 / (Math.random() * 0.4 + 1.2) + power * 0.5);
    if (guest) guest.shoot(from, velocity, crit);
    else mobs!.shoot(from, velocity, { player: LOCAL }, crit, mode === "survival");
  };

  // What broken blocks drop in survival, with experience from ores (the host does a guest's), and what a
  // broken chest or furnace held; breaking makes a little hungry
  interaction.onBroken = (x, y, z, state, held) => {
    blockEffect("break", x, y, z, state);
    host?.effect("break", x, y, z, state);
    if (interaction.mode !== "survival") return;
    survival.vitals.exert(BREAKING);
    if (guest) return;
    drops.spill(x, y, z, dropsOf(state, held, Math.random));
    const xp = xpOf(state, held, Math.random);
    if (xp > 0) drops.spawnXp(x + 0.5, y + 0.5, z + 0.5, xp);
  };
  if (!joined) world.onEntityRemoved = (x, y, z, e) => drops.spill(x, y, z, e.items);
  // Every game tick furnaces burn (where the world runs), the player's vitals change, and sleepers sleep
  ticks.onTick = () => {
    if (!joined) tickFurnaces(world);
    mobs?.tick();
    survival.tick();
    sleepTick();
  };
  // Eating: when hungry, held for EAT_TIME
  interaction.canEat = () => interaction.mode === "survival" && survival.vitals.hungry;
  interaction.onEat = (food) => {
    survival.vitals.eat(food);
    sounds.play("entity.player.burp", "players", player.position, 0.5, Math.random() * 0.1 + 0.9);
  };
  if (!joined) {
    interaction.onAction = (a) => actionEffect(a);
  }

  // Sound and particles ------------------------------------------------------------------------
  const sounds = new Sounds(() => settings.volume);
  await sounds.load();
  const particles = textures ? sim.add(new Particles(world, lightMap, { texture: textures.texture, uvs: textures.uvs })) : null;
  if (particles) particles.amount = PARTICLES[settings.particles];
  const at = (x: number, y: number, z: number): { x: number; y: number; z: number } => ({ x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  /** A block's sound of an action (break, place, step, hit), as Minecraft plays them: breaking a little louder and lower. */
  function blockSound(state: number, action: "break" | "place" | "step" | "hit" | "fall", where: { x: number; y: number; z: number }, volume: number = 1, pitch: number = 1): void {
    const group = soundGroup(STATE_BLOCK[state]);
    if (group) sounds.play(`block.${group}.${action}`, action === "step" ? "players" : "blocks", where, volume, pitch);
  }
  /** Someone broke, placed or used a block: its pieces, and its sound. */
  function blockEffect(kind: "break" | "place" | "use", x: number, y: number, z: number, state: number): void {
    if (kind === "break") {
      particles?.breakBlock(x, y, z, state);
      blockSound(state, "break", at(x, y, z), 1, 0.8);
    } else if (kind === "place") {
      blockSound(state, "place", at(x, y, z), 1, 0.8);
    } else {
      const shape = SHAPE[state];
      if (shape === "door" || shape === "trapdoor") sounds.play(`block.wooden_${shape}.${propertyOf(state, "open") === "true" ? "open" : "close"}`, "blocks", at(x, y, z), 1, Math.random() * 0.1 + 0.9);
    }
  }
  /** The player's own placing and using (breaking goes through onBroken): heard and seen here and by the guests. */
  function actionEffect(a: { act: "break" | "place" | "use"; x: number; y: number; z: number; nx: number; ny: number; nz: number }): void {
    hand.swing();
    if (a.act === "break") return;
    const [x, y, z] = a.act === "place" ? [a.x + a.nx, a.y + a.ny, a.z + a.nz] : [a.x, a.y, a.z];
    let state = world.get(x, y, z);
    // Short grass gives way to what is placed: then it went in the block aimed at
    if (a.act === "place" && state === Block.Air) state = world.get(a.x, a.y, a.z);
    blockEffect(a.act, x, y, z, state);
    host?.effect(a.act, x, y, z, state);
  }
  /** A guest's action, here on the host. */
  function guestActed(a: { act: "break" | "place" | "use"; x: number; y: number; z: number; nx: number; ny: number; nz: number }, before: number): void {
    if (a.act === "break") blockEffect("break", a.x, a.y, a.z, before);
    else if (a.act === "place") blockEffect("place", a.x + a.nx, a.y + a.ny, a.z + a.nz, world.get(a.x + a.nx, a.y + a.ny, a.z + a.nz));
    else blockEffect("use", a.x, a.y, a.z, world.get(a.x, a.y, a.z));
  }
  function explosionEffect(x: number, y: number, z: number, power: number): void {
    sounds.play("entity.generic.explode", "blocks", { x, y, z }, 4, (1 + (Math.random() - Math.random()) * 0.2) * 0.7);
    particles?.explosion(x, y, z, power);
  }
  /** Picking up a stack: whatever fits, with a pop. */
  function pickUp(s: ItemStack): ItemStack | null {
    const left = inventory.add(s);
    if (!left || left.count < s.count) sounds.play("entity.item.pickup", "players", player.position, 0.2, ((Math.random() - Math.random()) * 0.7 + 1) * 2);
    return left;
  }
  /** Experience picked up: a chime, and every fifth level a fanfare. */
  function gainXp(n: number): void {
    const before = levelOf(survival.vitals.xp).level;
    survival.vitals.xp += n;
    const after = levelOf(survival.vitals.xp).level;
    if (after > before && after % 5 === 0) sounds.play("entity.player.levelup", "players", player.position, 0.75);
    else sounds.play("entity.experience_orb.pickup", "players", player.position, 0.1, 0.5 + Math.random() * 0.7);
  }

  /** Throws a stack out in front of the player, the way they look. */
  function throwStack(s: ItemStack): void {
    const d = sim.camera.getForward({ x: 0, y: 0, z: 0 });
    const from = { x: player.position.x + d.x * 0.4, y: player.eyeY - 0.3, z: player.position.z + d.z * 0.4 };
    const velocity = { x: d.x * 6, y: d.y * 6 + 1.5, z: d.z * 6 };
    if (guest) guest.throwItem(s, from, velocity);
    else drops.spawn(from.x, from.y, from.z, s, velocity, 2);
  }

  /** How many of an item the inventory still has room for. */
  function roomFor(item: Item): number {
    const max = ITEMS[item].maxStack;
    let room = 0;
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      const s = inventory.slots[i];
      if (!s) room += max;
      else if (s.item === item && s.damage === 0 && max > 1) room += max - s.count;
    }
    return room;
  }

  if (guest) {
    const session = guest;
    // Picking up: asking for what lies close, once a second at most per item
    const asked = new Map<number, number>();
    sim.onUpdate(() => {
      const p = player.position;
      const now = performance.now();
      for (const [id, x, y, z, item] of session.drops) {
        if (item === ORB || !collecting()) continue;
        if (Math.abs(x - p.x) > 1.5 || Math.abs(z - p.z) > 1.5 || y < p.y - 0.75 || y > p.y + 2.5) continue;
        if ((asked.get(id) ?? 0) > now) continue;
        const room = roomFor(item);
        if (room <= 0) continue;
        asked.set(id, now + 1000);
        session.take(id, room);
      }
    });
    session.onGiven = (s) => {
      const left = pickUp(s);
      if (left) throwStack(left);
    };
    session.onXp = (n) => gainXp(n);
    session.onSound = (event, x, y, z, category) => sounds.play(event, category as SoundCategory, { x, y, z });
    session.onEffect = (kind, x, y, z, state) => blockEffect(kind, x, y, z, state);
    session.onExplosion = (x, y, z, power) => explosionEffect(x, y, z, power);
    session.onNotice = (text) => notice(text);
    session.onRules = (d) => {
      difficulty = d;
      applyMode();
    };
    session.onWake = () => wakeUp();
    session.onHurt = (amount, source, by, push) => hurtHere(amount, source, by, push);
    // How the player is goes to the host now and then, for keeping
    let lifeSent = "";
    let lifeTimer = 0;
    sim.onUpdate((dt) => {
      lifeTimer += dt;
      if (lifeTimer < 1) return;
      lifeTimer = 0;
      const now = life();
      const text = JSON.stringify(now);
      if (text === lifeSent) return;
      lifeSent = text;
      session.life(now);
    });
    // What the player carries goes to the host now and then, for keeping
    let inventoryTimer = 0;
    inventory.onChange = () => {
      clearTimeout(inventoryTimer);
      inventoryTimer = window.setTimeout(() => session.inventory(inventory.slots, inventory.selected), 500);
      refreshHotbar();
    };
  } else {
    inventory.onChange = () => refreshHotbar();
  }
  // The other players, whom blocks aren't placed into, drawn with their names
  const others = (): PlayerView[] =>
    guest ? guest.others : (host?.guests ?? []).map((g) => ({ id: g.id, name: g.name, ...g.state.position, yaw: g.state.yaw, pitch: g.state.pitch }));
  interaction.others = () => others();
  // The view: bobbing, a wider view sprinting, a tilt when hurt, third person (after the crosshair's aim)
  const view3 = sim.add(new CameraEffects(world, player));
  view3.fov = (settings.fov * Math.PI) / 180;
  view3.bobbing = settings.bobbing;
  view3.fovEffects = settings.fovEffects;
  view3.hurt = () => survival.vitals.hurt;
  const selfId = joined ? playerId() : LOCAL;
  const avatars = sim.add(new Avatars(world, lightMap, element("nametags", HTMLElement), canvas, imported?.mobs ?? null, textured));
  avatars.players = others;
  avatars.self = () => (view3.perspective !== "first" && !spectating && !player.asleep ? { id: selfId, name: "", x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw, pitch: player.pitch } : null);
  // After the player, so it follows the camera where the player put it; drawn on WebGL only
  const sky = sim.add(new Sky(ticks, lightMap, imported?.sky ?? null));
  sky.visible = textured;
  // The hand in front of the view
  const hand = sim.add(new Hand(world, lightMap, textures ? { texture: textures.texture, uvs: textures.uvs } : null, avatars.skinFor(selfId), textured));
  hand.held = () => inventory.held;
  hand.showing = () => view3.perspective === "first" && !spectating && !player.asleep && started && !survival.vitals.dead;
  hand.using = () => ({ eating: interaction.eating, drawing: interaction.drawing });
  player.keys = settings.keys;

  // Sounds and pieces every frame: the listener with the camera, footsteps, mining, eating, splashes, and
  // the world around now and then (torches smoking, furnaces burning, lava popping, caves)
  let lastStep = 0;
  let hitTimer = 0;
  let eatTimer = 0;
  let wasWet = false;
  let caveTimer = 60;
  sim.onUpdate((dt) => {
    const c = sim.camera;
    const f = c.getForward({ x: 0, y: 0, z: 0 });
    sounds.listen(c.position.x, c.position.y, c.position.z, f.x, f.y, f.z);
    sounds.tickMusic(dt, interaction.mode === "creative");
    if (sim.paused) return;
    const p = player.position;
    // A step every 1.67 blocks walked, of the block underfoot (snow or carpet on it, if any)
    const step = Math.floor(view3.walked);
    if (step !== lastStep) {
      lastStep = step;
      const on = world.get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      const below = SHAPE[on] === "snow" || SHAPE[on] === "carpet" ? on : world.get(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
      if (!player.sneaking && below !== Block.Air && FLUID[below] === 0) {
        blockSound(below, "step", { x: p.x, y: p.y, z: p.z }, 0.15);
        if (player.sprinting) particles?.footstep(p.x, p.y, p.z, below);
      }
    }
    // Mining: the block's hit sound and bits, four times a second
    const t = interaction.target;
    if (interaction.progress !== null && t) {
      hitTimer -= dt;
      if (hitTimer <= 0) {
        hitTimer = 0.25;
        blockSound(t.block, "hit", at(t.x, t.y, t.z), 0.25, 0.5);
        particles?.hitBlock(t.x, t.y, t.z, t.block, t.nx, t.ny, t.nz);
        hand.swing();
      }
    }
    // Eating: munching and crumbs
    if (interaction.eating !== null && inventory.held) {
      eatTimer -= dt;
      if (eatTimer <= 0) {
        eatTimer = 0.2;
        sounds.play("entity.generic.eat", "players", p, 0.5 + 0.5 * Math.random(), (Math.random() - Math.random()) * 0.2 + 1);
        const front = { x: p.x + f.x * 0.4, y: player.eyeY - 0.15, z: p.z + f.z * 0.4 };
        const item = ITEMS[inventory.held.item];
        if (textures && item.texture) particles?.crumbs(front.x, front.y, front.z, atlasIndex(`item_${item.texture}`));
      }
    }
    // Into water from a fall: a splash
    const wet = player.inWater;
    if (wet && !wasWet && player.velocity.y < -4) {
      sounds.play("entity.player.splash", "players", p, 0.6, 1 + (Math.random() - Math.random()) * 0.4);
      particles?.splash(p.x, Math.floor(p.y) + 1, p.z);
    }
    wasWet = wet;
    // The blocks around, at random, as Minecraft's animated blocks
    for (let i = 0; i < 24; i++) {
      const x = Math.floor(p.x + (Math.random() - 0.5) * 32);
      const y = Math.floor(p.y + (Math.random() - 0.5) * 32);
      const z = Math.floor(p.z + (Math.random() - 0.5) * 32);
      const s = world.get(x, y, z);
      const b = STATE_BLOCK[s];
      if (b === Block.Torch) {
        const facing = propertyOf(s, "facing");
        const off = facing === "up" ? [0, 0] : [[0, 0.27], [0, -0.27], [-0.27, 0], [0.27, 0]][["north", "south", "east", "west"].indexOf(facing)];
        const ty = y + (facing === "up" ? 0.7 : 0.92);
        particles?.smoke(x + 0.5 + off[0], ty, z + 0.5 + off[1]);
        particles?.flame(x + 0.5 + off[0], ty, z + 0.5 + off[1]);
      } else if (b === Block.Furnace && propertyOf(s, "lit") === "true") {
        const d = FACING_DIR[propertyOf(s, "facing")];
        const fx = x + 0.5 + DIR_X[d] * 0.52;
        const fz = z + 0.5 + DIR_Z[d] * 0.52;
        particles?.flame(fx, y + 0.3, fz);
        particles?.smoke(fx, y + 0.4, fz);
        if (Math.random() < 0.1) sounds.play("block.furnace.fire_crackle", "blocks", at(x, y, z));
      } else if (b === Block.Lava && world.get(x, y + 1, z) === Block.Air && Math.random() < 0.05) {
        particles?.lava(x + Math.random(), y + 1, z + Math.random());
        sounds.play("block.lava.pop", "blocks", at(x, y, z), 0.2 + Math.random() * 0.2, 0.9 + Math.random() * 0.15);
      }
    }
    // Deep down in the dark now and then a cave's sound
    caveTimer -= dt;
    if (caveTimer <= 0) {
      caveTimer = 60 + Math.random() * 120;
      if (world.getLight(Math.floor(p.x), Math.floor(player.eyeY), Math.floor(p.z)) >> 4 === 0 && Math.random() < 0.5) sounds.play("ambient.cave", "ambient", { x: p.x + (Math.random() - 0.5) * 16, y: p.y, z: p.z + (Math.random() - 0.5) * 16 }, 0.7, 0.8 + Math.random() * 0.2);
    }
  });

  // Guests who left since the last save, kept for it (and for when they come back before then)
  const leftGuests = new Map<string, GuestData>();
  let savingLeft: GuestData[] = [];
  const guestRecords = (): GuestData[] => {
    savingLeft = [...leftGuests.values()];
    return [...savingLeft, ...(host?.guests ?? []).map(recordOf)];
  };

  // The save, if this world is kept: it supplies saved chunks and takes unloaded ones
  let save: WorldSave | null = null;
  if (saved) {
    ticks.time = saved.meta.time;
    save = sim.add(
      new WorldSave({
        store: saved.store,
        meta: saved.meta,
        world,
        ticks,
        generator: chunks,
        savedChunks: saved.chunks,
        player: () => ({
          position: { ...player.position },
          velocity: { ...player.velocity },
          yaw: player.yaw,
          pitch: player.pitch,
          selected: inventory.selected,
          inventory: inventory.slots.map(saveStack),
          ...life(),
        }),
        guests: guestRecords,
        drops,
        mobs: mobs ?? undefined,
      }),
    );
    terrain.supply = save;
    terrain.onUnload = (chunk) => save!.unload(chunk);
  } else if (!joined) {
    terrain.supply = chunks;
    terrain.onUnload = (chunk) => {
      ticks.takeChunk(chunk.cx, chunk.cz);
      mobs?.inChunk(chunk.cx, chunk.cz, true);
    };
  } else {
    terrain.supply = chunks;
  }

  // Where the player stands: where the host says (a guest), as saved, or on the highest block at the
  // world's spawn (a tree, maybe)
  const record = saved?.player ?? null;
  let worldName = saved ? saved.meta.name : "Craft";
  // Quietly: the hotbar isn't drawn yet (it is once it is made, below)
  const restore = (slots: readonly (ReturnType<typeof saveStack> | null)[], selected: number): void => {
    for (let i = 0; i < PLAYER_SLOTS; i++) inventory.slots[i] = loadStack(slots[i]);
    inventory.selected = Math.max(0, Math.min(HOTBAR_SLOTS - 1, Math.floor(selected) || 0));
  };
  /** Health and the rest back as saved (or as the host kept them). */
  const restoreLife = (l: PlayerLife): void => {
    survival.vitals.load(l.vitals);
    bed = l.bed ? { ...l.bed } : null;
    spectating = hardcore && l.spectating;
    personal = hardcore ? null : (l.mode ?? null);
    ownSpawn = l.spawn ? { ...l.spawn } : null;
    applyMode();
    player.flying = player.flying || (player.mayFly && l.flying);
  };
  let guestSpawn: Position | null = null;
  if (guest) {
    const welcome = await guest.welcome;
    worldName = welcome.world;
    mode = welcome.mode;
    difficulty = welcome.difficulty;
    hardcore = welcome.hardcore;
    guestSpawn = welcome.spawn;
    const you = welcome.you;
    Object.assign(player.position, you.position);
    player.yaw = you.yaw;
    player.pitch = you.pitch;
    restore(you.inventory, you.selected);
    restoreLife(you);
  } else if (record) {
    Object.assign(player.position, record.position);
    Object.assign(player.velocity, record.velocity);
    player.yaw = record.yaw;
    player.pitch = record.pitch;
    restore(record.inventory, record.selected);
    restoreLife(record);
    await save!.loadNow(player.position.x, player.position.z, 1);
  } else {
    // A new player: nothing in survival, the usual blocks at hand in creative
    if (mode === "creative") HOTBAR.forEach((b, i) => (inventory.slots[i] = { item: b, count: 64, damage: 0 }));
    // Not a guest here: the world has its generator
    const land = saved?.meta.spawn ?? findLand(generator!);
    player.position.x = Math.floor(land.x) + 0.5;
    player.position.z = Math.floor(land.z) + 0.5;
    if (save) await save.loadNow(player.position.x, player.position.z, 1);
    else terrain.loadNow(1);
    let ground = WORLD_HEIGHT - 1;
    while (ground > 0 && !world.isSolid(Math.floor(land.x), ground, Math.floor(land.z))) ground--;
    player.position.y = ground + 1;
    if (save) {
      save.meta = { ...save.meta, spawn: { x: player.position.x, y: player.position.y, z: player.position.z } };
      await save.save();
    }
  }
  /** Where newcomers to the world start, and players without a bed come back to. */
  const spawnPoint = guestSpawn ?? saved?.meta.spawn ?? { x: player.position.x, y: player.position.y, z: player.position.z };

  /** How the player is, for saving (and the host's keeping of a guest). */
  function life(): PlayerLife {
    return { vitals: survival.vitals.save(), bed, spectating, flying: player.flying, mode: personal, spawn: ownSpawn };
  }

  // The status bar, the red flash of a hit, flames while burning, the darkness of sleep, eating's progress
  const hud = new Hud(element("status", HTMLElement), hudSprites(imported?.hud ?? null));
  sim.onUpdate(() => {
    const v = survival.vitals;
    const shown = survival.mode === "survival" && started;
    hud.update({ shown, hardcore, health: v.health, food: v.food, defense: survival.armor().defense, air: v.air, underwater: player.eyeInWater, xp: v.xp, hurt: v.hurt });
    hurtEl.style.opacity = v.hurt > 10 && !v.dead ? String(((v.hurt - 10) / 10) * 0.9) : v.dead ? "0.6" : "0";
    burningEl.hidden = !(v.fire > 0 && !v.dead);
    // Under the crosshair: eating's or a bow's progress, or a weapon coming back after a swing
    const strength = interaction.attackStrength;
    const progress = interaction.eating ?? interaction.drawing ?? (strength < 1 && survival.mode === "survival" ? strength : null);
    eatingEl.hidden = progress === null;
    if (progress !== null) eatingEl.style.setProperty("--eat", progress.toFixed(3));
    sleepEl.hidden = !player.asleep;
    if (player.asleep) sleepEl.style.setProperty("--dark", String(Math.min(0.9, (sleepTicks / SLEEP_TICKS) * 0.9)));
  });

  // Fog and the background: the sky's horizon color, darker the less sky light reaches the eyes (black in
  // caves); under water a short blue fog as bright as the light around
  let fogKey = "";
  function updateFog(): void {
    const e = sim.camera.position;
    const light = world.getLight(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z));
    const underwater = player.eyeInWater;
    let color: [number, number, number];
    if (underwater) {
      const k = Math.max(0.12, lightMap.brightness(light));
      color = [UNDERWATER[0] * k, UNDERWATER[1] * k, UNDERWATER[2] * k];
    } else {
      const k = 0.04 + 0.96 * ((light >> 4) / 15) ** 2;
      color = [sky.horizon[0] * k, sky.horizon[1] * k, sky.horizon[2] * k];
    }
    const d = terrain.renderDistance;
    const near = underwater ? 1 : d * 0.5;
    const far = underwater ? 14 : d;
    // Only when it changes visibly: the canvas renderer makes new styles for every fog color
    const key = `${css(color)}|${near}|${far}`;
    if (key === fogKey) return;
    fogKey = key;
    sim.scene.fog = { color: css(color), near, far, mode: "distance" };
    sim.scene.background = css(color);
    underwaterEl.hidden = !underwater;
  }
  sim.onUpdate(updateFog);

  // Saving: when the tab is hidden (switched away from, or about to close) and before quitting
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void save?.save().catch(() => {});
  });
  let saveError: string | null = null;
  /** The game menu's line about saving, while the menu is up. */
  let statusLine: HTMLElement | null = null;
  if (save) {
    save.onSaved = (ok, e) => {
      // Guests who left are in the save now, unless they came and went again meanwhile
      if (ok) for (const r of savingLeft) if (leftGuests.get(r.id) === r) leftGuests.delete(r.id);
      saveError = ok ? null : String((e as Error)?.message ?? e);
      if (statusLine?.isConnected) {
        statusLine.textContent = status();
        statusLine.className = saveError ? "error" : "muted";
      }
    };
  }

  // The game menu over the paused game, and the options from it
  const locked = (): boolean => document.pointerLockElement === canvas;
  let dragMode = false;
  let drag: { x: number; y: number; button: number; moved: boolean } | null = null;
  let started = false;

  function setPlaying(on: boolean): void {
    player.controls = on;
    menu.hidden = on;
    crosshair.hidden = !on && !started;
    interaction.release(0);
    interaction.release(2);
    updatePause();
    if (on) return;
    // Chatting: the mouse is free for typing, the game goes on behind
    if (chatOpen) {
      menu.hidden = true;
      return;
    }
    friendsShown = false;
    if (ended !== null) showEnded(ended);
    else if (survival.vitals.dead) showDeath();
    else if (!items.open) showPauseMenu();
    if (started) void save?.save().catch(() => {});
  }

  /** A game played alone stands still under its menu, as Minecraft's; shared, it goes on. */
  function updatePause(): void {
    sim.paused = !guest && !hosting && !player.controls && !items.open && !survival.vitals.dead;
  }

  function play(): void {
    if (ended !== null || survival.vitals.dead) return;
    started = true;
    sounds.start();
    Promise.resolve(canvas.requestPointerLock()).catch(() => {
      // Where the browser refuses pointer lock (some embedded or automated browsers), dragging looks around
      // and a click without dragging acts instead
      dragMode = true;
      setPlaying(true);
    });
  }

  async function quit(): Promise<void> {
    if (guest) {
      guest.leave();
      location.href = location.pathname;
      return;
    }
    stopSharing();
    if (save) {
      menu.replaceChildren(h("div", { class: "screen" }, h("h2", {}, "Saving world…")));
      try {
        await save.save();
      } catch {
        showPauseMenu();
        return;
      }
    }
    location.href = location.pathname;
  }

  function status(): string {
    if (guest) return "A friend's world: it is saved on their side.";
    const sharing = hosting ? ` Open to friends: ${hosting.code}, ${host?.guests.length ?? 0} playing.` : "";
    if (!save) return `Quick play: this world isn't saved.${sharing}`;
    if (saveError) return `Saving failed: ${saveError}`;
    if (sharing) return `${save.lastSaved === null ? "Not saved yet." : `Saved ${formatWhen(Date.now() - (performance.now() - save.lastSaved))}.`}${sharing}`;
    if (saveError) return `Saving failed: ${saveError}`;
    return save.lastSaved === null ? "Not saved yet." : `Saved ${formatWhen(Date.now() - (performance.now() - save.lastSaved))}.`;
  }

  function showPauseMenu(): void {
    menu.replaceChildren(
      h(
        "div",
        { class: "screen" },
        h("h1", {}, worldName),
        h(
          "div",
          { class: "buttons column" },
          h("button", { class: "primary", autofocus: true, onclick: play }, started ? "Back to game" : "Play"),
          h("button", { onclick: showOptions }, "Options…"),
          !guest &&
            h(
              "button",
              { disabled: hardcore, title: "Peaceful, easy, normal or hard: how hunger and starving go", onclick: cycleDifficulty },
              `Difficulty: ${difficulty[0].toUpperCase()}${difficulty.slice(1)}${hardcore ? " (hardcore)" : ""}`,
            ),
          !guest && h("button", { onclick: () => void openToFriends() }, hosting ? `Friends (${host?.guests.length ?? 0} playing)…` : "Open to friends…"),
          h("button", { onclick: () => void quit() }, guest ? "Leave world" : save ? "Save and quit to title" : "Quit to title"),
        ),
        (statusLine = h("p", { class: saveError ? "error" : "muted" }, status())),
        h(
          "ul",
          { class: "keys" },
          ...[
            [["forward", "left", "back", "right"].map((a) => keyName(settings.keys[a as KeyAction])).join(""), "move"],
            [keyName(settings.keys.jump), "jump, swim up"],
            [keyName(settings.keys.sprint), "sprint"],
            [keyName(settings.keys.sneak), "sneak"],
            ["Left click", "break, hit"],
            ["Right click", mode === "survival" ? "place, use, eat or draw a bow (hold)" : "place, use, draw a bow (hold)"],
            ...(mode === "creative" ? [[`${keyName(settings.keys.jump)} twice`, `fly (${keyName(settings.keys.sprint)} down)`]] : []),
            ["1–9, wheel", "choose from the hotbar"],
            [keyName(settings.keys.inventory), mode === "creative" ? "all items" : "inventory"],
            [keyName(settings.keys.drop), "throw the held item (Ctrl: all of it)"],
            [`${keyName(settings.keys.chat)}, ${keyName(settings.keys.command)}`, "chat, commands"],
            [`${keyName(settings.keys.perspective)}, ${keyName(settings.keys.debug)}`, "third person, debug screen"],
            ["Esc", "this menu"],
          ].map(([key, what]) => h("li", {}, h("b", {}, key), what)),
        ),
      ),
    );
    menu.querySelector<HTMLElement>("[autofocus]")?.focus();
  }

  /** The next difficulty, for this world and its guests. */
  function cycleDifficulty(): void {
    difficulty = DIFFICULTIES[(DIFFICULTIES.indexOf(difficulty) + 1) % DIFFICULTIES.length];
    applyMode();
    if (save) save.meta = { ...save.meta, difficulty };
    host?.rulesChanged();
    showPauseMenu();
  }

  // Sharing the world: friends join it by its code, connecting to this browser directly
  let hosting: Hosting | null = null;
  let hostingError: string | null = null;
  let friendsShown = false;

  async function openToFriends(): Promise<void> {
    if (!host) {
      host = sim.add(
        new HostSession({
          world,
          ticks,
          worldName,
          mode,
          difficulty: () => difficulty,
          hardcore,
          drops,
          mobs: mobs ?? undefined,
          host: () => ({ id: "host", name: settings.name || "Host", ...player.position, yaw: player.yaw, pitch: player.pitch }),
          spawn: () => spawnPoint,
          saved: async (id) => {
            const left = leftGuests.get(id);
            if (left) return stateOf(left);
            const r = saved ? await saved.store.getGuest(saved.meta.id, id) : null;
            return r ? stateOf(r) : null;
          },
          onLeave: (g) => leftGuests.set(g.id, recordOf(g)),
          onGuests: () => {
            if (friendsShown && menu.isConnected && !menu.hidden) showFriends();
          },
          onNotice: (text) => notice(text),
          onAct: (_id, a, before) => guestActed(a, before),
        }),
      );
      const session = host;
      terrain.others = () => session.focuses();
    }
    if (!hosting) {
      const session = host;
      const opening = new Hosting((conn) => session.accept(conn));
      opening.onStatus = (error) => {
        hostingError = error;
        if (friendsShown) showFriends();
      };
      friendsShown = true;
      menu.replaceChildren(h("div", { class: "screen" }, h("h2", {}, "Opening the world to friends…")));
      try {
        await opening.start();
        hosting = opening;
        hostingError = null;
      } catch (e) {
        hostingError = (e as Error).message;
      }
      updatePause();
    }
    showFriends();
  }

  function stopSharing(): void {
    hosting?.stop();
    hosting = null;
    host?.close();
    updatePause();
  }

  function showFriends(): void {
    friendsShown = true;
    const back = (): void => {
      friendsShown = false;
      showPauseMenu();
    };
    if (!hosting) {
      menu.replaceChildren(
        h(
          "div",
          { class: "screen" },
          h("h2", {}, "Open to friends"),
          h("p", { class: "error" }, `The world couldn't be opened to friends: ${hostingError ?? "unknown error"}`),
          h("p", { class: "muted" }, "Friends are introduced by the game's server (api/signal, see the README)."),
          h("div", { class: "buttons" }, h("button", { autofocus: true, onclick: back }, "Back")),
        ),
      );
      return;
    }
    const link = `${location.origin}${location.pathname}?join=${hosting.code}`;
    const field = h("input", { readonly: true, value: link });
    const copy = h("button", { onclick: () => void navigator.clipboard?.writeText(link).then(() => (copy.textContent = "Copied")) }, "Copy link");
    const guests = host?.guests ?? [];
    menu.replaceChildren(
      h(
        "div",
        { class: "screen" },
        h("h2", {}, "Open to friends"),
        h("p", {}, "Friends join with this code, or the link:"),
        h("p", { class: "code" }, hosting.code),
        h("div", { class: "invite" }, field, copy),
        h("p", {}, guests.length > 0 ? `Playing: ${guests.map((g) => g.name).join(", ")}` : "Nobody has joined yet."),
        hostingError && h("p", { class: "error" }, `Friends can't join right now: ${hostingError}`),
        h("p", { class: "muted" }, "This browser hosts the world: friends can play while this tab is open. Their places are kept in the world's save."),
        h(
          "div",
          { class: "buttons" },
          h("button", { class: "primary", autofocus: true, onclick: back }, "Back"),
          h(
            "button",
            {
              onclick: () => {
                stopSharing();
                back();
              },
            },
            "Stop sharing",
          ),
        ),
      ),
    );
    menu.querySelector<HTMLElement>("[autofocus]")?.focus();
  }

  function showOptions(): void {
    menu.replaceChildren(
      optionsScreen(
        settings,
        textured,
        (s) => {
          terrain.renderDistance = view();
          fogKey = "";
          updateFog();
          view3.fov = (s.fov * Math.PI) / 180;
          view3.bobbing = s.bobbing;
          view3.fovEffects = s.fovEffects;
          player.sensitivity = LOOK_SPEED * s.sensitivity;
          player.keys = s.keys;
          sounds.applyVolumes();
          if (particles) particles.amount = PARTICLES[s.particles];
          document.documentElement.style.setProperty("--gui", String(s.guiScale));
          if (MESHING.smooth !== s.smoothLighting) {
            MESHING.smooth = s.smoothLighting;
            for (const chunk of world.chunks.values()) for (const section of chunk.sections) section.dirty = true;
          }
        },
        showPauseMenu,
      ),
    );
  }

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
    if (locked() && e.button === 0 && !spectating && !player.asleep) hand.swing();
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
    if (items.open && (e.code === "KeyE" || e.code === "Escape") && !(e.target instanceof HTMLInputElement && e.code === "KeyE")) {
      items.close();
      return;
    }
    if (chatOpen) return;
    if (!player.controls) return;
    const keys = settings.keys;
    // The debug screen and the view work in any state of play, and the browser's own uses of the keys don't
    if (e.code === keys.debug) {
      e.preventDefault();
      debugShown = !debugShown;
      debugEl.hidden = !debugShown;
      return;
    }
    if (e.code === keys.perspective) {
      e.preventDefault();
      view3.perspective = view3.perspective === "first" ? "behind" : view3.perspective === "behind" ? "front" : "first";
      return;
    }
    if (e.code === keys.chat || e.code === keys.command) {
      e.preventDefault();
      openChat(e.code === keys.command ? "/" : "");
      return;
    }
    if (player.asleep) {
      if (e.code === keys.jump || e.code === keys.sneak || e.code === keys.sprint) wakeUp();
      return;
    }
    if (spectating && e.code !== "Escape") return;
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) interaction.select(Number(digit[1]) - 1);
    if (e.code === keys.inventory) showItems(() => (interaction.mode === "creative" ? items.showCreative() : items.showInventory()));
    if (e.code === keys.drop) {
      const s = interaction.throwHeld(e.ctrlKey);
      if (s) throwStack(s);
    }
    if (e.code === "Escape" && dragMode) setPlaying(false);
  });

  // Chat (T) and commands (/): lines for everyone, commands for the world's host
  let chatOpen = false;
  const chatLines: string[] = [];
  function openChat(prefix: string): void {
    chatOpen = true;
    chatEl.hidden = false;
    chatLog.hidden = false;
    chatLog.replaceChildren(...chatLines.slice(-CHAT_LINES).map((l) => h("div", {}, l)));
    chatInput.value = prefix;
    // The key that opened the chat isn't typed into it
    setTimeout(() => chatInput.focus(), 0);
    if (locked()) document.exitPointerLock();
    else setPlaying(false);
  }
  function closeChat(): void {
    chatOpen = false;
    chatEl.hidden = true;
    chatLog.hidden = true;
    chatInput.blur();
    play();
  }
  chatInput.addEventListener("keydown", (e) => {
    if (e.code === "Escape") {
      e.preventDefault();
      closeChat();
    }
  });
  chatEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = chatInput.value.trim().slice(0, 256);
    closeChat();
    if (!text) return;
    if (text.startsWith("/")) {
      if (guest) notice("Commands are the host's: they run where the world is");
      else if (hardcore) notice("Commands can't be used in hardcore");
      else runCommand(text, commands);
      return;
    }
    const name = settings.name || (guest ? "Guest" : "Player");
    if (guest) guest.chat(text);
    else if (host) host.announce(`<${name}> ${text}`);
    else notice(`<${name}> ${text}`);
  });
  /** What commands do to this game. */
  const commands: CommandContext = {
    seed,
    get position() {
      return player.position;
    },
    say: (text) => notice(text),
    setMode: (m) => {
      personal = m === mode ? null : m;
      applyMode();
      refreshHotbar();
    },
    time: () => ticks.time,
    setTime: (t) => {
      ticks.time = Math.max(0, Math.floor(t));
      host?.syncTime();
    },
    teleport: (x, y, z) => {
      Object.assign(player.position, { x, y, z });
      player.velocity.x = player.velocity.y = player.velocity.z = 0;
      player.fallDistance = 0;
    },
    players: () => (host?.guests ?? []).map((g) => ({ name: g.name, position: g.state.position })),
    give: (item, count) => {
      for (let left = count; left > 0; ) {
        const n = Math.min(left, ITEMS[item].maxStack);
        left -= n;
        const rest = inventory.add(stack(item, n));
        if (rest) throwStack(rest);
      }
    },
    kill: () => survival.hurt(1e6, "kill", null),
    setSpawn: (x, y, z) => {
      ownSpawn = { x, y, z };
    },
    setDifficulty: (d) => {
      if (hardcore) return false;
      difficulty = d;
      applyMode();
      if (save) save.meta = { ...save.meta, difficulty };
      host?.rulesChanged();
      return true;
    },
    summon: (kind, x, y, z) => {
      if (!mobs) return false;
      mobs.spawn(kind, x, y, z);
      return true;
    },
  };

  // The debug screen (F3): frames, where the player is and what is around, what is drawn
  let debugShown = false;
  let debugTimer = 0;
  const frameTimes: number[] = [];
  sim.onUpdate((dt) => {
    frameTimes.push(dt);
    if (frameTimes.length > 120) frameTimes.shift();
    if (!debugShown) return;
    debugTimer -= dt;
    if (debugTimer > 0) return;
    debugTimer = 0.25;
    const p = player.position;
    const bx = Math.floor(p.x);
    const by = Math.floor(p.y);
    const bz = Math.floor(p.z);
    const light = world.getLight(bx, by, bz);
    const t = interaction.target;
    debugEl.textContent = debugLines({
      frames: frameTimes,
      renderer: textured ? "WebGL 2" : "Canvas 2D",
      stats: backend.stats,
      position: p,
      yaw: player.yaw,
      pitch: player.pitch,
      biome: world.chunk(bx >> 4, bz >> 4)?.biomes[(bz & 15) * 16 + (bx & 15)] ?? null,
      sky: light >> 4,
      block: light & 15,
      target: t ? { x: t.x, y: t.y, z: t.z, state: t.block } : null,
      time: ticks.time,
      chunks: world.chunks.size,
      mobs: mobs ? mobs.mobs.size : (guest?.mobs.length ?? 0),
      mode: interaction.mode,
      sharing: guest ? "a friend's world" : hosting ? `hosting ${hosting.code}, ${host?.guests.length ?? 0} playing` : "alone",
    }).join("\n");
  });

  // The hotbar: the first nine slots of the inventory, with counts and how worn tools are
  function paintStack(el: HTMLElement, s: ItemStack | null): void {
    const info = s ? ITEMS[s.item] : null;
    el.title = info?.label ?? "";
    const block = info?.block ?? null;
    el.style.setProperty("--top", block !== null ? BLOCKS[block].top : (info?.color ?? "transparent"));
    el.style.setProperty("--side", block !== null ? BLOCKS[block].side : (info?.color ?? "transparent"));
    const bg = s ? icons.background(s.item) : null;
    if (bg) el.style.setProperty("--icon", bg);
    else if (s) el.style.removeProperty("--icon");
    else el.style.setProperty("--icon", "none");
  }
  const slotEls = Array.from({ length: HOTBAR_SLOTS }, (_, i) => {
    const slot = h("div", { class: "slot" }, h("span", {}, String(i + 1)), h("b"), h("i"));
    hotbarEl.append(slot);
    return slot;
  });
  function refreshHotbar(): void {
    slotEls.forEach((el, i) => {
      const s = inventory.slots[i];
      el.classList.toggle("selected", i === inventory.selected);
      paintStack(el, s);
      (el.children[1] as HTMLElement).textContent = s && s.count > 1 ? String(s.count) : "";
      const durability = s ? ITEMS[s.item].durability : 0;
      const wear = el.children[2] as HTMLElement;
      wear.hidden = !(s && s.damage > 0 && durability > 0);
      if (s && durability > 0) wear.style.setProperty("--wear", String(1 - s.damage / durability));
    });
  }
  let nameTimer = 0;
  interaction.onSelect = (slot) => {
    refreshHotbar();
    const held = inventory.slots[slot];
    blockName.textContent = held ? ITEMS[held.item].label : "";
    blockName.classList.add("shown");
    clearTimeout(nameTimer);
    nameTimer = window.setTimeout(() => blockName.classList.remove("shown"), 1200);
  };
  refreshHotbar();
  hotbarEl.hidden = spectating;

  // Screens with items: the inventory (E), the creative list, crafting tables, chests, furnaces
  const items = new ItemScreen(menu, { icons, inventory, spill: throwStack });
  items.onClose = () => {
    if (openContainer?.entity.kind === "chest") sounds.play("block.chest.close", "blocks", at(openContainer.x, openContainer.y, openContainer.z), 0.5, Math.random() * 0.1 + 0.9);
    if (openContainer && guest) guest.close(openContainer.x, openContainer.y, openContainer.z);
    openContainer = null;
    play();
  };
  sim.onUpdate(() => {
    items.tick();
    // A chest or furnace that went (broken by someone) closes its screen
    if (openContainer && !guest && !world.blockEntity(openContainer.x, openContainer.y, openContainer.z)) items.close();
  });
  /** The chest or furnace open on screen. */
  let openContainer: { x: number; y: number; z: number; entity: BlockEntity } | null = null;

  function showItems(show: () => void): void {
    show();
    if (locked()) document.exitPointerLock();
    else setPlaying(false);
  }

  /** Slots over a chest's or furnace's items: changes are saved, and a guest's go to the host. */
  function entitySlots(x: number, y: number, z: number, e: BlockEntity): Slot[] {
    return e.items.map((_, i) =>
      arraySlot(e.items, i, e.kind === "furnace" ? (s) => furnaceAccepts(i, s) : () => true, 64, () => {
        if (guest) {
          guest.setSlots(x, y, z, [[i, saveStack(e.items[i])]]);
        } else {
          const chunk = world.chunk(x >> 4, z >> 4);
          if (chunk) chunk.unsaved = true;
          // Taking from a furnace's output takes the experience it kept
          if (e.kind === "furnace" && i === FURNACE_OUTPUT) {
            const xp = takeXp(e, Math.random);
            if (xp > 0) drops.spawnXp(player.position.x, player.position.y + 1, player.position.z, xp);
          }
        }
      }),
    );
  }

  /** A chest's slots, a double chest's both halves (the left one first). */
  function chestSlots(x: number, y: number, z: number, state: number, e: BlockEntity): Slot[] {
    const own = entitySlots(x, y, z, e);
    const type = propertyOf(state, "type");
    if (guest || type === "single") return own;
    const facing = propertyOf(state, "facing");
    const d = FACING_DIR[type === "left" ? RIGHT_OF[facing] : LEFT_OF[facing]];
    const dx = d === 0 ? 1 : d === 1 ? -1 : 0;
    const dz = d === 4 ? 1 : d === 5 ? -1 : 0;
    const other = world.blockEntity(x + dx, y, z + dz);
    if (!other || other.kind !== "chest") return own;
    const theirs = entitySlots(x + dx, y, z + dz, other);
    return type === "left" ? [...own, ...theirs] : [...theirs, ...own];
  }

  function showContainer(x: number, y: number, z: number, state: number, e: BlockEntity): void {
    openContainer = { x, y, z, entity: e };
    if (e.kind === "chest") {
      sounds.play("block.chest.open", "blocks", at(x, y, z), 0.5, Math.random() * 0.1 + 0.9);
      const slots = chestSlots(x, y, z, state, e);
      showItems(() => items.showChest(slots, slots.length > 27 ? "Large chest" : "Chest"));
    } else {
      const slots = entitySlots(x, y, z, e);
      showItems(() => items.showFurnace([slots[FURNACE_INPUT], slots[FURNACE_FUEL], slots[FURNACE_OUTPUT]], e));
    }
  }

  interaction.onOpen = (x, y, z, state) => {
    const block = blockOf(state);
    if (isBed(block)) {
      useBed(x, y, z, state);
    } else if (block === Block.CraftingTable) {
      showItems(() => items.showTable());
    } else if (guest) {
      // Shown when the host sends what it holds
      openContainer = null;
      pendingOpen = { x, y, z, state };
      guest.open(x, y, z);
    } else {
      const e = world.blockEntity(x, y, z);
      if (e) showContainer(x, y, z, state, e);
    }
  };
  let pendingOpen: { x: number; y: number; z: number; state: number } | null = null;
  if (guest) {
    guest.onContainer = (x, y, z, saved) => {
      const open = openContainer && openContainer.x === x && openContainer.y === y && openContainer.z === z ? openContainer : null;
      if (!saved) {
        if (open) items.close();
        return;
      }
      const fresh = loadEntity(saved);
      if (!fresh) return;
      if (open) {
        // The same entity object stays (the slots read it): its contents change
        Object.assign(open.entity, fresh);
        if (open.entity.kind === "furnace") items.setFurnace(open.entity);
        items.refreshSlots();
      } else if (pendingOpen && pendingOpen.x === x && pendingOpen.y === y && pendingOpen.z === z) {
        showContainer(x, y, z, pendingOpen.state, fresh);
        pendingOpen = null;
      }
    };
  }

  // Death: what the player carried and some of their experience fall where they died; everyone is told
  survival.vitals.onHurt = (amount, source) => {
    if (player.asleep) wakeUp();
    // A fall lands with a thud; any other hurt with the player's cry
    if (source === "fall") sounds.play(amount > 4 ? "entity.player.big_fall" : "entity.player.small_fall", "players", player.position);
    else sounds.play("entity.player.hurt", "players", player.position, 1, (Math.random() - Math.random()) * 0.2 + 1);
  };
  survival.onDeath = () => {
    const v = survival.vitals;
    const cause = v.cause ?? "fall";
    const p = player.position;
    if (player.asleep) wakeUp();
    interaction.release(0);
    interaction.release(2);
    const stacks = inventory.slots.filter((s): s is ItemStack => s !== null);
    inventory.clear();
    const fling = (): { x: number; y: number; z: number } => ({ x: (Math.random() - 0.5) * 4, y: 2 + Math.random() * 2, z: (Math.random() - 0.5) * 4 });
    const from = { x: p.x, y: p.y + 1, z: p.z };
    const xp = deathXp(v.xp);
    const text = `${settings.name || (guest ? "Guest" : "Player")} ${deathMessage(cause, v.killer)}`;
    if (guest) {
      for (const s of stacks) guest.throwItem(s, from, fling());
      guest.died(cause, v.killer, xp);
    } else {
      for (const s of stacks) drops.spawn(from.x, from.y, from.z, s, fling(), 2);
      if (xp > 0) drops.spawnXp(p.x, p.y + 0.5, p.z, xp);
      if (host) host.announce(text);
      else notice(text);
    }
    deathText = text;
    if (items.open) items.close();
    if (locked()) document.exitPointerLock();
    else setPlaying(false);
  };
  // Saved (or kept by the host) dead: back on the death screen
  let deathText = survival.vitals.dead ? `${settings.name || (guest ? "Guest" : "Player")} died` : "";

  function showDeath(): void {
    const score = survival.vitals.xp;
    menu.classList.add("dead");
    const leave = (): void => {
      menu.classList.remove("dead");
      void quit();
    };
    menu.replaceChildren(
      h(
        "div",
        { class: "screen" },
        h("h1", {}, hardcore ? "Game over!" : "You died!"),
        h("p", {}, deathText),
        h("p", { class: "muted" }, `Score: ${score}`),
        h(
          "div",
          { class: "buttons column" },
          hardcore
            ? h("button", { class: "primary", autofocus: true, onclick: () => void comeBack(true) }, "Spectate world")
            : h("button", { class: "primary", autofocus: true, onclick: () => void comeBack(false) }, "Respawn"),
          h("button", { onclick: leave }, guest ? "Leave world" : "Title screen"),
        ),
      ),
    );
    menu.querySelector<HTMLElement>("[autofocus]")?.focus();
  }

  /** Back after dying: alive at the bed (or the world's spawn), or looking on in hardcore. */
  async function comeBack(spectate: boolean): Promise<void> {
    menu.classList.remove("dead");
    const where = { x: player.position.x, y: player.position.y, z: player.position.z };
    survival.revive();
    if (spectate) {
      spectating = true;
      applyMode();
    } else {
      const home = bed ? besideBed(bed) : null;
      if (bed && !home) {
        notice("Your home bed was missing or obstructed");
        bed = null;
      }
      Object.assign(player.position, home ?? ownSpawn ?? spawnPoint);
      if (!home) player.position.y += 0.01;
      player.velocity.x = player.velocity.y = player.velocity.z = 0;
      player.fallDistance = 0;
      if (save && !world.isLoaded(player.position.x, player.position.z)) await save.loadNow(player.position.x, player.position.z, 1);
    }
    if (spectate) Object.assign(player.position, where);
    play();
  }

  /** Where to stand beside a bed (its head at `head`): a free spot around it on solid ground, or null if it's gone. */
  function besideBed(head: Position): Position | null {
    const state = world.get(head.x, head.y, head.z);
    if (!isBed(blockOf(state))) return world.isLoaded(head.x, head.z) ? null : { x: head.x + 0.5, y: head.y + 0.6, z: head.z + 0.5 };
    const d = FACING_DIR[propertyOf(state, "facing")];
    const foot = { x: head.x - DIR_X[d], z: head.z - DIR_Z[d] };
    const free = (x: number, y: number, z: number): boolean => !SOLID[world.get(x, y, z)] && !SOLID[world.get(x, y + 1, z)] && SOLID[world.get(x, y - 1, z)] === 1;
    for (const c of [foot, { x: head.x, z: head.z }]) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const x = c.x + dx;
        const z = c.z + dz;
        if (free(x, head.y, z)) return { x: x + 0.5, y: head.y, z: z + 0.5 };
      }
    }
    return { x: head.x + 0.5, y: head.y + 0.6, z: head.z + 0.5 };
  }

  // Beds: using one makes it home; at night the player lies down, and when everyone sleeps the night passes
  let sleepTicks = 0;
  function useBed(x: number, y: number, z: number, state: number): void {
    const facing = propertyOf(state, "facing");
    const d = FACING_DIR[facing];
    const head = propertyOf(state, "part") === "head" ? { x, y, z } : { x: x + DIR_X[d], y, z: z + DIR_Z[d] };
    if (!bed || bed.x !== head.x || bed.y !== head.y || bed.z !== head.z) notice("Respawn point set");
    bed = head;
    const time = ticks.time % DAY;
    if (time < NIGHT_START || time > NIGHT_END) {
      notice("You can sleep only at night");
      return;
    }
    const monsters = mobs
      ? mobs.monsterNear(head.x, head.y, head.z)
      : [...shownMobs.values()].some((m) => m.kind !== "arrow" && MOBS[m.kind].hostile && Math.abs(m.x - head.x) < 8 && Math.abs(m.z - head.z) < 8 && Math.abs(m.y - head.y) < 5);
    if (monsters && mode === "survival") {
      notice("You may not rest now; there are monsters nearby");
      return;
    }
    player.asleep = { ...head, facing };
    sleepTicks = 0;
    guest?.sleep(true);
  }

  function wakeUp(): void {
    const asleep = player.asleep;
    if (!asleep) return;
    player.asleep = null;
    guest?.sleep(false);
    const spot = besideBed(asleep);
    if (spot) Object.assign(player.position, spot);
    player.velocity.x = player.velocity.y = player.velocity.z = 0;
  }

  function sleepTick(): void {
    const asleep = player.asleep;
    if (!asleep) return;
    sleepTicks++;
    if (!isBed(blockOf(world.get(asleep.x, asleep.y, asleep.z)))) {
      wakeUp();
      return;
    }
    // When everyone has slept long enough, morning comes (the host decides for its guests)
    if (guest || sleepTicks < SLEEP_TICKS || (host && !host.allAsleep)) return;
    ticks.time += DAY - (ticks.time % DAY);
    host?.wake();
    wakeUp();
  }

  // Who comes and goes
  const noticeEl = element("notice", HTMLElement);
  function notice(text: string): void {
    chatLines.push(text);
    if (chatLines.length > 100) chatLines.shift();
    if (chatOpen) chatLog.replaceChildren(...chatLines.slice(-CHAT_LINES).map((l) => h("div", {}, l)));
    const line = h("div", {}, text);
    noticeEl.append(line);
    setTimeout(() => (line.style.opacity = "0"), 4000);
    setTimeout(() => line.remove(), 4700);
  }
  const present = new Map<string, string>();
  sim.onUpdate(() => {
    const now = new Map(others().map((p) => [p.id, p.name]));
    for (const [id, name] of now) if (!present.has(id)) notice(`${name} joined the world`);
    for (const [id, name] of present) if (!now.has(id)) notice(`${name} left the world`);
    present.clear();
    for (const [id, name] of now) present.set(id, name);
  });

  // A friend's world ends when its host leaves (or the connection breaks)
  let ended: string | null = null;
  function showEnded(reason: string): void {
    menu.replaceChildren(
      h(
        "div",
        { class: "screen" },
        h("h2", {}, reason),
        h("div", { class: "buttons" }, h("button", { autofocus: true, onclick: () => (location.href = location.pathname) }, "Back to title")),
      ),
    );
    menu.querySelector<HTMLElement>("[autofocus]")?.focus();
  }
  if (guest) {
    guest.onBye = (reason) => {
      ended = reason;
      if (locked()) document.exitPointerLock();
      setPlaying(false);
      showEnded(reason);
    };
  }
  window.addEventListener("pagehide", () => {
    guest?.leave();
    stopSharing();
  });

  setPlaying(false);
  sim.start();
  // For poking at the running game from the browser console
  Object.assign(globalThis, {
    craft: {
      mobs,
      sounds,
      particles,
      hand,
      view: view3,
      commands,
      sim,
      backend,
      world,
      player,
      interaction,
      terrain,
      ticks,
      save,
      get host() {
        return host;
      },
      get hosting() {
        return hosting;
      },
      guest,
      openToFriends,
      drops,
      items,
    },
  });
}

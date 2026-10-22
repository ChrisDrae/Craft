import { Canvas2DBackend, DirectionalLight, HemisphereLight, Simulation, WebGLBackend, type RenderBackend } from "projector";
import { BLOCKS, PLACEABLE, blockByName, type Block } from "./blocks.js";
import { WORLD_HEIGHT, type ChunkGenerator } from "./chunk.js";
import { DirectSupply, WorkerSupply, type ChunkSupply } from "./chunkSupply.js";
import { SEA_LEVEL, TerrainGenerator } from "./generator.js";
import { BlockInteraction } from "./interaction.js";
import { LightMap } from "./lightmap.js";
import { Player } from "./player.js";
import { Avatars } from "./net/avatars.js";
import type { Connection } from "./net/connection.js";
import { GuestSession } from "./net/guest.js";
import { HostSession, type Guest } from "./net/host.js";
import type { GuestState, PlayerView } from "./net/protocol.js";
import { Hosting } from "./net/rtc.js";
import type { GuestRecord, PlayerRecord, WorldMeta } from "./save/format.js";
import type { WorldStore } from "./save/store.js";
import { WorldSave } from "./save/worldSave.js";
import { playerId, viewDistance, type Settings } from "./settings.js";
import { Sky, css } from "./sky.js";
import { Terrain, type TerrainTextures } from "./terrain.js";
import { blockBehaviors } from "./fluids.js";
import { AtlasTexture, animatedFrames, blockAtlas, iconPixels, importedTextures, proceduralTiles, tileImage } from "./textures.js";
import { TICKS_PER_SECOND, WorldTicks } from "./ticks.js";
import { BlockUpdates } from "./updates.js";
import { formatWhen, h } from "./ui/dom.js";
import { optionsScreen } from "./ui/options.js";
import { VoxelWorld } from "./world.js";

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
  world: SavedWorld | { seed: string } | { guest: Connection };
}

/** A guest's world makes nothing itself: its chunks come from the host. */
const NOTHING: ChunkGenerator = { generate: () => {} };

/** A guest as the save keeps them. */
type GuestData = Omit<GuestRecord, "format" | "world">;

function recordOf(g: Guest): GuestData {
  return { id: g.id, name: g.name, ...g.state, position: { ...g.state.position }, hotbar: [...g.state.hotbar] };
}

function stateOf(r: GuestData): GuestState {
  return { position: { ...r.position }, yaw: r.yaw, pitch: r.pitch, selected: r.selected, hotbar: [...r.hotbar] };
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

  const backend = createBackend(canvas, options.renderer);
  const textured = backend instanceof WebGLBackend;
  // ?view=16..160 overrides the setting for this page
  const urlView = Number(new URLSearchParams(location.search).get("view"));
  const view = (): number => (urlView >= 16 ? Math.min(160, urlView) : viewDistance(settings, textured));
  // Minecraft's own textures when they were imported (npm run textures), Craft's procedural ones otherwise
  const imported = textured ? await importedTextures() : null;
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
  /** The friend's world this is, if joined. */
  let guest: GuestSession | null = null;
  if (joined) {
    guest = sim.add(new GuestSession(joined, { world, ticks, id: playerId(), name: settings.name || "Guest", view: terrain.radius }));
    const session = guest;
    terrain.onUnload = (chunk) => session.drop(chunk);
    session.onReplace = (chunk) => terrain.drop(chunk);
    interaction.onAction = (a) => session.act(a);
    sim.onUpdate((dt) => session.report(dt, player));
  }
  // The other players, whom blocks aren't placed into, drawn with their names
  const others = (): PlayerView[] =>
    guest ? guest.others : (host?.guests ?? []).map((g) => ({ id: g.id, name: g.name, ...g.state.position, yaw: g.state.yaw, pitch: g.state.pitch }));
  interaction.others = () => others();
  const avatars = sim.add(new Avatars(world, lightMap, element("nametags", HTMLElement), canvas));
  avatars.players = others;
  // After the player, so it follows the camera where the player put it; drawn on WebGL only
  const sky = sim.add(new Sky(ticks, lightMap, imported?.sky ?? null));
  sky.visible = textured;

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
          selected: interaction.selected,
          hotbar: interaction.hotbar.map((b) => BLOCKS[b].name),
        }),
        guests: guestRecords,
      }),
    );
    terrain.supply = save;
    terrain.onUnload = (chunk) => save!.unload(chunk);
  } else if (!joined) {
    terrain.supply = chunks;
    terrain.onUnload = (chunk) => ticks.takeChunk(chunk.cx, chunk.cz);
  } else {
    terrain.supply = chunks;
  }

  // Where the player stands: where the host says (a guest), as saved, or on the highest block at the
  // world's spawn (a tree, maybe)
  const record = saved?.player ?? null;
  let worldName = saved ? saved.meta.name : "Craft";
  if (guest) {
    const { world: name, you } = await guest.welcome;
    worldName = name;
    Object.assign(player.position, you.position);
    player.yaw = you.yaw;
    player.pitch = you.pitch;
    you.hotbar.forEach((name, i) => {
      const block = blockByName(name);
      if (block !== null && i < interaction.hotbar.length) interaction.hotbar[i] = block;
    });
    interaction.select(you.selected);
  } else if (record) {
    Object.assign(player.position, record.position);
    Object.assign(player.velocity, record.velocity);
    player.yaw = record.yaw;
    player.pitch = record.pitch;
    record.hotbar.forEach((name, i) => {
      const block = blockByName(name);
      if (block !== null && i < interaction.hotbar.length) interaction.hotbar[i] = block;
    });
    interaction.select(record.selected);
    await save!.loadNow(player.position.x, player.position.z, 1);
  } else {
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
  /** Where newcomers to the world start. */
  const spawnPoint = saved?.meta.spawn ?? { x: player.position.x, y: player.position.y, z: player.position.z };

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
    if (on) {
      blockList = false;
      return;
    }
    friendsShown = false;
    if (blockList) showBlockList();
    else if (ended === null) showPauseMenu();
    else showEnded(ended);
    if (started) void save?.save().catch(() => {});
  }

  function play(): void {
    if (ended !== null) return;
    started = true;
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
          !guest && h("button", { onclick: () => void openToFriends() }, hosting ? `Friends (${host?.guests.length ?? 0} playing)…` : "Open to friends…"),
          h("button", { onclick: () => void quit() }, guest ? "Leave world" : save ? "Save and quit to title" : "Quit to title"),
        ),
        (statusLine = h("p", { class: saveError ? "error" : "muted" }, status())),
        h(
          "ul",
          { class: "keys" },
          ...[
            ["WASD", "move"],
            ["Space", "jump, swim up"],
            ["Shift", "sprint"],
            ["Left click", "break"],
            ["Right click", "place"],
            ["1–9, wheel", "pick a block"],
            ["Esc", "this menu"],
          ].map(([key, what]) => h("li", {}, h("b", {}, key), what)),
        ),
      ),
    );
    menu.querySelector<HTMLElement>("[autofocus]")?.focus();
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
    }
    showFriends();
  }

  function stopSharing(): void {
    hosting?.stop();
    hosting = null;
    host?.close();
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
          sim.camera.fov = (s.fov * Math.PI) / 180;
          player.sensitivity = LOOK_SPEED * s.sensitivity;
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
    if (e.code === "KeyE" && blockList) {
      play();
      return;
    }
    if (!player.controls) return;
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) interaction.select(Number(digit[1]) - 1);
    if (e.code === "KeyE") openBlockList();
    if (e.code === "Escape" && dragMode) setPlaying(false);
  });

  // Icons: a block's side texture, or its colors without textures
  const icons = new Map<Block, string>();
  function paintIcon(el: HTMLElement, block: Block): void {
    const info = BLOCKS[block];
    el.title = info.label;
    el.style.setProperty("--top", info.top);
    el.style.setProperty("--side", info.side);
    const tile = tiles ? iconPixels(tiles, block) : undefined;
    if (!tile) return;
    if (!icons.has(block)) icons.set(block, `url(${tileImage(tile)}) center / cover`);
    el.style.setProperty("--icon", icons.get(block)!);
  }

  // Hotbar
  const slots = interaction.hotbar.map((_, i) => {
    const slot = h("div", { class: "slot" }, h("span", {}, String(i + 1)));
    hotbarEl.append(slot);
    return slot;
  });
  let nameTimer = 0;
  const showHotbar = (selected: number): void =>
    slots.forEach((el, i) => {
      el.classList.toggle("selected", i === selected);
      paintIcon(el, interaction.hotbar[i]);
    });
  interaction.onSelect = (slot) => {
    showHotbar(slot);
    guest?.hotbar(
      interaction.hotbar.map((b) => BLOCKS[b].name),
      slot,
    );
    blockName.textContent = BLOCKS[interaction.hotbar[slot]].label;
    blockName.classList.add("shown");
    clearTimeout(nameTimer);
    nameTimer = window.setTimeout(() => blockName.classList.remove("shown"), 1200);
  };
  showHotbar(interaction.selected);
  hotbarEl.hidden = false;

  // The block list (E): every block, one click puts it into the selected hotbar slot
  let blockList = false;
  function openBlockList(): void {
    blockList = true;
    if (locked()) document.exitPointerLock();
    else setPlaying(false);
  }
  function showBlockList(): void {
    menu.replaceChildren(
      h(
        "div",
        { class: "screen wide" },
        h("h2", {}, "Blocks"),
        h(
          "div",
          { class: "blocks" },
          ...PLACEABLE.map((block) => {
            const el = h("button", { class: "slot", "aria-label": BLOCKS[block].label, onclick: () => (interaction.choose(block), play()) });
            paintIcon(el, block);
            return el;
          }),
        ),
        h("p", { class: "muted" }, "Click a block to put it in the selected hotbar slot. E or Esc goes back."),
      ),
    );
  }

  // Who comes and goes
  const noticeEl = element("notice", HTMLElement);
  function notice(text: string): void {
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
    },
  });
}

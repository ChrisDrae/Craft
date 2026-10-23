import { SimObject } from "projector";
import type { Action } from "../actions.js";
import type { SavedEntity } from "../blockEntities.js";
import { decodeBiomes } from "../biomes.js";
import { loadStack, saveStack, type ItemStack, type SavedStack } from "../items.js";
import type { GameMode, PlayerLife } from "../save/format.js";
import type { MobView } from "../mobs/mobs.js";
import type { DamageSource, Difficulty } from "../vitals.js";
import type { Chunk } from "../chunk.js";
import { lightChunk } from "../light.js";
import { decodeBlocks, decompress } from "../save/codec.js";
import type { WorldTicks } from "../ticks.js";
import type { VoxelWorld } from "../world.js";
import type { Connection } from "./connection.js";
import { PROTOCOL_VERSION, REGISTRY, decode, encode, type DropView, type GuestState, type PlayerView, type ToGuest, type ToHost } from "./protocol.js";

/** Seconds between position updates sent to the host. */
const MOVES = 0.05;

/** What the host says first: the world, how it is played, and the player's state. */
export interface Welcome {
  world: string;
  mode: GameMode;
  difficulty: Difficulty;
  hardcore: boolean;
  /** Where players start, and come back to without a bed. */
  spawn: { x: number; y: number; z: number };
  weather: { rain: boolean; thunder: boolean };
  you: GuestState;
}

export interface GuestOptions {
  world: VoxelWorld;
  ticks: WorldTicks;
  /** Who this player is: an id kept in the browser, and a name. */
  id: string;
  name: string;
  /** How far the player sees, in chunks. */
  view: number;
}

/** Where the guest is, for move updates. */
export interface Pose {
  position: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
}

/**
 * A guest's side of a shared world: the world here is a copy of the host's, filled with the chunks and
 * block changes the host sends (nothing is generated, ticked or saved here). The guest's own player moves
 * here and tells the host where it is; its actions are done here at once (so building feels immediate)
 * and sent to the host, whose answer is what counts.
 */
export class GuestSession extends SimObject {
  /** The other players, as the host last said. */
  others: PlayerView[] = [];
  /** The items lying about nearby, as the host last said. */
  drops: DropView[] = [];
  /** Resolves with the world's name, how it is played and the player's state when the host welcomes us. */
  readonly welcome: Promise<Welcome>;
  /** Called with what the host handed over (an item picked up). */
  onGiven: ((stack: ItemStack) => void) | null = null;
  /** Called with experience picked up. */
  onXp: ((points: number) => void) | null = null;
  /** Called with what everyone is told (who died). */
  onNotice: ((text: string) => void) | null = null;
  /** Called when the host changes the difficulty. */
  onRules: ((difficulty: Difficulty) => void) | null = null;
  /** Called in the morning, when the night passed with everyone asleep. */
  onWake: (() => void) | null = null;
  /** The mobs and arrows nearby as the host last said, and when it said so (performance.now()). */
  mobs: MobView[] = [];
  mobsAt: number = 0;
  /** Called when a mob, arrow or explosion hurt the player (on the host). */
  onHurt: ((amount: number, source: DamageSource, by: string, push: { x: number; y: number; z: number }) => void) | null = null;
  /** Called when something blew up nearby. */
  onExplosion: ((x: number, y: number, z: number, power: number) => void) | null = null;
  /** Called with a sound to play there. */
  onSound: ((event: string, x: number, y: number, z: number, category: string) => void) | null = null;
  /** Called when it starts or stops raining or storming, and when lightning strikes. */
  onWeather: ((rain: boolean, thunder: boolean) => void) | null = null;
  onLightning: ((x: number, y: number, z: number) => void) | null = null;
  /** Called when someone else broke, placed or used a block nearby. */
  onEffect: ((kind: "break" | "place" | "use" | "grow", x: number, y: number, z: number, state: number) => void) | null = null;
  /** Called with the open chest's or furnace's contents as they change, null when it is gone. */
  onContainer: ((x: number, y: number, z: number, entity: SavedEntity | null) => void) | null = null;
  /** Called when the host says goodbye or the link breaks, after the welcome. */
  onBye: ((reason: string) => void) | null = null;
  /** Called with a chunk about to be replaced by a fresh copy (the terrain drops its meshes). */
  onReplace: ((chunk: Chunk) => void) | null = null;
  private readonly conn: Connection;
  private readonly options: GuestOptions;
  /** Messages handled one after another: a chunk is in the world before changes to it are applied. */
  private queue: Promise<void> = Promise.resolve();
  private welcomed: boolean = false;
  private moveTimer: number = 0;
  private lastMove: string = "";
  private dropped: Array<[number, number]> = [];
  private resolveWelcome!: (w: Welcome) => void;
  private rejectWelcome!: (e: Error) => void;

  constructor(conn: Connection, options: GuestOptions) {
    super();
    this.conn = conn;
    this.options = options;
    this.welcome = new Promise((resolve, reject) => {
      this.resolveWelcome = resolve;
      this.rejectWelcome = reject;
    });
    conn.onMessage = (frame) => {
      this.queue = this.queue.then(() => this.handle(frame)).catch((e) => console.error("Craft: bad message from the host", e));
    };
    conn.onClose = () => {
      if (this.welcomed) this.onBye?.("The connection to the host was lost.");
      else this.rejectWelcome(new Error("The host didn't answer."));
    };
    this.send({ t: "hello", protocol: PROTOCOL_VERSION, registry: REGISTRY, id: options.id, name: options.name, view: options.view });
  }

  /** Waits until everything received so far has been applied (tests). */
  settled(): Promise<void> {
    return this.queue;
  }

  private async handle(frame: Uint8Array): Promise<void> {
    const { message: msg, payload } = decode<ToGuest>(frame);
    const world = this.options.world;
    switch (msg.t) {
      case "welcome":
        this.welcomed = true;
        this.options.ticks.time = msg.time;
        this.resolveWelcome({
          world: msg.world,
          mode: msg.mode === "creative" ? "creative" : "survival",
          difficulty: msg.difficulty ?? "normal",
          hardcore: msg.hardcore === true,
          spawn: msg.spawn,
          weather: msg.weather ?? { rain: false, thunder: false },
          you: msg.you,
        });
        return;
      case "refused":
        this.rejectWelcome(new Error(msg.reason));
        return;
      case "chunk": {
        const { chunk } = decodeBlocks(msg.cx, msg.cz, msg.palette, await decompress(payload));
        decodeBiomes(msg.biomes, chunk.biomes);
        chunk.generator = msg.generator;
        chunk.unsaved = false;
        lightChunk(chunk);
        const old = world.chunk(msg.cx, msg.cz);
        if (old) this.onReplace?.(old);
        world.insert(chunk);
        return;
      }
      case "blocks":
        for (let i = 0; i + 4 <= msg.changes.length; i += 4) world.set(msg.changes[i], msg.changes[i + 1], msg.changes[i + 2], msg.changes[i + 3]);
        return;
      case "players":
        this.others = msg.players;
        return;
      case "time":
        this.options.ticks.time = msg.time;
        return;
      case "drops":
        this.drops = msg.drops;
        return;
      case "given": {
        const s = loadStack(msg.item);
        if (s) this.onGiven?.(s);
        if (Number(msg.xp) > 0) this.onXp?.(Math.floor(Number(msg.xp)));
        return;
      }
      case "notice":
        this.onNotice?.(String(msg.text));
        return;
      case "rules":
        this.onRules?.(msg.difficulty);
        return;
      case "wake":
        this.onWake?.();
        return;
      case "mobs":
        this.mobs = msg.mobs;
        this.mobsAt = performance.now();
        return;
      case "hurt":
        this.onHurt?.(Number(msg.amount) || 0, msg.source, String(msg.by ?? ""), msg.push);
        return;
      case "explosion":
        this.onExplosion?.(msg.x, msg.y, msg.z, msg.power);
        return;
      case "sound":
        this.onSound?.(String(msg.event), msg.x, msg.y, msg.z, String(msg.category));
        return;
      case "effect":
        this.onEffect?.(msg.kind, msg.x, msg.y, msg.z, msg.state);
        return;
      case "weather":
        this.onWeather?.(msg.rain === true, msg.thunder === true);
        return;
      case "lightning":
        this.onLightning?.(msg.x, msg.y, msg.z);
        return;
      case "container":
        this.onContainer?.(msg.x, msg.y, msg.z, msg.entity);
        return;
      case "bye":
        this.welcomed = false;
        this.onBye?.(msg.reason);
        this.conn.close();
        return;
    }
  }

  /** Tells the host about an action done here, and what the player held (it decides the drops). */
  act(a: Action, held: ItemStack | null): void {
    this.send({ t: "act", ...a, held: saveStack(held) });
  }

  /** Tells the host what the player carries (it keeps it for the next visit). */
  inventory(slots: readonly (ItemStack | null)[], selected: number): void {
    this.send({ t: "inventory", inventory: slots.map(saveStack), selected });
  }

  /** Tells the host how the player is (for keeping). */
  life(life: PlayerLife): void {
    this.send({ t: "life", ...life });
  }

  /** Tells the host the player died (by what), and how much experience they leave. */
  died(cause: DamageSource, killer: string | null, xp: number): void {
    this.send({ t: "died", cause, killer, xp });
  }

  /** Hits a mob on the host's side. */
  attack(id: number, damage: number, crit: boolean, knockback: number): void {
    this.send({ t: "attack", id, damage, crit, knockback });
  }

  /** Looses an arrow on the host's side. */
  shoot(from: { x: number; y: number; z: number }, velocity: { x: number; y: number; z: number }, crit: boolean): void {
    this.send({ t: "shoot", x: from.x, y: from.y, z: from.z, vx: velocity.x, vy: velocity.y, vz: velocity.z, crit });
  }

  /** Says something to everyone. */
  chat(text: string): void {
    this.send({ t: "chat", text });
  }

  /** Uses the held item on a mob (shears). */
  useMob(id: number, held: ItemStack | null): void {
    this.send({ t: "useMob", id, held: saveStack(held) });
  }

  /** Tells the host the player lay down in a bed, or got up. */
  sleep(asleep: boolean): void {
    this.send({ t: "sleep", asleep });
  }

  /** Asks for an item lying about, as much as fits (`max`). */
  take(id: number, max: number): void {
    this.send({ t: "take", id, max });
  }

  /** Throws a stack out from a point. */
  throwItem(stack: ItemStack, from: { x: number; y: number; z: number }, velocity: { x: number; y: number; z: number }): void {
    this.send({ t: "throw", item: saveStack(stack)!, x: from.x, y: from.y, z: from.z, vx: velocity.x, vy: velocity.y, vz: velocity.z });
  }

  /** Opens a chest or furnace: the host sends its contents (onContainer) until it is closed. */
  open(x: number, y: number, z: number): void {
    this.send({ t: "open", x, y, z });
  }

  /** Changes slots of the open chest or furnace. */
  setSlots(x: number, y: number, z: number, slots: Array<[number, SavedStack | null]>): void {
    this.send({ t: "slots", x, y, z, slots });
  }

  close(x: number, y: number, z: number): void {
    this.send({ t: "close", x, y, z });
  }

  /** For Terrain.onUnload: the host sends the chunk again when it is needed. */
  drop(chunk: Chunk): void {
    this.dropped.push([chunk.cx, chunk.cz]);
  }

  /** Sends where the player is, if that changed, at most every MOVES seconds; and the chunks let go. */
  report(dt: number, pose: Pose): void {
    if (!this.welcomed) return;
    this.moveTimer += dt;
    if (this.moveTimer >= MOVES) {
      this.moveTimer = 0;
      const p = pose.position;
      const key = `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)},${pose.yaw.toFixed(3)},${pose.pitch.toFixed(3)}`;
      if (key !== this.lastMove) {
        this.lastMove = key;
        this.send({ t: "move", x: p.x, y: p.y, z: p.z, yaw: pose.yaw, pitch: pose.pitch });
      }
    }
    if (this.dropped.length > 0) {
      this.send({ t: "dropped", chunks: this.dropped });
      this.dropped = [];
    }
  }

  leave(): void {
    this.conn.close();
  }

  private send(msg: ToHost): void {
    this.conn.send(encode(msg));
  }
}

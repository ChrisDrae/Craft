import { BLOCKS, Block, FLUID, SHAPE, isBed, type Block as BlockId } from "./blocks.js";
import type { SoundKind } from "./settings.js";

/** The kinds of sound with a volume of their own (besides "master"). */
export type SoundCategory = Exclude<SoundKind, "master">;

/** How blocks sound, by Minecraft's sound groups. */
export type SoundGroup = "stone" | "wood" | "gravel" | "grass" | "sand" | "snow" | "wool" | "glass" | "ladder";

/** The sound group of a block, as Minecraft's: dirt and clay crunch like gravel, leaves and plants rustle like grass. */
export function soundGroup(block: BlockId): SoundGroup | null {
  const info = BLOCKS[block];
  const n = info.name;
  if (block === Block.Air || FLUID[block] !== 0) return null;
  if (n.endsWith("_wool") || n.endsWith("_carpet") || isBed(block)) return "wool";
  if (n.startsWith("glass") || block === Block.Ice || block === Block.Glowstone) return "glass";
  if (block === Block.Ladder) return "ladder";
  if (block === Block.Sand || block === Block.Sandstone) return "sand";
  if (block === Block.Snow || block === Block.SnowBlock) return "snow";
  if (block === Block.Dirt || block === Block.Gravel || block === Block.Clay) return "gravel";
  if (block === Block.Grass || info.leafy || SHAPE[block] === "cross" || SHAPE[block] === "tall" || SHAPE[block] === "lilypad" || n.includes("mushroom") || block === Block.Cactus) return "grass";
  if (n.includes("log") || n.includes("planks") || n.startsWith("oak") || n.includes("crafting") || block === Block.Chest || block === Block.Bookshelf || block === Block.Pumpkin || block === Block.Melon) return "wood";
  return "stone";
}

/** A sound of an event, as Minecraft's sounds.json gives it. */
interface SoundFile {
  file: string;
  volume: number;
  pitch: number;
  weight: number;
  stream: boolean;
}

/** Where `npm run textures` puts the sounds it copies from the player's Minecraft. */
const IMPORTED = "textures/minecraft/";
/** Sounds fade out to nothing over this many blocks. */
const HEARING = 16;
const RATE = 22050;

/** A small random number generator, so synthesized sounds vary a little each time. */
const rand = (): number => Math.random() * 2 - 1;

/** Shapes a buffer of noise or a tone: `fill(t, i)` gives the sample at time t. */
function makeBuffer(ctx: BaseAudioContext, seconds: number, fill: (t: number, i: number) => number): AudioBuffer {
  const n = Math.max(1, Math.floor(seconds * RATE));
  const buffer = ctx.createBuffer(1, n, RATE);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.max(-1, Math.min(1, fill(i / RATE, i)));
  return buffer;
}

/** Noise through a band (one-pole low and high passes), fading out: Craft's own block and impact sounds. */
function noiseBurst(ctx: BaseAudioContext, seconds: number, low: number, high: number, gain: number = 0.8, attack: number = 0.004): AudioBuffer {
  let lp = 0;
  let hp = 0;
  let prev = 0;
  const a = 1 - Math.exp((-2 * Math.PI * high) / RATE);
  const b = Math.exp((-2 * Math.PI * low) / RATE);
  return makeBuffer(ctx, seconds, (t) => {
    lp += a * (rand() - lp);
    hp = b * (hp + lp - prev);
    prev = lp;
    const env = Math.min(1, t / attack) * Math.exp((-5 * t) / seconds);
    return hp * env * gain * 2.5;
  });
}

/** A tone gliding from one pitch to another, fading out (oscillator shapes: sine, square, saw). */
function tone(ctx: BaseAudioContext, seconds: number, from: number, to: number, shape: "sine" | "square" | "saw" = "sine", gain: number = 0.5, vibrato: number = 0): AudioBuffer {
  let phase = 0;
  return makeBuffer(ctx, seconds, (t) => {
    const f = from + (to - from) * (t / seconds) + (vibrato ? Math.sin(t * Math.PI * 2 * 6) * vibrato : 0);
    phase += f / RATE;
    const p = phase % 1;
    const v = shape === "sine" ? Math.sin(p * Math.PI * 2) : shape === "square" ? (p < 0.5 ? 1 : -1) * 0.6 : (p * 2 - 1) * 0.7;
    const env = Math.min(1, t / 0.01) * Math.exp((-3 * t) / seconds);
    return v * env * gain;
  });
}

/** Two buffers one after the other, or played together. */
function join(ctx: BaseAudioContext, parts: AudioBuffer[], gap: number = 0): AudioBuffer {
  const total = parts.reduce((n, b) => n + b.length, 0) + Math.floor(gap * RATE) * (parts.length - 1);
  const out = ctx.createBuffer(1, total, RATE);
  const data = out.getChannelData(0);
  let at = 0;
  for (const p of parts) {
    data.set(p.getChannelData(0), at);
    at += p.length + Math.floor(gap * RATE);
  }
  return out;
}

/** Bands of noise per sound group: stone clicks high, wool is dull, gravel and sand hiss. */
const GROUP_BANDS: Record<SoundGroup, [number, number]> = {
  stone: [700, 3500],
  wood: [250, 1400],
  gravel: [1200, 6000],
  grass: [1800, 7000],
  sand: [2500, 9000],
  snow: [2000, 6000],
  wool: [150, 700],
  glass: [2500, 9000],
  ladder: [300, 1600],
};

/** Craft's own sound for an event, where Minecraft's weren't imported (none for music and ambience). */
function synthesize(ctx: BaseAudioContext, event: string): AudioBuffer | null {
  const [kind, name, action] = event.split(".");
  if (kind === "block" && name in GROUP_BANDS) {
    const [lo, hi] = GROUP_BANDS[name as SoundGroup];
    if (action === "break") return name === "glass" ? join(ctx, [noiseBurst(ctx, 0.25, lo, hi, 0.9), tone(ctx, 0.3, 2400, 2100, "sine", 0.2)]) : noiseBurst(ctx, 0.2, lo, hi);
    if (action === "place") return noiseBurst(ctx, 0.12, lo, hi, 0.7);
    return noiseBurst(ctx, 0.07, lo, hi, 0.45);
  }
  switch (event) {
    case "entity.player.hurt":
    case "entity.player.death":
      return tone(ctx, event.endsWith("death") ? 0.5 : 0.18, 320, 150, "saw", 0.45);
    case "entity.player.attack.strong":
    case "entity.player.attack.weak":
    case "entity.player.attack.crit":
    case "entity.player.attack.nodamage":
      return noiseBurst(ctx, 0.12, 900, 4000, 0.5, 0.02);
    case "entity.player.levelup":
      return join(ctx, [tone(ctx, 0.12, 784, 784), tone(ctx, 0.12, 988, 988), tone(ctx, 0.3, 1175, 1175)]);
    case "entity.player.burp":
      return tone(ctx, 0.25, 160, 110, "saw", 0.4, 8);
    case "entity.player.splash":
      return noiseBurst(ctx, 0.4, 1500, 8000, 0.7, 0.01);
    case "entity.player.small_fall":
    case "entity.player.big_fall":
      return noiseBurst(ctx, 0.1, 80, 600, 0.8);
    case "entity.generic.eat":
      return noiseBurst(ctx, 0.09, 1500, 5000, 0.5);
    case "entity.generic.explode":
      return noiseBurst(ctx, 1.4, 30, 900, 1, 0.005);
    case "entity.generic.extinguish_fire":
      return noiseBurst(ctx, 0.5, 2000, 9000, 0.4, 0.05);
    case "entity.item.pickup":
      return tone(ctx, 0.06, 500, 950, "sine", 0.35);
    case "entity.experience_orb.pickup":
      return join(ctx, [tone(ctx, 0.1, 1320, 1320, "sine", 0.25)]);
    case "entity.arrow.shoot":
    case "entity.skeleton.shoot":
      return join(ctx, [noiseBurst(ctx, 0.1, 1500, 5000, 0.4), tone(ctx, 0.15, 220, 160, "sine", 0.3)]);
    case "entity.arrow.hit":
    case "entity.arrow.hit_player":
      return noiseBurst(ctx, 0.05, 400, 3000, 0.6);
    case "block.chest.open":
    case "block.chest.close":
      return noiseBurst(ctx, 0.3, 60, 400, 0.8, 0.03);
    case "block.wooden_door.open":
    case "block.wooden_door.close":
    case "block.wooden_trapdoor.open":
    case "block.wooden_trapdoor.close":
      return noiseBurst(ctx, 0.1, 100, 800, 0.9);
    case "ui.button.click":
      return noiseBurst(ctx, 0.03, 800, 5000, 0.5);
    case "block.lava.pop":
    case "entity.chicken.egg":
      return tone(ctx, 0.05, 350, 600, "sine", 0.4);
    case "entity.sheep.shear":
      return join(ctx, [noiseBurst(ctx, 0.04, 3000, 9000, 0.5), noiseBurst(ctx, 0.04, 3000, 9000, 0.5)], 0.06);
    case "entity.creeper.primed":
      return noiseBurst(ctx, 1.5, 2500, 9000, 0.5, 1.2);
  }
  if (kind === "entity" && action === "step") return noiseBurst(ctx, 0.06, 300, 2500, 0.3);
  const death = action === "death";
  const hurt = action === "hurt";
  const k = death ? 1.6 : hurt ? 0.6 : 1;
  switch (name) {
    case "zombie":
      return tone(ctx, 0.6 * k, hurt ? 150 : 95, death ? 50 : 80, "saw", 0.4, 12);
    case "skeleton":
      return join(ctx, Array.from({ length: hurt ? 3 : 5 }, () => noiseBurst(ctx, 0.03, 1000, 6000, 0.5)), 0.04);
    case "creeper":
    case "spider":
      return noiseBurst(ctx, 0.4 * k, 2000, 8000, 0.5, 0.05);
    case "pig":
      return join(ctx, [tone(ctx, 0.12, 280, 240, "square", 0.3), tone(ctx, 0.12 * k, 260, 200, "square", 0.3)], 0.05);
    case "cow":
      return tone(ctx, 0.9 * k, 120, 105, "saw", 0.4, 4);
    case "sheep":
      return tone(ctx, 0.6 * k, 330, 300, "saw", 0.35, 18);
    case "chicken":
      return join(ctx, [tone(ctx, 0.06, 1000, 900, "square", 0.25), tone(ctx, 0.06, 1100, 950, "square", 0.25)], 0.04);
  }
  return null;
}

/**
 * The game's sound, as Minecraft's: events by Minecraft's names ("block.stone.break"), each a random one of
 * its files (imported from the player's Minecraft by `npm run textures`), at its volume and pitch; from a
 * point in the world they fade out over 16 blocks and come from where they are. Each kind has its volume
 * (Options). Without imported sounds Craft makes small ones of its own, and plays no music.
 */
export class Sounds {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private gains: Partial<Record<SoundCategory, GainNode>> = {};
  private events: Record<string, SoundFile[]> | null = null;
  private readonly buffers: Map<string, Promise<AudioBuffer | null>> = new Map();
  private readonly synthesized: Map<string, AudioBuffer[]> = new Map();
  private music: HTMLAudioElement | null = null;
  private musicIn: number = 60 + Math.random() * 120;
  private readonly volumes: () => Record<SoundKind, number>;

  constructor(volumes: () => Record<SoundKind, number>) {
    this.volumes = volumes;
  }

  /** Reads the list of imported sounds, if there is one (a build has none). */
  async load(): Promise<void> {
    try {
      const response = await fetch(`${IMPORTED}sounds.json`);
      if (response.ok) this.events = (await response.json()).events ?? null;
    } catch {
      this.events = null;
    }
  }

  /** Whether Minecraft's sounds were imported. */
  get imported(): boolean {
    return this.events !== null;
  }

  /** Starts the sound: browsers only allow it after the player clicked or pressed a key. */
  start(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctx = globalThis.AudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    for (const c of ["music", "blocks", "hostile", "friendly", "players", "ambient"] as SoundCategory[]) {
      const g = this.ctx.createGain();
      g.connect(this.master);
      this.gains[c] = g;
    }
    this.applyVolumes();
  }

  /** The volumes from the settings, now. */
  applyVolumes(): void {
    const v = this.volumes();
    if (this.master) this.master.gain.value = v.master;
    for (const [c, g] of Object.entries(this.gains)) g.gain.value = v[c as SoundCategory];
    if (this.music) this.music.volume = Math.min(1, v.master * v.music * 0.6);
  }

  /** Where the listener is and which way they face (every frame). */
  listen(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) {
      const t = this.ctx!.currentTime;
      l.positionX.setValueAtTime(x, t);
      l.positionY.setValueAtTime(y, t);
      l.positionZ.setValueAtTime(z, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(fy, t);
      l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(x, y, z);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  private file(path: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(path);
    if (!p) {
      const ctx = this.ctx!;
      p = fetch(`${IMPORTED}sounds/${path}.ogg`)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((data) => (data ? ctx.decodeAudioData(data) : null))
        .catch(() => null);
      this.buffers.set(path, p);
    }
    return p;
  }

  private synth(event: string): AudioBuffer | null {
    let list = this.synthesized.get(event);
    if (!list) {
      // A few takes of each, so repeats aren't the same
      list = [];
      for (let i = 0; i < 3; i++) {
        const b = synthesize(this.ctx!, event);
        if (b) list.push(b);
      }
      this.synthesized.set(event, list);
    }
    return list.length > 0 ? list[Math.floor(Math.random() * list.length)] : null;
  }

  /**
   * Plays an event: from a point in the world (fading with distance), or everywhere (null). `pitch`
   * multiplies the file's own; Minecraft varies most sounds' pitch a little.
   */
  play(event: string, category: SoundCategory, at: { x: number; y: number; z: number } | null = null, volume: number = 1, pitch: number = 1): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const files = this.events?.[event];
    if (this.events) {
      if (!files || files.length === 0) return;
      const total = files.reduce((n, f) => n + f.weight, 0);
      let r = Math.random() * total;
      const f = files.find((s) => (r -= s.weight) < 0) ?? files[0];
      void this.file(f.file).then((buffer) => buffer && this.voice(buffer, category, at, volume * f.volume, pitch * f.pitch));
      return;
    }
    const buffer = this.synth(event);
    if (buffer) this.voice(buffer, category, at, volume * 0.6, pitch);
  }

  /** Plays a buffer through its kind's volume, from a point or everywhere. */
  private voice(buffer: AudioBuffer, category: SoundCategory, at: { x: number; y: number; z: number } | null, volume: number, pitch: number): void {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = pitch;
    const gain = ctx.createGain();
    gain.gain.value = Math.min(2, volume);
    source.connect(gain);
    let last: AudioNode = gain;
    if (at) {
      const panner = ctx.createPanner();
      panner.panningModel = "equalpower";
      panner.distanceModel = "linear";
      panner.refDistance = 1;
      panner.maxDistance = HEARING * Math.max(1, volume);
      panner.rolloffFactor = 1;
      if (panner.positionX) {
        panner.positionX.value = at.x;
        panner.positionY.value = at.y;
        panner.positionZ.value = at.z;
      } else {
        panner.setPosition(at.x, at.y, at.z);
      }
      gain.connect(panner);
      last = panner;
    }
    last.connect(this.gains[category]!);
    source.start();
  }

  /**
   * Music now and then, as Minecraft's: a track every 10 to 20 minutes (the first within a few minutes of
   * starting), from the game's or creative's tracks; only with imported sounds.
   */
  tickMusic(dt: number, creative: boolean): void {
    if (!this.ctx || !this.events || this.music) return;
    this.musicIn -= dt;
    if (this.musicIn > 0) return;
    const list = this.events[creative ? "music.creative" : "music.game"] ?? this.events["music.game"];
    if (!list || list.length === 0) return;
    const track = list[Math.floor(Math.random() * list.length)];
    const audio = new Audio(`${IMPORTED}sounds/${track.file}.ogg`);
    this.music = audio;
    this.applyVolumes();
    audio.onended = () => {
      this.music = null;
      this.musicIn = 600 + Math.random() * 600;
    };
    void audio.play().catch(() => {
      this.music = null;
      this.musicIn = 60;
    });
  }
}

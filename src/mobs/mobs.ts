import type { Vec3 } from "projector";
import { Biome } from "../biomes.js";
import { Block, COLORS, OPAQUE, STATE_BLOCK } from "../blocks.js";
import { CHUNK_SIZE } from "../chunk.js";
import type { Drops } from "../drops.js";
import { blastOn, blastedBlocks } from "../explosion.js";
import { itemByName, type ItemStack } from "../items.js";
import { dropsOf } from "../mining.js";
import { celestialAngle, daylightAt } from "../sky.js";
import { byDifficulty, type DamageSource, type Difficulty } from "../vitals.js";
import { VoxelWorld } from "../world.js";
import { Arrow, segmentHitsBox, type Shooter } from "./arrow.js";
import { MOBS, MOB_KINDS, sheepColor, type MobKind } from "./kinds.js";
import { Mob } from "./mob.js";
import { findPath, standing } from "./path.js";

const DT = 1 / 20;
/** Monsters near all players at once at most, and animals. */
const MONSTER_CAP = 24;
const ANIMAL_CAP = 12;
/** Where monsters and animals appear around a player: no nearer, no farther. */
const SPAWN_NEAR = 24;
const SPAWN_FAR = 64;
/** Monsters this far from every player go at once; beyond 32 now and then. */
const DESPAWN = 128;
const DESPAWN_NEAR = 32;
/** How far monsters notice a player, and keep after them. */
const SIGHT = 16;
const FOLLOW = 32;
/** Mobs farther than this from every player stand still (not ticked). */
const ACTIVE = 96;
/** A creeper's fuse in ticks, and its blast. */
const FUSE = 30;
const CREEPER_POWER = 3;
/** How hard a hit pushes (blocks a second), as Minecraft's knockback of 0.4 a tick. */
export const KNOCKBACK = 8;

/** A player as mobs see them. */
export interface MobPlayer {
  id: string;
  /** Feet. */
  position: Vec3;
  /** Monsters go after them (alive, in survival). */
  targetable: boolean;
  /** The name of what they hold (animals follow their food). */
  held: string | null;
}

export interface MobsOptions {
  world: VoxelWorld;
  drops: Drops;
  players: () => MobPlayer[];
  difficulty: () => Difficulty;
  /** Ticks since the world began, for the time of day. */
  time: () => number;
  /** A player was hurt (by difficulty already), with who did it and the push. */
  onHurtPlayer: (id: string, amount: number, source: DamageSource, by: string, push: Vec3) => void;
  /** An explosion went off (for its sound and smoke, and guests). */
  onExplosion?: (x: number, y: number, z: number, power: number) => void;
  /** An arrow stuck where a player can take it: give it to them if they can (returns whether they did). */
  onArrowPickup?: (playerId: string) => boolean;
  /** A sound at a point (Minecraft's event names): mobs calling, hurt, dying, arrows striking. */
  onSound?: (event: string, x: number, y: number, z: number, category: "hostile" | "friendly" | "players") => void;
  random?: () => number;
}

/** A mob as saves keep it (animals: monsters aren't kept). */
export interface SavedMob {
  kind: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  color?: number;
  sheared?: boolean;
}

/** A mob or arrow as guests see it: id, kind (index in MOB_KINDS, or ARROW), where, which way, its state. */
export type MobView = [id: number, kind: number, x: number, y: number, z: number, yaw: number, headYaw: number, pitch: number, flags: number, extra: number];
export const ARROW = MOB_KINDS.length;
/** MobView flags: hit, burning, dying, sheared, swelling (a creeper's fuse), stuck (an arrow). */
export const Flag = { Hurt: 1, Fire: 2, Dying: 4, Sheared: 8, Swell: 16, Stuck: 32 } as const;

/** Kinds by weight, for spawning. */
const MONSTERS: ReadonlyArray<readonly [MobKind, number]> = [
  ["zombie", 100],
  ["skeleton", 100],
  ["creeper", 100],
  ["spider", 100],
];
const ANIMALS: ReadonlyArray<readonly [MobKind, number]> = [
  ["sheep", 12],
  ["pig", 10],
  ["chicken", 10],
  ["cow", 8],
];
const NO_ANIMALS: ReadonlySet<Biome> = new Set([Biome.Desert, Biome.River]);

const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * The mobs, as Minecraft's: they run where the world does (alone, or the host), 20 times a second.
 * - Monsters (zombies, skeletons, creepers, spiders) appear in the dark around players, from dungeon
 *   spawners too, under a cap, and go when far away; they see a player within 16 blocks and find their
 *   way to them (findPath), zombies and spiders to strike, skeletons to shoot from a distance, creepers to
 *   blow up; zombies and skeletons burn in daylight, spiders leave players alone in the light.
 * - Animals (pigs, cows, sheep, chickens) appear on grass in daylight under a cap and stay; they wander,
 *   follow a player holding their food, and run when hit. Sheep are sheared and grow their wool back
 *   eating grass, chickens lay eggs.
 * - Arrows fly, hit, and stick; explosions break blocks and hurt (explode()).
 */
export class Mobs {
  readonly mobs: Map<number, Mob> = new Map();
  readonly arrows: Map<number, Arrow> = new Map();
  private readonly options: MobsOptions;
  private readonly random: () => number;
  private nextId: number = 1;
  private age: number = 0;
  /** Spawners by chunk (found when the chunk is first seen), and their ticks to the next spawn. */
  private readonly spawners: Map<number, Array<{ x: number; y: number; z: number; delay: number }>> = new Map();
  /** The chunk each animal was in at its last tick (for saving the chunks they leave and enter). */
  private readonly chunkOf: Map<number, number> = new Map();

  constructor(options: MobsOptions) {
    this.options = options;
    this.random = options.random ?? Math.random;
  }

  private get world(): VoxelWorld {
    return this.options.world;
  }

  /** A mob of a kind at a point (a sheep's wool colored by chance). */
  spawn(kind: MobKind, x: number, y: number, z: number, yaw: number = this.random() * Math.PI * 2): Mob {
    const mob = new Mob(this.world, this.nextId++, kind, { x, y, z });
    mob.yaw = mob.headYaw = mob.prevYaw = yaw;
    if (kind === "sheep") mob.color = sheepColor(this.random());
    if (kind === "chicken") mob.eggTime = 6000 + Math.floor(this.random() * 6000);
    this.mobs.set(mob.id, mob);
    return mob;
  }

  /** One game tick: spawning, every mob's mind and body, the arrows. */
  tick(): void {
    this.age++;
    const players = this.options.players();
    const difficulty = this.options.difficulty();
    if (this.age % 20 === 0 && difficulty !== "peaceful") this.spawnMonsters(players);
    if (this.age % 100 === 50) this.spawnAnimals(players);
    if (difficulty !== "peaceful") this.runSpawners(players);
    for (const mob of [...this.mobs.values()]) this.tickMob(mob, players, difficulty);
    for (const arrow of [...this.arrows.values()]) this.tickArrow(arrow, players, difficulty);
  }

  // Spawning ------------------------------------------------------------------------------------

  /** How dark it must be for monsters: no block light, and sky light (dimmed at night) at most 0 to 7. */
  private darkEnough(x: number, y: number, z: number): boolean {
    const light = this.world.getLight(x, y, z);
    if ((light & 15) > 0) return false;
    const daylight = daylightAt(celestialAngle(this.options.time()));
    const sky = Math.round((light >> 4) - 11 * (1 - daylight));
    return sky <= Math.floor(this.random() * 8);
  }

  /** The top solid block of a column (for spawning), or -1 where the chunk isn't there. */
  private topOf(x: number, z: number): number {
    if (!this.world.isLoaded(x, z)) return -1;
    for (let y = 200; y > 0; y--) if (OPAQUE[this.world.get(x, y, z)] || STATE_BLOCK[this.world.get(x, y, z)] === Block.Grass) return y;
    return -1;
  }

  private pick<T>(list: ReadonlyArray<readonly [T, number]>): T {
    const total = list.reduce((n, [, w]) => n + w, 0);
    let r = this.random() * total;
    for (const [v, w] of list) if ((r -= w) < 0) return v;
    return list[0][0];
  }

  private count(hostile: boolean): number {
    let n = 0;
    for (const m of this.mobs.values()) if (m.info.hostile === hostile) n++;
    return n;
  }

  private nearAnyPlayer(players: readonly MobPlayer[], x: number, y: number, z: number, range: number): boolean {
    return players.some((p) => Math.hypot(p.position.x - x, p.position.y - y, p.position.z - z) < range);
  }

  /** A point around a player in the spawning ring. */
  private around(p: MobPlayer): [number, number] {
    const angle = this.random() * Math.PI * 2;
    const d = SPAWN_NEAR + this.random() * (SPAWN_FAR - SPAWN_NEAR);
    return [Math.floor(p.position.x + Math.cos(angle) * d), Math.floor(p.position.z + Math.sin(angle) * d)];
  }

  private spawnMonsters(players: readonly MobPlayer[]): void {
    for (const p of players) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (this.count(true) >= MONSTER_CAP) return;
        const [x, z] = this.around(p);
        const top = this.topOf(x, z);
        if (top < 0) continue;
        // Anywhere from deep down to the surface, as Minecraft picks: caves are dark by day too
        const y = 1 + Math.floor(this.random() * top);
        const kind = this.pick(MONSTERS);
        this.spawnGroup(kind, x, y, z, players);
      }
    }
  }

  private spawnAnimals(players: readonly MobPlayer[]): void {
    for (const p of players) {
      if (this.count(false) >= ANIMAL_CAP) return;
      const [x, z] = this.around(p);
      const top = this.topOf(x, z);
      if (top < 0 || STATE_BLOCK[this.world.get(x, top, z)] !== Block.Grass) continue;
      const biome = this.world.chunk(x >> 4, z >> 4)?.biomes[(z & 15) * CHUNK_SIZE + (x & 15)];
      if (biome === undefined || NO_ANIMALS.has(biome)) continue;
      if ((this.world.getLight(x, top + 1, z) >> 4) < 9) continue;
      this.spawnGroup(this.pick(ANIMALS), x, top + 1, z, players);
    }
  }

  /**
   * Whether a mob of a kind may appear with its feet in block (x, y, z): room to stand, no player within 24
   * blocks; a monster in the dark (darkEnough), an animal on grass.
   */
  canSpawn(kind: MobKind, x: number, y: number, z: number, players: readonly MobPlayer[]): boolean {
    if (standing(this.world, x, y, z, Math.ceil(MOBS[kind].height)) !== "walk") return false;
    if (this.nearAnyPlayer(players, x, y, z, SPAWN_NEAR)) return false;
    return MOBS[kind].hostile ? this.darkEnough(x, y, z) : STATE_BLOCK[this.world.get(x, y - 1, z)] === Block.Grass;
  }

  /** One to four of a kind (two to four animals) around a spot that suits them. */
  private spawnGroup(kind: MobKind, x: number, y: number, z: number, players: readonly MobPlayer[]): void {
    const hostile = MOBS[kind].hostile;
    const n = hostile ? 1 + Math.floor(this.random() * 4) : 2 + Math.floor(this.random() * 3);
    for (let i = 0; i < n; i++) {
      const sx = x + (i === 0 ? 0 : Math.floor(this.random() * 5) - 2);
      const sz = z + (i === 0 ? 0 : Math.floor(this.random() * 5) - 2);
      if (this.canSpawn(kind, sx, y, sz, players)) this.spawn(kind, sx + 0.5, y, sz + 0.5);
    }
  }

  /** Dungeon spawners near a player: a few of their kind now and then, up to six around. */
  private runSpawners(players: readonly MobPlayer[]): void {
    for (const chunk of this.world.chunks.values()) {
      const key = VoxelWorld.key(chunk.cx, chunk.cz);
      let list = this.spawners.get(key);
      if (!list) {
        list = [];
        // Dungeons lie below y 64
        for (let s = 0; s < 4; s++) {
          const blocks = chunk.sections[s].blocks;
          if (!blocks) continue;
          for (let i = 0; i < blocks.length; i++) {
            if (blocks[i] !== Block.Spawner) continue;
            list.push({ x: chunk.cx * CHUNK_SIZE + (i & 15), y: s * CHUNK_SIZE + (i >> 8), z: chunk.cz * CHUNK_SIZE + ((i >> 4) & 15), delay: 20 });
          }
        }
        this.spawners.set(key, list);
      }
      for (const sp of list) {
        if (this.world.get(sp.x, sp.y, sp.z) !== Block.Spawner) continue;
        if (!this.nearAnyPlayer(players, sp.x, sp.y, sp.z, 16)) continue;
        if (--sp.delay > 0) continue;
        sp.delay = 200 + Math.floor(this.random() * 600);
        // Each spawner's kind follows from where it is
        const h = Math.abs((sp.x * 73856093) ^ (sp.y * 19349663) ^ (sp.z * 83492791)) % 4;
        const kind: MobKind = h < 2 ? "zombie" : h === 2 ? "skeleton" : "spider";
        let near = 0;
        for (const m of this.mobs.values()) if (m.kind === kind && Math.abs(m.position.x - sp.x) < 9 && Math.abs(m.position.z - sp.z) < 9 && Math.abs(m.position.y - sp.y) < 5) near++;
        for (let i = 0; i < 4 && near < 6; i++) {
          const x = sp.x + Math.floor(this.random() * 9) - 4;
          const z = sp.z + Math.floor(this.random() * 9) - 4;
          const y = sp.y + Math.floor(this.random() * 3) - 1;
          if (standing(this.world, x, y, z, Math.ceil(MOBS[kind].height)) !== "walk") continue;
          this.spawn(kind, x + 0.5, y, z + 0.5);
          near++;
        }
      }
    }
  }

  // Minds and bodies ----------------------------------------------------------------------------

  private distance(mob: Mob, p: Vec3): number {
    return Math.hypot(p.x - mob.position.x, p.y - mob.position.y, p.z - mob.position.z);
  }

  /** Whether nothing opaque lies between the mob's eyes and a player's. */
  private sees(mob: Mob, p: Vec3): boolean {
    const ax = mob.position.x;
    const ay = mob.eyeY;
    const az = mob.position.z;
    const bx = p.x;
    const by = p.y + 1.6;
    const bz = p.z;
    const d = Math.hypot(bx - ax, by - ay, bz - az);
    const steps = Math.ceil(d / 0.3);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (OPAQUE[this.world.get(Math.floor(ax + (bx - ax) * t), Math.floor(ay + (by - ay) * t), Math.floor(az + (bz - az) * t))]) return false;
    }
    return true;
  }

  /** The player a monster goes after: the one it has while still in reach, or the nearest it sees. */
  private targetFor(mob: Mob, players: readonly MobPlayer[]): MobPlayer | null {
    const current = mob.target ? players.find((p) => p.id === mob.target!.id && p.targetable) : undefined;
    if (current && this.distance(mob, current.position) < FOLLOW) return current;
    if (mob.age % 10 !== mob.id % 10) return null;
    let best: MobPlayer | null = null;
    for (const p of players) {
      if (!p.targetable) continue;
      const d = this.distance(mob, p.position);
      if (d < SIGHT && (!best || d < this.distance(mob, best.position)) && this.sees(mob, p.position)) best = p;
    }
    return best;
  }

  /** Heads for a point along a path (found again now and then, or when the point moved), at a speed. */
  private goTo(mob: Mob, x: number, y: number, z: number, speed: number): void {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    const gz = Math.floor(z);
    const g = mob.goal;
    const moved = !g || Math.abs(g.x - gx) + Math.abs(g.z - gz) + Math.abs(g.y - gy) > 1;
    if (moved || mob.pathAge > 40 || (mob.path.length === 0 && mob.pathAge > 10)) {
      mob.path = findPath(this.world, Math.floor(mob.position.x), Math.floor(mob.position.y + 0.01), Math.floor(mob.position.z), gx, gy, gz, mob.info.height);
      mob.goal = { x: gx, y: gy, z: gz };
      mob.pathAge = 0;
    }
    mob.pathAge++;
    this.follow(mob, speed);
  }

  /** Walks the path: toward the next block's middle, jumping up where it rises. */
  private follow(mob: Mob, speed: number): void {
    const p = mob.position;
    while (mob.path.length > 0) {
      const n = mob.path[0];
      if (Math.hypot(n.x + 0.5 - p.x, n.z + 0.5 - p.z) < 0.4 && Math.abs(n.y - p.y) < 1.2) mob.path.shift();
      else break;
    }
    const n = mob.path[0];
    if (!n) {
      mob.want.x = mob.want.z = 0;
      return;
    }
    const dx = n.x + 0.5 - p.x;
    const dz = n.z + 0.5 - p.z;
    const d = Math.hypot(dx, dz) || 1;
    mob.want.x = (dx / d) * speed;
    mob.want.z = (dz / d) * speed;
    if (n.y > p.y + 0.5 && mob.onGround) mob.want.jump = true;
    mob.turnTo(Math.atan2(dx, dz));
    mob.headYaw = mob.yaw;
  }

  private stop(mob: Mob): void {
    mob.want.x = mob.want.z = 0;
    mob.path = [];
  }

  /** Wandering about: now and then off to a spot nearby. */
  private wander(mob: Mob, speed: number): void {
    if (mob.path.length > 0 && mob.goal) {
      this.follow(mob, speed);
      if (mob.path.length === 0) mob.goal = null;
      return;
    }
    mob.want.x = mob.want.z = 0;
    if (this.random() < 1 / 100) {
      const x = Math.floor(mob.position.x) + Math.floor(this.random() * 17) - 8;
      const z = Math.floor(mob.position.z) + Math.floor(this.random() * 17) - 8;
      mob.path = findPath(this.world, Math.floor(mob.position.x), Math.floor(mob.position.y + 0.01), Math.floor(mob.position.z), x, Math.floor(mob.position.y), z, mob.info.height);
      mob.goal = { x, y: Math.floor(mob.position.y), z };
    } else if (this.random() < 0.02) {
      mob.headYaw = mob.yaw + (this.random() - 0.5) * 2;
    }
  }

  private tickMob(mob: Mob, players: readonly MobPlayer[], difficulty: Difficulty): void {
    const p = mob.position;
    const nearest = Math.min(...players.map((pl) => this.distance(mob, pl.position)), Infinity);
    // Monsters go: in peaceful, far from everyone, or now and then when nobody is near
    if (mob.info.hostile) {
      if (difficulty === "peaceful" || nearest > DESPAWN || (nearest > DESPAWN_NEAR && ++mob.idle > 600 && this.random() < 1 / 800)) {
        this.remove(mob);
        return;
      }
    }
    if (nearest > ACTIVE) return;
    mob.age++;
    if (mob.hurt > 0) mob.hurt--;
    if (mob.invulnerable > 0) mob.invulnerable--;
    if (mob.cooldown > 0) mob.cooldown--;
    if (!mob.alive) {
      mob.want.x = mob.want.z = 0;
      mob.step(DT);
      if (++mob.dying > 20) this.remove(mob);
      return;
    }
    this.think(mob, players, difficulty);
    // Now and then a call (creepers keep quiet)
    if (mob.kind !== "creeper" && this.random() < 1 / 160) this.sound(mob, "ambient");
    const wasOnGround = mob.onGround;
    const fall = mob.fallDistance;
    mob.step(DT);
    if (mob.onGround && !wasOnGround && fall > 3) this.hurt(mob, Math.ceil(fall - 3), "fall", null);
    this.surroundings(mob);
    if (p.y < -64) this.remove(mob);
    this.trackChunk(mob);
  }

  /** Fire, lava, water and the sun. */
  private surroundings(mob: Mob): void {
    if (mob.inFire) {
      this.hurt(mob, 4, "lava", null);
      mob.fire = Math.max(mob.fire, 300);
    }
    if (mob.inWater) mob.fire = 0;
    // Zombies and skeletons catch fire under the open sky by day
    if (mob.info.burns && !mob.inWater && mob.fire === 0) {
      const daylight = daylightAt(celestialAngle(this.options.time()));
      const sky = this.world.getLight(Math.floor(mob.position.x), Math.floor(mob.eyeY), Math.floor(mob.position.z)) >> 4;
      if (daylight > 0.5 && sky === 15 && this.random() * 30 < (daylight - 0.4) * 2) mob.fire = 160;
    }
    if (mob.fire > 0) {
      if (mob.fire % 20 === 0) this.hurt(mob, 1, "fire", null);
      mob.fire--;
    }
  }

  private think(mob: Mob, players: readonly MobPlayer[], difficulty: Difficulty): void {
    const info = mob.info;
    if (info.hostile) {
      // Spiders only go after players in the dark, or one that hit them
      const target = this.targetFor(mob, players);
      const light = this.world.getLight(Math.floor(mob.position.x), Math.floor(mob.eyeY), Math.floor(mob.position.z));
      const daylight = daylightAt(celestialAngle(this.options.time()));
      const bright = Math.max(light & 15, Math.round((light >> 4) * daylight)) >= 12;
      const calm = mob.kind === "spider" && bright && !(mob.target && mob.hurt > 0) && mob.panic === 0;
      if (!target || calm) {
        mob.target = null;
        if (mob.kind === "creeper") mob.fuse = Math.max(0, mob.fuse - 1);
        this.wander(mob, info.speed * 0.6);
        return;
      }
      mob.target = { id: target.id, position: target.position };
      this.attack(mob, target, difficulty);
      return;
    }
    // Animals
    if (mob.panic > 0) {
      mob.panic--;
      if (mob.path.length === 0 || mob.panic % 30 === 0) {
        const from = mob.panicFrom ?? mob.position;
        const away = Math.atan2(mob.position.x - from.x, mob.position.z - from.z) + (this.random() - 0.5) * 1.5;
        const x = mob.position.x + Math.sin(away) * 8;
        const z = mob.position.z + Math.cos(away) * 8;
        mob.goal = null;
        this.goTo(mob, x, mob.position.y, z, info.speed * 1.8);
      } else {
        this.follow(mob, info.speed * 1.8);
      }
      return;
    }
    const tempting = players.find((pl) => pl.held && info.tempt.includes(pl.held) && this.distance(mob, pl.position) < 10);
    if (tempting) {
      mob.lookAt(tempting.position);
      if (this.distance(mob, tempting.position) > 2.5) this.goTo(mob, tempting.position.x, tempting.position.y, tempting.position.z, info.speed * 1.2);
      else this.stop(mob);
      return;
    }
    // Sheep graze (growing their wool back), chickens lay eggs
    const below = this.world.get(Math.floor(mob.position.x), Math.floor(mob.position.y - 0.5), Math.floor(mob.position.z));
    if (mob.kind === "sheep" && STATE_BLOCK[below] === Block.Grass && this.random() < 1 / 1000) {
      this.world.set(Math.floor(mob.position.x), Math.floor(mob.position.y - 0.5), Math.floor(mob.position.z), Block.Dirt);
      mob.sheared = false;
    }
    if (mob.kind === "chicken" && --mob.eggTime <= 0) {
      mob.eggTime = 6000 + Math.floor(this.random() * 6000);
      this.options.drops.spawn(mob.position.x, mob.position.y + 0.3, mob.position.z, { item: itemByName("egg")!, count: 1, damage: 0 });
      this.sound(mob, "egg");
    }
    const near = players.find((pl) => this.distance(mob, pl.position) < 6);
    if (near && this.random() < 0.02) mob.lookAt(near.position);
    this.wander(mob, info.speed);
  }

  /** A monster after its target: strike, shoot or blow up. */
  private attack(mob: Mob, target: MobPlayer, difficulty: Difficulty): void {
    const info = mob.info;
    const t = target.position;
    const dx = t.x - mob.position.x;
    const dz = t.z - mob.position.z;
    const flat = Math.hypot(dx, dz);
    const d = this.distance(mob, t);
    mob.lookAt(t);
    switch (mob.kind) {
      case "skeleton": {
        const sees = this.sees(mob, t);
        if (!sees || flat > 12) this.goTo(mob, t.x, t.y, t.z, info.speed);
        else if (flat < 5) {
          mob.path = [];
          mob.want.x = (-dx / flat) * info.speed;
          mob.want.z = (-dz / flat) * info.speed;
        } else {
          // Strafe round the target
          const side = Math.floor(mob.age / 40) % 2 === 0 ? 1 : -1;
          mob.path = [];
          mob.want.x = (dz / flat) * side * info.speed * 0.5;
          mob.want.z = (-dx / flat) * side * info.speed * 0.5;
        }
        mob.yaw = mob.headYaw;
        if (sees && flat < 15 && mob.cooldown === 0) {
          this.shootAt(mob, t, difficulty);
          this.sound(mob, "shoot");
          mob.cooldown = (difficulty === "hard" ? 20 : 40) + Math.floor(this.random() * 20);
        }
        return;
      }
      case "creeper": {
        if (mob.fuse > 0 || d < 3) {
          // Lit: it stands and swells; too far and it calms down
          this.stop(mob);
          if (d > 7 || !this.sees(mob, t)) mob.fuse = Math.max(0, mob.fuse - 1);
          else if (mob.fuse++ === 0) this.sound(mob, "primed");
          if (mob.fuse >= FUSE) {
            this.remove(mob);
            this.explode(mob.position.x, mob.position.y + 0.5, mob.position.z, CREEPER_POWER, mob.info.label);
          }
          return;
        }
        this.goTo(mob, t.x, t.y, t.z, info.speed);
        return;
      }
      default: {
        // Zombies and spiders: close in and strike; a spider leaps the last blocks
        if (mob.kind === "spider" && mob.onGround && flat > 2 && flat < 4 && this.random() < 0.1) {
          mob.velocity.x = (dx / flat) * 8;
          mob.velocity.z = (dz / flat) * 8;
          mob.velocity.y = 8;
        }
        const reach = info.width + 1;
        if (flat < reach && Math.abs(t.y - mob.position.y) < 1.5) {
          this.stop(mob);
          mob.turnTo(Math.atan2(dx, dz), 1);
          if (mob.cooldown === 0) {
            mob.cooldown = 20;
            const push = { x: (dx / (flat || 1)) * KNOCKBACK, y: 6, z: (dz / (flat || 1)) * KNOCKBACK };
            this.options.onHurtPlayer(target.id, byDifficulty(mob.kind === "spider" && difficulty === "hard" ? 3 : info.attack, difficulty), "mob", info.label, push);
          }
        } else {
          this.goTo(mob, t.x, t.y, t.z, info.speed);
        }
      }
    }
  }

  /**
   * A skeleton's arrow at a target, as Minecraft aims: at a third of the target's height, raised by a fifth
   * of the distance for the drop, less accurately on easier difficulties.
   */
  private shootAt(mob: Mob, t: Vec3, difficulty: Difficulty): void {
    const from = { x: mob.position.x, y: mob.eyeY - 0.1, z: mob.position.z };
    const dx = t.x - from.x;
    const dy = t.y + 0.6 - from.y;
    const dz = t.z - from.z;
    const flat = Math.hypot(dx, dz);
    const spread = (14 - { peaceful: 0, easy: 1, normal: 2, hard: 3 }[difficulty] * 4) * 0.0075;
    let vx = dx;
    let vy = dy + flat * 0.2;
    let vz = dz;
    const len = Math.hypot(vx, vy, vz) || 1;
    vx = vx / len + (this.random() - 0.5) * 2 * spread;
    vy = vy / len + (this.random() - 0.5) * 2 * spread;
    vz = vz / len + (this.random() - 0.5) * 2 * spread;
    const speed = 1.6 * 20;
    this.shoot(from, { x: vx * speed, y: vy * speed, z: vz * speed }, { mob: mob.id }, false, false);
  }

  /** An arrow on its way. */
  shoot(from: Vec3, velocity: Vec3, shooter: Shooter, crit: boolean, pickup: boolean): Arrow {
    const arrow = new Arrow(this.nextId++, from, velocity, shooter, crit, pickup);
    this.arrows.set(arrow.id, arrow);
    return arrow;
  }

  private tickArrow(arrow: Arrow, players: readonly MobPlayer[], difficulty: Difficulty): void {
    const flight = arrow.step(this.world, DT);
    if (arrow.expired) {
      this.arrows.delete(arrow.id);
      return;
    }
    if (arrow.stuck && !flight) {
      // A player's arrow can be taken back
      if (!arrow.pickup) return;
      for (const p of players) {
        if (!p.targetable) continue;
        const q = p.position;
        if (Math.abs(q.x - arrow.position.x) < 1 && Math.abs(q.z - arrow.position.z) < 1 && arrow.position.y > q.y - 0.5 && arrow.position.y < q.y + 2 && this.options.onArrowPickup?.(p.id)) {
          this.arrows.delete(arrow.id);
          return;
        }
      }
      return;
    }
    if (!flight) return;
    // The first body on its way, not its shooter (for a moment)
    let hit: { t: number; mob?: Mob; player?: MobPlayer } | null = null;
    const own = (s: Shooter): s is { mob: number } => "mob" in s;
    for (const mob of this.mobs.values()) {
      if (!mob.alive || (own(arrow.shooter) && arrow.shooter.mob === mob.id && arrow.age < 5)) continue;
      const w = mob.halfWidth + 0.1;
      const t = segmentHitsBox(flight.from, flight.to, { x: mob.position.x - w, y: mob.position.y, z: mob.position.z - w }, { x: mob.position.x + w, y: mob.position.y + mob.height, z: mob.position.z + w });
      if (t !== null && (!hit || t < hit.t)) hit = { t, mob };
    }
    for (const p of players) {
      if (!p.targetable || ("player" in arrow.shooter && arrow.shooter.player === p.id && arrow.age < 5)) continue;
      const q = p.position;
      const t = segmentHitsBox(flight.from, flight.to, { x: q.x - 0.4, y: q.y, z: q.z - 0.4 }, { x: q.x + 0.4, y: q.y + 1.8, z: q.z + 0.4 });
      if (t !== null && (!hit || t < hit.t)) hit = { t, player: p };
    }
    if (arrow.stuck && !hit) this.options.onSound?.("entity.arrow.hit", arrow.position.x, arrow.position.y, arrow.position.z, "players");
    if (!hit) return;
    const damage = arrow.damage(this.random);
    this.options.onSound?.(hit.player ? "entity.arrow.hit_player" : "entity.arrow.hit", arrow.position.x, arrow.position.y, arrow.position.z, "players");
    const v = arrow.velocity;
    const flat = Math.hypot(v.x, v.z) || 1;
    const push = { x: (v.x / flat) * KNOCKBACK * 0.6, y: 4, z: (v.z / flat) * KNOCKBACK * 0.6 };
    const by = own(arrow.shooter) ? (this.mobs.get(arrow.shooter.mob)?.info.label ?? "Skeleton") : null;
    if (hit.mob) this.hurt(hit.mob, damage, "arrow", "player" in arrow.shooter ? arrow.shooter.player : null, flight.from, push);
    else if (hit.player) this.options.onHurtPlayer(hit.player.id, by ? byDifficulty(damage, difficulty) : damage, "arrow", by ?? "Player", push);
    this.arrows.delete(arrow.id);
  }

  // Hurting and dying ---------------------------------------------------------------------------

  /**
   * Hurts a mob: by the hit window, flashing red, pushed back from where the hit came from; a hit animal
   * runs, a monster hit by a player goes after them. `byPlayer` is that player's id. Returns whether it landed.
   */
  hurt(mob: Mob, amount: number, source: string, byPlayer: string | null, from: Vec3 | null = null, push: Vec3 | null = null): boolean {
    if (!mob.alive || amount <= 0) return false;
    let dealt = amount;
    if (mob.invulnerable > 10) {
      if (amount <= mob.lastHurt) return false;
      dealt = amount - mob.lastHurt;
      mob.lastHurt = amount;
    } else {
      mob.lastHurt = amount;
      mob.invulnerable = 20;
    }
    mob.health -= dealt;
    mob.hurt = 10;
    if (mob.health > 0) this.sound(mob, "hurt");
    if (push) {
      const v = mob.velocity;
      v.x = v.x / 2 + push.x;
      v.z = v.z / 2 + push.z;
      if (mob.onGround) v.y = Math.min(8, v.y / 2 + push.y);
    }
    if (byPlayer) {
      mob.idle = 0;
      mob.hitByPlayer = mob.age;
      if (mob.info.hostile && from) mob.target = { id: byPlayer, position: from };
    }
    if (!mob.info.hostile) {
      mob.panic = 100;
      mob.panicFrom = from;
    }
    // Experience only for what a player killed (or hurt in the last five seconds)
    if (mob.health <= 0) this.die(mob, source, mob.age - mob.hitByPlayer < 100);
    return true;
  }

  /** A player's melee hit: damage, with knockback away from them. */
  strike(mob: Mob, damage: number, player: MobPlayer, knockback: number): boolean {
    const dx = mob.position.x - player.position.x;
    const dz = mob.position.z - player.position.z;
    const d = Math.hypot(dx, dz) || 1;
    return this.hurt(mob, damage, "player", player.id, player.position, { x: (dx / d) * knockback, y: 7, z: (dz / d) * knockback });
  }

  /** Dies: it falls over, drops what it drops (cooked if burning), and leaves experience if a player killed it. */
  private die(mob: Mob, _source: string, byPlayer: boolean): void {
    mob.dying = 1;
    mob.health = 0;
    this.sound(mob, "death");
    const stacks: ItemStack[] = [];
    for (const [name, lo, hi] of mob.info.drops) {
      const n = lo + Math.floor(this.random() * (hi - lo + 1));
      const cooked = mob.fire > 0 ? itemByName(`cooked_${name}`) : null;
      const item = cooked ?? itemByName(name);
      if (n > 0 && item !== null) stacks.push({ item, count: n, damage: 0 });
    }
    if (mob.kind === "sheep" && !mob.sheared) stacks.push({ item: Block.WhiteWool + mob.color, count: 1, damage: 0 });
    const p = mob.position;
    this.options.drops.spill(p.x - 0.5, p.y, p.z - 0.5, stacks);
    if (byPlayer) {
      const [lo, hi] = mob.info.xp;
      this.options.drops.spawnXp(p.x, p.y + 0.5, p.z, lo + Math.floor(this.random() * (hi - lo + 1)));
    }
  }

  /** A mob's sound (its kind's event: "entity.zombie.hurt"), from where it is. */
  private sound(mob: Mob, what: string): void {
    const p = mob.position;
    this.options.onSound?.(`entity.${mob.kind}.${what}`, p.x, p.y + mob.height / 2, p.z, mob.info.hostile ? "hostile" : "friendly");
  }

  private remove(mob: Mob): void {
    this.mobs.delete(mob.id);
    const key = this.chunkOf.get(mob.id);
    if (key !== undefined) this.markChunk(key);
    this.chunkOf.delete(mob.id);
  }

  /** Shears a sheep: 1 to 3 wool of its color. Returns whether it had wool to give. */
  shear(mob: Mob): boolean {
    if (mob.kind !== "sheep" || mob.sheared || !mob.alive) return false;
    mob.sheared = true;
    this.sound(mob, "shear");
    const p = mob.position;
    this.options.drops.spill(p.x - 0.5, p.y + 0.5, p.z - 0.5, [{ item: Block.WhiteWool + mob.color, count: 1 + Math.floor(this.random() * 3), damage: 0 }]);
    return true;
  }

  // Explosions ----------------------------------------------------------------------------------

  /**
   * An explosion: breaks the blocks it reaches (each dropping as if mined, one in `power` of them), and
   * hurts and pushes mobs and players by how near and exposed they are. `by` names what blew up.
   */
  explode(x: number, y: number, z: number, power: number, by: string | null): void {
    const w = this.world;
    const broken = blastedBlocks(w, x, y, z, power, this.random);
    for (const [bx, by_, bz] of broken) {
      const state = w.get(bx, by_, bz);
      if (state === Block.Air || STATE_BLOCK[state] === Block.Bedrock) continue;
      w.set(bx, by_, bz, Block.Air);
      if (this.random() < 1 / power) this.options.drops.spill(bx, by_, bz, dropsOf(state, null, this.random, true));
    }
    for (const mob of this.mobs.values()) {
      const blast = blastOn(w, x, y, z, power, mob);
      if (blast) this.hurt(mob, blast.damage, "explosion", null, { x, y, z }, blast.push);
    }
    for (const p of this.options.players()) {
      if (!p.targetable) continue;
      const blast = blastOn(w, x, y, z, power, { position: p.position, halfWidth: 0.3, height: 1.8 });
      if (blast) this.options.onHurtPlayer(p.id, byDifficulty(blast.damage, this.options.difficulty()), "explosion", by ?? "", blast.push);
    }
    this.options.onExplosion?.(x, y, z, power);
  }

  // Finding, seeing, saving ---------------------------------------------------------------------

  /** The nearest living mob a ray from (x, y, z) along unit (dx, dy, dz) meets within `reach`, and how far. */
  raycast(x: number, y: number, z: number, dx: number, dy: number, dz: number, reach: number): { mob: Mob; distance: number } | null {
    let best: { mob: Mob; distance: number } | null = null;
    const a = { x, y, z };
    const b = { x: x + dx * reach, y: y + dy * reach, z: z + dz * reach };
    for (const mob of this.mobs.values()) {
      if (!mob.alive) continue;
      const w = mob.halfWidth;
      const t = segmentHitsBox(a, b, { x: mob.position.x - w, y: mob.position.y, z: mob.position.z - w }, { x: mob.position.x + w, y: mob.position.y + mob.height, z: mob.position.z + w });
      if (t !== null && (!best || t * reach < best.distance)) best = { mob, distance: t * reach };
    }
    return best;
  }

  /** Whether a monster is within a few blocks of a point (a player can't sleep then). */
  monsterNear(x: number, y: number, z: number): boolean {
    for (const m of this.mobs.values()) if (m.info.hostile && m.alive && Math.abs(m.position.x - x) < 8 && Math.abs(m.position.z - z) < 8 && Math.abs(m.position.y - y) < 5) return true;
    return false;
  }

  /** The mobs and arrows within a range of a point, as guests see them. */
  views(x: number, z: number, range: number): MobView[] {
    const out: MobView[] = [];
    for (const m of this.mobs.values()) {
      const p = m.position;
      if (Math.abs(p.x - x) > range || Math.abs(p.z - z) > range) continue;
      const flags = (m.hurt > 0 ? Flag.Hurt : 0) | (m.fire > 0 ? Flag.Fire : 0) | (m.alive ? 0 : Flag.Dying) | (m.sheared ? Flag.Sheared : 0) | (m.fuse > 0 ? Flag.Swell : 0);
      const extra = m.kind === "sheep" ? m.color : m.kind === "creeper" ? m.fuse : m.dying;
      out.push([m.id, MOB_KINDS.indexOf(m.kind), round(p.x), round(p.y), round(p.z), round(m.yaw), round(m.headYaw), round(m.pitch), flags, extra]);
    }
    for (const a of this.arrows.values()) {
      const p = a.position;
      if (Math.abs(p.x - x) > range || Math.abs(p.z - z) > range) continue;
      out.push([a.id, ARROW, round(p.x), round(p.y), round(p.z), round(a.yaw), 0, round(a.pitch), a.stuck ? Flag.Stuck : 0, 0]);
    }
    return out;
  }

  /** Marks a chunk (by VoxelWorld.key) to be saved: an animal left or entered it. */
  private markChunk(key: number): void {
    const chunk = this.world.chunks.get(key);
    if (chunk) chunk.unsaved = true;
  }

  private trackChunk(mob: Mob): void {
    if (mob.info.hostile) return;
    const key = VoxelWorld.key(Math.floor(mob.position.x / CHUNK_SIZE), Math.floor(mob.position.z / CHUNK_SIZE));
    const was = this.chunkOf.get(mob.id);
    if (was === key) return;
    this.chunkOf.set(mob.id, key);
    if (was !== undefined) this.markChunk(was);
    this.markChunk(key);
  }

  /** The animals in a chunk as saves keep them, taken out (it is unloaded, its monsters with it) or not. */
  inChunk(cx: number, cz: number, take: boolean): SavedMob[] {
    const out: SavedMob[] = [];
    for (const m of [...this.mobs.values()]) {
      const p = m.position;
      if (Math.floor(p.x / CHUNK_SIZE) !== cx || Math.floor(p.z / CHUNK_SIZE) !== cz) continue;
      if (!m.info.hostile && m.alive) {
        const saved: SavedMob = { kind: m.kind, x: round(p.x), y: round(p.y), z: round(p.z), yaw: round(m.yaw), health: m.health };
        if (m.kind === "sheep") Object.assign(saved, { color: m.color, sheared: m.sheared });
        out.push(saved);
      }
      if (take) {
        this.mobs.delete(m.id);
        this.chunkOf.delete(m.id);
      }
    }
    if (take) {
      for (const a of [...this.arrows.values()]) if (Math.floor(a.position.x / CHUNK_SIZE) === cx && Math.floor(a.position.z / CHUNK_SIZE) === cz) this.arrows.delete(a.id);
      this.spawners.delete(VoxelWorld.key(cx, cz));
    }
    return out;
  }

  /** Puts saved animals back (their chunk was read). */
  restore(saved: readonly SavedMob[]): void {
    for (const s of saved) {
      if (!MOB_KINDS.includes(s.kind as MobKind) || ![s.x, s.y, s.z].every(Number.isFinite)) continue;
      const mob = this.spawn(s.kind as MobKind, s.x, s.y, s.z, Number(s.yaw) || 0);
      mob.health = Math.max(1, Math.min(mob.info.health, Number(s.health) || mob.info.health));
      if (mob.kind === "sheep") {
        mob.color = Math.max(0, Math.min(COLORS.length - 1, Math.floor(Number(s.color) || 0)));
        mob.sheared = s.sheared === true;
      }
    }
  }
}


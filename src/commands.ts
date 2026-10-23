import type { Vec3 } from "projector";
import { ITEMS, itemByName, type Item } from "./items.js";
import { MOB_KINDS, type MobKind } from "./mobs/kinds.js";
import { DIFFICULTIES, type Difficulty, type PlayMode } from "./vitals.js";

/** What commands can do to the game. */
export interface CommandContext {
  seed: string;
  /** Feet of the player giving the command. */
  position: Vec3;
  /** Tells the player something (in the chat). */
  say(text: string): void;
  setMode(mode: PlayMode): void;
  time(): number;
  setTime(ticks: number): void;
  teleport(x: number, y: number, z: number): void;
  /** The other players, by name, where they are. */
  players(): Array<{ name: string; position: Vec3 }>;
  give(item: Item, count: number): void;
  kill(): void;
  setSpawn(x: number, y: number, z: number): void;
  setDifficulty(d: Difficulty): boolean;
  summon(kind: MobKind, x: number, y: number, z: number): boolean;
  /** Sets the weather, if there is weather yet. */
  weather?(kind: "clear" | "rain" | "thunder"): boolean;
}

const DAY = 24000;
/** /time set's names, as Minecraft's. */
const TIMES: Readonly<Record<string, number>> = { day: 1000, noon: 6000, night: 13000, midnight: 18000 };

/** A coordinate as given: a number, or "~" and "~n" for the player's own and off from it. */
function coordinate(text: string | undefined, own: number): number | null {
  if (text === undefined) return null;
  if (text.startsWith("~")) {
    const off = text.length > 1 ? Number(text.slice(1)) : 0;
    return Number.isFinite(off) ? own + off : null;
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** x, y and z from three arguments (whole numbers are a block's middle, as Minecraft's). */
function position(args: readonly string[], from: Vec3): Vec3 | null {
  const x = coordinate(args[0], from.x);
  const y = coordinate(args[1], from.y);
  const z = coordinate(args[2], from.z);
  if (x === null || y === null || z === null) return null;
  const middle = (text: string, n: number): number => (!text.startsWith("~") && Number.isInteger(n) ? n + 0.5 : n);
  return { x: middle(args[0], x), y, z: middle(args[2], z) };
}

const HELP = [
  "/gamemode survival|creative|spectator",
  "/time set day|noon|night|midnight|<ticks>, /time add <ticks>, /time query daytime|day",
  "/tp <x> <y> <z>, /tp <player> (~ is where you are)",
  "/give <item> [count]",
  "/kill, /spawnpoint, /seed",
  "/difficulty peaceful|easy|normal|hard",
  "/summon <mob> [x y z]",
  "/weather clear|rain|thunder",
];

/**
 * Runs a command, as Minecraft's (without the "minecraft:" prefixes it allows): `text` starts with "/".
 * Says what happened, or what was wrong, through ctx.say.
 */
export function runCommand(text: string, ctx: CommandContext): void {
  const [name, ...args] = text.trim().slice(1).split(/\s+/);
  const p = ctx.position;
  switch (name) {
    case "help":
      for (const line of HELP) ctx.say(line);
      return;
    case "gamemode": {
      const mode = args[0] === "survival" || args[0] === "creative" || args[0] === "spectator" ? args[0] : null;
      if (!mode) return ctx.say("Usage: /gamemode survival|creative|spectator");
      ctx.setMode(mode);
      return ctx.say(`Set own game mode to ${mode[0].toUpperCase()}${mode.slice(1)} Mode`);
    }
    case "time": {
      const day = Math.floor(ctx.time() / DAY);
      if (args[0] === "set") {
        const t = TIMES[args[1]] ?? Number(args[1]);
        if (!Number.isFinite(t) || t < 0) return ctx.say("Usage: /time set day|noon|night|midnight|<ticks>");
        ctx.setTime(day * DAY + (t % DAY) + Math.floor(t / DAY) * DAY);
        return ctx.say(`Set the time to ${t}`);
      }
      if (args[0] === "add") {
        const t = Number(args[1]);
        if (!Number.isFinite(t) || t < 0) return ctx.say("Usage: /time add <ticks>");
        ctx.setTime(ctx.time() + t);
        return ctx.say(`Added ${t} to the time`);
      }
      if (args[0] === "query") {
        if (args[1] === "day") return ctx.say(`The day is ${day}`);
        return ctx.say(`The time is ${ctx.time() % DAY}`);
      }
      return ctx.say("Usage: /time set|add|query");
    }
    case "tp":
    case "teleport": {
      if (args.length === 1) {
        const other = ctx.players().find((o) => o.name.toLowerCase() === args[0].toLowerCase());
        if (!other) return ctx.say(`No player was found: ${args[0]}`);
        ctx.teleport(other.position.x, other.position.y, other.position.z);
        return ctx.say(`Teleported to ${other.name}`);
      }
      const to = position(args, p);
      if (!to) return ctx.say("Usage: /tp <x> <y> <z> or /tp <player>");
      ctx.teleport(to.x, to.y, to.z);
      return ctx.say(`Teleported to ${to.x.toFixed(1)}, ${to.y.toFixed(1)}, ${to.z.toFixed(1)}`);
    }
    case "give": {
      const item = args[0] ? itemByName(args[0].replace(/^minecraft:/, "")) : null;
      const count = args[1] === undefined ? 1 : Math.floor(Number(args[1]));
      if (item === null) return ctx.say(`Unknown item: ${args[0] ?? ""}`);
      if (!(count > 0) || count > 6400) return ctx.say("The count must be between 1 and 6400");
      ctx.give(item, count);
      return ctx.say(`Gave ${count} [${ITEMS[item].label}]`);
    }
    case "kill":
      ctx.kill();
      return;
    case "spawnpoint":
      ctx.setSpawn(p.x, p.y, p.z);
      return ctx.say(`Set the spawn point to ${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`);
    case "seed":
      return ctx.say(`Seed: [${ctx.seed}]`);
    case "difficulty": {
      const d = DIFFICULTIES.find((x) => x === args[0]);
      if (!d) return ctx.say("Usage: /difficulty peaceful|easy|normal|hard");
      if (!ctx.setDifficulty(d)) return ctx.say("The difficulty can't change in hardcore");
      return ctx.say(`The difficulty has been set to ${d[0].toUpperCase()}${d.slice(1)}`);
    }
    case "summon": {
      const kind = MOB_KINDS.find((k) => k === args[0]?.replace(/^minecraft:/, ""));
      if (!kind) return ctx.say(`Unknown mob: ${args[0] ?? ""} (${MOB_KINDS.join(", ")})`);
      const at = args.length >= 4 ? position(args.slice(1), p) : p;
      if (!at) return ctx.say("Usage: /summon <mob> [x y z]");
      if (!ctx.summon(kind, at.x, at.y, at.z)) return ctx.say("Mobs live where the world is hosted");
      return ctx.say(`Summoned new ${kind[0].toUpperCase()}${kind.slice(1)}`);
    }
    case "weather": {
      const kind = args[0] === "clear" || args[0] === "rain" || args[0] === "thunder" ? args[0] : null;
      if (!kind) return ctx.say("Usage: /weather clear|rain|thunder");
      if (!ctx.weather?.(kind)) return ctx.say("There is no weather yet");
      return ctx.say(`Set the weather to ${kind}`);
    }
    default:
      return ctx.say(`Unknown command: /${name ?? ""}. /help lists them`);
  }
}

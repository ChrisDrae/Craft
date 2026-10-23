#!/usr/bin/env node
// Copies the block and sky textures Craft uses out of your own Minecraft installation (or a resource pack zip) into
// textures/minecraft/, which git ignores and builds leave out: the textures are Mojang's, so they stay on
// your machine.
//
//   npm run textures                 the newest release in your .minecraft folder
//   npm run textures -- <file.zip>   a client jar or resource pack
//   MINECRAFT_JAR=<file> npm run textures
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const COLORS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"];
/** The block textures Craft draws (src/textures.ts TILES), plus the overlay tinted onto grass sides. */
const BLOCKS = [
  "grass_block_top",
  "grass_block_side",
  "grass_block_side_overlay",
  "dirt",
  "stone",
  "sand",
  "water_still",
  "oak_log",
  "oak_log_top",
  "oak_leaves",
  "oak_planks",
  "cobblestone",
  "bricks",
  "coal_ore",
  "iron_ore",
  "gold_ore",
  "bedrock",
  "torch",
  "glowstone",
  "gravel",
  "glass",
  "ice",
  "snow",
  "clay",
  "obsidian",
  "stone_bricks",
  "crafting_table_top",
  "crafting_table_side",
  "crafting_table_front",
  "furnace_top",
  "furnace_side",
  "furnace_front",
  "bookshelf",
  "ladder",
  "lava_still",
  "oak_door_top",
  "oak_door_bottom",
  "oak_trapdoor",
  "glass_pane_top",
  "dandelion",
  "poppy",
  "short_grass",
  "oak_sapling",
  "cactus_top",
  "cactus_side",
  "cactus_bottom",
  "grass_block_snow",
  "birch_log",
  "birch_log_top",
  "birch_leaves",
  "birch_planks",
  "spruce_log",
  "spruce_log_top",
  "spruce_leaves",
  "spruce_planks",
  "jungle_log",
  "jungle_log_top",
  "jungle_leaves",
  "jungle_planks",
  "acacia_log",
  "acacia_log_top",
  "acacia_leaves",
  "acacia_planks",
  "dark_oak_log",
  "dark_oak_log_top",
  "dark_oak_leaves",
  "dark_oak_planks",
  "sandstone",
  "sandstone_top",
  "sandstone_bottom",
  "copper_ore",
  "redstone_ore",
  "lapis_ore",
  "diamond_ore",
  "emerald_ore",
  "mossy_cobblestone",
  "mossy_stone_bricks",
  "cracked_stone_bricks",
  "spawner",
  "fern",
  "dead_bush",
  "sugar_cane",
  "cornflower",
  "oxeye_daisy",
  "allium",
  "azure_bluet",
  "blue_orchid",
  "lily_of_the_valley",
  "tall_grass_top",
  "tall_grass_bottom",
  "large_fern_top",
  "large_fern_bottom",
  "lily_pad",
  "pumpkin_side",
  "pumpkin_top",
  "furnace_front_on",
  "destroy_stage_0",
  "destroy_stage_1",
  "destroy_stage_2",
  "destroy_stage_3",
  "destroy_stage_4",
  "destroy_stage_5",
  "destroy_stage_6",
  "destroy_stage_7",
  "destroy_stage_8",
  "destroy_stage_9",
  ...COLORS.map((c) => `${c}_wool`),
  // Beds as block models (Minecraft 26 and later; before, Craft draws its own)
  ...COLORS.flatMap((c) => ["head_up", "head_east", "head_west", "foot_up", "foot_east", "foot_west", "foot_south"].map((f) => `${c}_bed_${f}`)),
  "bed_head_north",
  "bed_down",
  "melon_side",
  "melon_top",
  "brown_mushroom",
  "red_mushroom",
  "vine",
  "farmland",
  "farmland_moist",
  ...Array.from({ length: 8 }, (_, i) => `wheat_stage${i}`),
  ...[0, 1, 2, 3].flatMap((i) => [`carrots_stage${i}`, `potatoes_stage${i}`]),
  "pumpkin_stem",
  "attached_pumpkin_stem",
  "melon_stem",
  "attached_melon_stem",
  "redstone_dust_dot",
  "redstone_dust_line0",
  "redstone_dust_line1",
  "redstone_torch",
  "redstone_torch_off",
  "lever",
  "repeater",
  "repeater_on",
  "redstone_lamp",
  "redstone_lamp_on",
  "smooth_stone",
  "piston_top",
  "piston_top_sticky",
  "piston_side",
  "piston_bottom",
  "piston_inner",
  "observer_front",
  "observer_back",
  "observer_back_on",
  "observer_side",
  "observer_top",
  "hopper_outside",
  "hopper_inside",
  "hopper_top",
  "comparator",
  "comparator_on",
];
/** The item textures Craft draws (src/items.ts), saved as item_<name>. */
const ITEMS = [
  "stick",
  "coal",
  "charcoal",
  "raw_iron",
  "iron_ingot",
  "raw_gold",
  "gold_ingot",
  "raw_copper",
  "copper_ingot",
  "diamond",
  "emerald",
  "lapis_lazuli",
  "redstone",
  "flint",
  "string",
  "leather",
  "clay_ball",
  "brick",
  "glowstone_dust",
  "snowball",
  "paper",
  "book",
  "wheat",
  "apple",
  "bread",
  "melon_slice",
  "bowl",
  "mushroom_stew",
  "porkchop",
  "cooked_porkchop",
  "beef",
  "cooked_beef",
  "chicken",
  "cooked_chicken",
  "mutton",
  "cooked_mutton",
  "rotten_flesh",
  "spider_eye",
  "bone",
  "gunpowder",
  "feather",
  "egg",
  "arrow",
  "bow",
  "shears",
  "wheat_seeds",
  "carrot",
  "potato",
  "baked_potato",
  "pumpkin_seeds",
  "melon_seeds",
  "bone_meal",
  "slime_ball",
  "hopper",
  "comparator",
  ...["wooden", "stone", "iron", "golden", "diamond"].flatMap((m) => ["pickaxe", "axe", "shovel", "hoe", "sword"].map((t) => `${m}_${t}`)),
  ...["leather", "iron", "golden", "diamond"].flatMap((m) => ["helmet", "chestplate", "leggings", "boots"].map((p) => `${m}_${p}`)),
];
/** The status bar's sprites, by their path under gui/sprites/hud. */
const HUD = [
  "heart/container",
  "heart/container_blinking",
  "heart/container_hardcore",
  "heart/full",
  "heart/half",
  "heart/hardcore_full",
  "heart/hardcore_half",
  "food_empty",
  "food_full",
  "food_half",
  "armor_empty",
  "armor_full",
  "armor_half",
  "air",
  "air_bursting",
  "experience_bar_background",
  "experience_bar_progress",
];
const PHASES = ["full_moon", "waning_gibbous", "third_quarter", "waning_crescent", "new_moon", "waxing_crescent", "first_quarter", "waxing_gibbous"];
const TEXTURES = "assets/minecraft/textures/";
/** Every texture by the name it's saved under, with the paths it may have in the jar (newer versions first). */
const WANTED = new Map([
  ...BLOCKS.map((n) => [n, [`block/${n}.png`]]),
  ...ITEMS.map((n) => [`item_${n}`, [`item/${n}.png`]]),
  // The chest is drawn from its model's texture, orbs of experience cut from their sheet
  ["chest_entity", ["entity/chest/normal.png"]],
  ["experience_orb", ["entity/experience/experience_orb.png", "entity/experience_orb.png"]],
  // Mobs, in Minecraft's model layouts (the newest versions' names first)
  ["mob_zombie", ["entity/zombie/zombie.png"]],
  ["mob_skeleton", ["entity/skeleton/skeleton.png"]],
  ["mob_creeper", ["entity/creeper/creeper.png"]],
  ["mob_spider", ["entity/spider/spider.png"]],
  ["mob_pig", ["entity/pig/pig_temperate.png", "entity/pig/temperate_pig.png", "entity/pig/pig.png"]],
  ["mob_cow", ["entity/cow/cow_temperate.png", "entity/cow/temperate_cow.png", "entity/cow/cow.png"]],
  ["mob_sheep", ["entity/sheep/sheep.png"]],
  ["mob_sheep_wool", ["entity/sheep/sheep_wool.png", "entity/sheep/sheep_fur.png"]],
  ["mob_chicken", ["entity/chicken/chicken_temperate.png", "entity/chicken/temperate_chicken.png", "entity/chicken.png"]],
  ["mob_arrow", ["entity/projectiles/arrow.png"]],
  ["mob_slime", ["entity/slime/slime.png"]],
  ["mob_slime_outer", ["entity/slime/slime.png"]],
  // Players wear Minecraft's default skins
  ...["steve", "alex", "ari", "efe", "kai", "makena", "noor", "sunny", "zuri"].map((n) => [`mob_player_${n}`, [`entity/player/wide/${n}.png`, ...(n === "steve" ? ["entity/steve.png"] : [])]]),
  // Particles: smoke from large to small, splashes, a flame, a star, an explosion's puffs
  ...[...Array.from({ length: 8 }, (_, i) => `generic_${i}`), ...Array.from({ length: 4 }, (_, i) => `splash_${i}`), "flame", "critical_hit", "lava", "heart", "glint", ...Array.from({ length: 16 }, (_, i) => `explosion_${i}`)].map((n) => [`particle_${n}`, [`particle/${n}.png`]]),
  // Rain and snow falling
  ["weather_rain", ["environment/rain.png"]],
  ["weather_snow", ["environment/snow.png"]],
  // The status bar: hearts, food, armor, air and the experience bar (Minecraft 1.20.2 and later)
  ...HUD.map((n) => [`hud_${n.replaceAll("/", "_")}`, [`gui/sprites/hud/${n}.png`]]),
  ["sun", ["environment/celestial/sun.png", "environment/sun.png"]],
  ["clouds", ["environment/clouds.png"]],
  ...PHASES.map((p) => [`moon_${p}`, [`environment/celestial/moon/${p}.png`]]),
  // Before the moon came in separate files: all phases on one sheet
  ["moon_phases", ["environment/moon_phases.png"]],
]);
const PATHS = new Set([...WANTED.values()].flat().map((p) => TEXTURES + p));
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "textures", "minecraft");

/** The .minecraft folder of this platform. */
function minecraftDir() {
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), ".minecraft");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "minecraft");
  return join(homedir(), ".minecraft");
}

/** The client jar of the newest installed release (by release time), with its version name. */
function newestRelease() {
  const versions = join(minecraftDir(), "versions");
  if (!existsSync(versions)) return null;
  let best = null;
  for (const name of readdirSync(versions)) {
    const jar = join(versions, name, `${name}.jar`);
    const json = join(versions, name, `${name}.json`);
    if (!existsSync(jar) || !existsSync(json)) continue;
    let info;
    try {
      info = JSON.parse(readFileSync(json, "utf8"));
    } catch {
      continue;
    }
    if (info.type !== "release") continue;
    if (!best || info.releaseTime > best.time) best = { jar, version: name, time: info.releaseTime };
  }
  return best;
}

/** Files of a zip (jar), by name: just enough of the format to read stored and deflated entries. */
function readZip(file, wanted) {
  const zip = readFileSync(file);
  // The end of central directory record sits at the end, before a comment of up to 64 KiB
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error(`${file} is not a zip file`);
  const entries = zip.readUInt16LE(end + 10);
  let p = zip.readUInt32LE(end + 16);
  if (p === 0xffffffff) throw new Error(`${file} is a ZIP64 archive, which this importer doesn't read`);
  const out = new Map();
  for (let e = 0; e < entries; e++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error(`${file}: broken central directory`);
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLength = zip.readUInt16LE(p + 28);
    const extraLength = zip.readUInt16LE(p + 30);
    const commentLength = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLength);
    p += 46 + nameLength + extraLength + commentLength;
    if (!wanted(name)) continue;
    // The local header repeats the name and has its own extra field
    const data = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(data, data + size);
    if (method === 0) out.set(name, Buffer.from(raw));
    else if (method === 8) out.set(name, inflateRawSync(raw));
    else throw new Error(`${file}: ${name} uses compression method ${method}`);
  }
  return out;
}

const arg = process.argv[2] ?? process.env.MINECRAFT_JAR;
const source = arg ? { jar: arg, version: basename(arg).replace(/\.(jar|zip)$/i, "") } : newestRelease();
if (!source) {
  console.error(`No Minecraft release found in ${join(minecraftDir(), "versions")}.`);
  console.error("Start a release once in the Minecraft launcher, or pass a client jar or resource pack: npm run textures -- <file>");
  process.exit(1);
}
if (!existsSync(source.jar)) {
  console.error(`${source.jar} doesn't exist.`);
  process.exit(1);
}

const files = readZip(source.jar, (name) => PATHS.has(name));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const found = [];
for (const [name, paths] of WANTED) {
  const png = paths.map((p) => files.get(TEXTURES + p)).find((f) => f);
  if (!png) continue;
  writeFileSync(join(OUT, `${name}.png`), png);
  found.push(name);
}
// Separate moon phases make the old sheet unnecessary
const phases = PHASES.every((p) => found.includes(`moon_${p}`));
const missing = [...WANTED.keys()].filter((n) => !found.includes(n) && !(n === "moon_phases" && phases) && !(n.startsWith("moon_") && n !== "moon_phases" && found.includes("moon_phases")));
writeFileSync(join(OUT, "manifest.json"), `${JSON.stringify({ source: basename(source.jar), version: source.version, textures: found }, null, 2)}\n`);
console.log(`Imported ${found.length} textures from ${source.jar} into ${OUT}.`);
if (missing.length > 0) console.log(`Not in it (Craft draws its own instead): ${missing.join(", ")}`);

// Sounds: from the asset index of the version (an installation's .minecraft/assets), not the jar. The events
// Craft plays, by Minecraft's names (sounds.json), with the files they pick from.
const SOUND_GROUPS = ["stone", "wood", "gravel", "grass", "sand", "snow", "wool", "glass", "ladder", "metal"];
const SOUND_EVENTS = [
  ...SOUND_GROUPS.flatMap((g) => ["break", "place", "step", "hit", "fall"].map((a) => `block.${g}.${a}`)),
  ...["hurt", "death", "attack.strong", "attack.weak", "attack.crit", "attack.nodamage", "levelup", "burp", "splash", "small_fall", "big_fall"].map((e) => `entity.player.${e}`),
  "entity.generic.eat",
  "entity.generic.explode",
  "entity.generic.extinguish_fire",
  "entity.item.pickup",
  "entity.experience_orb.pickup",
  "entity.arrow.shoot",
  "entity.arrow.hit",
  "entity.arrow.hit_player",
  "block.chest.open",
  "block.chest.close",
  "block.wooden_door.open",
  "block.wooden_door.close",
  "block.wooden_trapdoor.open",
  "block.wooden_trapdoor.close",
  "block.furnace.fire_crackle",
  "block.lava.pop",
  "block.lava.ambient",
  "block.water.ambient",
  "ui.button.click",
  ...["zombie", "skeleton", "spider", "pig", "cow", "sheep", "chicken"].flatMap((m) => ["ambient", "hurt", "death", "step"].map((e) => `entity.${m}.${e}`)),
  "entity.skeleton.shoot",
  "entity.creeper.primed",
  "entity.creeper.hurt",
  "entity.creeper.death",
  "entity.sheep.shear",
  "entity.chicken.egg",
  "ambient.cave",
  "weather.rain",
  "weather.rain.above",
  "entity.lightning_bolt.thunder",
  "entity.lightning_bolt.impact",
  "item.hoe.till",
  "item.bone_meal.use",
  "item.crop.plant",
  "block.crop.break",
  "block.lever.click",
  "block.stone_button.click_on",
  "block.stone_button.click_off",
  "block.wooden_button.click_on",
  "block.wooden_button.click_off",
  "block.stone_pressure_plate.click_on",
  "block.stone_pressure_plate.click_off",
  "block.wooden_pressure_plate.click_on",
  "block.wooden_pressure_plate.click_off",
  "block.piston.extend",
  "block.piston.contract",
  "block.comparator.click",
  ...["jump", "squish", "hurt", "death"].flatMap((e) => [`entity.slime.${e}`, `entity.slime.${e}_small`]),
  "entity.slime.attack",
  "music.game",
  "music.creative",
];
/** Music tracks are large: this many per music event. */
const MUSIC_TRACKS = 8;

/** The asset index of a version installed in .minecraft, as { objects }, or null. */
function assetIndex(version) {
  const json = join(minecraftDir(), "versions", version, `${version}.json`);
  if (!existsSync(json)) return null;
  const id = JSON.parse(readFileSync(json, "utf8")).assetIndex?.id;
  const file = id && join(minecraftDir(), "assets", "indexes", `${id}.json`);
  return file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

function importSounds() {
  const index = assetIndex(source.version);
  if (!index) {
    console.log(`No sounds: ${source.version} isn't installed in ${minecraftDir()} (Craft makes its own).`);
    return;
  }
  const object = (name) => {
    const o = index.objects[`minecraft/${name}`];
    return o ? join(minecraftDir(), "assets", "objects", o.hash.slice(0, 2), o.hash) : null;
  };
  const soundsFile = object("sounds.json");
  if (!soundsFile || !existsSync(soundsFile)) return;
  const all = JSON.parse(readFileSync(soundsFile, "utf8"));
  // An event's sounds, events it refers to followed
  const resolve = (event, depth = 0) => {
    const entry = all[event];
    if (!entry || depth > 4) return [];
    return entry.sounds.flatMap((s) => {
      const o = typeof s === "string" ? { name: s } : s;
      if (o.type === "event") return resolve(o.name.replace(/^minecraft:/, ""), depth + 1);
      return [{ file: o.name.replace(/^minecraft:/, ""), volume: o.volume ?? 1, pitch: o.pitch ?? 1, weight: o.weight ?? 1, stream: o.stream ?? false }];
    });
  };
  const events = {};
  let files = 0;
  let bytes = 0;
  for (const event of SOUND_EVENTS) {
    let sounds = resolve(event);
    if (event.startsWith("music.")) sounds = sounds.slice(0, MUSIC_TRACKS);
    const kept = [];
    for (const s of sounds) {
      const from = object(`sounds/${s.file}.ogg`);
      if (!from || !existsSync(from)) continue;
      const to = join(OUT, "sounds", `${s.file}.ogg`);
      if (!existsSync(to)) {
        mkdirSync(dirname(to), { recursive: true });
        const data = readFileSync(from);
        writeFileSync(to, data);
        files++;
        bytes += data.length;
      }
      kept.push(s);
    }
    if (kept.length > 0) events[event] = kept;
  }
  writeFileSync(join(OUT, "sounds.json"), `${JSON.stringify({ version: source.version, events }, null, 1)}
`);
  console.log(`Imported ${files} sounds (${Math.round(bytes / 1048576)} MB) for ${Object.keys(events).length} events.`);
}

importSounds();

#!/usr/bin/env node
// Copies the block textures Craft uses out of your own Minecraft installation (or a resource pack zip) into
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

/** The textures Craft draws (src/textures.ts TILES), plus the overlay tinted onto grass sides. */
const NAMES = [
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
];
const PREFIX = "assets/minecraft/textures/block/";
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

const files = readZip(source.jar, (name) => name.startsWith(PREFIX) && NAMES.includes(name.slice(PREFIX.length, -4)) && name.endsWith(".png"));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const found = [];
for (const name of NAMES) {
  const png = files.get(`${PREFIX}${name}.png`);
  if (!png) continue;
  writeFileSync(join(OUT, `${name}.png`), png);
  found.push(name);
}
const missing = NAMES.filter((n) => !found.includes(n));
writeFileSync(join(OUT, "manifest.json"), `${JSON.stringify({ source: basename(source.jar), version: source.version, textures: found }, null, 2)}\n`);
console.log(`Imported ${found.length} of ${NAMES.length} textures from ${source.jar} into ${OUT}.`);
if (missing.length > 0) console.log(`Not in it (Craft draws its own instead): ${missing.join(", ")}`);

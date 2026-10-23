# Craft roadmap

A plan for giving Craft Minecraft's principal features, save games included. Written on 2026-10-22 against
`feature/textures` (7a6fdea).

- [Where Craft stands](#where-craft-stands) and the [principles](#principles) every phase follows
- [1. Feature inventory](#1-feature-inventory): Minecraft's features, what Craft has, and the phase for the rest
- [2. Phases at a glance](#2-phases-at-a-glance) and [3. the phases](#3-phases) in build order
- [4. What Projector needs](#4-what-projector-needs): rendering features that belong in the framework
- [5. Decisions](#5-decisions)

## Where Craft stands

- Seeded, endless heightmap terrain 64 blocks high: oceans with sand beaches, stone cliffs, coal, iron and gold
  in the stone, bedrock, oak trees.
- 14 block types, one byte per block, no block states (orientation, levels). Water stands still.
- Walking, sprinting, jumping, swimming and climbing out of water, with box collision against full blocks.
- Breaking and placing instantly within 6 blocks, from a 9-slot hotbar of blocks.
- WebGL: a textured mesh per chunk, cut-out leaves, translucent water, a 96-block view at 60 fps. A Canvas 2D
  fallback with flat colors. Minecraft's own textures when imported (`npm run textures`).
- **Nothing is saved:** a reload starts the world over. Chunks are never unloaded either, so a long walk grows
  memory without bound.

## Principles

- **Every phase ends playable**, with `npm run check` green and no half-wired features left in between.
- **Saves come early.** From Phase 1 on, each feature that adds state (inventories, time, mobs) adds it to the
  save format in the same phase, under a format version with a migration.
- **Data, not code paths.** Blocks, items, recipes and mobs are registry entries with properties; behavior is
  small handlers attached to them.
- **Headless tests** for every system, like `tests/water.test.ts`: the world, ticks, physics, AI and saves run
  in Node without a DOM. This also keeps the simulation movable to a worker, or a server one day.
- **A performance budget:** 60 fps at the default view, and no frame over 16 ms from chunk work while moving.
  Measured in Chrome at the end of each phase (standing still, and flying at 25 blocks/s).
- **Mojang's assets stay local.** Textures today, and sounds and entity textures later, are imported from the
  player's own installation into git-ignored folders and never bundled. Craft always has fallbacks of its own.
- **Projector grows where it's general.** Rendering any 3D app could use (vertex colors, light maps, sky) goes
  into Projector as requirements; Minecraft's rules stay in Craft.

## 1. Feature inventory

✓ have · ◐ partly · a number is the phase that adds it · L later · — not planned

| Area | Minecraft feature | Craft today | Phase |
| --- | --- | --- | --- |
| World | Endless seeded terrain | ◐ heightmap hills, mountains, oceans | 4 (3D shapes, overhangs) |
| | Build height | 0–63 | 0 (0–255) |
| | Biomes | — | 4 (about 15) |
| | Caves, ravines, aquifers | — | 4 |
| | Ores by depth | ◐ coal, iron, gold | 4 (+ copper, redstone, lapis, diamond, emerald) |
| | Trees and plants | ◐ oak | 4 |
| | Structures | — | 4 (dungeons, wells), L (villages) |
| | Nether, End | — | L, — |
| Blocks | Block types (about 1,000 in Minecraft) | 14 | 3 (about 60), then as needed |
| | Block states: orientation, levels, halves | — | 0 |
| | Shapes: slabs, stairs, fences, doors, torches, plants | — | 3 |
| | Cut-out and translucent blocks | ◐ leaves, water | 3 |
| | Flowing water and lava | ◐ still water | 3 |
| | Falling sand and gravel | — | 3 |
| | Animated textures (water, lava) | — | 3 |
| | Crafting table, furnace, chest, bed, door, ladder | — | 3, 5, 6 |
| Light and sky | Sky light and block light, levels 0–15 | — (sun shading only) | 2 |
| | Smooth lighting, ambient occlusion | — | 2 |
| | Day and night, sun, moon, stars, clouds | — (always noon) | 2 |
| | Rain, snow, thunderstorms | — | 9 |
| Player | Walk, sprint, jump, swim | ✓ | |
| | Sneak, climb ladders, fly in creative | — | 8, 3, 6 |
| | Mining with break times and cracks | ◐ instant | 5 |
| | Placing with orientation | ◐ cubes only | 3 |
| | Hand, held item, third person | — | 8 |
| Items | Inventory: 36 slots, armor, off-hand | ◐ 9-slot block hotbar | 5 |
| | Crafting 2×2 and 3×3 | — | 5 |
| | Tools in tiers, durability | — | 5 |
| | Smelting | — | 5 |
| | Food, armor | — | 6 |
| | Enchanting, anvils, brewing | — | L |
| Survival | Health, damage, death, respawn | — | 6 |
| | Hunger and saturation, air and drowning | — | 6 |
| | Experience | — | 6 |
| | Game modes, difficulty | — (creative-like) | 6 |
| Mobs | Passive animals | — | 7 |
| | Monsters spawning in the dark | — | 7 |
| | AI and pathfinding | — | 7 |
| | Combat: melee, bows, knockback, explosions | — | 7 |
| | Breeding, taming | — | 9, L |
| | Villagers and trading | — | L |
| Simulation | Game ticks: scheduled and random | — | 0 |
| | Growth, spreading, leaf decay, farming | — | 9 |
| | Redstone | — | 9 (basics), L |
| | Fire | — | L |
| | Boats, minecarts, horses | — | L |
| Saves and UI | Several worlds, saving, autosave | — (lost on reload) | 1 |
| | Title, world list and pause menus | ◐ start overlay | 1 |
| | Settings and key bindings | ◐ URL parameters | 1, 8 |
| | HUD: hearts, hunger, air, XP | ◐ hotbar | 6 |
| | Debug screen (F3) | — (removed on request) | 8 (hidden until F3) |
| | Chat and commands | — | 8 |
| | Sound and music | — | 8 |
| | Particles | — | 8 |
| | Signs, books, maps, paintings | — | L |
| | Advancements, statistics | — | — |
| | Multiplayer | — | — (see decision 4) |
| Rendering | Textured blocks | ✓ (Minecraft's when imported) | |
| | Render distance | ✓ 96 blocks, up to 160 | |

## 2. Phases at a glance

| Phase | Theme | Size | Needs |
| --- | --- | --- | --- |
| 0 | Foundations: block states, taller chunks, unloading, ticks, entities, a generation worker | L | |
| 1 | Worlds and save games | M | 0 |
| 2 | Light, day and night, sky | L | 0; Projector R12–R14 |
| 3 | Block shapes, more blocks, fluids | L | 0, 2 |
| 4 | Terrain 2.0: biomes, caves, structures | L | 3 |
| M | Multiplayer: friends join a host's session | L | 4 |
| 5 | Items, inventory, crafting, tools | L | 3 |
| 6 | Survival and game modes | M | 5 |
| 7 | Mobs and combat | L | 6 |
| 8 | Feel: sound, particles, hand, camera, UI | M | parts any time |
| 9 | Farming, weather, redstone basics | L | 5, 7 |
| L | Later: Nether, enchanting, brewing, villagers, transport | | |

Sizes are relative effort (S, M, L), not dates. Each phase is planned in detail when it starts.

## 3. Phases

### Phase 0: Foundations (L)

**Done on 2026-10-22.** What changed against the plan below:
- Faces are built per section, but meshes stay one per chunk column: rebuilding a column's mesh from its
  sections' faces takes 0.2 ms, and it keeps the draw calls where they were (61 at a 96-block view).
- A section of nothing but opaque blocks is scanned only on its outer layer, so face building stays at
  0.4 ms per chunk on the four times taller world (0.39 ms before).
- The registry has only the properties something uses so far (solidity, opacity, shapes, looks, the log's
  axis); hardness, tools, drops and light come with the phases that use them.
- Logs already lie along the face they're placed against (from Phase 3), to put the states to real use.
- Entities don't belong to chunks yet: saving is the first thing that needs it, so it moves to Phase 1.
- Projector's R16 and R17 aren't needed yet: meshing stays on the main thread, and memory stays bounded.
- Measured in Chrome (RTX 5070): flying at 25 blocks/s, a median frame of 0.3 ms and at most 3.2 ms (3.8 ms
  before); at 50 blocks/s for 2,000 blocks, at most 4.8 ms, 210–217 chunks loaded all the way and a heap
  between 63 and 96 MB that doesn't grow. Generation takes about 2 ms per chunk, in the worker.

Everything later builds on these, and the save format (Phase 1) should be written against them instead of
migrating from today's format.

- **Block registry and states** (`src/blocks.ts`): every block is a named entry (`oak_log`) with its
  properties: solidity, opacity class (opaque, cut-out, translucent, none), hardness, tool and harvest level,
  drops, light emission and filtering, model, textures per face, sound group, gravity, replaceable, flammable.
  States (`oak_log[axis=x]`, `water[level=3]`) get dense numeric ids at startup and chunks store those. Saves
  store names, so ids can change between versions.
- **Chunk format v2** (`src/chunk.ts`, `src/world.ts`): `Uint16Array` state ids, 0–255 high in 16 sections of
  16³, sea level 63. Per-section block counts make empty sections free; light arrays per section are filled
  in Phase 2. `world.get` and `world.set` keep their signatures; the generator scales to the new height.
- **Section meshing** (`src/chunkMesh.ts`, `src/terrain.ts`): faces and meshes per section, so an edit
  rebuilds 16³ blocks instead of the column, and the face packing loses its 6-bit height limit. If a draw call
  per section costs too much, sections of a column are merged into one mesh (measure first).
- **Chunk lifecycle:** generating, loaded, meshed, unloaded. Chunks beyond the load radius plus a margin are
  unloaded, after saving from Phase 1 on.
- **Generation in a worker** (`src/worker/`): the generator is a pure function of seed, generator version and
  chunk position, so it moves to a Web Worker as it is; block arrays come back as transferables, requested
  nearest first. Meshing stays on the main thread (0.5 ms per chunk today) unless measurements say otherwise.
- **Game ticks** (`src/ticks.ts`): Minecraft's 20 ticks per second, on top of Projector's fixed steps.
  Scheduled ticks (fluids, falling blocks, redstone) in a queue ordered by tick and insertion; random ticks
  (3 random blocks per section per tick) for growth and decay. Deterministic, so tests can step them.
- **Entities** (`src/entity.ts`): the player's box physics (`moveAxis`, gravity, water) becomes an `Entity`
  base shared by the player, dropped items, falling blocks and mobs. Entities belong to the chunk they are in,
  for saving and unloading.
- **Block shapes in collision and picking** (`src/collision.ts`, `src/raycast.ts`): blocks report boxes (a
  full cube by default), so slabs, stairs, doors and plants can collide and be targeted precisely.
- **Done when:** today's game plays the same on the new format at 256 blocks high; memory stays flat flying
  2,000 blocks; walking costs no more frame time than today; generation runs in the worker.
- **Tests:** state ids round trip by name; v2 get and set across sections; the worker and the main thread
  generate identical chunks; tick ordering; today's collision tests on the entity base.

### Phase 1: Worlds and save games (M)

**Done on 2026-10-22.** What changed against the plan below:
- Each world plays in a page of its own (`?world=<id>`); quitting loads the title page. That frees the WebGL
  context, the worker and every listener without teardown code, for about a second of loading.
- New chunks come from the worker already encoded and compressed for saving, so a save only encodes chunks
  the player changed on the main thread. Before that, the first save of a new world blocked for 45 ms (168
  chunks); now 0.2 ms, 8 ms in all, and no frame runs long.
- A saved chunk takes about 0.9 KB (the estimate was 10 KB): a world explored for a while is a few MB.
- Chunk records don't hold entities yet. The first entity that must be saved (falling blocks, Phase 3) adds
  them, with a format bump, a migration and a fixture.
- Game mode, difficulty and weather join the world's record with the phases that add them.
- The store is tested on IndexedDB itself (`fake-indexeddb` in Node), and `tests/fixtures/format-1.craftworld`
  is the first saved-world fixture.

- **Menus** (DOM, `src/ui/`): a title screen and a world list showing name, seed, last played and size.
  Create a world (name and seed; game mode from Phase 6), play, rename, duplicate, delete (with a
  confirmation), export to a file and import one. Esc opens a pause menu: back to game, options, save and quit
  to title. `?seed=` stays as a quick way into a fresh world.
- **Entities in chunks:** an entity is saved and unloaded with the chunk it stands in (moved here from
  Phase 0, then on to Phase 3: see above); the player is saved apart.
- **Store** (`src/save/`): a `WorldStore` interface, implemented on IndexedDB for the browser and in memory
  for tests. The IndexedDB database `craft` holds:
  - `worlds`: id, name, seed, format version, generator version, created and last played, game mode,
    difficulty, time of day, weather, world spawn.
  - `players`, one per world: position, rotation, velocity, health, hunger, air, XP, inventory, selected slot,
    game mode, spawn point. Each field arrives with the phase that adds it.
  - `chunks`, keyed by world and position: a palette of state names, blocks as indices into it (8 or 16 bits),
    light, block entities (chest contents, furnace progress), entities, pending scheduled ticks, and the
    generator version that made it. Compressed with `CompressionStream("deflate-raw")`, which Node has too.
- **Which chunks are saved:** every generated chunk, as in Minecraft. Saving only edited chunks is smaller,
  but a changed generator would then regenerate untouched land differently, with seams around every edit.
  The size per chunk is to be measured in this phase (estimated around 10 KB).
- **When:** edits mark chunks unsaved. An autosave every 30 seconds writes the unsaved chunks, the player and
  the world metadata in one transaction; so do pausing, quitting, unloading a chunk and, as far as the browser
  allows, hiding the tab. Closing the tab loses at most the time since the last autosave.
- **Safety:** `navigator.storage.persist()` is requested at the first save so the browser doesn't evict worlds
  when space runs low; a Web Lock per world stops two tabs from writing the same world; the format version
  comes with migrations, tested against a saved fixture of every older version.
- **Export file** (`.craftworld`): a small binary container (magic number, version, a JSON header with the
  metadata, the player and a chunk index, then the chunk records), downloaded on a click and imported through
  a file picker.
- **Settings** (render distance, renderer, FOV, mouse sensitivity, later volume and key bindings) move to
  `localStorage`; the URL parameters remain as overrides.
- **Done when:** after building something and reloading, everything is where it was, the player included; two
  worlds stay independent; export, delete and import give back the same world.
- **Tests:** chunk and player serialization round trips, the store contract on the memory store, migrations
  from fixtures, autosave timing with a fake clock.

### Phase 2: Light, day and night, sky (L)

**Done on 2026-10-22.** What changed against the plan below:
- Saves don't keep light: it follows from the blocks. The worker lights every chunk it generates on its own,
  a saved chunk is lit as it's read (0.2 ms), and a chunk's light is joined with its neighbors' when it
  enters the world. A test checks that light after hundreds of random edits equals the light of the same
  blocks lit from scratch.
- Missing chunks count as dark, so no light leaks in from the edge of the loaded world.
- Projector got R12-R14 (corner colors, a second UV set with light maps, materials outside fog and depth,
  additive blending) in version 0.4.0. Terrain is unlit by the scene's lights: face shading and ambient
  occlusion are in the corner colors, light levels in the second UVs, and the day in the light map.
- Canvas 2D shades each face by the light in front of it (8 steps, warmer where torches light it more than
  the sky) and follows the day through fog and background; it has no sky objects, as decided.
- Light filters: leaves and water dim light by one more level per block than air; water is dark below
  about seven blocks.
- Measured in Chrome: meshing takes 0.42 ms per chunk (0.17 before, for the light and occlusion per
  corner); flying at 25 blocks/s, at most 5.8 ms a frame (3.2 before), at 50 blocks/s 7.1 ms; 60 fps
  throughout. Canvas 2D: 60 fps, 2.9 ms a frame.

- **Light levels** (`src/light.ts`): sky light (15 straight down from the sky, 1 less per block sideways and
  through leaves or water) and block light from emitters (torch 14, glowstone and lava 15), 0–15 per block in
  the section light arrays. Flood-filled when a chunk is generated (in the worker) and updated on edits with
  the usual add and remove queues, across chunk borders.
- **First light sources:** torches (on the floor and on walls, a small model of their own) and glowstone.
- **Smooth lighting and ambient occlusion** (`src/chunkMesh.ts`): each face corner gets the average light of
  the four blocks around it and an occlusion factor from the three neighbors that can shade it. This needs
  per-corner data in Projector meshes (R12, R13).
- **Day and night:** a 20-minute day (24,000 ticks), saved with the world. Light reaches the shader as levels;
  a light map (a 16×16 texture indexed by block light and sky light, R13) turns them into brightness and is
  recomputed as the time changes, so night falls without remeshing anything. The directional sun light
  follows the sun; sky color, fog color and the hemisphere light follow the time.
- **Sky:** a gradient, the sun and the moon with its phases, stars at night and drifting clouds, as unlit
  meshes that move with the camera and ignore fog (R14). They use `environment/sun.png`, `moon_phases.png`
  and `clouds.png` when imported, and drawn ones otherwise.
- **Darkness:** caves and deep water get dark from light levels instead of today's fixed fog.
- **Done when:** a torch in a cave lights a round area that falls off level by level; the sun sets and rises;
  night is dark and starry; nothing remeshes as time passes.
- **Tests:** sky light under an overhang, a torch placed and removed, light across a chunk border, light-map
  values over a day.

### Phase 3: Block shapes, more blocks, fluids (L)

**Done on 2026-10-22.** What changed against the plan below:
- Models are in `src/shapes.ts`: every state's quads (from boxes, or crossed planes) are built once at
  startup, with its collision and selection boxes. Which sides a state covers (for culling) is rasterized
  from its quads; which sides are sturdy (for torches, plants and fence connections) from its collision
  boxes, so glass and leaves hold torches as in Minecraft while hiding nothing.
- Block updates (`src/updates.ts`): a change updates the block and its six neighbors, as in Minecraft:
  fences, panes and walls connect, stairs take their corner shapes (Minecraft's rule), blocks that lose
  their support come off (a door's two halves together), and fluids and sand are scheduled to move. As in
  Minecraft, a block only checks its support when a neighbor changes, not when it is put in place.
- 82 blocks: the shapes in oak, stone, cobblestone, brick and stone brick, 16 colors of wool and carpet,
  gravel, glass, ice, snow, clay, obsidian, crafting table, furnace, bookshelf, ladder, lava, flowers, short
  grass, a sapling and cactus. The chest and the bed wait for what they're for (Phases 5 and 6); fence gates,
  stained glass and farmland (Phase 9) for later.
- Fluids follow Minecraft's spreading code closely, down to its quirks: a source in midair spreads a block to
  each side before falling, so it makes a plus-shaped waterfall. Flowing water uses the still texture on its
  sloped surface (no `water_flow` yet). Currents push the player; lava is slower to move in than water.
- Sand and gravel fall by scheduled ticks (a block a tick, 20 a second) instead of as entities: no falling
  animation yet, but nothing to save between ticks.
- Light gets into slabs and stairs but not through them (Minecraft's light occlusion by shape, simplified),
  so their faces and the faces next to them aren't black, and a slab roof keeps the house below dark.
- Ladders came from Phase 8: climbing while pushing into them or holding Space, sliding down slowly otherwise.
- E opens a list of all blocks to put one into the hotbar, and the middle button picks the block aimed at.
  The hotbar is saved: save format 2, with a migration that gives older players the default hotbar and a
  fixture of its own.
- Measured in Chrome: meshing 0.47 ms per chunk (0.42 before); flying at 25 blocks/s at most 5.1 ms a frame,
  at 50 blocks/s 5.6 ms; 60 fps throughout. Canvas 2D: 60 fps, 3.4 ms a frame, every shape drawn, fluids
  flat per block.

- **Models** (`src/models.ts`): a block model is a list of boxes with textures and UVs per face, plus culling
  rules (a face is hidden only by a neighbor that covers it completely). Shapes: cube, cross (flowers, tall
  grass, saplings), torch, slab (bottom, top, double), stairs (with corner shapes), fence and wall
  (connecting), glass pane, door (two blocks, opens), trapdoor, ladder, carpet, snow layer, cactus, farmland.
- **Placement:** logs along the clicked axis, stairs and doors facing the player, top or bottom slabs by where
  the face was hit, torches on walls. The right button opens doors, trapdoors and gates.
- **Transparency:** opaque; cut-out (leaves, glass, plants: alpha-tested in the solid mesh); translucent
  (water, ice, stained glass: the sorted translucent mesh).
- **About 60 blocks:** the shapes above in oak, stone, cobblestone and brick; gravel, glass, colored wool,
  ice, snow, clay, obsidian, glowstone, crafting table, furnace, chest, bed, ladder.
- **Fluids:** water and lava with levels (a source plus 7 flowing levels for water, 3 for lava), falling
  columns, Minecraft's spreading rule (toward the nearest way down within 4 blocks), new water sources between
  two sources, and lava meeting water turning into obsidian, cobblestone or stone. Sloped surfaces from the
  corner heights, flowing textures, currents that push entities. Water updates every 5 ticks, lava every 30.
- **Animated textures:** water and lava frames, by updating their atlas tiles (`Texture.markDirty`).
- **Gravity blocks:** sand and gravel fall as entities and land as blocks.
- **Done when:** a house of planks, stairs and slabs with glass windows and a door; a torch-lit room; water
  poured on a hill runs down and pools; lava meeting water makes cobblestone.
- **Tests:** culling between shapes, placement states, fluid spreading stepped tick by tick on fixed layouts,
  falling blocks.

### Phase 4: Terrain 2.0 (L)

**Done on 2026-10-22.** What changed against the plan below:
- 18 biomes: the 15 planned and dark forest, frozen river and frozen ocean. Climate is sampled at density
  points 4 blocks apart (as Minecraft's biomes are) and each column takes a nearby point's biome with a
  little jitter, so borders aren't square. Chunks store a biome per column (save format 3); chunks from
  before are plains, as they were made.
- Biome colors blend over 6 x 6 columns around each corner. Grass, leaves, ferns, sugar cane and water are
  stored gray (Minecraft's own are) and colored per corner by the mesh; birch and spruce leaves and lily
  pads have fixed colors. Grass block sides get Minecraft's tinted overlay as a second quad, drawn over the
  first (WebGL's depth test lets the second through). Snow on grass shows on its sides (`snowy`).
- Shape: Minecraft's density on 4 x 8 x 4 points, interpolated, from splines of the climate: coasts, hills,
  rivers in valleys, mountains with cliffs and overhangs up to about y 235, swamps at the water line.
- Caves: noise caves only (caverns and tunnels, some opening to the surface) and noise ravines instead of
  carvers, so they meet across chunk borders by construction; lava below y 10. **No aquifers:** caves are
  dry, and are kept from touching the sea and rivers so these don't drain into them.
- Ores by depth as measured over 24 land chunks: coal (median y 59), copper (48), iron (35), gold (17),
  redstone and lapis low, diamonds below 16 at about 4 per chunk, emeralds single in mountains. No
  deepslate.
- Trees: oak, big oak, swamp oak, birch, spruce, jungle (and 2 x 2 giant ones), acacia, dark oak (2 x 2).
  Plants: grass, tall grass, ferns, large ferns, eight flowers, dead bushes, cacti, sugar cane by water,
  lily pads on swamps, pumpkins. Snow on cold ground and on peaks above y 150, ice on cold water. No vines
  or cocoa yet.
- Structures: dungeons (with a spawner; the chest comes with Phase 5's inventories), desert wells, ruins of
  old stone. Trees don't grow through them.
- 121 blocks: five more woods (log, leaves, planks), sandstone, five ores, mossy and cracked stone,
  spawner, the plants above. Tall grass and large ferns are two-high like doors.
- Measured in Chrome: generating takes 1.5 ms per chunk in the worker, which kept every chunk in view
  loaded flying at 44 blocks/s; meshing 0.96 ms per chunk (0.47 before: tints, overlays, cave faces);
  frames at most 8.7 ms flying; Canvas 2D 60 fps at 7.9 ms (more plants to draw).

- **Climate and biomes** (`src/gen/`): noise for temperature, humidity, continentalness and erosion picks a
  biome per column: ocean, deep ocean, beach, river, plains, forest, birch forest, taiga, snowy plains,
  desert, savanna, jungle, swamp, stony mountains, snowy peaks. Each brings surface rules, vegetation and tint
  colors; tints blend over 5×5 columns into the per-corner colors (R12).
- **Shape:** 3D density noise instead of a heightmap, for overhangs and steep mountains up to about y 200.
- **Underground:** cheese and spaghetti caves, ravines, lava pools below y 10, aquifers; ores by depth and in
  veins (coal, copper, iron, gold, redstone, lapis, diamond, and emerald in mountains).
- **Features:** trees by biome (oak, birch, spruce, jungle, acacia, dark oak, big oaks), tall grass, flowers,
  ferns, cacti, dead bushes, sugar cane, pumpkins; snow on cold ground and ice on cold water.
- **Structures:** placed on a seeded grid that reaches across chunk borders (as trees do today): dungeons with
  a spawner and a chest, desert wells, small ruins. Villages come later.
- **Old worlds:** new chunks use the new generator, with seams at the old border, as in Minecraft.
- **Done when:** a walk crosses several biomes with smooth transitions; caves open to the surface; diamonds are
  rare and deep; the worker keeps up with flying at sprint speed.
- **Tests:** determinism per seed, every biome appearing within a fixed area, ore depth histograms, structures
  across chunk borders.

### Phase M: Multiplayer (L)

**Done on 2026-10-22.** What changed against the plan below:
- Guests do their own actions at once with the same rules as the host (`src/actions.ts`, shared with
  single player) and send them; the host does them again after checking reach, the block and that the
  face is real, and sends what really is there to every guest, the actor included, putting right a guess
  it refused. Movement is the guest's own (not checked beyond being numbers), as Minecraft's servers do
  only loosely.
- The host sends chunks in the packed form saves use, nearest first, a few per frame and only while the
  data channel's buffer is low; a guest tells the host which chunks it let go of. Block changes in the
  chunks a guest has go out once a frame, after any chunk still being compressed for them.
- Host and guest check they run the same Craft: the protocol version and a fingerprint of all block states
  (states travel as ids).
- Signaling: `/api/signal` (mailboxes per world code, one offer and one answer per join, no trickle ICE)
  and `/api/ice` (STUN, and Cloudflare TURN credentials when a key is set), one module run by Vercel
  Functions with Upstash Redis and by the Vite dev and preview servers in memory.
- Guests are saved by the host: save format 4 and a `guests` store (IndexedDB version 2, created on
  upgrade); `.craftworld` files carry them. Quick-play worlds keep returning guests' places until the page
  closes.
- Other players are figures of boxes in a shirt color of their own, lit by the light where they stand,
  with name tags; joins and leaves are noticed. The player's name is in Options, asked for on the first
  join; a random id kept in the browser says who comes back.
- Not done: copy-and-paste invites without any server (a deployment needs its functions), and importing
  Minecraft's textures in the browser (guests on a deployed game see Craft's own).
- Measured in Chrome, two browsers on one computer over WebRTC: a guest joined and had 151 chunks in 3.2
  s; while it flew at 20 blocks/s for 10 s it never missed a chunk within 4, and the host's frames stayed
  at a median of 1 ms and at most 3.3 ms.

Asked for after Phase 4 was planned: friends play in one world, hosted by one of them, with nothing to run
but the game. Proposed to come right after Phase 4, so items, mobs and survival are built for it from the
start rather than fitted to it later.

- **The host's browser is the server.** The host plays as usual; generation, ticks, fluids, block updates
  and saves run there, as now. "Open to friends" gives an invite link (`<domain>/?join=<code>`).
- **Clients** show the host's world: they receive chunks in the packed form saves use (biomes and all),
  block changes as they happen, other players and the time, and send their position and actions (break,
  place, use). The host checks actions against reach and rules before applying them. Movement is predicted
  locally and corrected by the host.
- **Transport:** WebRTC data channels, browser to browser. Introductions (signaling) go through a small
  function next to the static game (Vercel), a few kilobytes per join; STUN finds the way through home
  routers, and a TURN relay (Cloudflare's free tier) is used where that fails. Game traffic never touches
  the deployment. A copy-and-paste invite works without any server.
- **Saves:** player records per player id in the host's world (format change); the world lives in the
  host's browser, and the session ends when the host closes it.
- **Textures:** a deployed game can't serve Minecraft's textures; each player may import their own into
  their browser instead of `npm run textures`.
- **Done when:** two browsers on different networks build in the same world, see each other move, and the
  joining player's things are where they left them when they come back.
- **Tests:** a host and clients in one test over an in-memory transport: chunk sync, edits both ways,
  rejected actions, a client reconnecting.

### Phase 5: Items, inventory, crafting, tools (L)

**Done on 2026-10-23.** What changed against the plan below:
- A game mode per world came along (the start of Phase 6): survival gathers, breaks in time, drops and
  crafts; creative has every item at hand (E lists them, with a search), breaks at once and uses nothing
  up. New worlds pick one, older ones are creative (save format 5), quick play takes `&mode=creative`.
- Items (`src/items.ts`): every block, 25 materials and foods, 25 tools in five tiers (gold as fast as
  Minecraft's and as weak), 16 pieces of armor (worn in their slots; protection comes with health in
  Phase 6). Not yet: buckets, shears, flint and steel; beds and food came in Phase 6.
- Inventory (`src/inventory.ts`): 36 slots, 4 armor slots and an off-hand slot (kept, not used yet).
  Minecraft's clicks: pick up, put down, swap, halve, one at a time, shift to move across, double click to
  gather; not yet dragging to spread a stack.
- Crafting (`src/crafting.ts`): about a hundred shaped and shapeless recipes as data, with tags (any
  planks, any log, coal or charcoal), shapes matched anywhere in the grid and mirrored; 2 x 2 in the
  inventory, 3 x 3 at a crafting table; shift on the result crafts as many as fit. No recipe book.
- Mining (`src/mining.ts`): Minecraft's hardness, tool kinds and tiers and its break time formula, the
  drops of each block (ores give raw ore or gems, stone cobblestone, leaves now and then a sapling or an
  apple, double slabs two slabs), tools wearing a use per block. Cracks show the progress on WebGL.
- Dropped items (`src/drops.ts`): entities that fall, slide, merge with their kind, get picked up after a
  moment and go after five minutes; saved with their chunk. Block items show as spinning cubes with their
  textures, others as their picture.
- Block entities (`src/blockEntities.ts`): chests (27 slots, a double chest 54) and furnaces (fuel, 10 s per
  item, coal for 8, a lit front that gives off light), saved with their chunk; breaking one spills what it
  held.
- Icons: blocks drawn once into little cubes from their textures (`src/icons.ts`), items from Minecraft's
  item textures when imported (66 of them, and the chest from its model's texture), Craft's own drawings
  otherwise.
- Multiplayer (protocol 2): a guest's inventory is theirs (the host keeps it for their next visit); their
  breaks drop on the host's side for the tool they held; they see the items lying about, pick them up by
  asking, throw them; chests and furnaces are the host's, shown to the guest who opens them and changed by
  them. A guest sees only the half of a double chest they opened.
- Checked in the browser: the survival start played with the mouse (a log broken by hand, picked up,
  planks and a crafting table in the 2 x 2 grid, a pickaxe at the table), a furnace smelting and lit, a
  double chest, and a reload that kept the mode, the inventory with a worn pickaxe, the chest's contents and
  the items lying about; two browsers in one world with protocol 2; Canvas 2D at 60 fps. That found two
  bugs: chests side by side never joined into a double chest (`BlockUpdates` now pairs them, keeping a pair
  it has), and saved worlds and joins failed to open (the inventory drew the hotbar before it was made).


- **Items** (`src/items.ts`): every block as an item, plus materials (sticks, coal, ingots, diamonds, flint,
  string, leather), tools and food. Stacks of up to 64 (16 for some items, 1 for tools), tools with durability.
- **Inventory:** 36 slots (9 of them the hotbar), 4 armor slots and an off-hand. E opens the inventory screen
  with drag and drop, shift-click, splitting a stack with the right button and double-click to gather. Creative
  mode gets a searchable creative inventory with tabs.
- **Crafting:** shaped and shapeless recipes as data; 2×2 in the inventory, 3×3 at a crafting table. About 60
  recipes: planks, sticks, crafting table, furnace, chest, torches, tools in five tiers, doors, stairs, slabs,
  panes, ladders, beds, bread, armor.
- **Tools and mining:** break time from the block's hardness, the tool type and its tier (hardness × 1.5 s
  when the block can be harvested, × 5 s when it can't, divided by the tool's speed when it is the right kind
  of tool); blocks that need a tier drop nothing without it (stone needs a pickaxe); tools wear with use;
  cracks spread over the block being broken (`destroy_stage_*`).
- **Drops:** broken blocks drop item entities that bob and spin, merge with their neighbors, get picked up when
  the player comes near and disappear after 5 minutes.
- **Block entities:** chests (27 slots, 54 when double), furnaces (fuel and smelting: 10 s per item, coal for 8
  items), crafting tables. Their contents are saved with the chunk.
- **Icons:** blocks rendered once into small isometric images, items from `item/*.png` when imported, and
  drawn ones otherwise.
- **Done when:** in a new world, the Minecraft start works: wood, planks, crafting table, wooden pickaxe,
  stone, a furnace to smelt iron, a chest to store it, and a reload keeps all of it.
- **Tests:** recipe matching (shapes, mirrored shapes, shapeless), stacking and splitting, break times by
  tool, furnace progress over ticks, chest contents through a save.

### Phase 6: Survival and game modes (M)

**Done on 2026-10-23.** What changed against the plan below:
- Game modes per world: survival, creative (flying: a double tap of Space, Shift to go down, as Craft's
  sprint key is Shift) and hardcore (survival on hard, one life; after dying the player looks on as a
  spectator, flying through blocks). Chosen when the world is made; no switching in a world yet.
- Health (`src/vitals.ts`, `src/survival.ts`): Minecraft's rules. Falls (a point per block beyond three,
  half onto a bed, none into water or onto a ladder), drowning, lava (4, and burning for 15 seconds, put
  out by water), burning, suffocating, cactus and the void; half a second in which only a harder hit lands;
  a red flash, hearts that flash when hit and shake when nearly gone, flames on screen while burning. The
  death screen gives the cause and score; what the player carried and 7 points of experience per level
  (100 at most) fall where they died; they come back at their bed (beside it, if there's room) or the
  world's spawn. Creative takes only the void, spectators nothing. Fire blocks: not yet.
- Hunger: Minecraft's exhaustion (sprinting, swimming, jumping, breaking, hurts), saturation, healing (from
  18, quickly at 20 with saturation), starving by difficulty, no sprinting at 6 or less. Food came short
  before monsters, so came: melons in jungles (slices), mushrooms in dark forests, swamps and taigas, bowls
  and mushroom stew, and loot chests in dungeons (bread, wheat, apples, string for wool and so beds, coal,
  iron, gold, redstone, diamonds). Generator version 3.
- Armor: Minecraft's points and toughness, against lava and cactus (falls, drowning and the rest go through
  armor in Minecraft too); every piece wears a use per 4 damage.
- Beds in the 16 colors, from wool and planks: two blocks long, the head the way the player looks; using
  one makes it home, at night the player lies down, and when every player sleeps for 5 seconds morning
  comes. Waking with Space or Shift, or a hit. Minecraft 26 draws beds as block models with textures of
  their own, which are imported; Craft's world is Minecraft's mirrored, so the sides swap.
- Experience: orbs from coal, diamond, emerald, lapis and redstone ores and from smelting (the furnace keeps
  it until its output is taken); they fly to the nearest player within 8 blocks; Minecraft's levels.
- Difficulty: peaceful, easy, normal, hard, set when the world is made and from the game menu (hard in
  hardcore); for now it decides hunger and starving, damage waits for monsters (Phase 7).
- The status bar (`src/ui/hud.ts`) uses Minecraft's sprites when imported (gui/sprites/hud), its own
  drawings otherwise.
- A game played alone pauses under its game menu, as Minecraft's; a shared one goes on.
- Multiplayer (protocol 3): a guest's own physics runs on their side, so they feel their own hurts and
  send their vitals to the host for keeping; deaths are told to everyone; orbs fly to guests; difficulty
  changes reach them; the night passes when host and guests all sleep.
- Save format 6: difficulty and hardcore; players' and guests' vitals, beds, flying and spectating; orbs in
  chunks; furnaces' experience.


- **Game modes** per world: survival and creative, and hardcore as an option. Creative flies (double-tap
  Space), breaks instantly, has endless blocks and takes no damage.
- **Health:** 20 points (10 hearts). Damage from falling (1 per block beyond 3), drowning (15 s of air, then 2
  per second), lava and fire, being stuck in a block, and the void; a short invulnerability after each hit; a
  red flash; a death screen and respawn at the world spawn or a bed, with the inventory dropped.
- **Hunger:** 20 points plus saturation; exhaustion from sprinting, jumping, swimming and taking damage;
  regeneration at 18 or more, starvation at 0, no sprinting below 6. Food: apples from oak leaves, bread,
  cooked meat (Phase 7); eating takes 1.6 s of holding the right button.
- **Armor:** leather, iron, gold and diamond reduce damage by armor points.
- **Beds:** set the spawn point and skip the night (if no monsters are near, from Phase 7).
- **Experience:** orbs from ores and mobs, and a level bar; spent later on enchanting.
- **Difficulty:** peaceful (no monsters, no hunger), easy, normal, hard, scaling damage and hunger.
- **HUD:** hearts, hunger, air bubbles under water, armor and the XP bar above the hotbar.
- **Done when:** a survival night can kill you by falling, drowning or lava; food keeps you alive; death
  respawns you with your items on the ground where you died.
- **Tests:** damage rules per source, hunger and regeneration over ticks, respawn, game mode rules.

### Phase 7: Mobs and combat (L)

**Done on 2026-10-23.** What changed against the plan below:
- Models (`src/mobs/models.ts`): Minecraft's part and box definitions ported as they are (texture corners,
  pivots, rest rotations), mapped into Craft's mirrored world by turning every axis over, so Minecraft's
  entity textures fit unmirrored; imported from the player's installation (mob_*), Craft paints its own
  skins on the same layouts otherwise. Each mob is one mesh posed on the CPU every frame (a draw call a
  mob, shading and the red of a hit in the corner colors), so instancing (R19) wasn't needed.
- AI (`src/mobs/mobs.ts`): goals in Minecraft's order per kind rather than a general goal system. A* paths
  (`src/mobs/path.ts`): stepping up a block, dropping up to three, swimming, through open doors,
  diagonally where both sides are clear, 600 nodes a search, the nearest point when the goal can't be
  reached. Monsters notice a player within 16 blocks they can see and follow to 32; zombies strike,
  skeletons keep their distance, strafe and shoot (aimed as Minecraft's), creepers stop, swell for 1.5
  seconds and blow up (calming down when the player gets away), spiders climb walls, leap, and leave
  players alone in the light unless hit. Zombies and skeletons burn under the open sky by day.
- Animals wander, run when hit, follow wheat (cows, sheep, chickens; pigs follow apples until carrots come
  with farming in Phase 9); sheep have Minecraft's natural colors, are sheared for 1 to 3 wool and grow it
  back eating grass; chickens lay eggs every 5 to 10 minutes. No breeding yet; no dyeing sheep (no dyes).
- Spawning: monsters where Minecraft's rule allows (no block light, sky light dimmed by night at most 0 to 7,
  in groups, 24 to 64 blocks from players, 24 at most), going when far away; animals on grass in daylight
  (12 at most) and staying; dungeon spawners (zombie, skeleton or spider by position, up to six around).
- Combat: Minecraft's damage by weapon and its attack cooldown, critical hits falling, knockback (more when
  sprinting), the hit window for mobs as for players; bows that draw over a second and fire arrows that
  fall, do damage by speed, stick and can be picked up; explosions by Minecraft's ray method (blast
  resistance per block, drops one in power, damage by distance and exposure). Monster damage scales with
  difficulty; armor counts against mobs, arrows and explosions.
- New items: raw and cooked pork, beef, chicken and mutton, rotten flesh, spider eyes (food without their
  effects yet), bones, gunpowder, feathers, eggs, arrows, bows, shears. TNT and bone meal wait for Phase 9.
- Ticking: 20 a second in the world's ticks, drawn between ticks; mobs beyond 96 blocks of every player
  stand still. Animals are saved with their chunk (save format 7), monsters aren't.
- Multiplayer (protocol 4): the host runs the mobs and sends each guest those near them ten times a second,
  which the guest moves smoothly between updates; guests' hits, shots and shears go to the host, which
  checks their reach; mobs and explosions hurt guests by a message; monsters go after guests too.


- **Models:** mobs are boxes in a hierarchy (body, head, legs) shaped like Minecraft's, as Projector mesh
  nodes under one object, so imported entity textures fit them; drawn textures otherwise. Legs swing with the
  walking speed and heads turn.
- **AI:** goals by priority (wander, look at the player, panic when hit, follow someone holding their food,
  attack in melee, keep distance and shoot, hide from or burn in sunlight). Pathfinding with A* over walkable
  cells (step up 1, drop up to 3, through doors and water), with a node budget per tick.
- **Mobs:** passive pig, cow, sheep (wool, shearing, dye colors) and chicken (eggs); hostile zombie,
  skeleton (bow), creeper (explodes) and spider (climbs walls, neutral by day). Drops: meat, leather, wool,
  feathers, rotten flesh, bones, arrows, gunpowder, string.
- **Spawning:** animals with the terrain in grassy biomes; monsters in darkness (block light 0) 24–128 blocks
  from the player under a mob cap, despawning when far away; spawners in dungeons.
- **Combat:** melee with an attack cooldown, critical hits while falling, knockback, sword damage by tier;
  bows that draw and fire arrows as projectiles that stick; explosions that break blocks by blast resistance
  and hurt by distance.
- **Performance:** entities tick at 20 Hz and are interpolated between ticks; distant ones tick less often.
  Instanced drawing (R19) if many mobs cost too many draw calls.
- **Done when:** nights bring zombies and skeletons that find their way to you around obstacles and burn at
  dawn; swords and bows work; creepers blow holes; animals give food and wool.
- **Tests:** pathfinding on fixed layouts, spawn rules by light, damage and knockback, explosion damage to
  blocks.

### Phase 8: Feel: sound, particles, hand, camera, UI (M)

Parts of this phase can come at any point; sound in particular depends on nothing else.

- **Sound** (`src/audio.ts`, Web Audio): positional sounds for breaking, placing and footsteps per block's
  sound group, water, lava, mobs, getting hurt, eating and UI clicks; cave ambience; music. Imported from the
  player's Minecraft like the textures: the version's asset index maps `minecraft/sounds/...` to hashed files
  under `.minecraft/assets/objects/`, copied by `npm run textures` into a git-ignored folder. Without them,
  a few synthesized sounds.
- **Particles:** block-break pieces with the block's texture, footstep dust, splashes, smoke from torches and
  furnaces, later rain. Needs textured billboards in Projector (R18).
- **Hand and held item:** the arm and the held block or item in view, swinging on use (R15).
- **Camera:** view bobbing, a wider view while sprinting, a tilt when hurt; third person from behind and in
  front (F5) with a player model.
- **Movement:** sneaking (slower, a lower camera, no walking off edges), climbing vines (ladders came in
  Phase 3).
- **F3 debug screen,** hidden until F3 (the removed info box, now on demand): fps and frame times, position,
  chunk, facing, biome, light levels, renderer stats.
- **Chat and commands:** T opens the chat; `/gamemode`, `/time set`, `/tp`, `/give`, `/seed`, `/weather`,
  `/kill`, `/spawnpoint`. Useful for testing every other phase too, so they can come early.
- **Options:** render distance, FOV, mouse sensitivity, volume per category, GUI scale, key bindings,
  renderer, smooth lighting.
- **Done when:** the world sounds and moves like Minecraft: footsteps change with the ground, broken blocks
  crumble into particles, the hand swings, F3 and the commands work.

### Phase 9: Farming, weather, redstone basics (L)

- **Random ticks** (from Phase 0): grass spreads to lit dirt and dies under blocks; leaves decay more than 6
  blocks from a log; saplings grow into trees; ice and snow form in cold biomes and melt near light; cacti and
  sugar cane grow.
- **Farming:** hoes make farmland; seeds come from grass; wheat grows in stages, faster when watered and lit;
  carrots, potatoes, pumpkins, melons; bone meal; breeding animals (if not done in Phase 7).
- **Weather:** rain and snow by biome (falling textured streaks around the camera, R18), a darker sky with less
  sky light, thunderstorms with lightning; saved with the world.
- **Redstone basics:** power levels 0–15 updated through scheduled ticks; dust, torches (inverters), levers,
  buttons, pressure plates, repeaters (delay and locking), lamps, and powered doors and trapdoors. Pistons
  (moving blocks and entities) come right after; comparators and the rest later.
- **Done when:** a wheat farm grows overnight; rain comes and goes; a lever lights a lamp down a repeater line;
  a torch clock blinks.
- **Tests:** growth over ticks, leaf decay, circuit truth tables and timing (inverter, clock, repeater delays)
  stepped in Node.

### Later

Each gets its own plan when its turn comes.

- **The Nether:** obsidian portals, a second dimension with its own store and generator, netherrack, lava
  seas, fortresses and Nether mobs.
- **Enchanting, anvils and brewing:** spending XP, enchantments on tools and armor, potions and status effects.
- **Villages and villagers:** generated villages, professions, trading, iron golems.
- **Transport:** boats, minecarts and rails (powered rails need redstone), horses and saddles.
- **Text and pictures on blocks:** signs, books, maps, item frames, paintings.
- **Not planned:** the End, advancements and statistics, and multiplayer (see decision 4). For multiplayer,
  Phase 0 keeps the simulation free of DOM and rendering code, so a server could run it later.

## 4. What Projector needs

Rendering features general enough to belong in Projector rather than Craft. They continue the numbering of
R1–R11 in Projector's `docs/requirements-feedback.md`.

| ID | Requirement | What Craft uses it for | Phase | Priority |
| --- | --- | --- | --- | --- |
| R12 | Colors per face corner on `Mesh` (like `uvs`), multiplied into the surface color on WebGL and averaged per face on Canvas 2D | Ambient occlusion; biome tints of grass, leaves and water | 2 | Done (0.4.0) |
| R13 | A second UV set per corner and `Material.lightMap`, a texture looked up by it and multiplied in | Sky and block light that changes with the time of day without remeshing (Minecraft's light map) | 2 | Done (0.4.0) |
| R14 | `Material.fog = false`, and control over depth writes | Sky, sun, moon, stars and clouds, which fog would otherwise turn into the fog color | 2 | Done (0.4.0), with additive blending |
| R15 | Clearing the depth buffer before a layer (a depth-tested overlay) | The hand and held item: on top of the world, yet correct in themselves | 8 | P2 |
| R16 | Freeing a mesh's GPU buffers right away (`backend.release(mesh)`) instead of after 300 unused frames | Chunk rebuilds and unloading churn through meshes | 0 | P3 |
| R17 | Building a `Mesh` from flat typed arrays (face indices and starts, optional normals) | Meshes made in a worker, without an array per face | 0 | P3 |
| R18 | Textured billboards: many camera-facing quads, each with a texture rectangle | Particles, rain and snow, dropped items as sprites | 8 | P2 |
| R19 | Instanced meshes: one mesh drawn with many transforms | Many mobs and dropped items in few draw calls | 7 | P3 |
| R20 | Lines wider than 1 px on WebGL (`LineSet.width`) | A more visible block outline | 8 | P3 |

Sound stays in Craft (Web Audio), unless Projector should get positional audio tied to its objects.

## 5. Decisions

Settled on 2026-10-22, all as recommended:

1. **World height:** 0–255 in 16 sections, sea level 63 (Minecraft's −64 to 319 would make every chunk half
   again as large for little gain in a browser).
2. **The Canvas 2D renderer** stays as a fallback that gets new blocks, and light as face shading, but not
   smooth lighting, the sky or particles.
3. **Saves store every generated chunk,** so worlds stay intact when the generator changes.
4. **Multiplayer** by sharing a host's session (changed on 2026-10-22; first out of scope): the host's
   browser runs the world and friends join over WebRTC, introduced by a small function next to the
   deployed game (Phase M). Phase 0 kept the simulation free of DOM and rendering code for this.
5. **Assets:** sounds and entity, item and GUI textures are imported from the player's installation like the
   block textures, with Craft's own fallbacks.
6. **Redstone:** the basics in Phase 9, pistons right after, comparators and the rest later.

Phases 0 to 7 and M are done; next is Phase 8, feel: sound, particles, the hand, camera and UI.

# Craft

A Minecraft-style voxel world in the browser, built on [Projector](https://github.com/ChrisDrae/Projector):
seeded terrain with 18 biomes, from deserts and jungles to snowy peaks, mountains with cliffs and
overhangs, rivers, caves and ravines, ores by depth, dungeons, desert wells and ruins; walking, swimming
and climbing; building with 121 blocks, slabs, stairs, fences, walls, panes, doors and plants among them;
water and lava that flow, fall and harden where they meet; light levels with smooth lighting, torches and
glowstone; a 20-minute day with the sun, the moon in its phases, stars and clouds.

```sh
npm install
npm run dev      # http://localhost:5173
npm run check    # typecheck, tests, build
```

The title screen lists your worlds: create one and play. WASD moves, Space jumps (and swims up), Shift
sprints, the left button breaks and the right one places (or opens and shuts doors and trapdoors), 1–9 or
the wheel pick a hotbar slot, the middle button picks the block you aim at, E lists every block to put one in
the hotbar, Esc opens the game menu (options, save and quit).

## Worlds and saves

Worlds are kept in the browser (IndexedDB): every chunk you've been near, the player and the world's clock.
Craft saves every 30 seconds, when you open the game menu or switch tabs, and when you quit to the title.
A world open in one tab can't be opened in a second one. From the title screen you can rename, copy and
delete worlds, and export one to a `.craftworld` file (or import such a file), to keep it elsewhere or move
it to another browser. Options (render distance, field of view, mouse sensitivity, renderer) are kept in
the browser too.

## Renderers

By default Craft draws with Projector's `WebGLBackend`: every chunk is a mesh of its own with textured
blocks, leaves you can see through and translucent water, at a 96-block view. Without WebGL2, or with the
Canvas 2D renderer chosen in Options, it draws with Projector's Canvas 2D renderer: flat-colored blocks at 48
blocks.

URL options: `?seed=` plays a fresh world with that seed that isn't saved (Quick play), `?view=16..160` and
`?renderer=canvas|webgl` override the options for one page.

## Minecraft's textures

Craft paints its own pixel-art textures. To play with Minecraft's instead, import them from your own
installation:

```sh
npm run textures                    # the newest release in your .minecraft folder
npm run textures -- <file>          # a client jar or a resource pack zip
```

This copies the block textures Craft needs (water and lava animated), and the sun, the moon's phases and
the clouds, into `textures/minecraft/`; grass, leaves and water are tinted at load time like a plains biome.
They belong to Mojang, so they stay on your machine: git ignores the folder and `npm run build` leaves it out
(a built Craft always uses its own textures). Delete the folder to go back to them.

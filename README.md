# Craft

A Minecraft-style voxel world in the browser, built on [Projector](https://github.com/ChrisDrae/Projector):
seeded terrain with oceans, beaches, cliffs, ores and trees; walking, swimming and climbing out of water;
breaking and placing blocks.

```sh
npm install
npm run dev      # http://localhost:5173
npm run check    # typecheck, tests, build
```

Click to play. WASD moves, Space jumps (and swims up), Shift sprints, the left button breaks and the right
one places, 1–9 or the wheel pick a block, Esc releases the mouse.

## Renderers

By default Craft draws with Projector's `WebGLBackend`: every chunk is a mesh of its own with textured
blocks, leaves you can see through and translucent water, at a 96-block view. Without WebGL2, or with
`?renderer=canvas`, it falls back to Projector's Canvas 2D renderer with flat-colored blocks at 48 blocks.

URL options: `?seed=` picks another world, `?view=16..160` the view distance in blocks.

## Minecraft's textures

Craft paints its own pixel-art textures. To play with Minecraft's instead, import them from your own
installation:

```sh
npm run textures                    # the newest release in your .minecraft folder
npm run textures -- <file>          # a client jar or a resource pack zip
```

This copies the 17 block textures Craft needs into `textures/minecraft/`, tinted at load time like a plains
biome. They belong to Mojang, so they stay on your machine: git ignores the folder and `npm run build` leaves
it out (a built Craft always uses its own textures). Delete the folder to go back to them.

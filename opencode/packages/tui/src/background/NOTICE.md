# Wallpapers

The engine (`src/`) and the scenes (`wallpapers/`) are adapted from
[vaprdev/opencode-wallpapers](https://github.com/vaprdev/opencode-wallpapers), commit `71b9a35`, MIT licence, copyright
(c) 2026 Alan Rice. The licence text is in `LICENSE.opencode-wallpapers`.

What RIFT changed:

- Only the Matrix, City, Megacity, Dome, Rider, Space, 3D Pipes and Mystify scenes are included. The
  OpenCode-branded Universe scene and the rest are left out to keep RIFT small.
- `wallpapers/rift.ts` is not from that project. It is RIFT's own scene, written against the same engine.
- `host.ts` replaces the OpenCode plugin context. The engine gets the renderer, the theme mode and a wake hook from RIFT.
- Pixel mode (the scene as a real image in Ghostty or kitty) is switched off, because it needs a newer OpenTUI than
  RIFT ships. The scene is always drawn as terminal cells.
- The wallpaper loader for third-party packages, the plugin menu and the plugin's settings storage are not included.
  `/background` and `catalog.ts` replace them.

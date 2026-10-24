import type { CliRenderer } from "@opentui/core"

/** What the wallpaper engine needs from RIFT's TUI. */
export interface Context {
  // kittyImageTransport only exists in newer OpenTUI; it is used by pixel mode, which RIFT keeps off.
  readonly renderer: CliRenderer & { kittyImageTransport?: "file" | "direct" | "shm" }
  readonly themeMode: "dark" | "light"
  readonly data: {
    /** Called whenever RIFT is doing something; the engine uses it to wake from its idle rate. */
    listen(wake: () => void): () => void
  }
}

import { registerCustomTheme } from "@pierre/diffs"
import { OpenCodeTheme } from "./marked-theme"

let registered = false

export function registerRIFTTheme() {
  if (registered) return
  registered = true
  registerCustomTheme("RIFT", () => Promise.resolve(OpenCodeTheme))
}

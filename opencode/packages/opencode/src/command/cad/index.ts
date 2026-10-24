import fs from "fs"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import PROMPT from "./prompt.txt"
import RULES from "./rules.md"
import CHECK from "./check.py.txt"
import HELPERS from "./rift_cad.py.txt"

const FILES: Record<string, string> = {
  "rules.md": RULES,
  "check.py": CHECK,
  "rift_cad.py": HELPERS,
}

/**
 * Writes the CAD kit (rule sheet, helpers, verifier and renderer) where the agent can read and run
 * it. Rewritten on every use so an upgrade never leaves an old kit.
 */
export function kit(dir = path.join(Global.Path.cache, "cad")) {
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, content] of Object.entries(FILES)) fs.writeFileSync(path.join(dir, name), content)
  return dir
}

export function template(dir = kit()) {
  return PROMPT.replaceAll("${kit}", dir)
}

export { PROMPT }

export * as Cad from "."

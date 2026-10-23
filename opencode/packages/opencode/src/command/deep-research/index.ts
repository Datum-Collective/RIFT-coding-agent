import fs from "fs"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import PROMPT from "./prompt.txt"
import SOURCES from "./sources.md"
import WRITING from "./writing.md"
import TEMPLATE from "./template.tex.txt"
import CHECK from "./check.py.txt"

const FILES: Record<string, string> = {
  "sources.md": SOURCES,
  "writing.md": WRITING,
  "template.tex": TEMPLATE,
  "check.py": CHECK,
}

/**
 * Writes the research kit (search lenses, writing guide, LaTeX template, citation checker) where
 * the agent can read and run it. Rewritten on every use so an upgrade never leaves an old kit.
 */
export function kit(dir = path.join(Global.Path.cache, "deep-research")) {
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, content] of Object.entries(FILES)) fs.writeFileSync(path.join(dir, name), content)
  return dir
}

export function template(dir = kit()) {
  return PROMPT.replaceAll("${kit}", dir)
}

export { PROMPT }

export * as DeepResearch from "."

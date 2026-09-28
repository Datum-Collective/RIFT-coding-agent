import fs from "fs/promises"
import path from "path"
import { embedded } from "./template"

export const PACKAGE_NAME = "rift-video"

/** Where a project's engine lives, checked in the order `scaffold` would create it. */
const CANDIDATES = ["video", path.join(".rift", "video")]

export async function findWorkspace(root: string) {
  const found = await Promise.all(
    CANDIDATES.map(async (dir) => ((await isEngine(path.join(root, dir))) ? path.join(root, dir) : undefined)),
  )
  return found.find(Boolean)
}

/**
 * Writes the engine into a project. An existing engine is kept as it is, so videos already made
 * are never overwritten; a project's own `video/` folder is never touched either.
 */
export async function scaffold(root: string, options: { dir?: string } = {}) {
  const existing = options.dir ? undefined : await findWorkspace(root)
  if (existing) return { dir: existing, created: false }
  const dir = path.resolve(root, options.dir ?? ((await isEmpty(path.join(root, "video"))) ? "video" : CANDIDATES[1]!))
  if (await isEngine(dir)) return { dir, created: false }
  if (!(await isEmpty(dir))) throw new Error(`${dir} is not empty; pass another directory with --dir`)
  await Promise.all(
    Object.entries(embedded()).map(([file, content]) =>
      Bun.write(path.join(dir, file), Buffer.from(content.data, content.encoding)),
    ),
  )
  return { dir, created: true }
}

async function isEngine(dir: string) {
  const pkg = Bun.file(path.join(dir, "package.json"))
  if (!(await pkg.exists())) return false
  const data: unknown = await pkg.json().catch(() => undefined)
  return typeof data === "object" && data !== null && "name" in data && data.name === PACKAGE_NAME
}

async function isEmpty(dir: string) {
  const entries = await fs.readdir(dir).catch(() => [])
  return entries.length === 0
}

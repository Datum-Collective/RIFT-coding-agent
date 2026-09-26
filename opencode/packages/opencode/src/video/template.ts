import fs from "fs/promises"
import path from "path"
import TEMPLATE from "./template.txt"

/**
 * The RIFT video engine (the repo's video/ package), shipped inside the binary as one text file
 * so `rift video init` works in any project, offline. Regenerate with
 * `bun run script/video-template.ts`; a test fails if it drifts from video/.
 */
export type Template = Record<string, { encoding: "utf8" | "base64"; data: string }>

const SKIP = new Set(["node_modules", "out", "build", ".DS_Store"])
const BINARY = /\.(woff2?|ttf|otf|png|jpe?g|gif|webp|mp4|webm|mov|mp3|wav)$/i

export function embedded(): Template {
  return JSON.parse(TEMPLATE)
}

/** Reads an engine directory into the shipped format, in a stable order. */
export async function collect(dir: string): Promise<Template> {
  const files = (await fs.readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .filter((file) => !file.split("/").some((part) => SKIP.has(part)))
    .sort()
  const entries = await Promise.all(
    files.map(async (file) => {
      const bytes = await Bun.file(path.join(dir, file)).bytes()
      const binary = BINARY.test(file)
      return [
        file,
        { encoding: binary ? "base64" : "utf8", data: Buffer.from(bytes).toString(binary ? "base64" : "utf8") },
      ] as const
    }),
  )
  return Object.fromEntries(entries)
}

export * as RiftScope from "./scope.js"

import path from "node:path"

/**
 * The edited files that lie outside the folder RIFT verifies, as absolute paths. Verification checks out the
 * project it was opened in; an edit anywhere else is never checked, and the user has to be told.
 */
export function outside(root: string, files: readonly string[]): string[] {
  const base = path.resolve(root)
  return [
    ...new Set(
      files
        .map((file) => path.resolve(base, file))
        .filter((file) => {
          const relative = path.relative(base, file)
          return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
        }),
    ),
  ]
}

/** The newest few, so a long run of edits elsewhere cannot grow the stored state without end. */
export const MAX_OUTSIDE = 5
export const remember = (known: readonly string[], found: readonly string[]): string[] =>
  [...known.filter((file) => !found.includes(file)), ...found].slice(-MAX_OUTSIDE)

const text = (value: unknown) => (typeof value === "string" ? [value] : [])

/**
 * The files a finished write, edit or patch changed. A tool's result carries its data under `output`; reading the
 * top level instead meant a `write`, the way new files are made, was never seen.
 */
export function edited(tool: string, input: unknown, result: unknown): string[] {
  const output = (result as { readonly output?: unknown } | null | undefined)?.output ?? result
  if (tool === "write") return text((output as { resource?: unknown } | null | undefined)?.resource)
  if (tool === "edit") return text((input as { path?: unknown } | null | undefined)?.path)
  if (tool !== "patch") return []
  const applied = (output as { applied?: unknown } | null | undefined)?.applied
  return Array.isArray(applied) ? applied.flatMap((item) => text((item as { resource?: unknown } | null)?.resource)) : []
}

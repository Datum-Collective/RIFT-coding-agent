/**
 * Where the RIFT name is defined, and how it stays compatible with the OpenCode install it
 * forked from.
 *
 * Two kinds of compatibility matter here:
 *
 * - Paths. An existing install already has auth, sessions and config under the legacy
 *   directory. Moving it would lose them, so a legacy directory is used in place when no RIFT
 *   directory exists yet. Nothing is copied or deleted; a fresh install simply starts under the
 *   new name.
 * - Environment. Ninety-odd variables are read by their legacy names throughout the codebase.
 *   Rather than rename every read, `adoptEnv` copies any `RIFT_*` variable onto its legacy
 *   counterpart once at startup, so both spellings work and the legacy one keeps winning if a
 *   script already sets it.
 */
import fs from "fs"
import path from "path"

export const BRAND = "rift"
export const BRAND_DISPLAY = "RIFT"
export const LEGACY_BRAND = "opencode"

export const ENV_PREFIX = "RIFT_"
export const LEGACY_ENV_PREFIX = "OPENCODE_"

/**
 * Config basenames, most preferred first. Use when picking a single file, where the first hit
 * wins. `.jsonc` beats `.json` and RIFT beats the legacy name.
 */
export const CONFIG_NAMES = [`${BRAND}.jsonc`, `${BRAND}.json`, `${LEGACY_BRAND}.jsonc`, `${LEGACY_BRAND}.json`]

/**
 * The same names least preferred first. Use when merging a directory's configs in sequence,
 * where each file layers over the last, so the preferred one must be applied last.
 */
export const CONFIG_NAMES_ASCENDING = [...CONFIG_NAMES].reverse()

/** Per-project directory, newest name first. */
export const PROJECT_DIRS = [`.${BRAND}`, `.${LEGACY_BRAND}`]

function isDirectory(target: string) {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

/**
 * Picks the app directory under `base`. Prefers the RIFT directory, falls back to an existing
 * legacy one so an upgrade keeps its auth and sessions, and otherwise returns the RIFT path for
 * a fresh install to create.
 */
export function brandedDir(base: string) {
  const next = path.join(base, BRAND)
  if (isDirectory(next)) return next
  const legacy = path.join(base, LEGACY_BRAND)
  if (isDirectory(legacy)) return legacy
  return next
}

/**
 * Mirrors `RIFT_*` variables onto their `OPENCODE_*` names so every existing reader keeps
 * working. An already-set legacy variable wins, so nothing a caller set is overwritten.
 */
export function adoptEnv(env: NodeJS.ProcessEnv = process.env) {
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(ENV_PREFIX) || value === undefined) continue
    const legacy = LEGACY_ENV_PREFIX + key.slice(ENV_PREFIX.length)
    if (env[legacy] === undefined) env[legacy] = value
  }
  return env
}

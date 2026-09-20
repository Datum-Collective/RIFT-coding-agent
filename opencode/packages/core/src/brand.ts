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
 * Where RIFT is published and installed from.
 *
 * The install scripts are standalone shell and PowerShell files and must repeat these literals,
 * so a repo rename touches this file, `install` and `install.ps1` — and nowhere else.
 */
export const GITHUB_REPO = "Datum-Collective/RIFT-coding-agent"
export const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
export const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/opencode`
export const INSTALL_SH_URL = `${RAW_BASE}/install`
export const INSTALL_PS1_URL = `${RAW_BASE}/install.ps1`

/**
 * Where to look for the newest release, and where to fetch the install script from when updating.
 * Both can be overridden through the environment. That is how the update flow is tested against a
 * stand-in for GitHub, and it lets an organisation point RIFT at an internal mirror. Anything that can
 * set these already controls the process, so they widen nothing.
 */
export const releasesApi = (env: NodeJS.ProcessEnv = process.env) => env["RIFT_RELEASES_API"] || RELEASES_API
export const installScriptUrl = (windows: boolean, env: NodeJS.ProcessEnv = process.env) =>
  env["RIFT_INSTALL_URL"] || (windows ? INSTALL_PS1_URL : INSTALL_SH_URL)

/** Directory the install scripts put the binary in, under the user's home. */
export const INSTALL_DIR_NAME = `.${BRAND}`
export const LEGACY_INSTALL_DIR_NAME = `.${LEGACY_BRAND}`

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

import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import {
  adoptEnv,
  brandedDir,
  BRAND,
  CONFIG_NAMES,
  CONFIG_NAMES_ASCENDING,
  GITHUB_REPO,
  INSTALL_DIR_NAME,
  INSTALL_PS1_URL,
  INSTALL_SH_URL,
  LEGACY_BRAND,
  LEGACY_INSTALL_DIR_NAME,
  PROJECT_DIRS,
  RELEASES_API,
} from "../src/brand"

const made: string[] = []
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rift-brand-"))
  made.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("directory resolution", () => {
  test("a fresh install uses the RIFT directory", () => {
    const base = tmp()
    expect(brandedDir(base)).toBe(path.join(base, BRAND))
  })

  test("an upgrade keeps using the directory its data is already in", () => {
    const base = tmp()
    fs.mkdirSync(path.join(base, LEGACY_BRAND))
    // Returning the new path here would strand existing auth, sessions and config.
    expect(brandedDir(base)).toBe(path.join(base, LEGACY_BRAND))
  })

  test("once a RIFT directory exists it wins over the legacy one", () => {
    const base = tmp()
    fs.mkdirSync(path.join(base, LEGACY_BRAND))
    fs.mkdirSync(path.join(base, BRAND))
    expect(brandedDir(base)).toBe(path.join(base, BRAND))
  })

  test("a legacy file rather than a directory is ignored", () => {
    const base = tmp()
    fs.writeFileSync(path.join(base, LEGACY_BRAND), "not a directory")
    expect(brandedDir(base)).toBe(path.join(base, BRAND))
  })
})

describe("environment adoption", () => {
  test("RIFT_* is mirrored onto the legacy name every reader still uses", () => {
    const env = { RIFT_CONFIG: "/tmp/rift.json" } as NodeJS.ProcessEnv
    adoptEnv(env)
    expect(env["OPENCODE_CONFIG"]).toBe("/tmp/rift.json")
    expect(env["RIFT_CONFIG"]).toBe("/tmp/rift.json")
  })

  test("an explicitly set legacy variable is never overwritten", () => {
    const env = { RIFT_CONFIG: "/tmp/new.json", OPENCODE_CONFIG: "/tmp/existing.json" } as NodeJS.ProcessEnv
    adoptEnv(env)
    expect(env["OPENCODE_CONFIG"]).toBe("/tmp/existing.json")
  })

  test("only the RIFT_ prefix is adopted, not names that merely start with RIFT", () => {
    const env = { PATH: "/usr/bin", DRIFT: "no", RIFTY: "also no" } as NodeJS.ProcessEnv
    adoptEnv(env)
    expect(Object.keys(env).sort()).toEqual(["DRIFT", "PATH", "RIFTY"])
  })
})

describe("config names", () => {
  test("both spellings are accepted, with the RIFT names preferred", () => {
    expect(CONFIG_NAMES).toEqual(["rift.jsonc", "rift.json", "opencode.jsonc", "opencode.json"])
    expect(PROJECT_DIRS).toEqual([".rift", ".opencode"])
  })

  // Lookups take the first hit; merges apply each file over the last. Using one order for both
  // silently inverts precedence, so the two orders are named separately and pinned here.
  test("the ascending order is the exact reverse, for merge loops where the last file wins", () => {
    expect(CONFIG_NAMES_ASCENDING).toEqual([...CONFIG_NAMES].reverse())
    expect(CONFIG_NAMES_ASCENDING.at(-1)).toBe("rift.jsonc")
    expect(CONFIG_NAMES_ASCENDING[0]).toBe("opencode.json")
  })

  test("jsonc outranks json within each brand", () => {
    for (const names of [CONFIG_NAMES, [...CONFIG_NAMES_ASCENDING].reverse()]) {
      expect(names.indexOf("rift.jsonc")).toBeLessThan(names.indexOf("rift.json"))
      expect(names.indexOf("opencode.jsonc")).toBeLessThan(names.indexOf("opencode.json"))
      expect(names.indexOf("rift.json")).toBeLessThan(names.indexOf("opencode.jsonc"))
    }
  })
})

describe("distribution", () => {
  // These are baked into every shipped binary: `rift upgrade` re-runs the install script from
  // these URLs. If they are wrong, an installed copy can never update itself.
  test("the install scripts are fetched from this repo's main branch", () => {
    expect(INSTALL_SH_URL).toBe(`https://raw.githubusercontent.com/${GITHUB_REPO}/main/opencode/install`)
    expect(INSTALL_PS1_URL).toBe(`${INSTALL_SH_URL}.ps1`)
    expect(RELEASES_API).toBe(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`)
  })

  test("the repo is this fork, not upstream", () => {
    expect(GITHUB_REPO).not.toContain("anomalyco")
    expect(GITHUB_REPO).toMatch(/^[\w.-]+\/[\w.-]+$/)
  })

  // Upgrade detection matches the install directory by name, so these must track the brands.
  test("install directories are the dotted brand names", () => {
    expect(INSTALL_DIR_NAME).toBe(`.${BRAND}`)
    expect(LEGACY_INSTALL_DIR_NAME).toBe(`.${LEGACY_BRAND}`)
  })
})

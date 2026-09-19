/**
 * Finds a Chromium-family browser to drive.
 *
 * RIFT does not ship a browser. It uses one already on the machine, so browser verification
 * needs no download and no new dependency. Candidates are ordered headless-first, because a
 * headless shell can be driven without stealing focus from the user.
 */
import fs from "fs"
import os from "os"
import path from "path"

export type BrowserKind = "headless-shell" | "chromium"

export type BrowserBinary = {
  path: string
  kind: BrowserKind
}

/** Explicit override, checked before anything is searched for. */
export const BROWSER_PATH_ENV = "RIFT_BROWSER_PATH"

function executable(target: string) {
  try {
    fs.accessSync(target, fs.constants.X_OK)
    return fs.statSync(target).isFile()
  } catch {
    return false
  }
}

/** Playwright's cached browsers, newest build first. */
function playwrightCandidates(home: string): BrowserBinary[] {
  const roots = [path.join(home, "Library/Caches/ms-playwright"), path.join(home, ".cache/ms-playwright")]
  const found: { path: string; kind: BrowserKind; build: number }[] = []
  for (const root of roots) {
    let entries: string[]
    try {
      entries = fs.readdirSync(root)
    } catch {
      continue
    }
    for (const entry of entries) {
      const headless = entry.startsWith("chromium_headless_shell-")
      if (!headless && !entry.startsWith("chromium-")) continue
      const build = Number(entry.slice(entry.lastIndexOf("-") + 1)) || 0
      const kind: BrowserKind = headless ? "headless-shell" : "chromium"
      for (const relative of [
        "chrome-headless-shell-mac-arm64/chrome-headless-shell",
        "chrome-headless-shell-mac-x64/chrome-headless-shell",
        "chrome-headless-shell-linux/chrome-headless-shell",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome-linux/chrome",
        "chrome-win/chrome.exe",
      ]) {
        const candidate = path.join(root, entry, relative)
        if (executable(candidate)) found.push({ path: candidate, kind, build })
      }
    }
  }
  // Headless first, then the newest build.
  found.sort((a, b) => (a.kind === b.kind ? b.build - a.build : a.kind === "headless-shell" ? -1 : 1))
  return found.map(({ path: target, kind }) => ({ path: target, kind }))
}

function installedCandidates(): BrowserBinary[] {
  const targets =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
          "/Applications/Helium.app/Contents/MacOS/Helium",
        ]
      : process.platform === "win32"
        ? [
            "C:/Program Files/Google/Chrome/Application/chrome.exe",
            "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
            "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/snap/bin/chromium",
            "/usr/bin/microsoft-edge",
          ]
  return targets.filter(executable).map((target) => ({ path: target, kind: "chromium" as const }))
}

export function candidates(home = os.homedir()): BrowserBinary[] {
  const override = process.env[BROWSER_PATH_ENV]
  const explicit = override && executable(override) ? [{ path: override, kind: "chromium" as const }] : []
  return [...explicit, ...playwrightCandidates(home), ...installedCandidates()]
}

export function find(home = os.homedir()): BrowserBinary | undefined {
  return candidates(home)[0]
}

/** Message shown when nothing usable is installed, naming the ways to fix it. */
export const NOT_FOUND =
  "No Chromium-family browser was found. Install Chrome, Chromium, Edge or Brave, " +
  `or set ${BROWSER_PATH_ENV} to a browser executable.`

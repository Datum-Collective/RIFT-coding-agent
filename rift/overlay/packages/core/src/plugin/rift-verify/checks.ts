export * as RiftChecks from "./checks.js"

import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

export interface Check {
  readonly name: string
  readonly command: string
  /** Directory to run in. */
  readonly dir: string
}

/** "not_run" covers everything that stopped a check from executing. It is never reported as a pass. */
export type Status = "passed" | "failed" | "timed_out" | "not_run"

export interface Result extends Check {
  readonly status: Status
  readonly reason?: string
  readonly ms: number
  readonly output: string
}

const SCRIPTS = ["typecheck", "lint", "test"] as const
const DOCS = /\.(md|mdx|txt|rst)$/i
const OUTPUT_LINES = 40

const git = (dir: string, args: string[]) =>
  new Promise<string | undefined>((resolve) => {
    const proc = spawn("git", args, { cwd: dir, stdio: ["ignore", "pipe", "ignore"] })
    let output = ""
    proc.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()))
    proc.once("error", () => resolve(undefined))
    proc.once("close", (code) => resolve(code === 0 ? output : undefined))
  })

const paths = (porcelain: string) => {
  const entries = porcelain.split("\0").filter(Boolean)
  const files: string[] = []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!
    files.push(entry.slice(3))
    // A rename is followed by its source path.
    if (entry[0] === "R" || entry[0] === "C") index++
  }
  return files
}

export interface Tree {
  /** Changes whenever the working tree does. */
  readonly fingerprint: string
  /** Files that differ from HEAD, relative to the directory. */
  readonly files: readonly string[]
  /** The commit the tree is based on, when there is one. */
  readonly head?: string
}

/** Reads the working tree from git, so an edit counts whichever tool or process made it. Undefined outside git. */
export const tree = async (dir: string): Promise<Tree | undefined> => {
  const [head, status] = await Promise.all([
    git(dir, ["rev-parse", "-q", "--verify", "HEAD"]),
    git(dir, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  ])
  if (status === undefined) return undefined
  const files = paths(status)
  const hash = createHash("sha256").update(head ?? "").update(status)
  for (const file of files) {
    const stat = statSync(path.join(dir, file), { throwIfNoEntry: false })
    hash.update(`${file}:${stat?.size}:${stat?.mtimeMs}`)
  }
  return { fingerprint: hash.digest("hex"), files, head: head?.trim() || undefined }
}

/** A file that differs from `before` by name is an edit; so is any change when the fingerprints differ. */
export const edited = (before: Tree | undefined, after: Tree) => {
  if (before?.fingerprint === after.fingerprint) return []
  const known = new Set(before?.files)
  const added = after.files.filter((file) => !known.has(file))
  return added.length > 0 ? added : after.files
}

/**
 * What changed in `files` since HEAD, as a zero-context unified diff for the integrity review. A file that is new and
 * untracked has no diff against HEAD, so it is shown as an addition of its whole content.
 */
export const diff = async (dir: string, files: readonly string[]): Promise<string> => {
  if (files.length === 0) return ""
  const tracked = (await git(dir, ["diff", "HEAD", "--unified=0", "--no-color", "--no-ext-diff", "--", ...files])) ?? ""
  const untracked = (await git(dir, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...files])) ?? ""
  const added = untracked
    .split("\0")
    .filter(Boolean)
    .map((file) => {
      let text = ""
      try {
        text = readFileSync(path.join(dir, file), "utf8")
      } catch {}
      return [`diff --git a/${file} b/${file}`, "new file mode 100644", ...text.split("\n").map((line) => `+${line}`)].join("\n")
    })
  return [tracked, ...added].join("\n")
}

export const docsOnly = (files: readonly string[]) => files.length > 0 && files.every((file) => DOCS.test(file))

const placeholder = (script: string) => /no test specified/.test(script) || /(^|&&|;)\s*exit 1\s*$/.test(script)

const runner = (dir: string, root: string) => {
  for (let current = dir; ; current = path.dirname(current)) {
    if (existsSync(path.join(current, "bun.lock")) || existsSync(path.join(current, "bun.lockb"))) return "bun run"
    if (existsSync(path.join(current, "pnpm-lock.yaml"))) return "pnpm run"
    if (existsSync(path.join(current, "yarn.lock"))) return "yarn run"
    if (current === root || current === path.dirname(current)) return "npm run"
  }
}

export const detect = (dir: string, root: string): Check[] => {
  const checks: Check[] = []
  const manifest = path.join(dir, "package.json")
  if (existsSync(manifest)) {
    let scripts: Record<string, unknown> = {}
    try {
      scripts = JSON.parse(readFileSync(manifest, "utf8")).scripts ?? {}
    } catch {
      scripts = {}
    }
    const run = runner(dir, root)
    for (const name of SCRIPTS) {
      const script = scripts[name]
      if (typeof script === "string" && !placeholder(script)) checks.push({ name, command: `${run} ${name}`, dir })
    }
  }
  if (existsSync(path.join(dir, "go.mod")))
    checks.push({ name: "go vet", command: "go vet ./...", dir }, { name: "go test", command: "go test ./...", dir })
  if (existsSync(path.join(dir, "Cargo.toml")))
    checks.push({ name: "cargo check", command: "cargo check", dir }, { name: "cargo test", command: "cargo test", dir })
  return checks
}

/** Each edited file uses the nearest directory, up to the root, that has checks of its own. */
export const resolve = (root: string, files: readonly string[]): Check[] => {
  const dirs = new Map<string, Check[]>()
  for (const file of files) {
    for (let current = path.dirname(path.join(root, file)); ; current = path.dirname(current)) {
      if (path.relative(root, current).startsWith("..")) break
      const found = detect(current, root)
      if (found.length > 0) {
        dirs.set(current, found)
        break
      }
      if (current === root) break
    }
  }
  return [...dirs.values()].flat()
}

const tail = (text: string) => {
  const lines = text.trim().split("\n")
  return lines.length <= OUTPUT_LINES ? lines.join("\n") : ["...", ...lines.slice(-OUTPUT_LINES)].join("\n")
}

export const run = (check: Check, timeoutMs: number, signal?: AbortSignal) =>
  new Promise<Result>((resolve) => {
    const started = Date.now()
    const finish = (status: Status, output: string, reason?: string) =>
      resolve({ ...check, status, reason, ms: Date.now() - started, output: tail(output) })
    if (signal?.aborted) return finish("not_run", "", "cancelled")
    const windows = process.platform === "win32"
    const shell = windows ? (process.env.COMSPEC ?? "cmd.exe") : (process.env.SHELL ?? "sh")
    const proc = spawn(shell, windows ? ["/c", check.command] : ["-c", check.command], {
      cwd: check.dir,
      stdio: ["ignore", "pipe", "pipe"],
      detached: !windows,
      windowsHide: true,
    })
    let output = ""
    let stopped: "timed_out" | "cancelled" | undefined
    const collect = (chunk: Buffer) => (output = (output + chunk.toString()).slice(-200_000))
    proc.stdout.on("data", collect)
    proc.stderr.on("data", collect)
    const stop = (why: "timed_out" | "cancelled") => {
      stopped = why
      try {
        if (proc.pid !== undefined && !windows) process.kill(-proc.pid, "SIGKILL")
        else proc.kill("SIGKILL")
      } catch {}
    }
    const timer = setTimeout(() => stop("timed_out"), timeoutMs)
    const abort = () => stop("cancelled")
    signal?.addEventListener("abort", abort, { once: true })
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
    }
    proc.once("error", (error) => {
      done()
      finish("not_run", "", error.message)
    })
    proc.once("close", (code) => {
      done()
      if (stopped === "cancelled") return finish("not_run", output, "cancelled")
      if (stopped === "timed_out") return finish("timed_out", output)
      finish(code === 0 ? "passed" : "failed", output)
    })
  })

export const blocked = (check: Check, reason: string): Result => ({ ...check, status: "not_run", reason, ms: 0, output: "" })

const MARK: Record<Status, string> = { passed: "ok", failed: "FAILED", timed_out: "TIMED OUT", not_run: "NOT RUN" }

export const format = (results: readonly Result[]) =>
  [
    "RIFT verification",
    ...results.map((result) => {
      const head = `- ${MARK[result.status]}: ${result.command}${result.reason ? ` (${result.reason})` : ""} [${result.ms} ms]`
      return result.status === "failed" || result.status === "timed_out" ? `${head}\n${result.output}` : head
    }),
  ].join("\n")

export type Decision =
  | { readonly type: "report" }
  /** Hand the failures back to the agent in the same run. */
  | { readonly type: "fix" }
  /** The rounds ran out: tell the user the work is not proven and stop. */
  | { readonly type: "give_up" }

/** `tampered`: the integrity review found the tests or checks were changed to get a pass. It is handled like a failure. */
export const decide = (results: readonly Result[], round: number, maxRounds: number, tampered = false): Decision => {
  if (!tampered && !results.some((result) => result.status === "failed" || result.status === "timed_out")) return { type: "report" }
  return round < maxRounds ? { type: "fix" } : { type: "give_up" }
}

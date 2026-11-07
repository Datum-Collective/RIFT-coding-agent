export * as RiftWorkspace from "./workspace.js"

import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Schema, type Scope } from "effect"
import { RiftStages } from "./stages.js"
import { RiftVerdict } from "./verdict.js"

export type TreeId = string & { readonly TreeId: unique symbol }
export type CommitId = string & { readonly CommitId: unique symbol }

/** `tree`: the project as git would commit it, tracked and untracked files, ignored files left out. */
export interface Snapshot {
  readonly tree: TreeId
  readonly head?: CommitId
  readonly headTree?: TreeId
}

export type Env =
  /** Nothing ignored comes along. Dependencies come only from the plan's install stages. */
  | { readonly kind: "clean" }
  /** Dependency directories are linked from the live tree, so no install runs. Fast, not hermetic. */
  | { readonly kind: "snapshot"; readonly live: string; readonly links: readonly string[] }

export interface Workspace {
  readonly dir: string
  readonly tree: TreeId
  readonly env: Env["kind"]
}

export class WorkspaceError extends Schema.TaggedError<WorkspaceError>()("RiftWorkspace.Error", { reason: Schema.String }) {}

const OUTPUT_LINES = 40
/** Output kept in memory for failure names; the digest still covers all of it. */
const KEEP = 4 * 1024 * 1024
const OWNER = "owner.json"
const base = () => path.join(os.tmpdir(), "rift-verify")

const git = (cwd: string, args: readonly string[], options: { env?: Record<string, string>; input?: string } = {}) =>
  new Promise<Buffer | undefined>((resolve) => {
    const proc = spawn("git", args, {
      cwd,
      // Reads take no optional locks, so the user's own git commands never wait on RIFT.
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", ...options.env },
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "ignore"],
    })
    const chunks: Buffer[] = []
    proc.stdout!.on("data", (chunk: Buffer) => chunks.push(chunk))
    proc.once("error", () => resolve(undefined))
    proc.once("close", (code) => resolve(code === 0 ? Buffer.concat(chunks) : undefined))
    if (options.input !== undefined) proc.stdin!.end(options.input)
  })
const text = async (...args: Parameters<typeof git>) => (await git(...args))?.toString("utf8").trim()

/** The repository's top level, the project's path inside it, and its index file. */
const locate = async (root: string) => {
  const out = (await git(root, ["rev-parse", "--show-toplevel", "--show-prefix", "--git-path", "index"]))?.toString("utf8")
  if (out === undefined) return undefined
  const [top, prefix, index] = out.split("\n")
  return { top: top!, prefix: prefix!.replace(/\/$/, ""), index: path.resolve(root, index!) }
}

const tops = new Map<string, Promise<string | undefined>>()
const top = (root: string) => {
  if (!tops.has(root)) tops.set(root, locate(root).then((where) => where?.top))
  return tops.get(root)!
}

const take = async (root: string): Promise<Snapshot | undefined> => {
  const where = await locate(root)
  if (!where) return undefined
  const dir = mkdtempSync(path.join(os.tmpdir(), "rift-index-"))
  const env = { GIT_INDEX_FILE: path.join(dir, "index") }
  try {
    // A copy of the user's index lets git skip files whose stat is unchanged. The user's index is only read. The copy
    // keeps the original's timestamps: git trusts an entry's stat only if it is older than the index file, so a fresh
    // timestamp would hide a same-size edit made in the second the entry was recorded.
    const original = statSync(where.index, { throwIfNoEntry: false })
    if (original) {
      copyFileSync(where.index, env.GIT_INDEX_FILE)
      utimesSync(env.GIT_INDEX_FILE, original.atime, original.mtime)
    }
    if ((await git(root, ["add", "-A", "--", "."], { env })) === undefined) return undefined
    const whole = await text(where.top, ["write-tree"], { env })
    if (!whole) return undefined
    const tree = where.prefix
      ? ((await text(where.top, ["rev-parse", "-q", "--verify", `${whole}:${where.prefix}`])) ??
        (await text(where.top, ["mktree"], { input: "" })))
      : whole
    const head = await text(where.top, ["rev-parse", "-q", "--verify", "HEAD^{commit}"])
    const headTree = head ? await text(where.top, ["rev-parse", "-q", "--verify", `${head}:${where.prefix}`]) : undefined
    return { tree: tree as TreeId, head: (head || undefined) as CommitId | undefined, headTree: (headTree || undefined) as TreeId | undefined }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Writes the project as a git tree object through a private copy of the index (`git add -A && git write-tree`).
 * The user's index, files and refs are untouched. Same content gives the same id, so the id is the fingerprint,
 * the cache key and the receipt's input. Undefined outside git.
 */
export const snapshot = (root: string) => Effect.promise(() => take(root))

/** Files that differ between two trees. Exact and content-based: undoing an edit lists nothing. */
export const changed = (root: string, from: TreeId, to: TreeId) =>
  Effect.promise(async () => {
    const out = await git((await top(root)) ?? root, ["diff-tree", "-r", "-z", "--name-only", "--no-renames", from, to])
    return (out?.toString("utf8") ?? "").split("\0").filter(Boolean)
  })

/** A zero-context unified diff between two trees, for the integrity review and the mutants' changed lines. */
export const diff = (root: string, from: TreeId, to: TreeId) =>
  Effect.promise(async () => {
    const args = ["diff-tree", "-r", "-p", "--unified=0", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", from, to]
    return (await git((await top(root)) ?? root, args))?.toString("utf8") ?? ""
  })

/** The tree's file list, and the contents of the files detection reads, without copying anything. */
export const reader = (root: string, tree: TreeId) =>
  Effect.promise(async (): Promise<RiftStages.TreeReader> => {
    const cwd = (await top(root)) ?? root
    const listing = (await git(cwd, ["ls-tree", "-r", "-l", "-z", "--full-tree", tree]))?.toString("utf8") ?? ""
    const entries = listing.split("\0").flatMap((entry) => {
      const tab = entry.indexOf("\t")
      const [, type, oid, size] = entry.slice(0, tab).split(/\s+/)
      return type === "blob" ? [{ file: entry.slice(tab + 1), oid: oid!, size: Number(size) }] : []
    })
    const wanted = entries.filter((entry) => RiftStages.READS.has(path.posix.basename(entry.file)) && !entry.file.includes("node_modules/"))
    const contents = new Map<string, string>()
    const batch = wanted.length > 0 ? await git(cwd, ["cat-file", "--batch"], { input: wanted.map((entry) => entry.oid).join("\n") + "\n" }) : undefined
    let offset = 0
    for (const entry of wanted) {
      if (!batch) break
      const header = batch.indexOf(10, offset)
      const size = Number(batch.subarray(offset, header).toString("utf8").split(" ")[2])
      contents.set(entry.file, batch.subarray(header + 1, header + 1 + size).toString("utf8"))
      offset = header + 1 + size + 1
    }
    const sizes = new Map(entries.map((entry) => [entry.file, entry.size]))
    return { files: entries.map((entry) => entry.file), read: (file) => contents.get(file), size: (file) => sizes.get(file) }
  })

/** Checks a tree out through a private index, as a fresh clone would: filters and line endings apply, export-ignore does not. */
const checkout = async (root: string, tree: TreeId, env: Env, runDir: string): Promise<Workspace> => {
  const dir = mkdtempSync(path.join(runDir, "ws-"))
  const index = { GIT_INDEX_FILE: `${dir}.index` }
  const cwd = (await top(root)) ?? root
  try {
    if ((await git(cwd, ["read-tree", tree], { env: index })) === undefined) throw new Error(`git could not read tree ${tree}`)
    if ((await git(cwd, ["checkout-index", "-a", "-f", `--prefix=${dir}/`], { env: index })) === undefined)
      throw new Error("git could not check out the tree")
  } finally {
    await rm(index.GIT_INDEX_FILE, { force: true })
  }
  if (env.kind === "snapshot")
    for (const link of env.links) {
      const from = path.join(env.live, link)
      const to = path.join(dir, link)
      if (existsSync(from) && !existsSync(to) && existsSync(path.dirname(to))) symlinkSync(from, to, "dir")
    }
  return { dir, tree, env: env.kind }
}

/** A fresh checkout of `tree` under `runDir`, removed when the scope closes. */
export const materialize = (
  root: string,
  tree: TreeId,
  env: Env,
  runDir: string,
): Effect.Effect<Workspace, WorkspaceError, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () => checkout(root, tree, env, runDir),
      catch: (error) => new WorkspaceError({ reason: error instanceof Error ? error.message : String(error) }),
    }),
    (workspace) => Effect.promise(() => rm(workspace.dir, { recursive: true, force: true })),
  )

/** `$TMPDIR/rift-verify/<run>`, with an owner file so a later process can tell it was abandoned. Removed with the scope. */
export const runDir = (run: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const dir = path.join(base(), run)
      mkdirSync(dir, { recursive: true })
      writeFileSync(path.join(dir, OWNER), JSON.stringify({ pid: process.pid, started: Date.now() }))
      return dir
    }),
    (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
  )

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

/** Removes run directories whose owner process is gone. Safe to call any number of times. */
export const sweep = () =>
  Effect.promise(async () => {
    const root = base()
    const names = existsSync(root) ? readdirSync(root) : []
    for (const name of names) {
      const dir = path.join(root, name)
      let pid: number | undefined
      try {
        pid = (JSON.parse(readFileSync(path.join(dir, OWNER), "utf8")) as { pid?: number }).pid
      } catch {}
      if (pid !== undefined ? alive(pid) : Date.now() - (statSync(dir, { throwIfNoEntry: false })?.mtimeMs ?? 0) < 60 * 60 * 1000) continue
      await rm(dir, { recursive: true, force: true })
    }
  })

const tail = (text: string) => {
  const lines = text.trim().split("\n")
  return lines.length <= OUTPUT_LINES ? lines.join("\n") : ["...", ...lines.slice(-OUTPUT_LINES)].join("\n")
}

/** How a toolchain says a command it needs is not installed. */
const MISSING: readonly RegExp[] = [/^error: no such command: `?([\w-]+)/m, /^error: '([\w-]+)' is not installed for the toolchain/m]

const execute = (
  dir: string,
  command: string,
  env: Readonly<Record<string, string>>,
  timeoutMs: number,
  signal: AbortSignal,
) =>
  new Promise<RiftVerdict.Attempt>((resolve) => {
    const started = Date.now()
    const hash = createHash("sha256")
    let output = ""
    const finish = (status: RiftVerdict.Attempt["status"], reason?: string) =>
      resolve({
        status,
        reason,
        ms: Date.now() - started,
        tail: tail(output),
        digest: hash.digest("hex"),
        failures: RiftVerdict.failures(output),
      })
    if (signal.aborted) return finish("not_run", "cancelled")
    if (!existsSync(dir)) return finish("not_run", `no such directory: ${dir}`)
    const windows = process.platform === "win32"
    const proc = spawn(windows ? (process.env.COMSPEC ?? "cmd.exe") : "/bin/sh", windows ? ["/c", command] : ["-c", command], {
      cwd: dir,
      env: { ...process.env, CI: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: !windows,
      windowsHide: true,
    })
    let stopped: "timed_out" | "cancelled" | undefined
    const collect = (chunk: Buffer) => {
      hash.update(chunk)
      output = (output + chunk.toString()).slice(-KEEP)
    }
    proc.stdout.on("data", collect)
    proc.stderr.on("data", collect)
    // The whole process group goes, so a test runner's workers cannot outlive the stage.
    const stop = (why: "timed_out" | "cancelled") => {
      stopped = why
      try {
        if (proc.pid !== undefined && !windows) process.kill(-proc.pid, "SIGKILL")
        else proc.kill("SIGKILL")
      } catch {}
    }
    const timer = setTimeout(() => stop("timed_out"), timeoutMs)
    const abort = () => stop("cancelled")
    signal.addEventListener("abort", abort, { once: true })
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", abort)
    }
    proc.once("error", (error) => {
      done()
      finish("not_run", error.message)
    })
    proc.once("close", (code) => {
      done()
      if (stopped === "cancelled") return finish("not_run", "cancelled")
      if (stopped === "timed_out") return finish("timed_out")
      if (code === 0) return finish("passed")
      const tool =
        code === 127
          ? (output.match(/([^\s:'"`]+): (?:command )?not found/)?.[1] ?? command.split(/\s+/)[0])
          : MISSING.map((pattern) => output.match(pattern)?.[1]).find(Boolean)
      finish(tool ? "not_run" : "failed", tool ? `tool missing: ${tool}` : undefined)
    })
  })

/**
 * Runs one command with CI=1 in its own process group, in `cwd` relative to the workspace. The timeout or an
 * interrupt kills the group. A missing tool is not run, never a failure.
 */
export const exec = (workspace: Workspace, cwd: string, command: string, env: Readonly<Record<string, string>>, timeoutMs: number) =>
  Effect.promise((signal) => execute(path.join(workspace.dir, cwd), command, env, timeoutMs, signal))

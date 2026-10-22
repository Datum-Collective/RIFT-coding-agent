import { createHash } from "crypto"
import fs from "fs/promises"
import path from "path"
import { Process } from "@/util/process"
import { Verify } from "./verify"

/**
 * Runs verification checks with three speedups over calling `Verify.runCheck` directly:
 *
 * - Results are cached by (command, directory, working tree fingerprint), and in-flight runs are
 *   shared. Live checks, the end-of-turn report and graph evidence all go through here, so the same
 *   command against the same code runs once.
 * - Checks of one batch run in parallel at lowered CPU priority.
 * - `kick` starts checks in the background as soon as a step edits files, while the model is still
 *   working, and `failures` hands the results back so the agent can fix them in the same turn.
 */

/**
 * Cheap identity of the working tree: HEAD, `git status`, and the size and mtime of every dirty
 * file. Any edit changes it. Undefined outside git, which turns caching off.
 */
export async function fingerprint(dir: string): Promise<string | undefined> {
  const [top, head, status] = await Promise.all([
    Process.run(["git", "rev-parse", "--show-toplevel"], { cwd: dir, nothrow: true }),
    Process.run(["git", "rev-parse", "-q", "--verify", "HEAD"], { cwd: dir, nothrow: true }),
    Process.run(["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: dir, nothrow: true }),
  ])
  if (top.code !== 0 || status.code !== 0) return undefined
  const root = top.stdout.toString().trim()
  const listing = status.stdout.toString()
  const hash = createHash("sha1").update(head.stdout.toString()).update(listing)
  const stats = await Promise.all(
    listing
      .split("\0")
      .filter((entry) => entry.length > 3)
      .map((entry) => entry.slice(3))
      .map((file) =>
        fs
          .stat(path.join(root, file))
          .then((stat) => `${file}:${stat.size}:${stat.mtimeMs}`)
          .catch(() => `${file}:-`),
      ),
  )
  return hash.update(stats.join("\n")).digest("hex")
}

interface Shared {
  promise: Promise<Verify.CheckResult>
  controller: AbortController
  users: number
}

const MAX_ENTRIES = 256
const cache = new Map<string, Shared>()

function remember(key: string, entry: Shared) {
  cache.set(key, entry)
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!)
}

/**
 * One check through the cache. A consumer that cancels only stops the shared run when nobody else
 * is waiting on it. Results that are not a real pass or fail (timed out, cancelled) are not kept.
 */
export function run(
  check: Verify.Check,
  dir: string,
  tree: string | undefined,
  options: Verify.RunOptions,
): Promise<Verify.CheckResult> {
  if (!tree) return Verify.runCheck(check, dir, { ...options, lowPriority: true })
  const key = `${tree}\0${check.dir ?? dir}\0${check.command}`
  const entry =
    cache.get(key) ??
    (() => {
      const controller = new AbortController()
      const created: Shared = {
        controller,
        users: 0,
        promise: Verify.runCheck(check, dir, { ...options, cancel: controller.signal, lowPriority: true }).then(
          (result) => {
            if (result.status !== "passed" && result.status !== "failed") cache.delete(key)
            return result
          },
          (error: unknown) => {
            cache.delete(key)
            throw error
          },
        ),
      }
      remember(key, created)
      return created
    })()
  entry.users++
  const cancel = options.cancel
  if (!cancel) return entry.promise.finally(() => entry.users--)
  return new Promise<Verify.CheckResult>((resolve, reject) => {
    const abort = () => {
      entry.users--
      if (entry.users <= 0) entry.controller.abort()
      resolve(Verify.notRun(check, "cancelled"))
    }
    if (cancel.aborted) return abort()
    cancel.addEventListener("abort", abort, { once: true })
    entry.promise.then(
      (result) => {
        cancel.removeEventListener("abort", abort)
        entry.users--
        resolve(result)
      },
      (error) => {
        cancel.removeEventListener("abort", abort)
        entry.users--
        reject(error)
      },
    )
  })
}

/** A batch in parallel, through the cache. */
export function runAll(checks: Verify.Check[], dir: string, tree: string | undefined, options: Verify.RunOptions) {
  return Promise.all(
    checks.map((check) =>
      run(check, dir, tree, options).catch((error: unknown) =>
        Verify.notRun(check, `could not start: ${error instanceof Error ? error.message : String(error)}`),
      ),
    ),
  )
}

interface Live {
  tree: string
  controller: AbortController
  results?: Verify.CheckResult[]
  reported: boolean
  done: Promise<void>
}

const live = new Map<string, Live>()
// Failures the agent was already told about, by command and output. A failure that was already
// there before the agent's change would otherwise be re-announced on every step and every turn.
const told = new Map<string, Set<string>>()

function identity(result: Verify.CheckResult) {
  return `${result.dir ?? ""}\0${result.command}\0${createHash("sha1").update(result.output).digest("hex")}`
}

/**
 * Starts the session's checks in the background for the tree as it is now, replacing any older
 * live run for that session. Returns immediately.
 */
export async function kick(
  sessionID: string,
  input: { dir: string; checks: Verify.Check[]; options: Omit<Verify.RunOptions, "cancel"> },
) {
  if (input.checks.length === 0) return
  const tree = await fingerprint(input.dir)
  if (!tree) return
  const previous = live.get(sessionID)
  if (previous?.tree === tree) return
  previous?.controller.abort()
  const controller = new AbortController()
  const current: Live = {
    tree,
    controller,
    reported: false,
    done: runAll(input.checks, input.dir, tree, { ...input.options, cancel: controller.signal }).then((results) => {
      if (live.get(sessionID) === current) current.results = results
    }),
  }
  live.set(sessionID, current)
}

/**
 * Waits, up to `ms`, for the session's live run to finish, then returns its unreported failures.
 * Used when the agent is about to finish, so it does not end a turn on a broken build.
 */
export async function settled(sessionID: string, dir: string, ms: number) {
  const current = live.get(sessionID)
  if (!current) return []
  await Promise.race([current.done, Bun.sleep(ms)])
  return failures(sessionID, dir)
}

/**
 * Failures from the session's finished live run, once: a run that is still going, already
 * reported, or clean returns nothing. Only reported while the tree has not changed since.
 */
export async function failures(sessionID: string, dir: string) {
  const current = live.get(sessionID)
  if (!current?.results || current.reported) return []
  if ((await fingerprint(dir)) !== current.tree) return []
  current.reported = true
  const seen = told.get(sessionID) ?? new Set<string>()
  told.set(sessionID, seen)
  return current.results
    .filter((result) => result.status === "failed" || result.status === "timed_out")
    .filter((result) => {
      const key = identity(result)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/**
 * Records the end-of-turn results as the session's latest run, so failures the agent has not been
 * told about yet reach it on its next step. A tree it was already told about stays reported.
 */
export function settle(sessionID: string, tree: string, results: Verify.CheckResult[]) {
  const previous = live.get(sessionID)
  if (previous?.tree === tree && previous.reported) return
  if (previous && previous.tree !== tree) previous.controller.abort()
  live.set(sessionID, {
    tree,
    controller: previous?.controller ?? new AbortController(),
    results,
    reported: false,
    done: Promise.resolve(),
  })
}

export function stop(sessionID: string) {
  live.get(sessionID)?.controller.abort()
  live.delete(sessionID)
  told.delete(sessionID)
}

const DOC_EXTENSIONS = new Set([".md", ".mdx", ".markdown", ".rst", ".adoc"])
const DOC_NAMES = new Set(["license", "licence", "changelog", "authors", "notice", "codeowners"])

/** True when every edited file is documentation, so no check can be affected by the edit. */
export function docsOnly(files: string[]) {
  return (
    files.length > 0 &&
    files.every((file) => {
      const base = path.basename(file).toLowerCase()
      return DOC_EXTENSIONS.has(path.extname(base)) || DOC_NAMES.has(base.replace(/\.[^.]+$/, ""))
    })
  )
}

export function failureReminder(results: Verify.CheckResult[]) {
  return [
    "<system-reminder>",
    "RIFT ran the project's checks in the background after your latest edits, and these failed:",
    ...results.map(
      (result) =>
        `\n\`${result.command}\`${result.where ? ` (in ${result.where})` : ""} ${result.status === "timed_out" ? "timed out" : `exited ${result.code}`}:\n${result.output}`,
    ),
    "\nFix them before you finish, or say plainly why a failure is unrelated to your change.",
    "</system-reminder>",
  ].join("\n")
}

export * as CheckRunner from "./check-runner"

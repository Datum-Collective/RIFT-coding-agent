import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { spawn } from "child_process"
import { Shell } from "@opencode-ai/core/shell"
import { Process } from "@/util/process"
import { BrowserSession } from "@/browser/session"
import { find } from "@/browser/discover"
import type { Evidence } from "./evidence"

// Verification / trust layer: after an agent claims it is done, actually run the repo's own
// checks and report the real output instead of trusting the agent's "tests pass".

export interface Check {
  name: string
  command: string
  /** Directory to run in, when it is not the project root (monorepo packages). */
  dir?: string
  /** `dir` relative to the project root, for display. */
  where?: string
}

/**
 * Outcome of one check. "not_run" covers everything that stopped a check from executing
 * (permission denied, session cancelled) and is never reported as a pass.
 */
export type Status = "passed" | "failed" | "timed_out" | "not_run"

export interface CheckResult extends Check {
  status: Status
  /** Why a check was not run. */
  reason?: string
  code?: number
  ms: number
  output: string
}

export interface Entry {
  check: Check
  /** Undefined until the check has finished (or been skipped). */
  result?: CheckResult
}

export interface Options {
  /** Explicit commands; skips auto-detection when set. They always run from the project root. */
  commands?: string[]
  /** Files the agent edited, used to find the nearest package in a monorepo. */
  files?: string[]
}

const TOOLS_THAT_EDIT = new Set(["edit", "write", "apply_patch"])
const SCRIPTS = ["typecheck", "lint", "test"] as const

export interface ToolUse {
  tool: string
  status: string
  input?: unknown
}

export function editedFiles(tools: ToolUse[]) {
  return tools.some((part) => TOOLS_THAT_EDIT.has(part.tool) && part.status === "completed")
}

/** Paths touched by completed edit-like tool calls, resolved against `root`. */
export function editedPaths(tools: ToolUse[], root: string) {
  const paths = new Set<string>()
  for (const part of tools) {
    if (!TOOLS_THAT_EDIT.has(part.tool) || part.status !== "completed") continue
    const input = typeof part.input === "object" && part.input !== null ? part.input : {}
    if ("filePath" in input && typeof input.filePath === "string") paths.add(path.resolve(root, input.filePath))
    if ("patchText" in input && typeof input.patchText === "string") {
      for (const match of input.patchText.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)) {
        paths.add(path.resolve(root, match[1].trim()))
      }
    }
  }
  return [...paths]
}

async function read(file: string) {
  return Bun.file(file)
    .text()
    .catch(() => undefined)
}

async function exists(file: string) {
  return Bun.file(file).exists()
}

// Lockfiles usually live at the workspace root, so look from the package up to the project root.
async function packageRunner(dir: string, root: string) {
  let current = dir
  while (!path.relative(root, current).startsWith("..")) {
    if ((await exists(path.join(current, "bun.lock"))) || (await exists(path.join(current, "bun.lockb"))))
      return "bun run"
    if (await exists(path.join(current, "pnpm-lock.yaml"))) return "pnpm run"
    if (await exists(path.join(current, "yarn.lock"))) return "yarn run"
    if (current === root) break
    current = path.dirname(current)
  }
  return "npm run"
}

// Scripts that only exist to refuse to run (npm's default placeholder, "do not run from root" guards).
function isPlaceholder(script: string) {
  return /no test specified/.test(script) || /(^|&&|;)\s*exit 1\s*$/.test(script)
}

export async function detect(dir: string, root = dir): Promise<Check[]> {
  const checks: Check[] = []

  const pkg = await read(path.join(dir, "package.json"))
  if (pkg) {
    const scripts = (() => {
      try {
        const parsed: unknown = JSON.parse(pkg)
        const value = typeof parsed === "object" && parsed !== null && "scripts" in parsed ? parsed.scripts : undefined
        return typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : {}
      } catch {
        return {}
      }
    })()
    const runner = await packageRunner(dir, root)
    for (const name of SCRIPTS) {
      const script = scripts[name]
      if (typeof script === "string" && !isPlaceholder(script)) checks.push({ name, command: `${runner} ${name}` })
    }
  }

  if (await exists(path.join(dir, "go.mod"))) {
    checks.push({ name: "go vet", command: "go vet ./..." }, { name: "go test", command: "go test ./..." })
  }
  if (await exists(path.join(dir, "Cargo.toml"))) {
    checks.push({ name: "cargo check", command: "cargo check" }, { name: "cargo test", command: "cargo test" })
  }
  const pyproject = await read(path.join(dir, "pyproject.toml"))
  if ((await exists(path.join(dir, "pytest.ini"))) || pyproject?.includes("[tool.pytest")) {
    checks.push({ name: "pytest", command: "pytest" })
  }

  return checks
}

function tail(text: string, lines = 40) {
  const all = text.trim().split("\n")
  return all.length <= lines ? all.join("\n") : ["…", ...all.slice(-lines)].join("\n")
}

/**
 * Picks the checks to run. Explicit commands win. Otherwise each edited file uses the nearest
 * directory (walking up to the project root) that has checks of its own, so a change in one
 * monorepo package runs that package's scripts. Files outside the project are checked in their
 * own directory only. With no usable files it falls back to the root, but never when every edit
 * landed outside the project: that would run the wrong project's checks.
 */
export async function resolve(dir: string, options: Options = {}): Promise<Check[]> {
  if (options.commands?.length) return options.commands.map((command) => ({ name: command, command }))

  const cache = new Map<string, Check[]>()
  const detectIn = async (target: string) => {
    const hit = cache.get(target)
    if (hit) return hit
    const found = await detect(target, insideProject(dir, target) ? dir : target)
    cache.set(target, found)
    return found
  }

  const files = options.files ?? []
  const targets = new Set<string>()
  for (const file of files) {
    let current = path.dirname(file)
    if (!insideProject(dir, current)) {
      const home = os.homedir()
      while (current !== home && current !== path.dirname(current)) {
        if ((await detectIn(current)).length > 0) {
          targets.add(current)
          break
        }
        current = path.dirname(current)
      }
      continue
    }
    while (!path.relative(dir, current).startsWith("..")) {
      if ((await detectIn(current)).length > 0) {
        targets.add(current)
        break
      }
      if (current === dir) break
      current = path.dirname(current)
    }
  }
  if (targets.size === 0) return files.some((file) => insideProject(dir, file)) || files.length === 0 ? detectIn(dir) : []

  const checks: Check[] = []
  for (const target of [...targets].sort()) {
    const where = insideProject(dir, target) ? path.relative(dir, target) : target
    for (const check of await detectIn(target)) checks.push({ ...check, dir: target, where })
  }
  return checks
}

export function notRun(check: Check, reason: string): CheckResult {
  return { ...check, status: "not_run", reason, ms: 0, output: "" }
}

const MAX_OUTPUT_CHARS = 200_000

// Runs one command in the user's configured shell (same as the bash tool, so PATH and version managers
// behave the same) and kills the whole process tree when aborted.
function exec(shell: string, command: string, cwd: string, signal?: AbortSignal) {
  return new Promise<{ code: number; output: string }>((resolve, reject) => {
    const proc = spawn(shell, Shell.args(shell, command, cwd), {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: process.platform === "win32",
    })
    let output = ""
    let exited = false
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-MAX_OUTPUT_CHARS)
    }
    proc.stdout?.on("data", collect)
    proc.stderr?.on("data", collect)
    const abort = () => void Shell.killTree(proc, { exited: () => exited })
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) abort()
    proc.once("error", (error) => {
      signal?.removeEventListener("abort", abort)
      reject(error)
    })
    proc.once("close", (code) => {
      exited = true
      signal?.removeEventListener("abort", abort)
      resolve({ code: code ?? 1, output })
    })
  })
}

export interface RunOptions {
  /** Kill the check after this many ms. 0 disables the timeout. */
  timeoutMs: number
  /** Cancels the check, e.g. when the session is aborted. */
  cancel?: AbortSignal
  shell?: string
}

export async function runCheck(check: Check, dir: string, options: RunOptions): Promise<CheckResult> {
  const started = Date.now()
  const timeout = options.timeoutMs > 0 ? AbortSignal.timeout(options.timeoutMs) : undefined
  const signals = [timeout, options.cancel].filter((item): item is AbortSignal => !!item)
  const abort = signals.length ? AbortSignal.any(signals) : undefined
  const result = await exec(options.shell ?? Shell.acceptable(), check.command, check.dir ?? dir, abort)
  const ms = Date.now() - started
  const output = tail(result.output)
  if (options.cancel?.aborted)
    return { ...check, status: "not_run", reason: "cancelled", code: result.code, ms, output }
  if (timeout?.aborted) return { ...check, status: "timed_out", code: result.code, ms, output }
  return { ...check, status: result.code === 0 ? "passed" : "failed", code: result.code, ms, output }
}

/** Files changed relative to HEAD, including untracked. Empty outside a git repo. */
export async function changedFiles(dir: string): Promise<string[]> {
  const result = await Process.run(["git", "status", "--porcelain"], { cwd: dir, nothrow: true })
  if (result.code !== 0) return []
  return result.stdout
    .toString()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).split(" -> ").pop()!.replace(/^"|"$/g, ""))
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}\n… (truncated, ${text.length - max} more characters)` : text
}

function insideProject(dir: string, file: string) {
  return !path.relative(dir, path.resolve(dir, file)).startsWith("..")
}

/** Current on-disk contents of `files`, for showing a reviewer. Skips unreadable files and paths outside `dir`. */
export async function fileContents(dir: string, files: string[], max = 100_000) {
  const sections = await Promise.all(
    files.map(async (file) => {
      if (!insideProject(dir, file)) return undefined
      const text = await read(path.resolve(dir, file))
      return text === undefined ? undefined : `--- ${file} ---\n${truncate(text, max)}`
    }),
  )
  return sections.filter((item): item is string => !!item).join("\n\n")
}

/**
 * Diff of `files` for the model to read: tracked changes from `git diff HEAD`, plus untracked
 * files rendered as additions (git omits those). Files with no git history to diff against,
 * because they sit outside the project or the project isn't a repo, are shown as their current
 * contents, so a site built in ~/Desktop can still be checked. Read-only: it never touches the index.
 */
export async function turnDiff(dir: string, files: string[], max = 100_000) {
  const inside = files.filter((file) => insideProject(dir, file))
  const outside = files.filter((file) => !insideProject(dir, file)).map((file) => path.resolve(dir, file))
  const relative = inside.map((file) => path.relative(dir, path.resolve(dir, file)))

  const tracked =
    relative.length > 0 ? await Process.run(["git", "diff", "HEAD", "--", ...relative], { cwd: dir, nothrow: true }) : undefined
  const repo = tracked?.code === 0

  const untracked = repo
    ? await Process.run(["git", "ls-files", "--others", "--exclude-standard", "--", ...relative], {
        cwd: dir,
        nothrow: true,
      })
    : undefined
  const added = untracked?.code === 0 ? untracked.stdout.toString().split("\n").filter(Boolean) : []

  const sections = await Promise.all([
    ...added.map(async (file) => (await asAddition(path.resolve(dir, file), `new file: ${file}`)) ?? `--- new file: ${file} (unreadable) ---`),
    ...[...(repo ? [] : relative), ...outside].map((file) =>
      asAddition(path.resolve(dir, file), `current contents, no git history: ${file}`),
    ),
  ])

  return truncate(
    [tracked?.code === 0 ? tracked.stdout.toString().trim() : "", ...sections]
      .filter((item): item is string => !!item)
      .join("\n\n"),
    max,
  )
}

async function asAddition(file: string, label: string) {
  const text = await read(file)
  if (text === undefined) return undefined
  const body = text
    .split("\n")
    .map((line) => `+${line}`)
    .join("\n")
  return `--- ${label} ---\n${body}`
}

/** Uncommitted changes to `files` relative to HEAD. Empty outside a git repo or when nothing changed. */
export async function diffOf(dir: string, files: string[], max = 100_000) {
  const inside = files.filter((file) => insideProject(dir, file))
  if (inside.length === 0) return ""
  const result = await Process.run(["git", "diff", "HEAD", "--", ...inside], { cwd: dir, nothrow: true })
  return result.code === 0 ? truncate(result.stdout.toString().trim(), max) : ""
}

export interface Mismatch {
  claim: string
  reality: string
}

/**
 * Result of comparing the agent's own summary against the real diff.
 * "not_run" covers a disabled, failed or unparseable check; it never means "the claims are fine".
 */
export type Claims =
  | { status: "off" }
  | { status: "pending" }
  | { status: "ok" }
  | { status: "mismatch"; items: Mismatch[] }
  | { status: "not_run"; reason: string }

/**
 * Reads the claims-check verdict. Returns undefined when the text is not a usable verdict, so the
 * caller reports "not run" rather than treating a bad reply as agreement.
 */
export function parseClaims(text: string): Mismatch[] | undefined {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end <= start) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (typeof parsed !== "object" || parsed === null || !("mismatches" in parsed)) return undefined
  const raw = parsed.mismatches
  if (!Array.isArray(raw)) return undefined
  const items: Mismatch[] = []
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue
    const claim = "claim" in item ? item.claim : undefined
    const reality = "reality" in item ? item.reality : undefined
    if (typeof claim === "string" && typeof reality === "string" && claim.trim()) {
      items.push({ claim: claim.trim(), reality: reality.trim() })
    }
  }
  return items
}

/** A page loaded and read after the commands ran. */
export type BrowserCheck = {
  url: string
  status: "passed" | "failed" | "not_run"
  reason?: string
  httpStatus?: number
  title?: string
  errors: string[]
}

export interface Report {
  entries: Entry[]
  /** Files changed since the task started, when the project is a git repo. */
  scopeFiles: string[]
  scopeWarnFiles: number
  /** False while checks are still queued or running. */
  done: boolean
  claims?: Claims
  browser?: BrowserCheck
  /** Per-node evidence RIFT gathered for the engineering graph. */
  evidence?: Evidence.Record[]
}

function describe(result: CheckResult) {
  const seconds = `${(result.ms / 1000).toFixed(1)}s`
  if (result.status === "passed") return `✓ passed in ${seconds}`
  if (result.status === "timed_out") return `✗ timed out after ${seconds}`
  if (result.status === "not_run") return `– not run (${result.reason ?? "skipped"})`
  return `✗ failed (exit ${result.code}) in ${seconds}`
}

/**
 * Loads a page and reports what actually rendered. A UI change that typechecks and passes its
 * tests can still throw on every render, and only the console says so.
 */
/**
 * A page this turn built, for the browser check when no URL is configured: `index.html` first,
 * else the first edited HTML file. Lets a plain static site be verified with nothing set up.
 */
export async function editedPage(files: string[]) {
  const pages = files.filter((file) => /\.html?$/i.test(file))
  const page = pages.find((file) => path.basename(file).toLowerCase() === "index.html") ?? pages[0]
  if (!page || !(await exists(page))) return undefined
  return pathToFileURL(page).href
}

export async function checkBrowser(url: string, timeoutMs = 30_000): Promise<BrowserCheck> {
  if (!find()) return { url, status: "not_run", reason: "no browser found", errors: [] }
  let session: BrowserSession | undefined
  try {
    session = await BrowserSession.launch()
    const state = await session.navigate(url, timeoutMs)
    const errors = state.console.filter((entry) => entry.level === "error").map((entry) => entry.text)
    // No response at all means the request never reached a server — the browser is showing its
    // own error page. A clean console there must not read as a page that works. Local files
    // never get an HTTP response, and editedPage only offers files that exist.
    if (state.status === undefined && !url.startsWith("file://")) {
      return { url, status: "failed", reason: "the page did not load (no HTTP response)", title: state.title, errors }
    }
    return {
      url,
      status: errors.length > 0 || (state.status ?? 0) >= 400 ? "failed" : "passed",
      httpStatus: state.status,
      title: state.title,
      errors,
    }
  } catch (error) {
    return {
      url,
      status: "not_run",
      reason: error instanceof Error ? error.message : String(error),
      errors: [],
    }
  } finally {
    await session?.close().catch(() => {})
  }
}

/** Key under which the structured report rides along on the verification text part. */
export const METADATA_KEY = "rift_verification"

/** Wire status: a check that has not started yet is "queued", never "not_run". */
export type ReportedStatus = Status | "queued"

export interface Summary {
  done: boolean
  checks: Array<{ command: string; where?: string; status: ReportedStatus; reason?: string; ms: number }>
  passed: number
  failed: number
  notRun: number
  scopeFiles: number
  scopeWarnFiles: number
  claims?: Claims
  browser?: BrowserCheck
  /** Evidence without command output: the transcript text carries that for failures. */
  evidence?: Array<Omit<Evidence.Record, "output">>
}

/** Machine-readable twin of `format`. Kept beside it so the two cannot drift apart. */
export function summarize(report: Report): Summary {
  const results = report.entries.flatMap((entry) => (entry.result ? [entry.result] : []))
  const count = (status: Status) => results.filter((item) => item.status === status).length
  return {
    done: report.done,
    checks: report.entries.map((entry) => ({
      command: entry.check.command,
      where: entry.check.where,
      // Matches what format() prints: unfinished checks are queued, not "did not run".
      status: entry.result?.status ?? (report.done ? "not_run" : "queued"),
      reason: entry.result?.reason,
      ms: entry.result?.ms ?? 0,
    })),
    passed: count("passed"),
    failed: count("failed") + count("timed_out"),
    notRun: count("not_run"),
    scopeFiles: report.scopeFiles.length,
    scopeWarnFiles: report.scopeWarnFiles,
    claims: report.claims,
    browser: report.browser,
    evidence: report.evidence?.map(({ output: _, ...record }) => record),
  }
}

export function format(report: Report) {
  const { entries, scopeFiles, scopeWarnFiles, done } = report
  const lines = ["Automated verification (real command output, not the agent's claim)"]
  if (entries.length === 0 && !report.browser && !report.evidence?.length) {
    lines.push(
      "Not configured: no test, typecheck or lint commands were found for this project, so nothing was verified.",
      "Set `verify_commands` in your config to choose the commands to run.",
    )
  }
  for (const entry of entries) {
    const state = entry.result ? describe(entry.result) : done ? "– not run" : "… queued"
    lines.push(`- \`${entry.check.command}\`${entry.check.where ? ` in ${entry.check.where}` : ""} ${state}`)
  }
  for (const entry of entries) {
    const result = entry.result
    if (!result || result.status === "passed" || !result.output) continue
    lines.push("", `Output of \`${result.command}\`:`, "```", result.output, "```")
  }
  const results = entries.flatMap((entry) => (entry.result ? [entry.result] : []))
  const count = (status: Status) => results.filter((r) => r.status === status).length
  if (done && entries.length > 0) {
    const failed = count("failed") + count("timed_out")
    const parts = [`${count("passed")} passed`, `${failed} failed`, `${count("not_run")} not run`]
    lines.push("", `${parts.join(", ")}.`)
    if (failed > 0) lines.push("Do not treat this task as done until the failing checks are fixed.")
    else if (count("not_run") > 0) lines.push("Some checks did not run, so this task is not fully verified.")
  }
  const browser = report.browser
  if (browser) {
    const label = `- ${browser.url}`
    if (browser.status === "passed") {
      lines.push(`${label} ✓ rendered${browser.httpStatus ? ` (${browser.httpStatus})` : ""}, no console errors`)
    } else if (browser.status === "not_run") {
      lines.push(`${label} – not checked (${browser.reason ?? "unknown"})`)
    } else {
      lines.push(
        `${label} ✗ ${browser.httpStatus && browser.httpStatus >= 400 ? `HTTP ${browser.httpStatus}` : `${browser.errors.length} console ${browser.errors.length === 1 ? "error" : "errors"}`}`,
      )
      for (const error of browser.errors.slice(0, 5)) lines.push(`    ${error}`)
    }
  }

  const evidence = report.evidence ?? []
  if (evidence.length > 0) {
    lines.push("", "Evidence per requirement (gathered by RIFT, not claimed by the agent):")
    for (const node of [...new Set(evidence.map((record) => record.node))]) {
      const records = evidence.filter((record) => record.node === node)
      lines.push(`- ${records[0].title}`)
      for (const record of records) {
        const mark = record.status === "passed" ? "✓" : record.status === "failed" ? "✗" : record.status === "queued" ? "…" : "○"
        lines.push(`  ${mark} ${record.label}${record.detail ? `: ${record.detail}` : ""}${record.artifact ? ` (${record.artifact})` : ""}`)
      }
    }
    for (const record of evidence) {
      if (record.status !== "failed" || !record.output) continue
      lines.push("", `Output of ${record.label} for ${record.title}:`, "```", record.output, "```")
    }
    const unproven = evidence.filter((record) => record.status !== "passed" && record.status !== "queued")
    if (done && unproven.length > 0) {
      lines.push("", `${unproven.length} ${unproven.length === 1 ? "requirement check is" : "requirement checks are"} not proven. Do not call those requirements done.`)
    }
  }

  const claims = report.claims
  if (claims && claims.status !== "off") {
    if (claims.status === "pending") lines.push("", "Checking the summary against the diff…")
    if (claims.status === "ok") lines.push("", "Summary matches the diff.")
    if (claims.status === "not_run") lines.push("", `Summary vs diff: not run (${claims.reason}).`)
    if (claims.status === "mismatch") {
      lines.push("", `⚠ Summary does not match the diff (${claims.items.length}):`)
      for (const item of claims.items) lines.push(`- Claimed: ${item.claim}`, `  Actually: ${item.reality}`)
    }
  }
  if (scopeWarnFiles > 0 && scopeFiles.length > scopeWarnFiles) {
    lines.push(
      "",
      `⚠ Scope: ${scopeFiles.length} files changed since this task started (threshold ${scopeWarnFiles}). If this was meant to be a small change, review the diff.`,
    )
  }
  return lines.join("\n")
}

export * as Verify from "./verify"

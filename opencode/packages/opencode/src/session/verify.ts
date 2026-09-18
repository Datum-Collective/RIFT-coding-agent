import path from "path"
import { spawn } from "child_process"
import { Shell } from "@opencode-ai/core/shell"
import { Process } from "@/util/process"

// Verification / trust layer: after an agent claims it is done, actually run the repo's own
// checks and report the real output instead of trusting the agent's "tests pass".

export interface Check {
  name: string
  command: string
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
  /** Explicit commands; skips auto-detection when set. */
  commands?: string[]
}

const TOOLS_THAT_EDIT = new Set(["edit", "write", "apply_patch"])
const SCRIPTS = ["typecheck", "lint", "test"] as const

export function editedFiles(tools: Array<{ tool: string; status: string }>) {
  return tools.some((part) => TOOLS_THAT_EDIT.has(part.tool) && part.status === "completed")
}

async function read(file: string) {
  return Bun.file(file)
    .text()
    .catch(() => undefined)
}

async function exists(file: string) {
  return Bun.file(file).exists()
}

async function packageRunner(dir: string) {
  if ((await exists(path.join(dir, "bun.lock"))) || (await exists(path.join(dir, "bun.lockb")))) return "bun run"
  if (await exists(path.join(dir, "pnpm-lock.yaml"))) return "pnpm run"
  if (await exists(path.join(dir, "yarn.lock"))) return "yarn run"
  return "npm run"
}

// Scripts that only exist to refuse to run (npm's default placeholder, "do not run from root" guards).
function isPlaceholder(script: string) {
  return /no test specified/.test(script) || /(^|&&|;)\s*exit 1\s*$/.test(script)
}

export async function detect(dir: string): Promise<Check[]> {
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
    const runner = await packageRunner(dir)
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

export async function resolve(dir: string, options: Options = {}): Promise<Check[]> {
  if (options.commands?.length) return options.commands.map((command) => ({ name: command, command }))
  return detect(dir)
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
  const result = await exec(options.shell ?? Shell.acceptable(), check.command, dir, abort)
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

export interface Report {
  entries: Entry[]
  /** Files changed since the task started, when the project is a git repo. */
  scopeFiles: string[]
  scopeWarnFiles: number
  /** False while checks are still queued or running. */
  done: boolean
}

function describe(result: CheckResult) {
  const seconds = `${(result.ms / 1000).toFixed(1)}s`
  if (result.status === "passed") return `✓ passed in ${seconds}`
  if (result.status === "timed_out") return `✗ timed out after ${seconds}`
  if (result.status === "not_run") return `– not run (${result.reason ?? "skipped"})`
  return `✗ failed (exit ${result.code}) in ${seconds}`
}

export function format(report: Report) {
  const { entries, scopeFiles, scopeWarnFiles, done } = report
  const lines = ["Automated verification (real command output, not the agent's claim)"]
  if (entries.length === 0) {
    lines.push(
      "Not configured: no test, typecheck or lint commands were found for this project, so nothing was verified.",
      "Set `verify_commands` in your config to choose the commands to run.",
    )
  }
  for (const entry of entries) {
    const state = entry.result ? describe(entry.result) : done ? "– not run" : "… queued"
    lines.push(`- \`${entry.check.command}\` ${state}`)
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
  if (scopeWarnFiles > 0 && scopeFiles.length > scopeWarnFiles) {
    lines.push(
      "",
      `⚠ Scope: ${scopeFiles.length} files changed since this task started (threshold ${scopeWarnFiles}). If this was meant to be a small change, review the diff.`,
    )
  }
  return lines.join("\n")
}

export * as Verify from "./verify"

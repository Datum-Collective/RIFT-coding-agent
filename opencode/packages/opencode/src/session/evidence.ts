/**
 * Evidence graph: RIFT never relies on an agent saying something works.
 *
 * The agent declares, per engineering-graph node, how that node should be proven (`checks`). This
 * module turns those declarations into evidence RIFT produced itself: an exit code, an HTTP status,
 * console errors, a saved screenshot, files on disk. Each record says why it passed or failed, so
 * the result is an inspectable record rather than a confidence score.
 */
import path from "path"
import { fileURLToPath } from "url"
import { Global } from "@opencode-ai/core/global"
import type { EngineeringGraph } from "./engineering-graph"
import { BrowserSession } from "@/browser/session"
import { find } from "@/browser/discover"
import { ShellID } from "@/tool/shell/id"
import { Verify } from "./verify"

export type Kind = EngineeringGraph.Info["checks"][number]["kind"] | "implementation"
export type Status = "passed" | "failed" | "not_run" | "queued"

/** One piece of evidence to gather: an Implementation check, or a check the agent declared. */
export interface Planned {
  node: string
  title: string
  kind: Kind
  label: string
  command?: string
  cwd?: string
  url?: string
  files?: readonly string[]
}

export interface Record {
  node: string
  title: string
  kind: Kind
  label: string
  status: Status
  /** Why RIFT believes this: exit code, HTTP status, console errors, missing files. */
  detail: string
  ms: number
  /** The tail of a command's output. */
  output?: string
  /** A file RIFT produced as evidence, such as a screenshot. */
  artifact?: string
}

export interface RunOptions {
  /** The project root: where commands run and relative files resolve by default. */
  directory: string
  timeoutMs: number
  cancel?: AbortSignal
  shell?: string
}

const LABEL: { [K in Kind]: string } = {
  implementation: "Implementation",
  typecheck: "Type check",
  unit: "Unit tests",
  integration: "Integration tests",
  browser: "Browser test",
  http: "HTTP check",
  screenshot: "Screenshot",
  static: "Static analysis",
  security: "Security check",
  load: "Load test",
  production: "Production check",
}

export function plan(nodes: readonly EngineeringGraph.Info[]): Planned[] {
  return nodes.flatMap((node) => [
    ...(node.files.length > 0
      ? [{ node: node.id, title: node.title, kind: "implementation" as const, label: LABEL.implementation, files: node.files }]
      : []),
    ...node.checks.map((check) => ({
      node: node.id,
      title: node.title,
      kind: check.kind,
      label: check.label ?? LABEL[check.kind],
      command: check.command,
      cwd: check.cwd,
      url: check.url,
    })),
  ])
}

/**
 * The permission an item needs before RIFT runs it: the same one the agent would need to do it
 * as a tool call. Implementation evidence only checks declared files exist, so it needs none.
 */
export function permission(item: Planned, worktree: string) {
  if (item.command) return { permission: ShellID.ToolID, patterns: [item.command] }
  if (item.url?.startsWith("file://")) {
    return { permission: "read", patterns: [path.relative(worktree, fileURLToPath(item.url))] }
  }
  if (item.url) return { permission: "browser_open", patterns: [item.url] }
  return undefined
}

export function queued(item: Planned): Record {
  return { node: item.node, title: item.title, kind: item.kind, label: item.label, status: "queued", detail: "", ms: 0 }
}

export function notRun(item: Planned, reason: string): Record {
  return { ...queued(item), status: "not_run", detail: reason }
}

export async function run(item: Planned, options: RunOptions): Promise<Record> {
  if (item.kind === "implementation") return implementation(item, options.directory)
  if (item.command) return command(item, item.command, options)
  if (item.url && (item.kind === "browser" || item.kind === "screenshot")) return page(item, item.url)
  if (item.url) return http(item, item.url)
  return notRun(item, "no command or url was declared for it")
}

async function implementation(item: Planned, directory: string): Promise<Record> {
  const started = Date.now()
  const files = (item.files ?? []).map((file) => path.resolve(directory, file))
  const present = await Promise.all(files.map((file) => Bun.file(file).exists()))
  const missing = files.filter((_, index) => !present[index])
  const ms = Date.now() - started
  if (missing.length > 0) {
    const names = missing.map((file) => path.relative(directory, file)).join(", ")
    return { ...queued(item), status: "failed", detail: `missing: ${names}`, ms }
  }
  return {
    ...queued(item),
    status: "passed",
    detail: `${files.length} ${files.length === 1 ? "file" : "files"} present`,
    ms,
  }
}

async function command(item: Planned, command: string, options: RunOptions): Promise<Record> {
  const result = await Verify.runCheck({ name: item.label, command, dir: item.cwd }, options.directory, {
    timeoutMs: options.timeoutMs,
    cancel: options.cancel,
    shell: options.shell,
  })
  const base = { ...queued(item), ms: result.ms, output: result.output }
  if (result.status === "passed") return { ...base, status: "passed", detail: `${command} (exit 0)` }
  if (result.status === "timed_out") {
    return { ...base, status: "failed", detail: `${command} timed out after ${Math.round(result.ms / 1000)}s` }
  }
  if (result.status === "not_run") return { ...base, status: "not_run", detail: result.reason ?? "not run" }
  return { ...base, status: "failed", detail: `${command} (exit ${result.code ?? "?"})` }
}

async function page(item: Planned, url: string): Promise<Record> {
  if (item.kind === "screenshot") return screenshot(item, url)
  const started = Date.now()
  const result = await Verify.checkBrowser(url)
  const ms = Date.now() - started
  if (result.status === "not_run") return { ...queued(item), status: "not_run", detail: result.reason ?? "not run", ms }
  return { ...queued(item), status: result.status, detail: describePage(url, result.httpStatus, result.errors), ms }
}

async function screenshot(item: Planned, url: string): Promise<Record> {
  if (!find()) return notRun(item, "no browser found")
  const started = Date.now()
  const session = await BrowserSession.launch().catch(() => undefined)
  if (!session) return notRun(item, "could not start a browser")
  try {
    const state = await session.navigate(url)
    const errors = state.console.filter((entry) => entry.level === "error").map((entry) => entry.text)
    const file = path.join(Global.Path.state, "evidence", `${Date.now()}-${item.node.replace(/[^\w.-]/g, "_")}.png`)
    await Bun.write(file, Buffer.from(await session.screenshot(), "base64"))
    const failed = errors.length > 0 || (state.status ?? 0) >= 400
    return {
      ...queued(item),
      status: failed ? "failed" : "passed",
      detail: describePage(url, state.status, errors),
      artifact: file,
      ms: Date.now() - started,
    }
  } catch (error) {
    return { ...notRun(item, error instanceof Error ? error.message : String(error)), ms: Date.now() - started }
  } finally {
    await session.close().catch(() => {})
  }
}

async function http(item: Planned, url: string): Promise<Record> {
  const started = Date.now()
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "follow" }).catch(
    (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  )
  const ms = Date.now() - started
  if (response instanceof Error) return { ...queued(item), status: "failed", detail: `${url} unreachable: ${response.message}`, ms }
  return {
    ...queued(item),
    status: response.status < 400 ? "passed" : "failed",
    detail: `${url} → HTTP ${response.status} in ${ms}ms`,
    ms,
  }
}

function describePage(url: string, status: number | undefined, errors: readonly string[]) {
  const code = status === undefined ? "" : ` (HTTP ${status})`
  if (errors.length > 0) return `${url}${code}: ${errors.length} console ${errors.length === 1 ? "error" : "errors"}: ${errors[0]}`
  if ((status ?? 0) >= 400) return `${url}${code}`
  return `${url} rendered${code}, no console errors`
}

export * as Evidence from "./evidence"

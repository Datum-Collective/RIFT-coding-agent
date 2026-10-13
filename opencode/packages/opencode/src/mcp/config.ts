// Where MCP servers come from, and which of them a project has approved.
//
// Three scopes, later wins on a name clash:
//   user     ~/.rift/mcp.json                 { "mcpServers": { ... } }
//   project  .mcp.json (nearest, up to root)  { "mcpServers": { ... } }, checked into the repo
//   local    `mcp` in rift.json / opencode.json, global or project, in RIFT's own shape
//
// The `mcpServers` shape is the one Claude Code and other MCP clients use, so a project's
// existing .mcp.json works unchanged. Strings in it expand ${VAR} and ${VAR:-default}.
//
// A project server runs a command someone else committed, so it does not start until the
// user approves it. Decisions are remembered per project in <state>/mcp-projects.json.
import fs from "fs"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Flag } from "@opencode-ai/core/flag/flag"
import type { ConfigMCPV1 } from "@opencode-ai/core/v1/config/mcp"

export type Scope = "user" | "project" | "local"

export interface Entry {
  config: ConfigMCPV1.Info
  scope: Scope
  /** File the entry was read from, when it came from a file. */
  file?: string
}

/** One server in the `mcpServers` shape. `type` defaults to stdio when `command` is set. */
export interface ServerJson {
  type?: "stdio" | "http" | "sse" | "streamable-http"
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  timeout?: number
  disabled?: boolean
  oauth?: ConfigMCPV1.Remote["oauth"]
}

export const USER_FILE = () => path.join(Global.Path.home, ".rift", "mcp.json")
export const PROJECT_FILE = ".mcp.json"
const APPROVALS_FILE = () => path.join(Global.Path.state, "mcp-projects.json")

/**
 * Expand ${VAR} and ${VAR:-default}. Unset variables without a default become "" and are reported.
 * With `env` null the string is kept as written, which is how a server is saved back to a file.
 */
export function expand(value: string, env: Record<string, string | undefined> | null, missing?: Set<string>) {
  if (env === null) return value
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, name: string, fallback?: string) => {
    const found = env[name]
    if (found !== undefined && found !== "") return found
    if (fallback !== undefined) return fallback
    missing?.add(name)
    return ""
  })
}

function expandRecord(
  input: Record<string, string> | undefined,
  env: Record<string, string | undefined> | null,
  missing: Set<string>,
) {
  if (!input) return undefined
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, expand(String(value), env, missing)]))
}

/** Convert one `mcpServers` entry to RIFT's config shape. Throws on an entry that is neither stdio nor remote. */
export function fromJson(
  name: string,
  server: ServerJson,
  env: Record<string, string | undefined> | null = process.env,
  missing = new Set<string>(),
): ConfigMCPV1.Info {
  const enabled = server.disabled ? false : undefined
  const type = server.type ?? (server.command ? "stdio" : server.url ? "http" : undefined)
  if (type === "stdio") {
    if (!server.command) throw new Error(`MCP server "${name}" has no command`)
    return {
      type: "local",
      command: [expand(server.command, env, missing), ...(server.args ?? []).map((arg) => expand(String(arg), env, missing))],
      ...(server.env && { environment: expandRecord(server.env, env, missing) }),
      ...(server.cwd && { cwd: expand(server.cwd, env, missing) }),
      ...(server.timeout && { timeout: server.timeout }),
      ...(enabled === false && { enabled }),
    }
  }
  if (type === "http" || type === "sse" || type === "streamable-http") {
    if (!server.url) throw new Error(`MCP server "${name}" has no url`)
    return {
      type: "remote",
      url: expand(server.url, env, missing),
      ...(server.headers && { headers: expandRecord(server.headers, env, missing) }),
      ...(server.oauth !== undefined && { oauth: server.oauth }),
      ...(server.timeout && { timeout: server.timeout }),
      ...(enabled === false && { enabled }),
    }
  }
  throw new Error(`MCP server "${name}" needs a command (stdio) or a url (http, sse)`)
}

/** Convert RIFT's config shape to an `mcpServers` entry, for writing .mcp.json and ~/.rift/mcp.json. */
export function toJson(config: ConfigMCPV1.Info): ServerJson {
  if (config.type === "local") {
    const [command, ...args] = config.command
    return {
      command,
      ...(args.length && { args }),
      ...(config.environment && { env: config.environment }),
      ...(config.cwd && { cwd: config.cwd }),
      ...(config.timeout && { timeout: config.timeout }),
      ...(config.enabled === false && { disabled: true }),
    }
  }
  return {
    type: "http",
    url: config.url,
    ...(config.headers && { headers: config.headers }),
    ...(config.oauth !== undefined && { oauth: config.oauth }),
    ...(config.timeout && { timeout: config.timeout }),
    ...(config.enabled === false && { disabled: true }),
  }
}

export function readServersFile(file: string): Record<string, ServerJson> {
  let text: string
  try {
    text = fs.readFileSync(file, "utf8")
  } catch {
    return {}
  }
  const parsed = JSON.parse(text) as { mcpServers?: Record<string, ServerJson> }
  return parsed.mcpServers ?? {}
}

export function writeServersFile(file: string, update: (servers: Record<string, ServerJson>) => void) {
  let doc: { mcpServers?: Record<string, ServerJson> } & Record<string, unknown> = {}
  try {
    doc = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {}
  const servers = { ...doc.mcpServers }
  update(servers)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ ...doc, mcpServers: servers }, null, 2) + "\n")
}

/** .mcp.json files from the worktree root down to `directory`, nearest last. */
export function projectFiles(directory: string, worktree?: string) {
  const stop = worktree && worktree !== "/" ? path.resolve(worktree) : path.parse(directory).root
  const found: string[] = []
  let current = path.resolve(directory)
  while (true) {
    const file = path.join(current, PROJECT_FILE)
    if (fs.existsSync(file)) found.push(file)
    if (current === stop) break
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return found.reverse()
}

/** Where to write a project-scoped server: the nearest existing .mcp.json, else one at the project root. */
export function projectWriteFile(directory: string, worktree?: string) {
  return projectFiles(directory, worktree).at(-1) ?? path.join(projectRoot(directory, worktree), PROJECT_FILE)
}

export function projectRoot(directory: string, worktree?: string) {
  return worktree && worktree !== "/" ? worktree : directory
}

type Warn = (message: string, fields?: Record<string, unknown>) => void

/** All configured servers with their scope. `local` is the already-merged `mcp` key of the main config. */
export function load(input: {
  directory: string
  worktree?: string
  local?: Record<string, unknown>
  env?: Record<string, string | undefined>
  warn?: Warn
}): Record<string, Entry> {
  const env = input.env ?? process.env
  const warn: Warn = input.warn ?? (() => {})
  const result: Record<string, Entry> = {}

  const fromFile = (file: string, scope: Scope) => {
    let servers: Record<string, ServerJson>
    try {
      servers = readServersFile(file)
    } catch (error) {
      warn("could not read MCP config", { file, error: error instanceof Error ? error.message : String(error) })
      return
    }
    for (const [name, server] of Object.entries(servers)) {
      const missing = new Set<string>()
      try {
        result[name] = { config: fromJson(name, server, env, missing), scope, file }
      } catch (error) {
        warn("ignoring MCP server", { name, file, error: error instanceof Error ? error.message : String(error) })
        continue
      }
      if (missing.size) warn("MCP server config references unset variables", { name, file, missing: [...missing] })
    }
  }

  fromFile(USER_FILE(), "user")
  if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG)
    for (const file of projectFiles(input.directory, input.worktree)) fromFile(file, "project")
  for (const [name, entry] of Object.entries(input.local ?? {})) {
    if (typeof entry !== "object" || entry === null || !("type" in entry)) {
      // `{ enabled: false }` without a type turns off a server defined in another scope.
      if (typeof entry === "object" && entry !== null && (entry as { enabled?: boolean }).enabled === false && result[name]) {
        result[name] = { ...result[name], config: { ...result[name].config, enabled: false } }
        continue
      }
      warn("ignoring MCP config entry without type", { name })
      continue
    }
    result[name] = { config: entry as ConfigMCPV1.Info, scope: "local" }
  }
  return result
}

// --- approvals ---

export type Decision = "allow" | "deny"

interface ProjectState {
  approved?: string[]
  denied?: string[]
  disabled?: string[]
}

function readApprovals(): Record<string, ProjectState> {
  try {
    return JSON.parse(fs.readFileSync(APPROVALS_FILE(), "utf8"))
  } catch {
    return {}
  }
}

function writeApprovals(update: (state: ProjectState) => void, root: string) {
  const all = readApprovals()
  const state = all[root] ?? {}
  update(state)
  all[root] = state
  fs.mkdirSync(path.dirname(APPROVALS_FILE()), { recursive: true })
  fs.writeFileSync(APPROVALS_FILE(), JSON.stringify(all, null, 2) + "\n")
}

/** The remembered decision for a project server, if any. */
export function decision(root: string, name: string): Decision | undefined {
  const state = readApprovals()[root]
  if (state?.denied?.includes(name)) return "deny"
  if (state?.approved?.includes(name)) return "allow"
}

export function remember(root: string, name: string, value: Decision | undefined) {
  writeApprovals((state) => {
    state.approved = (state.approved ?? []).filter((item) => item !== name)
    state.denied = (state.denied ?? []).filter((item) => item !== name)
    if (value === "allow") state.approved.push(name)
    if (value === "deny") state.denied.push(name)
  }, root)
}

/** Servers the user turned off in /mcp for this project. Survives restarts; config is untouched. */
export function disabled(root: string) {
  return new Set(readApprovals()[root]?.disabled ?? [])
}

export function setDisabled(root: string, name: string, off: boolean) {
  writeApprovals((state) => {
    state.disabled = (state.disabled ?? []).filter((item) => item !== name)
    if (off) state.disabled.push(name)
  }, root)
}

export * as McpConfig from "./config"

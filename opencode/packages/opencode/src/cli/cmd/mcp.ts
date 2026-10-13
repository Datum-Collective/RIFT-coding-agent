import path from "path"
import { cmd } from "./cmd"
import { effectCmd } from "../effect-cmd"
import { Cause, Effect } from "effect"
import * as prompts from "@clack/prompts"
import { modify, applyEdits } from "jsonc-parser"
import { UI } from "../ui"
import { MCP } from "../../mcp"
import { McpAuth } from "../../mcp/auth"
import { McpConfig } from "../../mcp/config"
import { Config } from "@/config/config"
import { ConfigMCPV1 } from "@opencode-ai/core/v1/config/mcp"
import { InstanceRef } from "@/effect/instance-ref"
import { BRAND, LEGACY_BRAND, PROJECT_DIRS } from "@opencode-ai/core/brand"
import { Filesystem } from "@/util/filesystem"

const SCOPES = ["local", "project", "user"] as const
type Scope = (typeof SCOPES)[number]

const instance = Effect.gen(function* () {
  const ctx = yield* InstanceRef
  if (!ctx) return yield* Effect.die("InstanceRef not provided")
  return ctx
})

/** Every configured server with its scope, read from disk the same way the engine does. */
const entries = Effect.gen(function* () {
  const ctx = yield* instance
  const config = yield* Config.Service.use((cfg) => cfg.get())
  return McpConfig.load({
    directory: ctx.directory,
    worktree: ctx.worktree,
    local: config.mcp as Record<string, unknown> | undefined,
    warn: (message, fields) => prompts.log.warn(`${message} ${JSON.stringify(fields ?? {})}`),
  })
})

function statusText(status: MCP.Status) {
  switch (status.status) {
    case "connected":
      return "connected"
    case "disabled":
      return "disabled"
    case "pending":
      return "not started"
    case "connecting":
      return "connecting (timed out waiting)"
    case "needs_approval":
      return "needs approval (open /mcp in the TUI)"
    case "needs_auth":
      return `needs authentication (run: ${BRAND} mcp auth <name>)`
    case "needs_client_registration":
    case "failed":
      return `failed: ${status.error}`
  }
}

function describe(config: ConfigMCPV1.Info) {
  return config.type === "remote" ? config.url : config.command.join(" ")
}

/** Parse KEY=VALUE pairs. */
function pairs(items: string[] | undefined, separator: RegExp, flag: string) {
  const result: Record<string, string> = {}
  for (const item of items ?? []) {
    const match = item.match(separator)
    if (!match || match.index === undefined || match.index === 0) throw new Error(`Invalid ${flag} value: ${item}`)
    result[item.slice(0, match.index).trim()] = item.slice(match.index + match[0].length).trim()
  }
  return result
}

/** The rift.json (or legacy opencode.json) a local-scope server is written to. */
async function localConfigPath(directory: string) {
  // An existing config is edited in place whatever it is called; a new one takes the RIFT name.
  const names = [`${BRAND}.json`, `${BRAND}.jsonc`, `${LEGACY_BRAND}.json`, `${LEGACY_BRAND}.jsonc`]
  const candidates = names.map((name) => path.join(directory, name))
  for (const dir of PROJECT_DIRS) candidates.push(...names.map((name) => path.join(directory, dir, name)))
  for (const candidate of candidates) if (await Filesystem.exists(candidate)) return candidate
  return candidates[0]
}

async function editLocal(file: string, name: string, value: ConfigMCPV1.Info | undefined) {
  const text = (await Filesystem.exists(file)) ? await Filesystem.readText(file) : "{}"
  const edits = modify(text, ["mcp", name], value, { formattingOptions: { tabSize: 2, insertSpaces: true } })
  await Filesystem.write(file, applyEdits(text, edits))
}

/** Write one server to a scope. Returns the file written. */
const save = Effect.fnUntraced(function* (scope: Scope, name: string, config: ConfigMCPV1.Info) {
  const ctx = yield* instance
  if (scope === "local") {
    const file = yield* Effect.promise(() => localConfigPath(ctx.directory))
    yield* Effect.promise(() => editLocal(file, name, config))
    return file
  }
  const file = scope === "user" ? McpConfig.USER_FILE() : McpConfig.projectWriteFile(ctx.directory, ctx.worktree)
  McpConfig.writeServersFile(file, (servers) => {
    servers[name] = McpConfig.toJson(config)
  })
  return file
})

function parseScope(value: string | undefined): Scope {
  const scope = (value ?? "local") as Scope
  if (!SCOPES.includes(scope)) throw new Error(`--scope must be one of ${SCOPES.join(", ")}`)
  return scope
}

const scopeOption = {
  alias: "s",
  describe: "where to save it: local (rift.json), project (.mcp.json, shared), user (~/.rift/mcp.json)",
  type: "string",
  choices: SCOPES,
} as const

export const McpAddCommand = effectCmd({
  command: "add <name> [target] [args..]",
  describe: "add a server: `add <name> -- <command> [args]` or `add -t http <name> <url>`",
  builder: (yargs) =>
    yargs
      .positional("name", { describe: "server name", type: "string", demandOption: true })
      .positional("target", { describe: "command (stdio) or URL (http, sse)", type: "string" })
      .positional("args", { describe: "arguments for the command", type: "string", array: true })
      .option("scope", { ...scopeOption, default: "local" })
      .option("transport", {
        alias: "t",
        describe: "stdio, http or sse (a URL target implies http)",
        type: "string",
        choices: ["stdio", "http", "sse"],
      })
      .option("env", { alias: "e", describe: "environment variable, KEY=value", type: "string", array: true })
      .option("header", { alias: "H", describe: 'HTTP header, "Name: value"', type: "string", array: true }),
  handler: Effect.fn("Cli.mcp.add")(function* (args) {
    // yargs turns numeric-looking words into numbers; a command line is all strings.
    const rest = [...(args.target ? [args.target] : []), ...(args.args ?? []), ...((args["--"] as unknown[]) ?? [])].map(String)
    const [target, ...extra] = rest
    if (!target) throw new Error("Give a command after -- for a stdio server, or a URL for an http server")
    const transport = args.transport ?? (URL.canParse(target) && /^https?:/.test(target) ? "http" : "stdio")
    let config: ConfigMCPV1.Info
    if (transport === "stdio") {
      if (args.header?.length) throw new Error("--header is only valid for http and sse servers")
      const env = pairs(args.env, /=/, "--env")
      config = { type: "local", command: [target, ...extra], ...(Object.keys(env).length && { environment: env }) }
    } else {
      if (!URL.canParse(target)) throw new Error(`Invalid URL: ${target}`)
      if (args.env?.length) throw new Error("--env is only valid for stdio servers")
      if (extra.length) throw new Error(`Unexpected arguments after the URL: ${extra.join(" ")}`)
      const headers = pairs(args.header, /:|=/, "--header")
      config = { type: "remote", url: target, ...(Object.keys(headers).length && { headers }) }
    }
    const file = yield* save(parseScope(args.scope), args.name, config)
    console.log(`Added ${transport} server "${args.name}" to ${file}`)
  }),
})

export const McpAddJsonCommand = effectCmd({
  command: "add-json <name> <json>",
  describe: 'add a server from JSON, e.g. \'{"command":"npx","args":["-y","pkg"]}\'',
  builder: (yargs) =>
    yargs
      .positional("name", { type: "string", demandOption: true })
      .positional("json", { type: "string", demandOption: true })
      .option("scope", { ...scopeOption, default: "local" }),
  handler: Effect.fn("Cli.mcp.addJson")(function* (args) {
    const parsed = JSON.parse(args.json) as McpConfig.ServerJson | ConfigMCPV1.Info
    // Accept both the mcpServers shape and RIFT's own `{ type: "local" | "remote" }` shape.
    const config =
      parsed.type === "local" || parsed.type === "remote"
        ? (parsed as ConfigMCPV1.Info)
        : McpConfig.fromJson(args.name, parsed as McpConfig.ServerJson, null)
    const file = yield* save(parseScope(args.scope), args.name, config)
    console.log(`Added server "${args.name}" to ${file}`)
  }),
})

export const McpRemoveCommand = effectCmd({
  command: "remove <name>",
  aliases: ["rm"],
  describe: "remove a server",
  builder: (yargs) => yargs.positional("name", { type: "string", demandOption: true }).option("scope", scopeOption),
  handler: Effect.fn("Cli.mcp.remove")(function* (args) {
    const ctx = yield* instance
    const all = yield* entries
    const found = all[args.name]
    const scope = args.scope ? parseScope(args.scope) : found?.scope
    if (!scope) throw new Error(`No MCP server named "${args.name}"`)
    if (scope === "local") {
      const file = yield* Effect.promise(() => localConfigPath(ctx.directory))
      if (!(yield* Effect.promise(() => Filesystem.exists(file)))) throw new Error(`No local server "${args.name}"`)
      yield* Effect.promise(() => editLocal(file, args.name, undefined))
      console.log(`Removed "${args.name}" from ${file}`)
      return
    }
    const file =
      scope === "user"
        ? McpConfig.USER_FILE()
        : found?.scope === "project" && found.file
          ? found.file
          : McpConfig.projectWriteFile(ctx.directory, ctx.worktree)
    let removed = false
    McpConfig.writeServersFile(file, (servers) => {
      removed = args.name in servers
      delete servers[args.name]
    })
    if (!removed) throw new Error(`No ${scope} server "${args.name}" in ${file}`)
    console.log(`Removed "${args.name}" from ${file}`)
  }),
})

export const McpListCommand = effectCmd({
  command: "list",
  aliases: ["ls"],
  describe: "list servers, their scope and whether they connect",
  handler: Effect.fn("Cli.mcp.list")(function* () {
    const mcp = yield* MCP.Service
    const all = yield* entries
    if (!Object.keys(all).length) {
      console.log(`No MCP servers configured. Add one with: ${BRAND} mcp add <name> -- <command>`)
      return
    }
    yield* mcp.settle(15_000)
    for (const server of yield* mcp.servers()) {
      const tools = server.tools.length ? `, ${server.tools.length} tools` : ""
      console.log(`${server.name} (${server.scope}): ${server.target} - ${statusText(server.status)}${tools}`)
    }
  }),
})

export const McpGetCommand = effectCmd({
  command: "get <name>",
  describe: "show one server's config, scope, status and tools",
  builder: (yargs) => yargs.positional("name", { type: "string", demandOption: true }),
  handler: Effect.fn("Cli.mcp.get")(function* (args) {
    const mcp = yield* MCP.Service
    const all = yield* entries
    const entry = all[args.name]
    if (!entry) throw new Error(`No MCP server named "${args.name}"`)
    yield* mcp.settle(15_000)
    const server = (yield* mcp.servers()).find((item) => item.name === args.name)
    const config = entry.config
    const lines = [
      `${args.name}`,
      `  scope:     ${entry.scope}${entry.file ? ` (${entry.file})` : ""}`,
      `  transport: ${config.type === "local" ? "stdio" : "http"}`,
      `  ${config.type === "local" ? "command" : "url"}:   ${describe(config)}`,
    ]
    if (config.type === "local" && config.environment)
      lines.push(`  env:       ${Object.keys(config.environment).join(", ")}`)
    if (config.type === "remote" && config.headers) lines.push(`  headers:   ${Object.keys(config.headers).join(", ")}`)
    if (server) {
      lines.push(`  status:    ${statusText(server.status)}`)
      if (server.auth) lines.push(`  auth:      ${server.auth.replace("_", " ")}`)
      if (server.tools.length) lines.push(`  tools:     ${server.tools.map((tool) => `mcp__${args.name}__${tool}`).join(", ")}`)
    }
    console.log(lines.join("\n"))
  }),
})

export const McpResetCommand = effectCmd({
  command: "reset-project-choices",
  describe: "forget which .mcp.json servers this project allowed or denied",
  handler: Effect.fn("Cli.mcp.reset")(function* () {
    const ctx = yield* instance
    const root = McpConfig.projectRoot(ctx.directory, ctx.worktree)
    for (const [name, entry] of Object.entries(yield* entries))
      if (entry.scope === "project") McpConfig.remember(root, name, undefined)
    console.log("Project server approvals reset. RIFT will ask again.")
  }),
})

export const McpAuthCommand = effectCmd({
  command: "auth <name>",
  describe: "sign in to an OAuth MCP server",
  builder: (yargs) => yargs.positional("name", { describe: "server name", type: "string", demandOption: true }),
  handler: Effect.fn("Cli.mcp.auth")(function* (args) {
    const mcp = yield* MCP.Service
    const entry = (yield* entries)[args.name]
    if (!entry) throw new Error(`No MCP server named "${args.name}"`)
    if (entry.config.type !== "remote" || entry.config.oauth === false)
      throw new Error(`${args.name} is not a remote server with OAuth`)
    UI.empty()
    const spinner = prompts.spinner()
    spinner.start("Starting OAuth flow...")
    yield* mcp
      .authenticate(args.name, (url) => {
        spinner.stop("Authorize in your browser:")
        prompts.log.info(url)
        spinner.start("Waiting for authorization...")
      })
      .pipe(
        Effect.tap((status) =>
          Effect.sync(() => {
            if (status.status === "connected") return spinner.stop("Authenticated")
            spinner.stop("Authentication failed", 1)
            if (status.status === "needs_client_registration")
              prompts.log.error(`${status.error} Add "oauth": { "clientId": "..." } to the server config.`)
            else if (status.status === "failed") prompts.log.error(status.error)
            else prompts.log.error("Unexpected status: " + status.status)
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            spinner.stop("Authentication failed", 1)
            const error = Cause.squash(cause)
            prompts.log.error(error instanceof Error ? error.message : String(error))
          }),
        ),
      )
  }),
})

export const McpLogoutCommand = effectCmd({
  command: "logout <name>",
  describe: "remove stored OAuth credentials for a server",
  builder: (yargs) => yargs.positional("name", { describe: "server name", type: "string", demandOption: true }),
  handler: Effect.fn("Cli.mcp.logout")(function* (args) {
    const credentials = yield* McpAuth.Service.use((auth) => auth.all())
    if (!credentials[args.name]) throw new Error(`No stored credentials for ${args.name}`)
    yield* MCP.Service.use((mcp) => mcp.removeAuth(args.name))
    console.log(`Removed OAuth credentials for ${args.name}`)
  }),
})

export const McpCommand = cmd({
  command: "mcp",
  describe: "manage MCP (Model Context Protocol) servers",
  builder: (yargs) =>
    yargs
      .command(McpAddCommand)
      .command(McpAddJsonCommand)
      .command(McpGetCommand)
      .command(McpListCommand)
      .command(McpRemoveCommand)
      .command(McpResetCommand)
      .command(McpAuthCommand)
      .command(McpLogoutCommand)
      .demandCommand(),
  async handler() {},
})

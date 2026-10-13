// MCP tool search. Past a size threshold the model gets tool names only, plus one `mcp_search`
// tool that returns full schemas on demand. A tool returned by a search is sent with its full
// schema on every later step of the session, so the model can call it by name.
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import type { SessionV1 } from "@opencode-ai/core/v1/session"

export const TOOL = "mcp_search"

/** Estimated schema tokens above which MCP tools are deferred, unless RIFT_MCP_TOOL_SEARCH says otherwise. */
export const THRESHOLD = 2_500
const MAX_RESULTS = 8

export type Mode = "auto" | "always" | "never"

export function mode(env: Record<string, string | undefined> = process.env): Mode {
  const value = (env.OPENCODE_MCP_TOOL_SEARCH ?? env.RIFT_MCP_TOOL_SEARCH ?? "auto").toLowerCase()
  if (value === "always" || value === "on" || value === "true" || value === "1") return "always"
  if (value === "never" || value === "off" || value === "false" || value === "0") return "never"
  return "auto"
}

/** Rough token cost of sending one tool's definition. Four characters per token is close enough to pick a mode. */
export function cost(def: MCPToolDef) {
  return Math.ceil(JSON.stringify({ name: def.name, description: def.description, input: def.inputSchema }).length / 4)
}

export function shouldDefer(defs: MCPToolDef[], current: Mode = mode()) {
  if (current === "always") return defs.length > 0
  if (current === "never") return false
  return defs.reduce((total, def) => total + cost(def), 0) > THRESHOLD
}

/** Names of MCP tools an earlier `mcp_search` in this session loaded. */
export function loaded(messages: SessionV1.WithParts[]) {
  const result = new Set<string>()
  for (const message of messages)
    for (const part of message.parts) {
      if (part.type !== "tool" || part.tool !== TOOL || part.state.status !== "completed") continue
      const names = (part.state.metadata as { loaded?: unknown } | undefined)?.loaded
      if (Array.isArray(names)) for (const name of names) if (typeof name === "string") result.add(name)
    }
  return result
}

/** The tool description: how to use it, then every deferred tool name grouped by server. */
export function description(names: string[], connecting: string[]) {
  const byServer = new Map<string, string[]>()
  for (const name of names) {
    const match = name.match(/^mcp__(.+?)__(.+)$/)
    if (!match) continue
    byServer.set(match[1], [...(byServer.get(match[1]) ?? []), match[2]])
  }
  const lines = [
    "Load MCP tools by name or keyword. Returns their schemas; then call a tool by its full name, mcp__<server>__<tool>.",
    'Query with keywords ("create issue") or exact names ("select:mcp__github__get_issue,mcp__github__list_issue").',
  ]
  if (byServer.size) {
    lines.push("Available:")
    for (const [server, tools] of [...byServer].sort(([a], [b]) => a.localeCompare(b)))
      lines.push(`- ${server}: ${tools.join(", ")}`)
  }
  if (connecting.length) lines.push(`Still connecting (searching waits for them): ${connecting.join(", ")}.`)
  return lines.join("\n")
}

export interface Candidate {
  name: string
  def: MCPToolDef
}

/** Exact selection with `select:a,b`, otherwise keyword scoring on name and description. */
export function find(query: string, candidates: Candidate[], limit = MAX_RESULTS) {
  const trimmed = query.trim()
  if (trimmed.startsWith("select:")) {
    const wanted = trimmed
      .slice("select:".length)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
    return candidates.filter((item) => wanted.includes(item.name) || wanted.includes(item.def.name))
  }
  const exact = candidates.filter((item) => item.name === trimmed || item.def.name === trimmed)
  if (exact.length) return exact
  const terms = trimmed.toLowerCase().split(/[\s_,]+/).filter(Boolean)
  if (!terms.length) return []
  return candidates
    .map((item) => {
      const name = item.name.toLowerCase()
      const text = (item.def.description ?? "").toLowerCase()
      const score = terms.reduce((total, term) => total + (name.includes(term) ? 3 : 0) + (text.includes(term) ? 1 : 0), 0)
      return { item, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, limit)
    .map((entry) => entry.item)
}

export function render(found: Candidate[]) {
  if (!found.length) return "No matching MCP tools. Try other keywords, or a server name."
  return found
    .map((item) =>
      [`<tool name="${item.name}">`, item.def.description ?? "", JSON.stringify(item.def.inputSchema), "</tool>"].join("\n"),
    )
    .join("\n")
}

export * as McpSearch from "./search"

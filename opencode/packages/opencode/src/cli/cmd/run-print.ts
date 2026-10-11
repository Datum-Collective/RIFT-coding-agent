// One line (or a short block) per tool call for `rift run`'s plain output. Written to stderr by
// run.ts, so stdout stays the model's text and `--format json` stays machine-readable.
import path from "path"
import stripAnsi from "strip-ansi"
import type { ToolPart } from "@opencode-ai/sdk/v2"

export type ToolInline = {
  icon: string
  title: string
  description?: string
  mode?: "inline" | "block"
  body?: string
}

const BODY_LINES = 20

const str = (value: unknown) => (typeof value === "string" ? value : undefined)
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

/** A path relative to the working directory when it is inside it. */
function rel(value: unknown) {
  const file = str(value)
  if (!file) return ""
  const relative = path.relative(process.cwd(), file)
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : file
}

function clip(text: string, lines = BODY_LINES) {
  const all = text.split("\n")
  if (all.length <= lines) return text
  return [...all.slice(0, lines), `… ${all.length - lines} more lines`].join("\n")
}

function diffstat(diff: unknown) {
  const text = str(diff)
  if (!text) return undefined
  let added = 0
  let removed = 0
  for (const line of text.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue
    if (line.startsWith("+")) added++
    else if (line.startsWith("-")) removed++
  }
  return `+${added} -${removed}`
}

function count(value: number | undefined, one: string, many: string) {
  return value === undefined ? undefined : `${value} ${value === 1 ? one : many}`
}

export function toolInlineInfo(part: ToolPart): ToolInline {
  const input = (part.state.input ?? {}) as Record<string, unknown>
  const meta = (part.state.status === "pending" ? {} : (part.state.metadata ?? {})) as Record<string, unknown>
  const title = part.state.status === "completed" || part.state.status === "running" ? part.state.title : undefined

  switch (part.tool) {
    case "bash": {
      const output = stripAnsi(str(meta.output) ?? "").trim()
      const exit = num(meta.exit)
      return {
        icon: "$",
        title: str(input.command) ?? "",
        description: exit ? `exit ${exit}` : undefined,
        mode: output ? "block" : "inline",
        body: output ? clip(output) : undefined,
      }
    }
    case "read":
      return { icon: "→", title: `Read ${rel(input.filePath)}` }
    case "glob":
      return { icon: "✱", title: `Glob ${str(input.pattern) ?? ""}`, description: count(num(meta.count), "match", "matches") }
    case "grep":
      return { icon: "✱", title: `Grep ${str(input.pattern) ?? ""}`, description: count(num(meta.matches), "match", "matches") }
    case "list":
      return { icon: "→", title: `List ${rel(input.path) || "."}` }
    case "edit":
      return { icon: "←", title: `Edit ${rel(input.filePath)}`, description: diffstat(meta.diff) }
    case "write":
      return { icon: "←", title: `Write ${rel(input.filePath)}` }
    case "apply_patch": {
      const files = Array.isArray(meta.files) ? meta.files.length : undefined
      return { icon: "←", title: "Patch", description: count(files, "file", "files") }
    }
    case "webfetch":
      return { icon: "%", title: `Fetch ${str(input.url) ?? ""}` }
    case "websearch":
      return { icon: "◈", title: `Search ${str(input.query) ?? ""}`, description: count(num(meta.numResults), "result", "results") }
    case "task":
      return { icon: "⇢", title: str(input.description) ?? "Task", description: str(input.subagent_type) }
    case "skill":
      return { icon: "→", title: `Skill ${str(input.name) ?? ""}` }
    case "todowrite": {
      const todos = Array.isArray(input.todos) ? (input.todos as Array<Record<string, unknown>>) : []
      const mark = (status: unknown) => (status === "completed" ? "[x]" : status === "in_progress" ? "[>]" : "[ ]")
      return {
        icon: "#",
        title: "Plan",
        mode: todos.length ? "block" : "inline",
        body: todos.map((todo) => `${mark(todo.status)} ${str(todo.content) ?? ""}`).join("\n"),
      }
    }
    default:
      return { icon: "⚙", title: title || part.tool }
  }
}

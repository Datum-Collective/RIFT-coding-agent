import type { SessionMessageInfo } from "@opencode/client"

export type LogLevel = "ok" | "running" | "error"

export interface LogEntry {
  readonly time: number
  readonly level: LogLevel
  readonly text: string
}

const firstLine = (text: string) => text.split("\n")[0]

// What the call was about comes before where it ran: grep and glob have both a pattern and a path.
const TARGETS = ["command", "pattern", "query", "url", "path", "filePath"]

const target = (input: unknown) => {
  if (typeof input !== "object" || input === null) return undefined
  const fields = input as Record<string, unknown>
  const value = TARGETS.map((key) => fields[key]).find((item) => typeof item === "string" && item.length > 0)
  return typeof value === "string" ? firstLine(value) : undefined
}

const DECISIONS: Record<string, string> = {
  fix: "checks failed, sent back to the agent",
  give_up: "stopped after the fix rounds, work not proven",
}

const entries = (message: SessionMessageInfo): LogEntry[] => {
  if (message.type === "synthetic") {
    const decision = message.metadata?.source === "rift-verify" ? message.metadata.decision : undefined
    const text = typeof decision === "string" ? DECISIONS[decision] : undefined
    return text ? [{ time: message.time.created, level: "error", text }] : []
  }
  if (message.type !== "assistant") return []
  return message.content.flatMap((part): LogEntry[] => {
    if (part.type !== "tool") return []
    const line = [part.name, target(part.state.input)].filter(Boolean).join(" ")
    const time = part.time.created
    if (part.state.status === "error") {
      return [{ time, level: "error", text: `${line}: ${firstLine(part.state.error.message)}` }]
    }
    return [{ time, level: part.state.status === "completed" ? "ok" : "running", text: line }]
  })
}

/**
 * What the agent did, as one line per event: tool calls and the verification results sent back to it.
 * Messages from `revert` on have been undone, so they are left out, as the transcript leaves them out.
 */
export const logEntries = (messages: readonly SessionMessageInfo[], revert?: string): LogEntry[] => {
  const end = revert ? messages.findIndex((message) => message.id === revert) : -1
  return (end === -1 ? messages : messages.slice(0, end)).flatMap(entries)
}

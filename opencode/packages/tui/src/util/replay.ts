/**
 * Replay: a session reconstructed as a sequence of inspectable steps, plus the activity grid
 * for a whole codebase. Shared by `/replay` in the TUI and `rift replay` on the command line,
 * so both tell the same story. Pure data in, pure data out.
 */
import { verification, type TaskMessage, type TaskPart, type Verification } from "./task"

// Stricter than the task view's word match: a replay lists tests executed, so "ls test/" or an
// echoed "---test---" must not count. Matches real runners and the usual check scripts.
const TEST_RUN =
  /(^|[;&|(]\s*|\s)((bun|npm|pnpm|yarn|npx|bunx|deno)\s+(run\s+)?(test|typecheck|type-check|lint|check)\b|(pytest|jest|vitest|tsc|eslint|oxlint|mocha|rspec|phpunit)\b|cargo\s+(test|check|clippy)\b|go\s+(test|vet)\b|make\s+(test|check)\b)/

export type ReplayMessage = TaskMessage & { time?: { created?: number } }
export type ReplayPart = TaskPart & { files?: string[] }

export type ReplayTest = { command: string; exit?: number; passed: boolean }

export type ReplayStep = {
  messageID: string
  time: number
  agent?: string
  /** The first thing the agent said in this step: its stated decision. */
  decision?: string
  tools: Array<{ name: string; title: string; status: "ok" | "failed" | "running" }>
  files: string[]
  tests: ReplayTest[]
  failures: string[]
  /** Commands that failed in an earlier step and pass in this one. */
  repairs: string[]
}

export type ReplayTurn = {
  /** The user message that started the turn. Rewinding to it undoes everything after. */
  messageID: string
  time: number
  prompt: string
  steps: ReplayStep[]
}

export type Replay = {
  turns: ReplayTurn[]
  totals: { steps: number; tools: number; files: number; tests: number; failures: number; repairs: number }
  evidence: Verification
}

export type ReplayInput = {
  messages: readonly ReplayMessage[]
  parts: (messageID: string) => readonly ReplayPart[]
}

export function replay(input: ReplayInput): Replay {
  const turns: ReplayTurn[] = []
  const failing = new Set<string>()

  for (const message of input.messages) {
    const parts = input.parts(message.id)
    const time = message.time?.created ?? 0
    if (message.role === "user") {
      const prompt = parts.find((part) => part.type === "text" && !part.synthetic)?.text?.trim()
      if (prompt) turns.push({ messageID: message.id, time, prompt: prompt.split("\n")[0], steps: [] })
      continue
    }
    const turn = turns[turns.length - 1]
    if (!turn) continue
    const step: ReplayStep = {
      messageID: message.id,
      time,
      agent: message.agent,
      decision: parts
        .find((part) => part.type === "text" && part.text?.trim())
        ?.text?.trim()
        .split("\n")[0],
      tools: [],
      files: [...new Set(parts.flatMap((part) => (part.type === "patch" ? (part.files ?? []) : [])))],
      tests: [],
      failures: [],
      repairs: [],
    }
    for (const part of parts) {
      if (part.type !== "tool" || !part.tool || !part.state) continue
      const status = part.state.status
      const exit = part.state.metadata?.exit
      const failed = status === "error" || (typeof exit === "number" && exit !== 0)
      const title = part.state.title ?? part.tool
      step.tools.push({
        name: part.tool,
        title,
        status: failed ? "failed" : status === "completed" ? "ok" : "running",
      })
      if (failed) step.failures.push(`${part.tool}: ${title}`)
      const command = commandOf(part)
      if (!command || !TEST_RUN.test(command) || status === "pending" || status === "running") continue
      step.tests.push({ command, exit: typeof exit === "number" ? exit : undefined, passed: !failed })
      if (failed) {
        failing.add(command)
        continue
      }
      if (failing.delete(command)) step.repairs.push(command)
    }
    turn.steps.push(step)
  }

  const steps = turns.flatMap((turn) => turn.steps)
  return {
    turns,
    totals: {
      steps: steps.length,
      tools: steps.reduce((total, step) => total + step.tools.length, 0),
      files: new Set(steps.flatMap((step) => step.files)).size,
      tests: steps.reduce((total, step) => total + step.tests.length, 0),
      failures: steps.reduce((total, step) => total + step.failures.length, 0),
      repairs: steps.reduce((total, step) => total + step.repairs.length, 0),
    },
    evidence: verification({ messages: input.messages, parts: input.parts }),
  }
}

function commandOf(part: ReplayPart) {
  const input = part.state?.input
  if (part.tool !== "bash" || typeof input !== "object" || input === null || !("command" in input)) return undefined
  return typeof input.command === "string" ? input.command : undefined
}

// --- activity grid ------------------------------------------------------------------------

export type Edit = { time: number; files: number; sessionID: string; turnID: string }

export type Day = { date: string; edits: number; level: 0 | 1 | 2 | 3 | 4 }

/**
 * GitHub-style contribution grid: one column per week, Sunday to Saturday, ending on the week
 * that contains `now`. Levels are relative to the busiest day so a quiet codebase still reads.
 */
export function activity(edits: readonly Edit[], now: number, weeks = 26): Day[][] {
  const counts = new Map<string, number>()
  for (const edit of edits) {
    const key = dayKey(edit.time)
    counts.set(key, (counts.get(key) ?? 0) + edit.files)
  }
  const today = new Date(now)
  // Local calendar arithmetic rather than fixed 24h steps, so DST changes cannot skip a day.
  const saturday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (6 - today.getDay()))
  const last = weeks * 7 - 1
  const max = Math.max(0, ...counts.values())
  return Array.from({ length: weeks }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const date = dayKey(
        new Date(
          saturday.getFullYear(),
          saturday.getMonth(),
          saturday.getDate() - (last - (week * 7 + weekday)),
        ).getTime(),
      )
      const count = counts.get(date) ?? 0
      return { date, edits: count, level: level(count, max) }
    }),
  )
}

/** Local calendar day, so an edit at 11pm lands on the day the person made it. */
export function dayKey(time: number) {
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function level(count: number, max: number): Day["level"] {
  if (count === 0 || max === 0) return 0
  const ratio = count / max
  if (ratio > 0.75) return 4
  if (ratio > 0.5) return 3
  if (ratio > 0.25) return 2
  return 1
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/**
 * The month row above a grid drawn two characters per week. A label goes where a month starts
 * and is skipped when the previous label is still in the way.
 */
export function monthLabels(weeks: readonly Day[][]) {
  return weeks
    .reduce(
      (row, week, index) => {
        const month = Number(week[0].date.slice(5, 7)) - 1
        const previous = index > 0 ? Number(weeks[index - 1][0].date.slice(5, 7)) - 1 : -1
        if (month === previous || index * 2 < row.end) return row
        return { text: row.text.padEnd(index * 2) + MONTHS[month], end: index * 2 + 4 }
      },
      { text: "", end: 0 },
    )
    .text.padEnd(weeks.length * 2)
}

/**
 * Derives the RIFT Forge pipeline from a session's `forge` tool calls.
 *
 * The agent reports stage transitions; everything else here is observed rather than claimed.
 * Shell commands and subagents are attributed to whichever stage was open when they ran, and
 * their real exit codes are what the evidence counts. Re-opening an earlier stage marks every
 * later stage stale, the way a build system invalidates downstream targets.
 */
import type { Signal, TaskInput, TaskPart } from "./task"

export const STAGES = [
  { id: "goal", label: "Goal" },
  { id: "requirements", label: "Requirements" },
  { id: "architecture", label: "Architecture" },
  { id: "graph", label: "Engineering Graph" },
  { id: "agents", label: "Parallel Agents" },
  { id: "verify", label: "Verification" },
  { id: "adversarial", label: "Adversarial Testing" },
  { id: "repair", label: "Repair" },
  { id: "evidence", label: "Evidence" },
  { id: "gate", label: "Human Gate" },
  { id: "ship", label: "Ship" },
] as const

export type StageID = (typeof STAGES)[number]["id"]

export type StageState = "pending" | "active" | "done" | "failed" | "skipped" | "stale" | "waiting"

export type Counter = { total: number; running: number; failed: number }

export type Stage = {
  id: StageID
  label: string
  state: StageState
  summary?: string
  items: Array<{ text: string; signal: Signal }>
  /** Shell commands run while this stage was open, judged by their real exit codes. */
  commands: Counter
  /** Subagents dispatched while this stage was open. */
  agents: Counter
  /** Times the stage was re-opened after it had finished. */
  revisions: number
  /** The earlier stage whose revision made this one stale. */
  staleBy?: StageID
}

export type ForgeState = "forging" | "waiting" | "paused" | "failed" | "shipped"

export type Forge = {
  goal: string
  state: ForgeState
  stages: Stage[]
  /** The stage worth expanding: the one waiting on the human, else the one in progress. */
  focus: StageID
  steers: number
  commands: Counter
}

const STATUSES = ["active", "done", "failed", "skipped"] as const
const ITEM_SIGNALS: Record<string, Signal> = {
  pending: "pending",
  active: "active",
  done: "done",
  failed: "failed",
  warn: "warn",
}

export function forge(input: TaskInput): Forge | undefined {
  const stages: Stage[] = STAGES.map((stage) => ({
    id: stage.id,
    label: stage.label,
    state: "pending",
    items: [],
    commands: counter(),
    agents: counter(),
    revisions: 0,
  }))
  const commands = counter()
  const touched: StageID[] = []
  let open: Stage | undefined
  let steers = 0

  for (const message of input.messages) {
    if (message.role !== "assistant") continue
    for (const part of input.parts(message.id)) {
      if (part.type !== "tool" || !part.state) continue
      if (part.tool === "forge") {
        const update = readUpdate(part)
        if (!update) continue
        const index = stages.findIndex((stage) => stage.id === update.stage)
        const stage = stages[index]
        if (update.state === "active" || update.state === "waiting") {
          const later = stages.slice(index + 1).filter((item) => item.state !== "pending")
          if (later.length > 0) steers++
          later.forEach((item) => {
            item.state = "stale"
            item.staleBy = stage.id
          })
          if (stage.state !== "active" && stage.state !== "waiting") {
            if (stage.state !== "pending" && stage.state !== "stale") stage.revisions++
            stage.commands = counter()
            stage.agents = counter()
          }
        }
        stage.state = update.state
        stage.staleBy = undefined
        stage.summary = update.summary ?? stage.summary
        if (update.items) stage.items = update.items
        touched.push(stage.id)
        open = stage
        continue
      }
      if (!open) continue
      const status = part.state.status
      const running = status === "pending" || status === "running"
      if (part.tool === "bash") {
        const exit = part.state.metadata?.exit
        const failed = status === "error" || (status === "completed" && typeof exit === "number" && exit !== 0)
        tally(open.commands, running, failed)
        tally(commands, running, failed)
      }
      if (part.tool === "task") tally(open.agents, running, status === "error")
    }
  }

  if (touched.length === 0) return undefined
  const waiting = stages.find((stage) => stage.state === "waiting")
  const active = stages.findLast((stage) => stage.state === "active")
  return {
    goal: stages[0].summary || firstLine(input) || "Untitled goal",
    state: overall(stages, input.busy === true),
    stages,
    focus: waiting?.id ?? active?.id ?? touched[touched.length - 1],
    steers,
    commands,
  }
}

function overall(stages: Stage[], busy: boolean): ForgeState {
  if (stages.some((stage) => stage.state === "waiting")) return "waiting"
  if (busy) return "forging"
  if (stages[stages.length - 1].state === "done") return "shipped"
  if (stages.some((stage) => stage.state === "failed")) return "failed"
  return "paused"
}

/** Reads one forge call. Malformed input is ignored rather than guessed at. */
function readUpdate(part: TaskPart) {
  const input = part.state?.input
  if (typeof input !== "object" || input === null) return undefined
  const stage = "stage" in input ? input.stage : undefined
  const status = "status" in input ? input.status : undefined
  if (!isStage(stage) || !isStatus(status)) return undefined
  const summary = "summary" in input && typeof input.summary === "string" ? input.summary : undefined
  const items = "items" in input && Array.isArray(input.items) ? readItems(input.items) : undefined
  return { stage, state: effectiveState(part, stage, status), summary, items }
}

function effectiveState(part: TaskPart, stage: StageID, status: (typeof STATUSES)[number]): StageState {
  const call = part.state?.status
  if (stage === "gate" && status === "active") {
    if (call === "error") return "failed"
    if (call === "completed") return part.state?.metadata?.approved === true ? "done" : "active"
    return "waiting"
  }
  if (call === "error") return "failed"
  return status
}

function isStage(value: unknown): value is StageID {
  return STAGES.some((stage) => stage.id === value)
}

function isStatus(value: unknown): value is (typeof STATUSES)[number] {
  return STATUSES.some((status) => status === value)
}

function readItems(raw: unknown[]) {
  return raw.flatMap((item) => {
    if (typeof item !== "object" || item === null) return []
    const text = "text" in item && typeof item.text === "string" ? item.text : undefined
    if (!text) return []
    const status = "status" in item && typeof item.status === "string" ? item.status : "pending"
    return [{ text, signal: ITEM_SIGNALS[status] ?? "pending" }]
  })
}

function firstLine(input: TaskInput) {
  for (const message of input.messages) {
    if (message.role !== "user") continue
    const text = input.parts(message.id).find((part) => part.type === "text" && !part.synthetic)?.text
    const line = text?.trim().split("\n")[0]
    if (line) return line
  }
  return undefined
}

function counter(): Counter {
  return { total: 0, running: 0, failed: 0 }
}

function tally(target: Counter, running: boolean, failed: boolean) {
  target.total++
  if (running) target.running++
  if (failed) target.failed++
}

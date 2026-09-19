/**
 * Derives the task-centred model the RIFT control plane renders.
 *
 * The transcript answers "what was said". This answers the four questions the UI is built
 * around: what is the agent doing, what changed, does it need me, and did it actually work.
 * It is deliberately free of UI imports so the whole model can be tested as data.
 */

export type Signal = "done" | "active" | "pending" | "failed" | "warn"

export type PhaseKind = "analyze" | "edit" | "shell" | "test" | "browser" | "delegate" | "research" | "note"

export type Phase = {
  kind: PhaseKind
  label: string
  signal: Signal
  detail?: string
  ms?: number
}

export type PlanStep = {
  n: number
  text: string
  files: string[]
  signal: Signal
}

export type Plan = {
  source: "vibe" | "todo" | "none"
  steps: PlanStep[]
}

export type ChangeFile = {
  file: string
  added: number
  removed: number
}

export type VerifyCheck = {
  command: string
  where?: string
  status: "passed" | "failed" | "timed_out" | "not_run" | "queued"
  reason?: string
  ms: number
}

export type Claims =
  | { status: "off" }
  | { status: "pending" }
  | { status: "ok" }
  | { status: "mismatch"; items: Array<{ claim: string; reality: string }> }
  | { status: "not_run"; reason: string }

export type BrowserCheck = {
  url: string
  status: "passed" | "failed" | "not_run"
  reason?: string
  httpStatus?: number
  title?: string
  errors: string[]
}

export type Verification = {
  /** "none" means no verification ran for this task, not that it passed. */
  state: "none" | "running" | "passed" | "failed" | "incomplete"
  checks: VerifyCheck[]
  claims?: Claims
  browser?: BrowserCheck
  scope?: { files: number; threshold: number }
}

export type TaskState = "idle" | "planning" | "executing" | "verifying" | "blocked" | "failed" | "done"

export type Context = {
  tokens: number
  /** Null when the model's context limit is unknown. */
  percent: number | null
}

export type Task = {
  title: string
  state: TaskState
  plan: Plan
  execution: Phase[]
  changes: { files: ChangeFile[]; added: number; removed: number }
  verification: Verification
  blocked: { permissions: number; questions: number }
  models: { planner?: string; executor?: string; current?: string }
  context: Context
  cost: number
}

/** Key the server publishes its structured verification report under. */
export const VERIFICATION_METADATA_KEY = "rift_verification"

// --- inputs -------------------------------------------------------------------------------

type ToolState = {
  status: "pending" | "running" | "completed" | "error"
  input?: unknown
  title?: string
  time?: { start?: number; end?: number }
}

/**
 * The slice of a message part this module needs. Everything is optional so a real SDK part is
 * structurally assignable, and reading a field is a plain check rather than a cast.
 */
export type TaskPart = {
  type: string
  text?: string
  synthetic?: boolean
  metadata?: Record<string, unknown>
  tool?: string
  state?: ToolState
}

export type TaskMessage = {
  id: string
  role: "user" | "assistant"
  mode?: string
  modelID?: string
  providerID?: string
  agent?: string
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}

export type TaskInput = {
  title?: string
  messages: readonly TaskMessage[]
  parts: (messageID: string) => readonly TaskPart[]
  diff?: readonly ChangeFile[]
  todos?: readonly { content: string; status: string }[]
  busy?: boolean
  permissions?: number
  questions?: number
  models?: { planner?: string; executor?: string; current?: string }
  /** Context window of the model that produced the newest reply, when known. */
  contextLimit?: (message: TaskMessage) => number | undefined
  cost?: number
}

// --- execution phases ---------------------------------------------------------------------

const KIND_BY_TOOL: Record<string, PhaseKind> = {
  read: "analyze",
  glob: "analyze",
  grep: "analyze",
  lsp: "analyze",
  list: "analyze",
  edit: "edit",
  write: "edit",
  apply_patch: "edit",
  bash: "shell",
  execute: "shell",
  browser_open: "browser",
  task: "delegate",
  skill: "delegate",
  webfetch: "research",
  websearch: "research",
}

const TEST_COMMAND = /\b(test|jest|vitest|pytest|tsc|typecheck|type-check|lint|eslint|oxlint|check|cargo|go test)\b/

function phaseKind(tool: string, state: ToolState): PhaseKind | undefined {
  const kind = KIND_BY_TOOL[tool]
  if (!kind) return undefined
  if (kind === "shell") {
    const input = state.input
    const command =
      typeof input === "object" && input !== null && "command" in input && typeof input.command === "string"
        ? input.command
        : ""
    return TEST_COMMAND.test(command) ? "test" : "shell"
  }
  return kind
}

function editedFile(input: unknown) {
  if (typeof input !== "object" || input === null) return undefined
  if ("filePath" in input && typeof input.filePath === "string") return input.filePath
  return undefined
}

function label(kind: PhaseKind, count: number, files: Set<string>): string {
  switch (kind) {
    case "analyze":
      return "Analyzing code"
    case "edit": {
      const n = files.size || count
      return `Editing ${n} ${n === 1 ? "file" : "files"}`
    }
    case "shell":
      return count === 1 ? "Running a command" : `Running ${count} commands`
    case "test":
      return "Running tests"
    case "browser":
      return "Checking in the browser"
    case "delegate":
      return count === 1 ? "Delegating to a subagent" : `Delegating to ${count} subagents`
    case "research":
      return "Searching the web"
    default:
      return "Working"
  }
}

/**
 * Collapses a run of tool calls into the few states worth reading at a glance. Consecutive calls
 * of the same kind merge into one line, so "read 40 files" becomes one "Analyzing code".
 */
export function phases(input: TaskInput): Phase[] {
  const out: Phase[] = []
  const messages = turnOf(input)
  let open:
    | { kind: PhaseKind; count: number; files: Set<string>; failed: number; running: boolean; ms: number }
    | undefined

  const flush = () => {
    if (!open) return
    // A tool still marked running while the session sits idle was interrupted, not active.
    // Reporting it as active would claim the agent is working when nothing is.
    const stalled = open.running && !input.busy
    const signal: Signal = open.running && !stalled ? "active" : open.failed > 0 ? "failed" : stalled ? "warn" : "done"
    const phase: Phase = { kind: open.kind, label: label(open.kind, open.count, open.files), signal }
    if (open.failed > 0) phase.detail = `${open.failed} failed`
    else if (stalled) phase.detail = "interrupted"
    if (!open.running && open.ms > 0) phase.ms = open.ms
    out.push(phase)
    open = undefined
  }

  for (const message of messages) {
    if (message.role !== "assistant") continue
    for (const part of input.parts(message.id)) {
      if (part.type !== "tool" || !part.tool || !part.state) continue
      const state = part.state
      const kind = phaseKind(part.tool, state)
      if (!kind) continue
      if (!open || open.kind !== kind) {
        flush()
        open = { kind, count: 0, files: new Set(), failed: 0, running: false, ms: 0 }
      }
      open.count++
      const file = editedFile(state.input)
      if (file) open.files.add(file)
      if (state.status === "error") open.failed++
      if (state.status === "running" || state.status === "pending") open.running = true
      const start = state.time?.start
      const end = state.time?.end
      if (typeof start === "number" && typeof end === "number" && end > start) open.ms += end - start
    }
  }
  flush()
  return out
}

// --- plan ---------------------------------------------------------------------------------

/** Reads the planner's own plan text. The planner emits a stable numbered format. */
export function parseVibePlan(text: string): PlanStep[] {
  const steps: PlanStep[] = []
  for (const line of text.split("\n")) {
    const step = VIBE_PLAN_STEP.exec(line)
    if (step) {
      steps.push({ n: Number(step[1]), text: step[2].trim(), files: [], signal: "pending" })
      continue
    }
    const files = VIBE_PLAN_FILES.exec(line)
    const current = steps[steps.length - 1]
    if (files && current) {
      const list = files[1].trim()
      if (list && list !== "not specified") current.files = list.split(",").map((item) => item.trim())
    }
  }
  return steps
}

function todoSignal(status: string): Signal {
  if (status === "completed") return "done"
  if (status === "in_progress") return "active"
  if (status === "cancelled") return "warn"
  return "pending"
}

const VIBE_PLAN_STEP = /^\s*(\d+)\.\s+(.*)$/
const VIBE_PLAN_FILES = /^\s*Files:\s*(.*)$/
const VIBE_STEP_RUNNING = /^Execute this Vibe Mode plan step[^\n]*?Step (\d+) of (\d+)/m
const VIBE_REVIEW = /review of step (\d+)\/(\d+):\s*(approved|changes requested)/i

/**
 * Messages belonging to the request in flight: everything after the newest real user message.
 * Without this, a failure from an hour ago would keep the task marked failed forever.
 */
export function turnOf(input: TaskInput): readonly TaskMessage[] {
  for (let index = input.messages.length - 1; index >= 0; index--) {
    const message = input.messages[index]
    if (message?.role !== "user") continue
    // A step message is the server talking to the executor, not the user starting a new task.
    const real = input
      .parts(message.id)
      .some((part) => part.type === "text" && !part.synthetic && !VIBE_STEP_RUNNING.test(part.text ?? ""))
    if (real) return input.messages.slice(index)
  }
  return input.messages
}

export function plan(input: TaskInput): Plan {
  let steps: PlanStep[] = []
  let running: number | undefined
  let approved = 0

  for (const message of turnOf(input)) {
    for (const part of input.parts(message.id)) {
      if (part.type !== "text" || typeof part.text !== "string") continue
      const text = part.text
      if (message.mode === "vibe-planner") {
        if (text.startsWith("Vibe Mode plan")) steps = parseVibePlan(text)
        // A revision replaces the step in place; the plan's shape does not change.
        const review = VIBE_REVIEW.exec(text)
        if (review && review[3].toLowerCase() === "approved") approved = Math.max(approved, Number(review[1]))
        continue
      }
      const step = message.role === "user" ? VIBE_STEP_RUNNING.exec(text) : null
      // The server states the step number; retries repeat the same number rather than advancing.
      if (step) running = Number(step[1])
    }
  }

  if (steps.length > 0) {
    for (const step of steps) {
      if (step.n <= approved) step.signal = "done"
      else if (step.n === running) step.signal = "active"
      else step.signal = "pending"
    }
    return { source: "vibe", steps }
  }

  const todos = input.todos ?? []
  if (todos.length > 0) {
    return {
      source: "todo",
      steps: todos.map((todo, index) => ({
        n: index + 1,
        text: todo.content,
        files: [],
        signal: todoSignal(todo.status),
      })),
    }
  }
  return { source: "none", steps: [] }
}

// --- verification -------------------------------------------------------------------------

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

const CHECK_STATUS = new Set<string>(["passed", "failed", "timed_out", "not_run", "queued"])

/** Validates the browser result rather than trusting the metadata's shape. */
function parseBrowser(value: unknown): BrowserCheck | undefined {
  const entry = record(value)
  if (!entry) return undefined
  const url = typeof entry.url === "string" ? entry.url : undefined
  const status = entry.status
  if (!url || (status !== "passed" && status !== "failed" && status !== "not_run")) return undefined
  const errors = Array.isArray(entry.errors)
    ? entry.errors.filter((item): item is string => typeof item === "string")
    : []
  return {
    url,
    status,
    reason: typeof entry.reason === "string" ? entry.reason : undefined,
    httpStatus: typeof entry.httpStatus === "number" ? entry.httpStatus : undefined,
    title: typeof entry.title === "string" ? entry.title : undefined,
    errors,
  }
}

const CLAIM_STATUS = new Set<string>(["off", "pending", "ok", "mismatch", "not_run"])

/** Validates the claims verdict rather than trusting the shape of the metadata. */
function parseClaims(value: unknown): Claims | undefined {
  const entry = record(value)
  const status = entry?.status
  if (typeof status !== "string" || !CLAIM_STATUS.has(status)) return undefined
  if (status === "mismatch") {
    const raw = Array.isArray(entry?.items) ? entry.items : []
    const items = raw.flatMap((item) => {
      const found = record(item)
      const claim = typeof found?.claim === "string" ? found.claim : undefined
      const reality = typeof found?.reality === "string" ? found.reality : undefined
      return claim ? [{ claim, reality: reality ?? "" }] : []
    })
    return { status: "mismatch", items }
  }
  if (status === "not_run") {
    return { status: "not_run", reason: typeof entry?.reason === "string" ? entry.reason : "unknown" }
  }
  return { status: status as "off" | "pending" | "ok" }
}

function isCheckStatus(value: unknown): value is VerifyCheck["status"] {
  return typeof value === "string" && CHECK_STATUS.has(value)
}

/** Reads the server's structured report. Anything unrecognised yields "none", never a pass. */
export function verification(input: TaskInput): Verification {
  let summary: Record<string, unknown> | undefined
  for (const message of input.messages) {
    for (const part of input.parts(message.id)) {
      if (part.type !== "text") continue
      const found = record(part.metadata?.[VERIFICATION_METADATA_KEY])
      if (found) summary = found
    }
  }
  if (!summary) return { state: "none", checks: [] }

  const rawChecks = Array.isArray(summary.checks) ? summary.checks : []
  const checks: VerifyCheck[] = rawChecks.flatMap((item) => {
    const entry = record(item)
    if (!entry) return []
    const command = typeof entry.command === "string" ? entry.command : undefined
    if (!command) return []
    const status = isCheckStatus(entry.status) ? entry.status : "not_run"
    return [
      {
        command,
        where: typeof entry.where === "string" ? entry.where : undefined,
        status,
        reason: typeof entry.reason === "string" ? entry.reason : undefined,
        ms: typeof entry.ms === "number" ? entry.ms : 0,
      },
    ]
  })

  // A report left at done:false by a crash or restart must not pin the session in "verifying"
  // forever; without a live run there is nothing left to wait for.
  const done = summary.done === true || (!input.busy && summary.done !== true)
  const failed = checks.filter((check) => check.status === "failed" || check.status === "timed_out").length
  const notRun = checks.filter((check) => check.status === "not_run" || check.status === "queued").length
  const claims = parseClaims(summary.claims)
  const browser = parseBrowser(summary.browser)

  const browserFailed = browser?.status === "failed"
  const state: Verification["state"] = !done
    ? "running"
    : failed > 0 || browserFailed
      ? "failed"
      : checks.length === 0 || notRun > 0
        ? "incomplete"
        : claims?.status === "mismatch"
          ? "failed"
          : "passed"

  const scopeFiles = typeof summary.scopeFiles === "number" ? summary.scopeFiles : 0
  const threshold = typeof summary.scopeWarnFiles === "number" ? summary.scopeWarnFiles : 0

  return {
    state,
    checks,
    claims,
    browser,
    scope: threshold > 0 && scopeFiles > threshold ? { files: scopeFiles, threshold } : undefined,
  }
}

/**
 * Context burn, taken from the newest assistant reply that actually produced output.
 * Mirrors what the sidebar has always shown so the two cannot disagree.
 */
export function context(input: TaskInput): Context {
  let last: TaskMessage | undefined
  for (const message of input.messages) {
    if (message.role !== "assistant") continue
    if (!message.tokens || message.tokens.output <= 0) continue
    last = message
  }
  if (!last?.tokens) return { tokens: 0, percent: null }
  const { input: prompt, output, reasoning, cache } = last.tokens
  const tokens = prompt + output + reasoning + cache.read + cache.write
  const limit = input.contextLimit?.(last)
  return { tokens, percent: limit ? Math.round((tokens / limit) * 100) : null }
}

// --- the task -----------------------------------------------------------------------------

function title(input: TaskInput): string {
  for (let index = input.messages.length - 1; index >= 0; index--) {
    const message = input.messages[index]
    if (message?.role !== "user") continue
    for (const part of input.parts(message.id)) {
      if (part.type !== "text" || typeof part.text !== "string" || part.synthetic) continue
      const line = part.text.trim().split("\n")[0]
      if (line) return line
    }
  }
  return input.title?.trim() || "Untitled task"
}

export function task(input: TaskInput): Task {
  const permissions = input.permissions ?? 0
  const questions = input.questions ?? 0
  const execution = phases(input)
  const verify = verification(input)
  const files = [...(input.diff ?? [])]

  const state: TaskState =
    permissions + questions > 0
      ? "blocked"
      : verify.state === "running"
        ? "verifying"
        : input.busy
          ? execution.length === 0
            ? "planning"
            : "executing"
          : verify.state === "failed" || execution.some((phase) => phase.signal === "failed")
            ? "failed"
            : execution.length > 0 || files.length > 0
              ? "done"
              : "idle"

  return {
    title: title(input),
    state,
    plan: plan(input),
    execution,
    changes: {
      files,
      added: files.reduce((total, file) => total + file.added, 0),
      removed: files.reduce((total, file) => total + file.removed, 0),
    },
    verification: verify,
    blocked: { permissions, questions },
    models: input.models ?? {},
    context: context(input),
    cost: input.cost ?? 0,
  }
}

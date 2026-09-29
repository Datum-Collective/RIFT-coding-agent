/**
 * Persistent task state: the engineering context of a session, kept outside the context window.
 *
 * Compaction replaces the conversation with a model-written summary, and summaries drop things:
 * the goal, a decision, which files were touched, whether the checks passed. This module derives
 * that context from what RIFT recorded (messages, todos, the engineering graph, git), writes it to
 * `.rift/tasks/<session>/`, and renders a deterministic handoff that is appended to every
 * compaction summary. The same inputs always give the same handoff, and no model writes it.
 */
import path from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Context, Semaphore } from "effect"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { Git } from "@/git"
import { Session } from "./session"
import { SessionID } from "./schema"
import { Todo } from "./todo"
import { EngineeringGraph } from "./engineering-graph"
import { Verify } from "./verify"

/** Key on the summary's text part that marks it as RIFT's handoff rather than model output. */
export const METADATA_KEY = "rift_task_state"

const DIR = path.join(".rift", "tasks")
const MAX_REQUEST_CHARS = 2_000
const MAX_ITEMS = 40
const TODO_MARK: { [status: string]: string } = { completed: "x", in_progress: "~", cancelled: "-" }

/** The slice of a message this module reads, so a real `SessionV1.WithParts` is assignable. */
export type Message = {
  info: { id: string; role: "user" | "assistant" }
  parts: readonly {
    type: string
    text?: string
    synthetic?: boolean
    ignored?: boolean
    metadata?: { [key: string]: unknown }
    tool?: string
    state?: { status: string; input?: unknown }
  }[]
}

export type State = {
  version: 1
  sessionID: string
  /** The first request of the session: what the whole task is for. */
  goal?: string
  /** The newest request, when it differs from the goal. */
  latest?: string
  todos: { content: string; status: string }[]
  graph: { id: string; title: string; status: string; files: string[] }[]
  decisions: { node: string; text: string }[]
  /** Files edited by the agent in this session, relative to the project root. */
  touched: string[]
  /** The newest finished verification report, or undefined when none ran. */
  verification?: {
    passed: number
    failed: number
    notRun: number
    checks: { command: string; status: string; reason?: string }[]
  }
  git?: GitSnapshot
}

export type GitSnapshot = { branch?: string; changes: { file: string; status: string }[] }

export function derive(input: {
  sessionID: string
  /** Where paths in the state are relative to. */
  root: string
  /** Where the session's tools resolve relative paths. */
  cwd: string
  messages: readonly Message[]
  todos: readonly { content: string; status: string }[]
  graph: readonly EngineeringGraph.Info[]
  git?: GitSnapshot
}): State {
  const requests = input.messages.flatMap((message) => {
    if (message.info.role !== "user") return []
    const text = message.parts
      .flatMap((part) => (part.type === "text" && !part.synthetic && !part.ignored && part.text ? [part.text] : []))
      .join("\n")
      .trim()
    return text ? [clip(text)] : []
  })
  const tools = input.messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      part.type === "tool" && part.tool && part.state
        ? [{ tool: part.tool, status: part.state.status, input: part.state.input }]
        : [],
    ),
  )
  const report = input.messages
    .flatMap((message) => message.parts.map((part) => part.metadata?.[Verify.METADATA_KEY]))
    .findLast(isFinishedReport)
  return {
    version: 1,
    sessionID: input.sessionID,
    goal: requests[0],
    latest: requests.length > 1 ? requests.at(-1) : undefined,
    todos: input.todos.map((todo) => ({ content: todo.content, status: todo.status })),
    graph: input.graph.map((node) => ({ id: node.id, title: node.title, status: node.status, files: [...node.files] })),
    decisions: input.graph.flatMap((node) => node.decisions.map((text) => ({ node: node.id, text }))),
    touched: [
      ...new Set(Verify.editedPaths(tools, input.cwd).map((file) => path.relative(input.root, file).replaceAll("\\", "/"))),
    ].sort(),
    verification: report && {
      passed: report.passed,
      failed: report.failed,
      notRun: report.notRun,
      checks: report.checks.map((check) => ({
        command: check.command,
        status: check.status,
        ...(check.reason ? { reason: check.reason } : {}),
      })),
    },
    git: input.git,
  }
}

/** The text appended to a compaction summary. Deterministic: no timestamps, no model output. */
export function handoff(state: State) {
  return [
    "## Task state (recorded by RIFT, not summarised)",
    `This is what RIFT recorded before the conversation was compacted. Where it disagrees with the summary above, trust this. The same state is in \`.rift/tasks/${state.sessionID}/\`.`,
    "",
    "### Goal",
    state.goal ?? "No request recorded.",
    ...(state.latest ? ["", "### Latest request", state.latest] : []),
    "",
    "### Plan",
    ...planLines(state),
    "",
    "### Decisions",
    ...cap(decisionLines(state)),
    "",
    "### Files touched",
    ...(state.touched.length > 0 ? cap(state.touched.map((file) => `- ${file}`)) : ["No files edited in this session."]),
    "",
    "### Git",
    ...gitLines(state.git),
    "",
    "### Last verification",
    ...verificationLines(state.verification),
    "",
    "Their contents are no longer in context: read a touched file again before you change it.",
  ].join("\n")
}

/**
 * Writes the state under `<root>/.rift/tasks/<session>/`. With a checkpoint id, the handoff is also
 * kept as `checkpoints/<id>.md` so every compaction leaves a record of what was carried forward.
 */
export async function write(root: string, state: State, options: { checkpoint?: string } = {}) {
  const base = path.join(root, DIR, state.sessionID)
  const json = (value: unknown) => JSON.stringify(value ?? null, null, 2) + "\n"
  await Promise.all([
    // Task state is per machine and per session; it never belongs in the project's history.
    Bun.write(path.join(root, DIR, ".gitignore"), "*\n"),
    Bun.write(path.join(base, "state.json"), json(state)),
    Bun.write(path.join(base, "plan.md"), ["# Plan", "", ...planLines(state), ""].join("\n")),
    Bun.write(path.join(base, "decisions.md"), ["# Decisions", "", ...decisionLines(state), ""].join("\n")),
    Bun.write(path.join(base, "touched-files.json"), json(state.touched)),
    Bun.write(path.join(base, "verification.json"), json(state.verification)),
    ...(options.checkpoint ? [Bun.write(path.join(base, "checkpoints", `${options.checkpoint}.md`), handoff(state))] : []),
  ])
}

function planLines(state: State) {
  const todos = cap(state.todos.map((todo) => `- [${TODO_MARK[todo.status] ?? " "}] ${todo.content}`))
  const graph = cap(
    state.graph.map(
      (node) => `- ${node.id}: ${node.title} (${node.status})${node.files.length > 0 ? ` files: ${node.files.join(", ")}` : ""}`,
    ),
  )
  if (graph.length === 0) return todos.length > 0 ? todos : ["No plan recorded."]
  return [...todos, ...(todos.length > 0 ? [""] : []), "Engineering graph:", ...graph]
}

function decisionLines(state: State) {
  if (state.decisions.length === 0) return ["No decisions recorded."]
  return state.decisions.map((item) => `- (${item.node}) ${item.text}`)
}

function gitLines(git: GitSnapshot | undefined) {
  if (!git) return ["Not a git repository."]
  return [
    `Branch: ${git.branch ?? "detached HEAD"}`,
    ...(git.changes.length > 0
      ? ["Uncommitted changes:", ...cap(git.changes.map((change) => `- ${change.status}: ${change.file}`))]
      : ["Working tree clean."]),
  ]
}

function verificationLines(verification: State["verification"]) {
  if (!verification) return ["No verification has run in this session."]
  return [
    `${verification.passed} passed, ${verification.failed} failed, ${verification.notRun} not run.`,
    ...cap(
      verification.checks.map(
        (check) => `- ${check.command}: ${check.status}${check.reason ? ` (${check.reason})` : ""}`,
      ),
    ),
  ]
}

function cap(lines: string[]) {
  if (lines.length <= MAX_ITEMS) return lines
  return [...lines.slice(0, MAX_ITEMS), `- ...and ${lines.length - MAX_ITEMS} more`]
}

function clip(text: string) {
  return text.length <= MAX_REQUEST_CHARS ? text : `${text.slice(0, MAX_REQUEST_CHARS)} [truncated]`
}

function isFinishedReport(value: unknown): value is Verify.Summary {
  return (
    typeof value === "object" &&
    value !== null &&
    "done" in value &&
    value.done === true &&
    "checks" in value &&
    Array.isArray(value.checks)
  )
}

export interface Interface {
  /**
   * Derives the session's task state and writes it to disk. Returns undefined when task state is
   * turned off or could not be gathered. Best effort: it never fails the turn or the compaction.
   */
  readonly save: (input: { sessionID: SessionID; checkpoint?: string }) => Effect.Effect<State | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/TaskState") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const todos = yield* Todo.Service
    const graph = yield* EngineeringGraph.Service
    const git = yield* Git.Service
    // The per-turn save runs in the background, so it can overlap a compaction's save.
    const locks = new Map<SessionID, Semaphore.Semaphore>()
    const lock = (sessionID: SessionID) => {
      const hit = locks.get(sessionID)
      if (hit) return hit
      const next = Semaphore.makeUnsafe(1)
      locks.set(sessionID, next)
      return next
    }

    const gather = Effect.fn("TaskState.gather")(function* (input: { sessionID: SessionID; checkpoint?: string }) {
      const cfg = yield* config.get()
      if (cfg.task_state === false) return undefined
      const ctx = yield* InstanceState.context
      const isGit = ctx.worktree !== "/"
      const root = isGit ? ctx.worktree : ctx.directory
      const state = derive({
        sessionID: input.sessionID,
        root,
        cwd: ctx.directory,
        messages: yield* sessions.messages({ sessionID: input.sessionID }).pipe(Effect.orElseSucceed(() => [])),
        todos: yield* todos.get(input.sessionID),
        graph: yield* graph.get(input.sessionID),
        git: isGit
          ? {
              branch: yield* git.branch(root),
              changes: (yield* git.status(root)).map((item) => ({ file: item.file, status: item.status })),
            }
          : undefined,
      })
      yield* Effect.tryPromise(() => write(root, state, { checkpoint: input.checkpoint })).pipe(
        Effect.catch((error) => Effect.logWarning("could not write task state", { error: String(error) })),
      )
      return state
    })

    const save = Effect.fn("TaskState.save")(function* (input: { sessionID: SessionID; checkpoint?: string }) {
      return yield* lock(input.sessionID)
        .withPermits(1)(gather(input))
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("could not gather task state", { cause }).pipe(Effect.as(undefined)),
          ),
        )
    })

    return Service.of({ save })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Config.node, Session.node, Todo.node, EngineeringGraph.node, Git.node],
})

export * as TaskState from "./task-state"

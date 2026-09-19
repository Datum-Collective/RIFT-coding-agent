import { describe, expect, test } from "bun:test"
import {
  context,
  phases,
  plan,
  task,
  verification,
  parseVibePlan,
  VERIFICATION_METADATA_KEY,
} from "../../src/util/task"
import type { TaskInput, TaskMessage, TaskPart } from "../../src/util/task"

type Built = { messages: TaskMessage[]; parts: Record<string, TaskPart[]> }

function build(blocks: Array<{ message: Partial<TaskMessage> & { role: "user" | "assistant" }; parts: TaskPart[] }>) {
  const built: Built = { messages: [], parts: {} }
  blocks.forEach((block, index) => {
    const id = `m${index}`
    built.messages.push({ id, ...block.message })
    built.parts[id] = block.parts
  })
  return built
}

function input(built: Built, extra: Partial<TaskInput> = {}): TaskInput {
  return { messages: built.messages, parts: (id) => built.parts[id] ?? [], ...extra }
}

const tool = (name: string, state: Partial<TaskPart & { state: unknown }> | Record<string, unknown> = {}): TaskPart =>
  ({ type: "tool", tool: name, state: { status: "completed", ...(state as object) } }) as TaskPart

const text = (value: string, extra: Record<string, unknown> = {}): TaskPart =>
  ({ type: "text", text: value, ...extra }) as TaskPart

describe("execution phases", () => {
  test("collapses a run of tool calls into readable states", () => {
    const built = build([
      { message: { role: "user" }, parts: [text("add retries")] },
      {
        message: { role: "assistant" },
        parts: [
          tool("read"),
          tool("grep"),
          tool("read"),
          tool("edit", { status: "completed", input: { filePath: "a.ts" } }),
          tool("edit", { status: "completed", input: { filePath: "b.ts" } }),
          tool("write", { status: "completed", input: { filePath: "a.ts" } }),
          tool("bash", { status: "completed", input: { command: "bun test" } }),
        ],
      },
    ])
    expect(phases(input(built)).map((phase) => [phase.label, phase.signal])).toEqual([
      ["Analyzing code", "done"],
      ["Editing 2 files", "done"],
      ["Running tests", "done"],
    ])
  })

  test("distinguishes a test command from an ordinary shell command", () => {
    const shell = build([
      { message: { role: "assistant" }, parts: [tool("bash", { input: { command: "git status" } })] },
    ])
    expect(phases(input(shell))[0]?.label).toBe("Running a command")
    for (const command of ["bun test", "npm run typecheck", "pytest -q", "cargo test", "eslint ."]) {
      const built = build([{ message: { role: "assistant" }, parts: [tool("bash", { input: { command } })] }])
      expect(phases(input(built))[0]?.label).toBe("Running tests")
    }
  })

  test("a running call makes the phase active, an error makes it failed", () => {
    const running = build([
      { message: { role: "assistant" }, parts: [tool("bash", { status: "running", input: { command: "bun test" } })] },
    ])
    expect(phases(input(running, { busy: true }))[0]).toMatchObject({ signal: "active", label: "Running tests" })

    const failed = build([
      {
        message: { role: "assistant" },
        parts: [
          tool("edit", { status: "error", input: { filePath: "a.ts" } }),
          tool("edit", { status: "completed", input: { filePath: "b.ts" } }),
        ],
      },
    ])
    expect(phases(input(failed))[0]).toMatchObject({ signal: "failed", detail: "1 failed" })
  })

  test("a tool left running while the session is idle reads as interrupted, not active", () => {
    const built = build([
      { message: { role: "assistant" }, parts: [tool("bash", { status: "running", input: { command: "bun test" } })] },
    ])
    expect(phases(input(built, { busy: true }))[0]).toMatchObject({ signal: "active" })
    expect(phases(input(built))[0]).toMatchObject({ signal: "warn", detail: "interrupted" })
  })

  test("sums durations only for finished phases and ignores user messages and unknown tools", () => {
    const built = build([
      { message: { role: "user" }, parts: [tool("read")] },
      {
        message: { role: "assistant" },
        parts: [
          tool("read", { time: { start: 0, end: 1500 } }),
          tool("read", { time: { start: 1500, end: 2000 } }),
          tool("mystery_tool"),
        ],
      },
    ])
    const result = phases(input(built))
    expect(result).toHaveLength(1)
    expect(result[0]?.ms).toBe(2000)
  })

  test("separates phases that repeat after an interruption", () => {
    const built = build([
      {
        message: { role: "assistant" },
        parts: [tool("read"), tool("edit", { input: { filePath: "a.ts" } }), tool("read")],
      },
    ])
    expect(phases(input(built)).map((phase) => phase.label)).toEqual([
      "Analyzing code",
      "Editing 1 file",
      "Analyzing code",
    ])
  })
})

describe("plan", () => {
  const planText = [
    "Vibe Mode plan",
    "1. Add the retry helper",
    "   Files: src/retry.ts",
    "   Functions: retry",
    "2. Wire it into the client",
    "   Files: src/client.ts, src/types.ts",
    "   Functions: not specified",
  ].join("\n")

  test("parses the planner's numbered format including target files", () => {
    expect(parseVibePlan(planText)).toEqual([
      { n: 1, text: "Add the retry helper", files: ["src/retry.ts"], signal: "pending" },
      { n: 2, text: "Wire it into the client", files: ["src/client.ts", "src/types.ts"], signal: "pending" },
    ])
  })

  test("marks steps done from review approvals and active from the running step", () => {
    const built = build([
      { message: { role: "assistant", mode: "vibe-planner" }, parts: [text(planText)] },
      { message: { role: "user" }, parts: [text("Execute this Vibe Mode plan step using the available tools.")] },
      { message: { role: "assistant", mode: "vibe-planner" }, parts: [text("Vibe Mode review of step 1/2: approved")] },
      { message: { role: "user" }, parts: [text("Execute this Vibe Mode plan step using the available tools.")] },
    ])
    const result = plan(input(built))
    expect(result.source).toBe("vibe")
    expect(result.steps.map((step) => step.signal)).toEqual(["done", "active"])
  })

  test("a rejected review does not mark the step done", () => {
    const built = build([
      { message: { role: "assistant", mode: "vibe-planner" }, parts: [text(planText)] },
      { message: { role: "user" }, parts: [text("Execute this Vibe Mode plan step using the available tools.")] },
      {
        message: { role: "assistant", mode: "vibe-planner" },
        parts: [text("Vibe Mode review of step 1/2: changes requested (1/2)\nstill wrong")],
      },
    ])
    expect(plan(input(built)).steps[0]?.signal).toBe("active")
  })

  test("falls back to todos, then to nothing", () => {
    const empty = build([{ message: { role: "user" }, parts: [text("hello")] }])
    expect(plan(input(empty)).source).toBe("none")

    const todos = plan(
      input(empty, {
        todos: [
          { content: "first", status: "completed" },
          { content: "second", status: "in_progress" },
          { content: "third", status: "pending" },
        ],
      }),
    )
    expect(todos.source).toBe("todo")
    expect(todos.steps.map((step) => step.signal)).toEqual(["done", "active", "pending"])
  })
})

describe("verification", () => {
  const withSummary = (summary: unknown) =>
    build([
      {
        message: { role: "assistant" },
        parts: [text("Automated verification", { metadata: { [VERIFICATION_METADATA_KEY]: summary } })],
      },
    ])

  test("reads the structured report", () => {
    const result = verification(
      input(
        withSummary({
          done: true,
          checks: [
            { command: "bun test", status: "passed", ms: 1200 },
            { command: "tsc", status: "failed", ms: 800, where: "packages/a" },
          ],
          scopeFiles: 20,
          scopeWarnFiles: 15,
        }),
      ),
    )
    expect(result.state).toBe("failed")
    expect(result.checks).toHaveLength(2)
    expect(result.checks[1]).toMatchObject({ command: "tsc", status: "failed", where: "packages/a" })
    expect(result.scope).toEqual({ files: 20, threshold: 15 })
  })

  test("is running until the report says done", () => {
    const result = verification(
      input(withSummary({ done: false, checks: [{ command: "bun test", status: "not_run" }] })),
    )
    expect(result.state).toBe("running")
  })

  test("checks that did not run are incomplete, never passed", () => {
    const result = verification(
      input(
        withSummary({ done: true, checks: [{ command: "bun test", status: "not_run", reason: "permission denied" }] }),
      ),
    )
    expect(result.state).toBe("incomplete")
    expect(result.checks[0]?.reason).toBe("permission denied")
  })

  test("a claims mismatch fails the task even when every check passed", () => {
    const result = verification(
      input(
        withSummary({
          done: true,
          checks: [{ command: "bun test", status: "passed" }],
          claims: { status: "mismatch", items: [{ claim: "added retries", reality: "no retry code" }] },
        }),
      ),
    )
    expect(result.state).toBe("failed")
    expect(result.claims?.status).toBe("mismatch")
  })

  test("validates the claims verdict instead of trusting the metadata shape", () => {
    const mismatch = verification(
      input(
        withSummary({
          done: true,
          checks: [],
          claims: { status: "mismatch", items: [{ claim: "a", reality: "b" }, { reality: "no claim" }, 7] },
        }),
      ),
    ).claims
    expect(mismatch).toEqual({ status: "mismatch", items: [{ claim: "a", reality: "b" }] })

    expect(verification(input(withSummary({ done: true, checks: [], claims: { status: "not_run" } }))).claims).toEqual({
      status: "not_run",
      reason: "unknown",
    })
    for (const bad of [{ status: "nonsense" }, { nope: 1 }, "ok", null]) {
      expect(verification(input(withSummary({ done: true, checks: [], claims: bad }))).claims).toBeUndefined()
    }
  })

  test("absent or malformed metadata yields none rather than a pass", () => {
    const none = build([{ message: { role: "assistant" }, parts: [text("just a reply")] }])
    expect(verification(input(none))).toEqual({ state: "none", checks: [] })
    for (const bad of [null, "nope", 42, { checks: "not an array" }]) {
      expect(verification(input(withSummary(bad))).state).not.toBe("passed")
    }
    // Entries without a command are dropped instead of rendering as blank rows.
    expect(verification(input(withSummary({ done: true, checks: [{ status: "passed" }, null] }))).checks).toEqual([])
  })

  test("the newest report wins when a session has several", () => {
    const built = build([
      {
        message: { role: "assistant" },
        parts: [
          text("v1", {
            metadata: { [VERIFICATION_METADATA_KEY]: { done: true, checks: [{ command: "old", status: "passed" }] } },
          }),
        ],
      },
      {
        message: { role: "assistant" },
        parts: [
          text("v2", {
            metadata: { [VERIFICATION_METADATA_KEY]: { done: true, checks: [{ command: "new", status: "passed" }] } },
          }),
        ],
      },
    ])
    expect(verification(input(built)).checks[0]?.command).toBe("new")
  })
})

describe("context usage", () => {
  const tokens = (
    over: Partial<{ input: number; output: number; reasoning: number; read: number; write: number }>,
  ) => ({
    input: over.input ?? 0,
    output: over.output ?? 0,
    reasoning: over.reasoning ?? 0,
    cache: { read: over.read ?? 0, write: over.write ?? 0 },
  })

  test("sums every token bucket from the newest reply that produced output", () => {
    const built = build([
      { message: { role: "assistant", modelID: "m", providerID: "p" }, parts: [] },
      { message: { role: "assistant", modelID: "m", providerID: "p" }, parts: [] },
    ])
    built.messages[0]!.tokens = tokens({ input: 999, output: 5 })
    built.messages[1]!.tokens = tokens({ input: 100, output: 20, reasoning: 5, read: 10, write: 5 })
    const result = context(input(built, { contextLimit: () => 1000 }))
    expect(result.tokens).toBe(140)
    expect(result.percent).toBe(14)
  })

  test("ignores replies with no output and reports an unknown limit as null", () => {
    const built = build([{ message: { role: "assistant" }, parts: [] }])
    built.messages[0]!.tokens = tokens({ input: 50 })
    expect(context(input(built))).toEqual({ tokens: 0, percent: null })

    const withOutput = build([{ message: { role: "assistant" }, parts: [] }])
    withOutput.messages[0]!.tokens = tokens({ input: 50, output: 10 })
    expect(context(input(withOutput))).toEqual({ tokens: 60, percent: null })
  })
})

describe("task state", () => {
  const editing = build([
    { message: { role: "user" }, parts: [text("add retries to the client")] },
    { message: { role: "assistant" }, parts: [tool("edit", { input: { filePath: "a.ts" } })] },
  ])

  test("titles the task from the newest real user message, ignoring synthetic ones", () => {
    const built = build([
      { message: { role: "user" }, parts: [text("first request")] },
      { message: { role: "user" }, parts: [text("Execute this Vibe Mode plan step", { synthetic: true })] },
    ])
    expect(task(input(built)).title).toBe("first request")
    expect(task(input(build([]), { title: "Session title" })).title).toBe("Session title")
    expect(task(input(build([]))).title).toBe("Untitled task")
  })

  test("blocked beats every other state", () => {
    expect(task(input(editing, { busy: true, permissions: 1 })).state).toBe("blocked")
    expect(task(input(editing, { busy: true, questions: 1 })).state).toBe("blocked")
  })

  test("moves through planning, executing, verifying and done", () => {
    const fresh = build([{ message: { role: "user" }, parts: [text("go")] }])
    expect(task(input(fresh, { busy: true })).state).toBe("planning")
    expect(task(input(editing, { busy: true })).state).toBe("executing")
    expect(task(input(editing)).state).toBe("done")
    expect(task(input(build([]))).state).toBe("idle")
  })

  test("a failed check or a failed tool call fails the task", () => {
    const built = build([
      { message: { role: "user" }, parts: [text("go")] },
      {
        message: { role: "assistant" },
        parts: [
          tool("edit", { status: "error", input: { filePath: "a.ts" } }),
          text("done", {
            metadata: { [VERIFICATION_METADATA_KEY]: { done: true, checks: [{ command: "t", status: "failed" }] } },
          }),
        ],
      },
    ])
    expect(task(input(built)).state).toBe("failed")
  })

  test("totals the diff", () => {
    const result = task(
      input(editing, {
        diff: [
          { file: "a.ts", added: 40, removed: 8 },
          { file: "b.ts", added: 42, removed: 3 },
        ],
      }),
    )
    expect(result.changes).toMatchObject({ added: 82, removed: 11 })
    expect(result.changes.files).toHaveLength(2)
  })
})

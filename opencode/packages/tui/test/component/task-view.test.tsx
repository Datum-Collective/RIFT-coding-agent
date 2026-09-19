/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { OpencodeKeymapProvider } from "../../src/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { KVProvider } from "../../src/context/kv"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"
import { TaskView } from "../../src/component/control/task-view"
import { shortenPath, formatDuration } from "../../src/component/control/primitives"
import type { Task } from "../../src/util/task"

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    title: "Add retry logic to the API client",
    state: "executing",
    plan: { source: "none", steps: [] },
    execution: [],
    changes: { files: [], added: 0, removed: 0 },
    verification: { state: "none", checks: [] },
    blocked: { permissions: 0, questions: 0 },
    models: {},
    context: { tokens: 0, percent: null },
    cost: 0,
    ...overrides,
  }
}

function Harness(props: { task: Task; width: number }) {
  const keymap = createDefaultOpenTuiKeymap(useRenderer())
  return (
    <OpencodeKeymapProvider keymap={keymap}>
      <TuiConfigProvider config={createTuiResolvedConfig()}>
        <KVProvider>
          <ThemeProvider mode="dark">
            <TaskView task={props.task} width={props.width} />
          </ThemeProvider>
        </KVProvider>
      </TuiConfigProvider>
    </OpencodeKeymapProvider>
  )
}

async function frame(task: Task, width = 100, height = 40) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <Harness task={task} width={width - 4} />
      </TestTuiContexts>
    ),
    { width, height },
  )
  try {
    // KV and the theme hydrate from disk before children mount, so poll for the first paint.
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      await app.renderOnce()
      if (app.captureCharFrame().trim().length > 0) break
    }
    return app.captureCharFrame()
  } finally {
    app.renderer.destroy()
  }
}

test("renders the task header with state, models and diff totals", async () => {
  const out = await frame(
    makeTask({
      models: { planner: "opus-5", executor: "haiku-4.5" },
      changes: {
        files: [
          { file: "src/client.ts", added: 40, removed: 8 },
          { file: "src/retry.ts", added: 42, removed: 3 },
        ],
        added: 82,
        removed: 11,
      },
    }),
  )
  expect(out).toContain("TASK")
  expect(out).toContain("Add retry logic to the API client")
  expect(out).toContain("executing")
  expect(out).toContain("opus-5 → haiku-4.5")
  expect(out).toContain("+82")
  expect(out).toContain("−11")
})

test("renders plan steps with their status glyphs", async () => {
  const out = await frame(
    makeTask({
      plan: {
        source: "vibe",
        steps: [
          { n: 1, text: "Add the retry helper", files: ["src/retry.ts"], signal: "done" },
          { n: 2, text: "Wire it into the client", files: [], signal: "active" },
          { n: 3, text: "Add tests", files: [], signal: "pending" },
        ],
      },
    }),
  )
  expect(out).toContain("PLAN")
  expect(out).toContain("✓ 1. Add the retry helper")
  expect(out).toContain("● 2. Wire it into the client")
  expect(out).toContain("○ 3. Add tests")
})

test("collapses execution into states with durations, not a transcript", async () => {
  const out = await frame(
    makeTask({
      execution: [
        { kind: "analyze", label: "Analyzing code", signal: "done", ms: 2100 },
        { kind: "edit", label: "Editing 4 files", signal: "done", ms: 8400 },
        { kind: "test", label: "Running tests", signal: "failed", detail: "2 failed" },
      ],
    }),
  )
  expect(out).toContain("EXECUTION")
  expect(out).toContain("✓ Analyzing code")
  expect(out).toContain("2.1s")
  expect(out).toContain("✗ Running tests")
  expect(out).toContain("2 failed")
})

test("shows verification results and a claims mismatch", async () => {
  const out = await frame(
    makeTask({
      state: "failed",
      verification: {
        state: "failed",
        checks: [
          { command: "bun run typecheck", status: "passed", ms: 1200 },
          { command: "bun test", status: "failed", ms: 3000 },
          { command: "bun lint", status: "not_run", reason: "permission denied", ms: 0 },
        ],
        claims: { status: "mismatch", items: [{ claim: "added retries", reality: "no retry code" }] },
        scope: { files: 20, threshold: 15 },
      },
    }),
  )
  expect(out).toContain("VERIFICATION")
  expect(out).toContain("✓ bun run typecheck")
  expect(out).toContain("✗ bun test")
  expect(out).toContain("permission denied")
  expect(out).toContain("summary does not match the diff (1)")
  expect(out).toContain("20 files changed")
})

test("surfaces a blocked task above everything else", async () => {
  const out = await frame(makeTask({ state: "blocked", blocked: { permissions: 2, questions: 1 } }))
  expect(out).toContain("NEEDS YOU")
  expect(out).toContain("2 permission requests")
  expect(out).toContain("1 question")
  const needs = out.indexOf("NEEDS YOU")
  expect(needs).toBeGreaterThan(-1)
  // It sits directly under the task header, before plan or execution.
  expect(needs).toBeLessThan(out.indexOf("EXECUTION") === -1 ? Number.MAX_SAFE_INTEGER : out.indexOf("EXECUTION"))
})

test("shows context pressure only when the limit is known", async () => {
  expect(await frame(makeTask({ context: { tokens: 120_000, percent: 78 } }))).toContain("78% context")
  expect(await frame(makeTask({ context: { tokens: 120_000, percent: null } }))).not.toContain("% context")
})

test("offers review of the changed files, pointing at the existing diff viewer", async () => {
  const out = await frame(
    makeTask({
      changes: { files: [{ file: "src/a.ts", added: 1, removed: 0 }], added: 1, removed: 0 },
    }),
  )
  expect(out).toContain("REVIEW")
  expect(out).toContain("1 file to review")
})

test("has no review section when nothing changed", async () => {
  expect(await frame(makeTask())).not.toContain("REVIEW")
})

test("tells the user when nothing has happened instead of rendering an empty frame", async () => {
  expect(await frame(makeTask({ state: "idle" }))).toContain("No activity yet")
})

test("fills the width without overflowing from 80 to 200 columns", async () => {
  const rich = makeTask({
    plan: {
      source: "vibe",
      steps: [{ n: 1, text: "Add the retry helper", files: ["src/retry.ts"], signal: "active" }],
    },
    execution: [{ kind: "test", label: "Running tests", signal: "active" }],
    changes: { files: [{ file: "src/client.ts", added: 40, removed: 8 }], added: 40, removed: 8 },
    verification: { state: "failed", checks: [{ command: "bun test", status: "failed", ms: 10 }] },
  })
  for (const width of [80, 100, 120, 160, 200]) {
    const out = await frame(rich, width, 44)
    for (const line of out.split("\n")) expect(line.length).toBeLessThanOrEqual(width)
    // Every section still renders, and the rules stretch to the terminal.
    for (const section of ["TASK", "PLAN", "EXECUTION", "CHANGES", "VERIFICATION", "REVIEW"]) {
      expect(out).toContain(section)
    }
    expect(out).toContain("─".repeat(Math.min(40, width - 20)))
  }
}, 30_000)

test("stays inside a narrow 80-column terminal", async () => {
  const out = await frame(
    makeTask({
      changes: {
        files: [{ file: "packages/opencode/src/session/very/deeply/nested/module/client.ts", added: 40, removed: 8 }],
        added: 40,
        removed: 8,
      },
      execution: [{ kind: "analyze", label: "Analyzing code", signal: "done", ms: 2100 }],
    }),
    80,
  )
  for (const line of out.split("\n")) expect(line.length).toBeLessThanOrEqual(80)
  expect(out).toContain("client.ts")
})

test("path shortening keeps the filename and duration formatting is compact", () => {
  expect(shortenPath("a/b/c/d/file.ts", 100)).toBe("a/b/c/d/file.ts")
  for (const max of [8, 12, 20]) {
    const short = shortenPath("a/b/c/d/file.ts", max)
    expect(short.length).toBeLessThanOrEqual(max)
    expect(short.endsWith("file.ts") || short.endsWith("le.ts")).toBe(true)
  }
  expect(shortenPath("a/b/c/d/file.ts", 12)).toBe("…/d/file.ts")
  expect(shortenPath("averyveryverylongfilename.ts", 10)).toBe("…lename.ts")
  expect(formatDuration(0)).toBe("")
  expect(formatDuration(450)).toBe("450ms")
  expect(formatDuration(2100)).toBe("2.1s")
  expect(formatDuration(65_000)).toBe("1m05s")
})

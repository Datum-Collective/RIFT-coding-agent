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
import { TaskPanel } from "../../src/feature-plugins/sidebar/task"
import type { Task } from "../../src/util/task"

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    title: "Add retry logic",
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

function Harness(props: { task: Task }) {
  const keymap = createDefaultOpenTuiKeymap(useRenderer())
  return (
    <OpencodeKeymapProvider keymap={keymap}>
      <TuiConfigProvider config={createTuiResolvedConfig()}>
        <KVProvider>
          <ThemeProvider mode="dark">
            <box width={38}>
              <TaskPanel task={props.task} />
            </box>
          </ThemeProvider>
        </KVProvider>
      </TuiConfigProvider>
    </OpencodeKeymapProvider>
  )
}

async function frame(task: Task) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <Harness task={task} />
      </TestTuiContexts>
    ),
    { width: 40, height: 30 },
  )
  try {
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

test("shows state, plan progress, changes and checks", async () => {
  const out = await frame(
    makeTask({
      plan: {
        source: "vibe",
        steps: [
          { n: 1, text: "Read the client", files: [], signal: "done" },
          { n: 2, text: "Add backoff", files: [], signal: "active" },
          { n: 3, text: "Write tests", files: [], signal: "pending" },
        ],
      },
      execution: [{ kind: "edit", label: "Editing src/client.ts", signal: "active" }],
      changes: { files: [{ file: "src/client.ts", added: 12, removed: 3 }], added: 12, removed: 3 },
      verification: {
        state: "passed",
        checks: [{ command: "bun test", status: "passed", ms: 2400 }],
      },
    }),
  )
  expect(out).toContain("Working")
  expect(out).toContain("Editing src/client.ts")
  expect(out).toContain("Plan")
  expect(out).toContain("1/3")
  expect(out).toContain("Add backoff")
  expect(out).toContain("Changes")
  expect(out).toContain("+12")
  expect(out).toContain("bun test")
})

test("says when it is waiting on you", async () => {
  const out = await frame(makeTask({ state: "blocked", blocked: { permissions: 2, questions: 0 } }))
  expect(out).toContain("Waiting on you")
  expect(out).toContain("2 requests need your answer")
})

test("stays quiet when there is nothing to show", async () => {
  const out = await frame(makeTask({ state: "idle" }))
  expect(out).toContain("Idle")
  expect(out).not.toContain("Plan")
  expect(out).not.toContain("Changes")
  expect(out).not.toContain("Checks")
})

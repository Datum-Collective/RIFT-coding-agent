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
import { ForgeView } from "../../src/component/control/forge-view"
import { forge, type Forge } from "../../src/util/forge"
import type { TaskPart } from "../../src/util/task"

function Harness(props: { forge: Forge; width: number }) {
  const keymap = createDefaultOpenTuiKeymap(useRenderer())
  return (
    <OpencodeKeymapProvider keymap={keymap}>
      <TuiConfigProvider config={createTuiResolvedConfig()}>
        <KVProvider>
          <ThemeProvider mode="dark">
            <ForgeView forge={props.forge} width={props.width} />
          </ThemeProvider>
        </KVProvider>
      </TuiConfigProvider>
    </OpencodeKeymapProvider>
  )
}

async function frame(value: Forge, width = 110, height = 50) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <Harness forge={value} width={width - 4} />
      </TestTuiContexts>
    ),
    { width, height },
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

const step = (stage: string, status: string, extra: Record<string, unknown> = {}, call = "completed"): TaskPart => ({
  type: "tool",
  tool: "forge",
  state: { status: call as "completed", input: { stage, status, summary: `${stage} summary`, ...extra } },
})

function pipeline(parts: TaskPart[], busy = true) {
  const value = forge({ messages: [{ id: "a", role: "assistant" }], parts: () => parts, busy })
  if (!value) throw new Error("expected a pipeline")
  return value
}

test("renders the goal, the forge line and every stage", async () => {
  const out = await frame(
    pipeline([
      step("goal", "done", { summary: "URL shortener with analytics" }),
      step("requirements", "done"),
      step("architecture", "active", {
        items: [
          { text: "Hono for routing", status: "done" },
          { text: "SQLite via drizzle", status: "active" },
        ],
      }),
    ]),
  )
  expect(out).toContain("FORGE")
  expect(out).toContain("URL shortener with analytics")
  expect(out).toContain("forging")
  expect(out).toContain("stage 3/11 Architecture")
  expect(out).toContain("■━━■━━◉┄┄○")
  for (const label of ["Goal", "Requirements", "Engineering Graph", "Adversarial Testing", "Human Gate", "Ship"]) {
    expect(out).toContain(label)
  }
  // The focused stage shows its artifact.
  expect(out).toContain("Hono for routing")
  expect(out).toContain("SQLite via drizzle")
})

test("stale stages say which steer will rebuild them", async () => {
  const out = await frame(
    pipeline([step("architecture", "done"), step("graph", "done"), step("architecture", "active")]),
  )
  expect(out).toContain("stale · rebuilds after Architecture")
  expect(out).toContain("↺ 1 steer")
})

test("a waiting gate asks for the human", async () => {
  const out = await frame(pipeline([step("evidence", "done"), step("gate", "active", {}, "running")]))
  expect(out).toContain("needs you")
  expect(out).toContain("NEEDS YOU")
  expect(out).toContain("waiting for you")
})

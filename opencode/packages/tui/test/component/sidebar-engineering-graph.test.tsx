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
import { GraphPanel } from "../../src/feature-plugins/sidebar/engineering-graph"
import { deriveGraph } from "../../src/util/engineering-graph"
import { task } from "../../src/util/task"
import type { TuiSidebarGraphItem } from "@opencode-ai/plugin/tui"

function Harness(props: { nodes: readonly TuiSidebarGraphItem[] }) {
  const keymap = createDefaultOpenTuiKeymap(useRenderer())
  return (
    <OpencodeKeymapProvider keymap={keymap}>
      <TuiConfigProvider config={createTuiResolvedConfig()}>
        <KVProvider>
          <ThemeProvider mode="dark">
            <box width={52}>
              <GraphPanel nodes={props.nodes} />
            </box>
          </ThemeProvider>
        </KVProvider>
      </TuiConfigProvider>
    </OpencodeKeymapProvider>
  )
}

async function frame(nodes: readonly TuiSidebarGraphItem[]) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <Harness nodes={nodes} />
      </TestTuiContexts>
    ),
    { width: 56, height: 30 },
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

test("shows a graph built from the plan when the agent declared none", async () => {
  const nodes = deriveGraph(
    task({
      messages: [],
      parts: () => [],
      title: "Datum site",
      todos: [
        { content: "Research Datum Collective", status: "completed" },
        { content: "Build animated website", status: "completed" },
      ],
      diff: [{ file: "/Users/me/Desktop/test/index.html", added: 200, removed: 0 }],
    }),
    "build",
  )
  const out = await frame(nodes)
  expect(out).toContain("Engineering graph")
  expect(out).not.toContain("No nodes yet")
  expect(out).toContain("Datum site")
  expect(out).toContain("Research Datum Collective")
  expect(out).toContain("Build animated website")
  expect(out).toContain("index.html")
})

test("nests declared nodes and flags unmet dependencies", async () => {
  const node = (fields: Partial<TuiSidebarGraphItem> & Pick<TuiSidebarGraphItem, "id" | "title">) => ({
    status: "not_started" as const,
    owner: "build",
    dependencies: [],
    files: [],
    tests: [],
    decisions: [],
    evidence: [],
    ...fields,
  })
  const out = await frame([
    node({ id: "p", title: "Product", status: "in_progress" }),
    node({ id: "auth", parent_id: "p", title: "Authentication", status: "in_progress" }),
    node({ id: "auth.db", parent_id: "auth", title: "Database", status: "done" }),
    node({ id: "auth.api", parent_id: "auth", title: "API", dependencies: ["auth.fe"] }),
    node({ id: "auth.fe", parent_id: "auth", title: "Frontend" }),
  ])
  expect(out).toContain("Product")
  expect(out).toContain("Authentication")
  expect(out).toContain("waiting on: Frontend")
})

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
import { task, verification } from "../../src/util/task"
import type { Evidence } from "../../src/util/task"
import { evidenceFor } from "../../src/util/engineering-graph"
import type { TuiSidebarGraphItem } from "@opencode-ai/plugin/tui"

type Rows = ReadonlyMap<string, readonly Evidence[]>

function Harness(props: { nodes: readonly TuiSidebarGraphItem[]; evidence?: Rows }) {
  const keymap = createDefaultOpenTuiKeymap(useRenderer())
  return (
    <OpencodeKeymapProvider keymap={keymap}>
      <TuiConfigProvider config={createTuiResolvedConfig()}>
        <KVProvider>
          <ThemeProvider mode="dark">
            <box width={70}>
              <GraphPanel nodes={props.nodes} evidence={props.evidence} />
            </box>
          </ThemeProvider>
        </KVProvider>
      </TuiConfigProvider>
    </OpencodeKeymapProvider>
  )
}

async function frame(nodes: readonly TuiSidebarGraphItem[], evidence?: Rows) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <Harness nodes={nodes} evidence={evidence} />
      </TestTuiContexts>
    ),
    { width: 72, height: 30 },
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

const node = (fields: Partial<TuiSidebarGraphItem> & Pick<TuiSidebarGraphItem, "id" | "title">): TuiSidebarGraphItem => ({
  status: "not_started",
  owner: "build",
  dependencies: [],
  files: [],
  checks: [],
  decisions: [],
  ...fields,
})

test("nests declared nodes and flags unmet dependencies", async () => {
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

test("shows the evidence RIFT gathered under each requirement, and what has not run", async () => {
  const nodes = [
    node({ id: "product", title: "Product", status: "in_progress" }),
    node({
      id: "upload",
      parent_id: "product",
      title: "Users can upload a 500MB video",
      status: "testing",
      checks: [
        { kind: "unit", command: "bun test upload" },
        { kind: "load", command: "k6 run load.js" },
        { kind: "production", url: "https://app.example.com/upload" },
      ],
    }),
  ]
  const summary = {
    done: true,
    checks: [{ command: "bun run typecheck", status: "passed", ms: 900 }],
    evidence: [
      { node: "upload", label: "Implementation", status: "passed", detail: "3 files present" },
      { node: "upload", label: "Unit tests", status: "passed", detail: "bun test upload (exit 0)" },
      { node: "upload", label: "Load test", status: "failed", detail: "k6 run load.js (exit 1)" },
      { node: "upload", label: "Sneaky", status: "proven-by-agent", detail: "trust me" },
    ],
  }
  const verified = verification({
    messages: [{ id: "m", role: "assistant" }],
    parts: () => [{ type: "text", text: "", metadata: { rift_verification: summary } }],
  })
  const out = await frame(nodes, evidenceFor(nodes, verified))
  expect(out).toContain("bun run typecheck")
  expect(out).toContain("✓ Implementation · 3 files present")
  expect(out).toContain("✓ Unit tests · bun test upload (exit 0)")
  expect(out).toContain("✗ Load test · k6 run load.js (exit 1)")
  expect(out).toContain("○ Production check · not run yet")
  expect(out).not.toContain("Sneaky")
  expect(verified.state).toBe("failed")
})

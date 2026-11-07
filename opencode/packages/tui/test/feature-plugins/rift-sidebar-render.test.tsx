/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import type { Rift } from "@opencode/schema/rift"
import { SidebarRift } from "../../src/feature-plugins/sidebar/rift"

const color = RGBA.fromInts(200, 200, 200)
const context = (state: Rift.State | null) =>
  ({
    theme: {
      text: {
        base: color,
        muted: color,
        feedback: { success: { base: color }, error: { base: color }, warning: { base: color } },
      },
    },
    data: { session: { get: () => ({ location: { directory: "/workspace" } }) }, on: () => () => undefined },
    client: { rpc: () => ({ get: async () => state, events: { on: () => () => undefined } }) },
  }) as unknown as Context

async function frame(state: Rift.State | null) {
  const app = await testRender(() => <SidebarRift context={context(state)} sessionID="session" />, { width: 48, height: 16 })
  try {
    await new Promise((resolve) => setTimeout(resolve, 10))
    await app.renderOnce()
    return app.captureCharFrame()
  } finally {
    app.renderer.destroy()
  }
}

test("nothing shows before verification has run", async () => {
  expect(await frame(null)).not.toContain("Verification")
})

const stage = (command: string, status: Rift.Stage["status"], extra: Partial<Rift.Stage> = {}): Rift.Stage => ({
  id: command,
  unit: ".",
  kind: "test",
  command,
  status,
  ...extra,
})

test("shows each check of the turn and the graph's verdicts, nested", async () => {
  const text = await frame({
    change: {
      round: 1,
      run: {
        id: "r",
        tree: "t",
        started: 0,
        phase: "done",
        finished: 1,
        verdict: "regressed",
        headline: "Verify: regressed",
        receipt: "abc",
        stages: [
          stage("bun run test", "failed", { introduced: 1, preexisting: 1 }),
          stage("bun run lint", "not_run", { reason: "declined" }),
        ],
      },
    },
    graph: [
      { id: "root", title: "Product", verdict: "at_risk", because: ["a"] },
      { id: "a", parent: "root", title: "Value", verdict: "stale", because: [] },
    ],
  })
  expect(text).toContain("Verification regressed round 1")
  expect(text).toContain("✗ bun run test (1 new, 1 already failing)")
  expect(text).toContain("○ bun run lint (declined)")
  expect(text).toContain("Engineering graph")
  expect(text).toContain("⚠ Product · at risk")
  expect(text).toContain("0/2 proven")
  expect(text).toContain("└─ ⟳ Value · stale")
  expect(text).toContain("↳ waiting on Value")
})

test("a full verify shows its progress, by unit", async () => {
  const text = await frame({
    project: {
      id: "r",
      tree: "t",
      started: 0,
      phase: "running",
      stages: [
        stage("bun install --frozen-lockfile", "passed"),
        stage("bun run test", "running", { unit: "packages/api", attempt: 2 }),
        stage("bun run test:e2e", "pending"),
      ],
    },
    graph: [],
  })
  expect(text).toContain("Full verify running 1/3")
  expect(text).toContain("✓ bun install --frozen-lockfile")
  expect(text).toContain("◌ packages/api bun run test (attempt 2)")
  expect(text).not.toContain("Verification")
})

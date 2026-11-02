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
  const app = await testRender(() => <SidebarRift context={context(state)} sessionID="session" />, { width: 42, height: 12 })
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

test("shows each check and the graph's verdicts, nested", async () => {
  const text = await frame({
    running: false,
    round: 1,
    checks: [
      { command: "bun run test", status: "failed", ms: 1 },
      { command: "bun run lint", status: "not_run", reason: "permission denied", ms: 0 },
    ],
    graph: [
      { id: "root", title: "Product", verdict: "at_risk", because: ["a"] },
      { id: "a", parent: "root", title: "Value", verdict: "stale", because: [] },
    ],
  })
  expect(text).toContain("Verification round 1")
  expect(text).toContain("✗ bun run test")
  expect(text).toContain("○ bun run lint (permission denied)")
  expect(text).toContain("Engineering graph")
  expect(text).toContain("⚠ Product · at risk")
  expect(text).toContain("0/2 proven")
  expect(text).toContain("└─ ⟳ Value · stale")
  expect(text).toContain("↳ waiting on Value")
})

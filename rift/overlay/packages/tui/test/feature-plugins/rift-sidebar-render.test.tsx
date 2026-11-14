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

async function frame(state: Rift.State | null, height = 16) {
  const app = await testRender(() => <SidebarRift context={context(state)} sessionID="session" />, { width: 48, height })
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
  expect(text).toContain("Verification regressed · round 1")
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

test("a failed check shows why it ran, what ran, how it ended and its output; the dispute shows how it ended", async () => {
  const text = await frame(
    {
      change: {
        round: 1,
        run: {
          id: "r",
          tree: "t",
          started: 0,
          phase: "done",
          finished: 1,
          verdict: "regressed",
          headline: "h",
          receipt: "abc",
          stages: [
            stage("bun run test", "failed", {
              introduced: 1,
              ms: 2500,
              why: "Tests say whether behaviour holds.",
              evidence: "expected 2\nreceived 3",
            }),
            stage("bun run lint", "passed", { why: "Lint.", evidence: "exit 0 in 0.5s, output sha256 abc" }),
          ],
        },
      },
      graph: [],
      disputes: [
        {
          stage: "bun run test",
          check: "bun run test",
          raised: 1,
          round: 1,
          claim: "bun run test fails on the agent's change",
          status: "unresolved",
          resolution: "still failing after 3 fix rounds",
        },
      ],
    },
    40,
  )
  expect(text).toContain("why      Tests say whether")
  expect(text).toContain("ran      bun run test")
  expect(text).toContain("result   failed (1 new) in 2.5s")
  expect(text).toContain("received 3")
  // A passing check stays closed until the user opens the run.
  expect(text).not.toContain("why      Lint.")
  expect(text).toContain("Verifier vs agent")
  expect(text).toContain("bun run test · unresolved")
  expect(text).toContain("still failing after 3 fix")
})

test("clicking the run's title opens every check, and clicking again closes them", async () => {
  const state: Rift.State = {
    change: {
      round: 0,
      run: {
        id: "r",
        tree: "t",
        started: 0,
        phase: "done",
        finished: 1,
        verdict: "verified",
        headline: "h",
        receipt: "abc",
        stages: [stage("bun run lint", "passed", { why: "Lint catches misuse.", evidence: "exit 0 in 0.5s, output sha256 abc" })],
      },
    },
    graph: [],
  }
  const app = await testRender(() => <SidebarRift context={context(state)} sessionID="session" />, { width: 48, height: 16 })
  try {
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      await app.renderOnce()
      return app.captureCharFrame()
    }
    expect(await settle()).not.toContain("Lint catches misuse.")
    await app.mockMouse.click(2, 0)
    const opened = await settle()
    expect(opened).toContain("Lint catches misuse.")
    expect(opened).toContain("output sha256 abc")
    await app.mockMouse.click(2, 0)
    expect(await settle()).not.toContain("Lint catches misuse.")
  } finally {
    app.renderer.destroy()
  }
})

test("the sidebar says which folder was verified and warns about edits outside it", async () => {
  const text = await frame(
    {
      graph: [],
      root: "/Users/me/Desktop/tests",
      outside: ["/Users/me/Documents/notes/cart.ts"],
      change: {
        round: 0,
        run: { id: "r", tree: "t", started: 0, phase: "done", finished: 1, verdict: "verified", headline: "h", receipt: "abc", stages: [stage("bun run test", "passed")] },
      },
    },
    24,
  )
  expect(text).toContain("in …/Desktop/tests")
  expect(text).toContain("1 file edited outside this folder")
  expect(text).toContain("…/notes/cart.ts")
  expect(text).toContain("No check covers them.")
})

test("wrapped rows keep their indent at a narrow width", async () => {
  const app = await testRender(
    () => (
      <box width={34}>
        <SidebarRift
          context={context({
            graph: [],
            change: {
              round: 0,
              run: {
                id: "r",
                tree: "t",
                started: 0,
                phase: "done",
                finished: 1,
                verdict: "regressed",
                headline: "h",
                receipt: "abc",
                stages: [stage("bun run test", "failed", { why: "The project's own tests say whether existing behaviour still holds on the change." })],
              },
            },
          })}
          sessionID="session"
        />
      </box>
    ),
    { width: 34, height: 20 },
  )
  try {
    await new Promise((resolve) => setTimeout(resolve, 20))
    await app.renderOnce()
    const lines = app.captureCharFrame().split("\n")
    const first = lines.findIndex((line) => line.includes("why      The"))
    expect(first).toBeGreaterThan(-1)
    // The second row of the sentence sits under the first word, not at the edge.
    expect(lines[first + 1]!.startsWith("           ")).toBe(true)
    expect(lines[first + 1]!.trim().length).toBeGreaterThan(0)
  } finally {
    app.renderer.destroy()
  }
})

test("a run with every check passing and an unproven verdict shows why", async () => {
  const text = await frame(
    {
      graph: [],
      change: {
        round: 0,
        run: {
          id: "r",
          tree: "t",
          started: 0,
          phase: "done",
          finished: 1,
          verdict: "unproven",
          headline: "h",
          receipt: "abc",
          notes: ["cart.ts: new code with no test in this change"],
          stages: [stage("bun run test", "passed")],
        },
      },
    },
    16,
  )
  expect(text).toContain("Verification unproven")
  expect(text).toContain("! cart.ts: new code with no test")
})

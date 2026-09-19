import { describe, expect, test } from "bun:test"
import { missionCounts, missionRow, missionState, missionSummary, orderRows } from "../../src/util/mission"
import type { MissionRow } from "../../src/util/mission"
import type { Task } from "../../src/util/task"

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    title: "A task",
    state: "done",
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

describe("mission state", () => {
  test("maps task states onto the board", () => {
    const cases: Array<[Task["state"], string]> = [
      ["blocked", "blocked"],
      ["failed", "failed"],
      ["planning", "running"],
      ["executing", "running"],
      ["verifying", "verifying"],
      ["done", "done"],
      ["idle", "idle"],
    ]
    for (const [state, expected] of cases) expect(missionState(makeTask({ state }))).toBe(expected as never)
  })
})

describe("mission summary", () => {
  test("anything waiting on a human wins", () => {
    expect(missionSummary(makeTask({ state: "blocked", blocked: { permissions: 2, questions: 1 } }))).toBe(
      "2 permission requests waiting",
    )
    expect(missionSummary(makeTask({ state: "blocked", blocked: { permissions: 0, questions: 1 } }))).toBe(
      "1 question waiting",
    )
  })

  test("names the failing check rather than a vague failure", () => {
    const summary = missionSummary(
      makeTask({
        state: "failed",
        verification: {
          state: "failed",
          checks: [
            { command: "bun run typecheck", status: "passed", ms: 10 },
            { command: "bun test", status: "failed", ms: 20 },
          ],
        },
      }),
    )
    expect(summary).toBe("1 check failed — bun test")
  })

  test("reports a claims mismatch when every command passed", () => {
    expect(
      missionSummary(
        makeTask({
          state: "failed",
          verification: {
            state: "failed",
            checks: [{ command: "bun test", status: "passed", ms: 10 }],
            claims: { status: "mismatch", items: [{ claim: "a", reality: "b" }] },
          },
        }),
      ),
    ).toBe("summary does not match the diff")
  })

  test("prefers the running phase, then falls back through changes and history", () => {
    expect(
      missionSummary(
        makeTask({
          state: "executing",
          execution: [
            { kind: "edit", label: "Editing 4 files", signal: "done" },
            { kind: "test", label: "Running tests", signal: "active" },
          ],
        }),
      ),
    ).toBe("running tests")

    expect(
      missionSummary(makeTask({ changes: { files: [{ file: "a.ts", added: 4, removed: 1 }], added: 4, removed: 1 } })),
    ).toBe("1 file · +4 −1")

    expect(missionSummary(makeTask({ execution: [{ kind: "edit", label: "Editing 2 files", signal: "done" }] }))).toBe(
      "editing 2 files",
    )
    expect(missionSummary(makeTask())).toBe("no activity")
  })

  test("distinguishes passed from incomplete verification", () => {
    expect(
      missionSummary(
        makeTask({ verification: { state: "passed", checks: [{ command: "bun test", status: "passed", ms: 1 }] } }),
      ),
    ).toBe("1 check passed")
    expect(missionSummary(makeTask({ verification: { state: "incomplete", checks: [] } }))).toBe(
      "some checks did not run",
    )
  })
})

describe("board ordering", () => {
  const row = (sessionID: string, state: MissionRow["state"]): MissionRow =>
    missionRow({
      sessionID,
      current: false,
      task: makeTask({ state: state === "running" ? "executing" : (state as never) }),
    })

  test("sessions needing a human come first, then failures, then work in flight", () => {
    const rows = [row("idle", "idle"), row("run", "running"), row("fail", "failed"), row("block", "blocked")]
    expect(orderRows(rows).map((item) => item.sessionID)).toEqual(["block", "fail", "run", "idle"])
  })

  test("ordering does not mutate the input and is stable within a rank", () => {
    const rows = [row("a", "running"), row("b", "running"), row("c", "blocked")]
    const before = rows.map((item) => item.sessionID)
    const sorted = orderRows(rows)
    expect(rows.map((item) => item.sessionID)).toEqual(before)
    expect(sorted.map((item) => item.sessionID)).toEqual(["c", "a", "b"])
  })

  test("counts what the header shows and flags rows needing attention", () => {
    const rows = [row("a", "blocked"), row("b", "failed"), row("c", "running"), row("d", "idle")]
    expect(missionCounts(rows)).toEqual({ blocked: 1, failed: 1, running: 1, total: 4 })
    expect(rows.filter((item) => item.attention).map((item) => item.sessionID)).toEqual(["a", "b"])
  })
})

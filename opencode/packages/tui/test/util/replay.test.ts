import { describe, expect, test } from "bun:test"
import { activity, dayKey, monthLabels, replay, type ReplayMessage, type ReplayPart } from "../../src/util/replay"
import { VERIFICATION_METADATA_KEY } from "../../src/util/task"

function input(turns: Array<{ role: "user" | "assistant"; time?: number; agent?: string; parts: ReplayPart[] }>) {
  const messages: ReplayMessage[] = turns.map((turn, index) => ({
    id: `m${index}`,
    role: turn.role,
    agent: turn.agent,
    time: { created: turn.time ?? index },
  }))
  return { messages, parts: (id: string) => turns[Number(id.slice(1))]?.parts ?? [] }
}

const text = (value: string, extra: Partial<ReplayPart> = {}): ReplayPart => ({ type: "text", text: value, ...extra })
const shell = (command: string, exit: number): ReplayPart => ({
  type: "tool",
  tool: "bash",
  state: { status: "completed", input: { command }, title: command, metadata: { exit } },
})
const patch = (...files: string[]): ReplayPart => ({ type: "patch", files })

describe("replay", () => {
  test("groups steps under the prompt that started them", () => {
    const result = replay(
      input([
        { role: "user", parts: [text("add retries\nwith backoff")] },
        { role: "assistant", agent: "build", parts: [text("I'll add a retry helper first."), patch("src/retry.ts")] },
        { role: "assistant", parts: [patch("src/client.ts", "src/retry.ts")] },
        { role: "user", parts: [text("now document it")] },
        { role: "assistant", parts: [patch("README.md")] },
      ]),
    )
    expect(result.turns.map((turn) => [turn.messageID, turn.prompt, turn.steps.length])).toEqual([
      ["m0", "add retries", 2],
      ["m3", "now document it", 1],
    ])
    expect(result.turns[0]!.steps[0]!.decision).toBe("I'll add a retry helper first.")
    expect(result.turns[0]!.steps[0]!.agent).toBe("build")
    expect(result.totals.files).toBe(3)
  })

  test("synthetic user messages do not start a turn", () => {
    const result = replay(
      input([
        { role: "user", parts: [text("fix it")] },
        { role: "user", parts: [text("server note", { synthetic: true })] },
        { role: "assistant", parts: [patch("a.ts")] },
      ]),
    )
    expect(result.turns).toHaveLength(1)
    expect(result.turns[0]!.steps).toHaveLength(1)
  })

  test("tests are judged by exit code, and a later pass of a failing command is a repair", () => {
    const result = replay(
      input([
        { role: "user", parts: [text("make the tests pass")] },
        { role: "assistant", parts: [shell("bun test", 1), shell("ls", 0)] },
        { role: "assistant", parts: [patch("src/a.ts"), shell("bun test", 0)] },
      ]),
    )
    const [first, second] = result.turns[0]!.steps
    expect(first!.tests).toEqual([{ command: "bun test", exit: 1, passed: false }])
    expect(first!.failures).toEqual(["bash: bun test"])
    expect(second!.repairs).toEqual(["bun test"])
    expect(result.totals).toMatchObject({ tests: 2, failures: 1, repairs: 1, tools: 3 })
  })

  test("only real test runs count as tests, not commands that mention the word", () => {
    const commands = [
      "bun test test/a.test.ts",
      "npm run typecheck",
      "cd pkg && pytest -q",
      "cargo test",
      "go test ./...",
      "ls src/ && echo ---test--- && ls test/",
      "cat test/fixture.json",
      "git commit -m 'fix tests'",
    ]
    const result = replay(
      input([
        { role: "user", parts: [text("go")] },
        { role: "assistant", parts: commands.map((c) => shell(c, 0)) },
      ]),
    )
    expect(result.turns[0]!.steps[0]!.tests.map((item) => item.command)).toEqual(commands.slice(0, 5))
  })

  test("tool errors are failures even without an exit code", () => {
    const result = replay(
      input([
        { role: "user", parts: [text("edit")] },
        { role: "assistant", parts: [{ type: "tool", tool: "edit", state: { status: "error", title: "src/a.ts" } }] },
      ]),
    )
    expect(result.turns[0]!.steps[0]!.tools).toEqual([{ name: "edit", title: "src/a.ts", status: "failed" }])
  })

  test("final evidence is RIFT's own verification report", () => {
    const report = { done: true, checks: [{ command: "bun test", status: "passed", ms: 10 }] }
    const result = replay(
      input([
        { role: "user", parts: [text("go")] },
        { role: "assistant", parts: [text("done", { metadata: { [VERIFICATION_METADATA_KEY]: report } })] },
      ]),
    )
    expect(result.evidence.state).toBe("passed")
  })
})

describe("activity grid", () => {
  const now = new Date(2026, 8, 26, 15).getTime() // a Saturday

  test("one column per week ending with the current week, Sunday first", () => {
    const grid = activity([], now, 4)
    expect(grid).toHaveLength(4)
    expect(grid.every((week) => week.length === 7)).toBe(true)
    expect(grid[3]![6]!.date).toBe("2026-09-26")
    expect(grid[0]![0]!.date).toBe("2026-08-30")
  })

  test("edits land on their local day and levels scale to the busiest day", () => {
    const at = (day: number, hour: number) => new Date(2026, 8, day, hour).getTime()
    const grid = activity(
      [
        { time: at(26, 23), files: 8, sessionID: "s", turnID: "t" },
        { time: at(25, 9), files: 1, sessionID: "s", turnID: "t" },
        { time: at(25, 10), files: 1, sessionID: "s", turnID: "t" },
      ],
      now,
      2,
    )
    const days = grid.flat()
    expect(days.find((day) => day.date === "2026-09-26")).toMatchObject({ edits: 8, level: 4 })
    expect(days.find((day) => day.date === "2026-09-25")).toMatchObject({ edits: 2, level: 1 })
    expect(days.filter((day) => day.edits === 0).every((day) => day.level === 0)).toBe(true)
  })

  test("dayKey uses the local calendar", () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59).getTime())).toBe("2026-01-05")
  })
  test("month labels start where a month starts and never overlap", () => {
    const labels = monthLabels(activity([], now, 26))
    expect(labels).toHaveLength(52)
    expect(labels.trim().split(/\s+/)).toEqual(["Mar", "May", "Jun", "Jul", "Aug", "Sep"])
  })
})

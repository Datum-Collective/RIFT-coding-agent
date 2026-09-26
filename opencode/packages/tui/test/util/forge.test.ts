import { describe, expect, test } from "bun:test"
import { forge } from "../../src/util/forge"
import type { TaskInput, TaskMessage, TaskPart } from "../../src/util/task"

function input(turns: Array<{ role: "user" | "assistant"; parts: TaskPart[] }>, extra: Partial<TaskInput> = {}) {
  const messages: TaskMessage[] = turns.map((turn, index) => ({ id: `m${index}`, role: turn.role }))
  return {
    messages,
    parts: (id: string) => turns[Number(id.slice(1))]?.parts ?? [],
    ...extra,
  } satisfies TaskInput
}

const step = (stage: string, status: string, extra: Record<string, unknown> = {}, call = "completed"): TaskPart => ({
  type: "tool",
  tool: "forge",
  state: { status: call as "completed", input: { stage, status, summary: `${stage} ${status}`, ...extra } },
})

const shell = (exit: number | undefined, status = "completed"): TaskPart => ({
  type: "tool",
  tool: "bash",
  state: { status: status as "completed", input: { command: "bun test" }, metadata: { exit } },
})

const agent = (status: string): TaskPart => ({ type: "tool", tool: "task", state: { status: status as "completed" } })

const text = (value: string): TaskPart => ({ type: "text", text: value })

const states = (value: ReturnType<typeof forge>) =>
  Object.fromEntries((value?.stages ?? []).map((stage) => [stage.id, stage.state]))

describe("forge pipeline", () => {
  test("a session that never used Forge has no pipeline", () => {
    expect(forge(input([{ role: "assistant", parts: [shell(0)] }]))).toBeUndefined()
  })

  test("stages advance in order and the goal comes from the goal stage", () => {
    const result = forge(
      input(
        [
          { role: "user", parts: [text("build a url shortener")] },
          {
            role: "assistant",
            parts: [
              step("goal", "done", { summary: "URL shortener with click analytics" }),
              step("requirements", "done"),
              step("architecture", "active"),
            ],
          },
        ],
        { busy: true },
      ),
    )
    expect(result?.goal).toBe("URL shortener with click analytics")
    expect(result?.state).toBe("forging")
    expect(result?.focus).toBe("architecture")
    expect(states(result)).toMatchObject({
      goal: "done",
      requirements: "done",
      architecture: "active",
      graph: "pending",
    })
  })

  test("steering an earlier stage makes every later stage stale", () => {
    const result = forge(
      input([
        {
          role: "assistant",
          parts: [
            step("goal", "done"),
            step("requirements", "done"),
            step("architecture", "done"),
            step("graph", "done"),
            step("agents", "active"),
          ],
        },
        { role: "user", parts: [text("architecture: use postgres")] },
        { role: "assistant", parts: [step("architecture", "active")] },
      ]),
    )
    expect(result?.steers).toBe(1)
    expect(states(result)).toMatchObject({
      requirements: "done",
      architecture: "active",
      graph: "stale",
      agents: "stale",
      verify: "pending",
    })
    const graph = result?.stages.find((stage) => stage.id === "graph")
    expect(graph?.staleBy).toBe("architecture")
    expect(result?.stages.find((stage) => stage.id === "architecture")?.revisions).toBe(1)
  })

  test("a rebuilt stage is no longer stale", () => {
    const result = forge(
      input([
        {
          role: "assistant",
          parts: [
            step("architecture", "done"),
            step("graph", "done"),
            step("architecture", "active"),
            step("architecture", "done"),
            step("graph", "done"),
          ],
        },
      ]),
    )
    expect(states(result)).toMatchObject({ architecture: "done", graph: "done" })
  })

  test("commands are judged by their real exit codes, not the agent's summary", () => {
    const result = forge(
      input([
        {
          role: "assistant",
          parts: [
            step("verify", "active"),
            shell(0),
            shell(1),
            step("verify", "done", { summary: "all checks passed" }),
          ],
        },
      ]),
    )
    const verify = result?.stages.find((stage) => stage.id === "verify")
    expect(verify?.summary).toBe("all checks passed")
    expect(verify?.commands).toEqual({ total: 2, running: 0, failed: 1 })
    expect(result?.commands.failed).toBe(1)
  })

  test("subagents are counted on the stage that dispatched them", () => {
    const result = forge(
      input(
        [
          {
            role: "assistant",
            parts: [step("agents", "active"), agent("completed"), agent("running"), agent("error")],
          },
        ],
        { busy: true },
      ),
    )
    expect(result?.stages.find((stage) => stage.id === "agents")?.agents).toEqual({ total: 3, running: 1, failed: 1 })
  })

  test("re-opening a stage starts its counters over", () => {
    const result = forge(
      input([
        {
          role: "assistant",
          parts: [step("verify", "active"), shell(1), step("verify", "failed"), step("verify", "active"), shell(0)],
        },
      ]),
    )
    expect(result?.stages.find((stage) => stage.id === "verify")?.commands).toEqual({
      total: 1,
      running: 0,
      failed: 0,
    })
    expect(result?.commands.total).toBe(2)
  })

  test("a gate in flight is waiting on the human and takes focus", () => {
    const result = forge(
      input([{ role: "assistant", parts: [step("evidence", "done"), step("gate", "active", {}, "running")] }], {
        busy: true,
      }),
    )
    expect(result?.state).toBe("waiting")
    expect(result?.focus).toBe("gate")
    expect(states(result).gate).toBe("waiting")
  })

  test("an approved gate is done; a rejected gate is failed", () => {
    const approved: TaskPart = {
      type: "tool",
      tool: "forge",
      state: {
        status: "completed",
        input: { stage: "gate", status: "active", summary: "" },
        metadata: { approved: true },
      },
    }
    expect(states(forge(input([{ role: "assistant", parts: [approved] }]))).gate).toBe("done")
    expect(states(forge(input([{ role: "assistant", parts: [step("gate", "active", {}, "error")] }]))).gate).toBe(
      "failed",
    )
  })

  test("shipping completes the pipeline", () => {
    const result = forge(input([{ role: "assistant", parts: [step("gate", "done"), step("ship", "done")] }]))
    expect(result?.state).toBe("shipped")
  })

  test("malformed forge calls are ignored rather than guessed at", () => {
    const bad: TaskPart = { type: "tool", tool: "forge", state: { status: "completed", input: { stage: "deploy" } } }
    expect(forge(input([{ role: "assistant", parts: [bad] }]))).toBeUndefined()
  })
})

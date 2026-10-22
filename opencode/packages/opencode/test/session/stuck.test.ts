import { describe, expect, test } from "bun:test"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Stuck } from "../../src/session/stuck"

const user = { info: { role: "user" }, parts: [] } as unknown as SessionV1.WithParts

function step(tool: string, input: Record<string, unknown>, thought = "") {
  return {
    info: { role: "assistant" },
    parts: [
      { type: "reasoning", text: thought },
      { type: "tool", tool, state: { status: "completed", input } },
    ],
  } as unknown as SessionV1.WithParts
}

const tools = ["bash", "browser", "read"]

describe("Stuck.check", () => {
  test("no-op steps in a row get a reminder, and the tool the model meant is required next", () => {
    const result = Stuck.check(
      [
        user,
        step("browser", { action: "click" }),
        step("bash", { command: "echo using the browser tool next" }),
        step("bash", { command: "true" }, "Now click + with the browser tool."),
      ],
      tools,
    )
    expect(result?.reminder).toContain("`browser`")
    expect(result?.reminder).toContain('`bash {"command":"true"}`')
    expect(result?.force).toBe("browser")
  })

  test("nothing is required when the model named no tool or several", () => {
    const noop = (thought: string) => step("bash", { command: "true" }, thought)
    expect(Stuck.check([user, noop(""), noop("hmm")], tools)?.force).toBeUndefined()
    expect(Stuck.check([user, noop(""), noop("read it, then use the browser")], tools)?.force).toBeUndefined()
  })

  test("a single no-op while naming one tool is caught at once", () => {
    const result = Stuck.check(
      [
        user,
        step("browser", { action: "open" }),
        step("bash", { command: "true" }, "Now click with the browser tool."),
      ],
      tools,
    )
    expect(result?.force).toBe("browser")
    expect(result?.reminder).toContain("last step")
  })

  test("repeating the same real call counts as stuck", () => {
    const same = () => step("read", { filePath: "/a.ts" })
    expect(Stuck.check([user, same(), same(), same()], tools)?.reminder).toBeString()
  })

  test("real work is left alone", () => {
    expect(
      Stuck.check(
        [user, step("bash", { command: "true" }), step("browser", { action: "click", selector: "#inc" })],
        tools,
      ),
    ).toBeUndefined()
    expect(
      Stuck.check(
        [user, step("bash", { command: "npm test" }), step("bash", { command: "npm run build" }), step("read", {})],
        tools,
      ),
    ).toBeUndefined()
  })

  test("only counts steps of the current turn", () => {
    const noop = () => step("bash", { command: "true" })
    expect(Stuck.check([noop(), noop(), user, noop()], tools)).toBeUndefined()
  })
})

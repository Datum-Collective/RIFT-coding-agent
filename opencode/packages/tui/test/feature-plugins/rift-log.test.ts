import { expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import { logEntries } from "../../src/feature-plugins/rift/log-entries"

const tool = (id: string, name: string, state: object) => ({ type: "tool", id, name, state, time: { created: 1_000 } })
const assistant = (...content: object[]) => ({ id: "m", type: "assistant", content, time: { created: 1_000 } })
const log = (...messages: object[]) => logEntries(messages as unknown as SessionMessageInfo[])

test("each tool call is one line naming what it touched", () => {
  const entries = log(
    assistant(
      tool("1", "read", { status: "completed", input: { path: "/repo/src/a.ts" } }),
      tool("2", "shell", { status: "running", input: { command: "bun test" } }),
      tool("3", "grep", { status: "completed", input: { pattern: "retry" } }),
    ),
  )
  expect(entries.map(({ level, text }) => [level, text])).toEqual([
    ["ok", "read /repo/src/a.ts"],
    ["running", "shell bun test"],
    ["ok", "grep retry"],
  ])
})

test("a search names what was searched for, not where", () => {
  const entries = log(assistant(tool("1", "grep", { status: "completed", input: { pattern: "retry", path: "src" } })))
  expect(entries[0]?.text).toBe("grep retry")
})

test("a multi-line error stays one event on one line", () => {
  const error = { message: "line one\nline two" }
  const entries = log(assistant(tool("1", "edit", { status: "error", input: { path: "a.ts" }, error })))
  expect(entries[0]?.text).toBe("edit a.ts: line one")
})

test("messages from the revert point on are left out", () => {
  const first = { ...assistant(tool("1", "read", { status: "completed", input: { path: "a" } })), id: "keep" }
  const second = { ...assistant(tool("2", "read", { status: "completed", input: { path: "b" } })), id: "gone" }
  const entries = logEntries([first, second] as unknown as SessionMessageInfo[], "gone")
  expect(entries.map((entry) => entry.text)).toEqual(["read a"])
})

test("a failed tool shows its error", () => {
  const entries = log(assistant(tool("1", "edit", { status: "error", input: { path: "a.ts" }, error: { message: "no match" } })))
  expect(entries[0]).toMatchObject({ level: "error", text: "edit a.ts: no match" })
})

test("a long command keeps to its first line", () => {
  const entries = log(assistant(tool("1", "shell", { status: "completed", input: { command: "one\ntwo" } })))
  expect(entries[0]?.text).toBe("shell one")
})

test("verification hand-backs appear in the stream, and other notices do not", () => {
  const entries = log(
    { id: "a", type: "synthetic", text: "RIFT verification\n- FAILED: bun run test", metadata: { source: "rift-verify", decision: "fix" }, time: { created: 2_000 } },
    { id: "b", type: "synthetic", text: "x", metadata: { source: "rift-verify", decision: "give_up" }, time: { created: 3_000 } },
    { id: "c", type: "synthetic", text: "goal", metadata: { source: "goal" }, time: { created: 4_000 } },
  )
  expect(entries.map(({ level, text }) => [level, text])).toEqual([
    ["error", "checks failed, sent back to the agent"],
    ["error", "stopped after the fix rounds, work not proven"],
  ])
})

test("text and thinking stay out of the log", () => {
  expect(log({ id: "u", type: "user", text: "hi", time: { created: 1 } }, assistant({ type: "text", text: "hello" }))).toEqual([])
})

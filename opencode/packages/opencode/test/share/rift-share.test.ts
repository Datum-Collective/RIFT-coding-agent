import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Session, ToolPart } from "@opencode-ai/sdk/v2"
import { RiftShare } from "@/share/rift-share"

const session = {
  id: "ses_1",
  slug: "fix-upload",
  projectID: "prj_1",
  directory: "/Users/me/secret-client/app",
  path: "app",
  title: "Fix flaky upload test",
  version: "0.1.14",
  time: { created: 1, updated: 2 },
} as Session

const assistant = {
  id: "msg_2",
  sessionID: "ses_1",
  role: "assistant",
  time: { created: 3 },
  parentID: "msg_1",
  modelID: "claude-opus-5-5",
  providerID: "anthropic",
  mode: "build",
  agent: "build",
  path: { cwd: "/Users/me/secret-client/app", root: "/Users/me/secret-client" },
  cost: 0,
  tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
} as AssistantMessage

const tool = (output: string) =>
  ({
    id: "prt_1",
    sessionID: "ses_1",
    messageID: "msg_2",
    type: "tool",
    callID: "call_1",
    tool: "bash",
    state: {
      status: "completed",
      input: { command: "bun test" },
      output,
      title: "bun test",
      metadata: {},
      time: { start: 1, end: 2 },
    },
  }) as ToolPart

describe("RiftShare.snapshot", () => {
  test("is tagged with the RIFT share format so the viewer and import can recognise it", () => {
    const snap = RiftShare.snapshot({ session, messages: [], diffs: [], models: [] })
    expect(snap.format).toBe("rift-share")
    expect(snap.version).toBe(1)
    expect(snap.session.title).toBe("Fix flaky upload test")
  })

  test("keeps local machine paths out of the shared copy", () => {
    const snap = RiftShare.snapshot({
      session,
      messages: [{ info: assistant, parts: [] }],
      diffs: [],
      models: [],
    })
    expect(JSON.stringify(snap)).not.toContain("secret-client")
  })

  test("trims a huge tool output and says how much was cut", () => {
    const snap = RiftShare.snapshot({
      session,
      messages: [{ info: assistant, parts: [tool("x".repeat(50_000))] }],
      diffs: [],
      models: [],
    })
    const part = snap.messages[0].parts[0] as ToolPart
    const output = part.state.status === "completed" ? part.state.output : ""
    expect(output.length).toBeLessThan(21_000)
    expect(output).toContain("30000 more characters")
  })

  test("leaves a normal tool output alone", () => {
    const snap = RiftShare.snapshot({
      session,
      messages: [{ info: assistant, parts: [tool("12 passed")] }],
      diffs: [],
      models: [],
    })
    const part = snap.messages[0].parts[0] as ToolPart
    expect(part.state.status === "completed" && part.state.output).toBe("12 passed")
  })
})

describe("RiftShare links", () => {
  test("a share link opens the RIFT viewer with the gist id in the fragment", () => {
    expect(RiftShare.url("8f3a0c1d2e4b5a69788f")).toBe(
      "https://datum-collective.github.io/RIFT-coding-agent/s/#8f3a0c1d2e4b5a69788f",
    )
  })

  test("reads the gist id back out of a RIFT link, a gist link, or a bare id", () => {
    const id = "8f3a0c1d2e4b5a69788f0a1b2c3d4e5f"
    expect(RiftShare.parse(RiftShare.url(id))).toBe(id)
    expect(RiftShare.parse(`https://gist.github.com/shiv207/${id}`)).toBe(id)
    expect(RiftShare.parse(`https://gist.github.com/${id}`)).toBe(id)
    expect(RiftShare.parse(id)).toBe(id)
  })

  test("rejects links that are not RIFT shares", () => {
    expect(RiftShare.parse("https://opncd.ai/share/abc123")).toBeUndefined()
    expect(RiftShare.parse("https://example.com/s/#8f3a0c1d2e4b5a69788f")).toBeUndefined()
    expect(RiftShare.parse("not a link")).toBeUndefined()
  })
})

describe("RiftShare.find", () => {
  test("finds a RIFT share link in a pull request description", () => {
    const link = RiftShare.url("8f3a0c1d2e4b5a69788f")
    expect(RiftShare.find(`Fixes the upload flake.\n\nSession: ${link}\n`)).toBe(link)
  })

  test("finds nothing when the description has no RIFT share link", () => {
    expect(RiftShare.find("Session: https://opncd.ai/s/Jsj3hNIW")).toBeUndefined()
    expect(RiftShare.find("")).toBeUndefined()
  })
})

describe("RiftShare.fromGist", () => {
  test("finds the share file's JSON in a gist API response", () => {
    const gist = { files: { [RiftShare.FILE]: { content: '{"format":"rift-share"}', truncated: false } } }
    expect(RiftShare.fromGist(gist)).toEqual({ content: '{"format":"rift-share"}' })
  })

  test("points at the raw file when GitHub truncated a large share", () => {
    const raw = "https://gist.githubusercontent.com/shiv207/abc/raw/rift-session.json"
    const gist = { files: { [RiftShare.FILE]: { content: "{", truncated: true, raw_url: raw } } }
    expect(RiftShare.fromGist(gist)).toEqual({ raw })
  })

  test("refuses a truncated share whose raw URL is not on GitHub's gist host", () => {
    const gist = { files: { [RiftShare.FILE]: { content: "{", truncated: true, raw_url: "https://evil.example/x" } } }
    expect(RiftShare.fromGist(gist)).toBeUndefined()
  })

  test("reads a RIFT link however its host is capitalised, like find does", () => {
    const id = "8f3a0c1d2e4b5a69788f"
    expect(RiftShare.parse(RiftShare.url(id).replace("datum-collective", "Datum-Collective"))).toBe(id)
  })

  test("finds nothing in a gist that is not a RIFT share", () => {
    expect(RiftShare.fromGist({ files: { "notes.md": { content: "hi" } } })).toBeUndefined()
    expect(RiftShare.fromGist({ message: "Not Found" })).toBeUndefined()
  })
})

describe("RiftShare.toSession", () => {
  test("turns a shared snapshot back into an importable session", () => {
    const snap = RiftShare.snapshot({
      session,
      messages: [{ info: assistant, parts: [tool("ok")] }],
      diffs: [],
      models: [],
    })
    const out = RiftShare.toSession(JSON.parse(JSON.stringify(snap)))
    expect(out?.info.id).toBe("ses_1")
    expect(out?.messages).toHaveLength(1)
    expect(out?.messages[0].parts).toHaveLength(1)
  })

  test("refuses JSON that is not a RIFT share", () => {
    expect(RiftShare.toSession({ hello: "world" })).toBeUndefined()
    expect(RiftShare.toSession({ format: "rift-share", version: 99 })).toBeUndefined()
    expect(RiftShare.toSession(null)).toBeUndefined()
  })
})

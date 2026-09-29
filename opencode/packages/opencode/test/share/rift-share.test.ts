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

  test("drops image attachments and keeps only the diff from tool metadata, so big sessions stay small", () => {
    const heavy = {
      ...tool("frame read"),
      state: {
        status: "completed",
        input: { filePath: "out/frames/01.png" },
        output: "frame read",
        title: "out/frames/01.png",
        metadata: { diff: "@@ -1 +1 @@\n-a\n+b", display: "x".repeat(20_000), filediff: { before: "y".repeat(50_000) } },
        attachments: [{ type: "file", mime: "image/png", url: `data:image/png;base64,${"A".repeat(800_000)}` }],
        time: { start: 1, end: 2 },
      },
    } as unknown as ToolPart
    const snap = RiftShare.snapshot({
      session,
      messages: [{ info: assistant, parts: Array.from({ length: 50 }, () => heavy) }],
      diffs: [],
      models: [],
    })
    const part = snap.messages[0].parts[0] as ToolPart
    expect(part.state.status === "completed" && part.state.attachments).toBeFalsy()
    expect(part.state.status === "completed" && part.state.metadata).toEqual({ diff: "@@ -1 +1 @@\n-a\n+b" })
    // 50 reads of an 800 KB image used to mean a 40 MB upload.
    expect(JSON.stringify(snap).length).toBeLessThan(100_000)
  })

  test("trims huge tool inputs, like a whole file passed to write", () => {
    const write = {
      ...tool("ok"),
      state: { status: "completed", input: { filePath: "a.ts", content: "z".repeat(60_000) }, output: "ok", title: "a.ts", metadata: {}, time: { start: 1, end: 2 } },
    } as unknown as ToolPart
    const snap = RiftShare.snapshot({ session, messages: [{ info: assistant, parts: [write] }], diffs: [], models: [] })
    const input = (snap.messages[0].parts[0] as ToolPart).state.input as { filePath: string; content: string }
    expect(input.filePath).toBe("a.ts")
    expect(input.content.length).toBeLessThan(5_000)
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

describe("RiftShare.snapshot keeps secrets on your machine", () => {
  const shared = (output: string) => {
    const snap = RiftShare.snapshot(
      { session, messages: [{ info: assistant, parts: [tool(output)] }], diffs: [], models: [] },
      { home: "/Users/me" },
    )
    const part = snap.messages[0].parts[0] as ToolPart
    return part.state.status === "completed" ? part.state.output : ""
  }

  test("removes API keys and tokens that show up in tool output", () => {
    const out = shared(
      [
        "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456",
        "export ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
        "token: ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ",
        "aws AKIAABCDEFGHIJKLMNOP",
        "DATABASE_PASSWORD='hunter2hunter2'",
      ].join("\n"),
    )
    expect(out).not.toContain("sk-proj-abcdefghijklmnop")
    expect(out).not.toContain("sk-ant-api03")
    expect(out).not.toContain("ghp_abcdefghij")
    expect(out).not.toContain("AKIAABCDEFGHIJKLMNOP")
    expect(out).not.toContain("hunter2hunter2")
    expect(out).toContain("OPENAI_API_KEY=")
    expect(out).toContain("[redacted")
  })

  test("removes private keys and passwords inside connection strings", () => {
    const out = shared(
      "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----\npostgres://app:s3cretpass@db.internal:5432/app",
    )
    expect(out).not.toContain("b3BlbnNzaC1rZXktdjEAAAAA")
    expect(out).not.toContain("s3cretpass")
    expect(out).toContain("postgres://app:")
    expect(out).toContain("@db.internal")
  })

  test("replaces your home folder with ~ so your username isn't shared", () => {
    expect(shared("error in /Users/me/work/app/src/index.ts")).toBe("error in ~/work/app/src/index.ts")
  })

  test("leaves ordinary output alone", () => {
    expect(shared("12 passed, 0 failed in 4.1s")).toBe("12 passed, 0 failed in 4.1s")
  })
})

describe("RiftShare.placeholder", () => {
  test("is a tiny pending share, so the link can be made before the upload", () => {
    const snap = RiftShare.placeholder(session)
    expect(snap.format).toBe("rift-share")
    expect(snap.pending).toBe(true)
    expect(snap.messages).toEqual([])
    expect(JSON.stringify(snap).length).toBeLessThan(1_000)
  })

  test("scrubs the title like any other share", () => {
    const snap = RiftShare.placeholder({ ...session, title: "rotate sk-ant-api03-abcdefghijklmnopqrstuvwxyz" })
    expect(snap.session.title).not.toContain("sk-ant-api03")
  })

  test("can't be imported until the full session has been uploaded", () => {
    expect(RiftShare.toSession(JSON.parse(JSON.stringify(RiftShare.placeholder(session))))).toBeUndefined()
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

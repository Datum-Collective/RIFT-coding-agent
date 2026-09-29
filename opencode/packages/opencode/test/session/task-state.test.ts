import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { TaskState } from "../../src/session/task-state"
import { Verify } from "../../src/session/verify"

const root = "/repo"

function user(id: string, text: string, synthetic = false): TaskState.Message {
  return { info: { id, role: "user" }, parts: [{ type: "text", text, synthetic }] }
}

function edit(id: string, filePath: string, status = "completed"): TaskState.Message {
  return {
    info: { id, role: "assistant" },
    parts: [{ type: "tool", tool: "edit", state: { status, input: { filePath } } }],
  }
}

function verification(id: string, summary: Partial<Verify.Summary>): TaskState.Message {
  return {
    info: { id, role: "assistant" },
    parts: [
      {
        type: "text",
        text: "Automated verification",
        metadata: {
          [Verify.METADATA_KEY]: {
            done: true,
            checks: [],
            passed: 0,
            failed: 0,
            notRun: 0,
            scopeFiles: 0,
            scopeWarnFiles: 15,
            ...summary,
          },
        },
      },
    ],
  }
}

const node = {
  id: "auth.api",
  title: "Auth API",
  status: "in_progress" as const,
  owner: "build",
  dependencies: [],
  files: ["src/auth.ts"],
  checks: [],
  decisions: ["Sessions live in Redis, not JWTs"],
}

function derive(input: Partial<Parameters<typeof TaskState.derive>[0]>) {
  return TaskState.derive({ sessionID: "ses_1", root, cwd: root, messages: [], todos: [], graph: [], ...input })
}

describe("TaskState.derive", () => {
  test("the goal is the first real request and the latest is the newest one", () => {
    const state = derive({
      messages: [
        user("m1", "Add login"),
        user("m2", "Continue if you have next steps", true),
        user("m3", "Also add logout"),
      ],
    })
    expect(state.goal).toBe("Add login")
    expect(state.latest).toBe("Also add logout")
  })

  test("latest is omitted when the goal is the only request", () => {
    expect(derive({ messages: [user("m1", "Add login")] }).latest).toBeUndefined()
  })

  test("touched files are every completed edit, relative to the root, sorted and unique", () => {
    const state = derive({
      messages: [
        edit("a1", "/repo/src/b.ts"),
        edit("a2", "src/a.ts"),
        edit("a3", "/repo/src/b.ts"),
        edit("a4", "/repo/src/failed.ts", "error"),
      ],
    })
    expect(state.touched).toEqual(["src/a.ts", "src/b.ts"])
  })

  test("relative edits resolve from the session's directory, not the project root", () => {
    const state = derive({ cwd: "/repo/packages/app", messages: [edit("a1", "src/a.ts")] })
    expect(state.touched).toEqual(["packages/app/src/a.ts"])
  })

  test("verification is the newest finished report", () => {
    const state = derive({
      messages: [
        verification("v1", { failed: 1 }),
        verification("v2", {
          passed: 1,
          checks: [{ command: "bun test", status: "passed", ms: 10 }],
        }),
        verification("v3", { done: false }),
      ],
    })
    expect(state.verification).toEqual({
      passed: 1,
      failed: 0,
      notRun: 0,
      checks: [{ command: "bun test", status: "passed" }],
    })
  })

  test("decisions come from the engineering graph, tagged with their node", () => {
    const state = derive({ graph: [node] })
    expect(state.decisions).toEqual([{ node: "auth.api", text: "Sessions live in Redis, not JWTs" }])
    expect(state.graph).toEqual([{ id: "auth.api", title: "Auth API", status: "in_progress", files: ["src/auth.ts"] }])
  })

  test("the same inputs give the same state", () => {
    const input = {
      messages: [user("m1", "Add login"), edit("a1", "src/a.ts")],
      todos: [{ content: "Write the form", status: "pending", priority: "high" }],
      graph: [node],
      git: { branch: "main", changes: [{ file: "src/a.ts", status: "modified" as const }] },
    }
    expect(JSON.stringify(derive(input))).toBe(JSON.stringify(derive(input)))
  })
})

describe("TaskState.handoff", () => {
  test("names every part of the engineering context", () => {
    const text = TaskState.handoff(
      derive({
        messages: [user("m1", "Add login"), edit("a1", "src/a.ts"), verification("v1", { failed: 1, checks: [{ command: "bun test", status: "failed", ms: 1 }] })],
        todos: [
          { content: "Write the form", status: "completed" },
          { content: "Wire the API", status: "in_progress" },
        ],
        graph: [node],
        git: { branch: "feature/login", changes: [{ file: "src/a.ts", status: "modified" }] },
      }),
    )
    expect(text).toContain("Add login")
    expect(text).toContain("[x] Write the form")
    expect(text).toContain("[~] Wire the API")
    expect(text).toContain("Sessions live in Redis, not JWTs")
    expect(text).toContain("src/a.ts")
    expect(text).toContain("feature/login")
    expect(text).toContain("bun test: failed")
    expect(text).toContain(".rift/tasks/ses_1/")
  })

  test("says plainly when nothing was recorded instead of leaving sections out", () => {
    const text = TaskState.handoff(derive({}))
    expect(text).toContain("No verification has run")
    expect(text).toContain("No files edited")
  })

  test("caps long lists and says how many were left out", () => {
    const messages = Array.from({ length: 60 }, (_, i) => edit(`a${i}`, `src/f${String(i).padStart(2, "0")}.ts`))
    const text = TaskState.handoff(derive({ messages }))
    expect(text).toContain("src/f39.ts")
    expect(text).not.toContain("src/f40.ts")
    expect(text).toContain("20 more")
  })
})

describe("TaskState.write", () => {
  test("writes the state files, keeps them out of git, and records a checkpoint", async () => {
    await using tmp = await tmpdir()
    const dir = tmp.path
    const state = derive({ messages: [user("m1", "Add login"), edit("a1", "src/a.ts")], graph: [node] })
    await TaskState.write(dir, state, { checkpoint: "msg_9" })
    const base = path.join(dir, ".rift", "tasks", "ses_1")
    expect(await Bun.file(path.join(base, "state.json")).json()).toEqual(JSON.parse(JSON.stringify(state)))
    expect(await Bun.file(path.join(base, "touched-files.json")).json()).toEqual(["src/a.ts"])
    expect(await Bun.file(path.join(base, "verification.json")).json()).toBeNull()
    expect(await Bun.file(path.join(base, "plan.md")).text()).toContain("Auth API")
    expect(await Bun.file(path.join(base, "decisions.md")).text()).toContain("Sessions live in Redis")
    expect(await Bun.file(path.join(base, "checkpoints", "msg_9.md")).text()).toBe(TaskState.handoff(state))
    expect(await Bun.file(path.join(dir, ".rift", "tasks", ".gitignore")).text()).toBe("*\n")
    // .rift/.gitignore belongs to config loading, which only writes it when it is missing.
    expect(await Bun.file(path.join(dir, ".rift", ".gitignore")).exists()).toBe(false)
  })

  test("without a checkpoint it only refreshes the live files", async () => {
    await using tmp = await tmpdir()
    const dir = tmp.path
    await TaskState.write(dir, derive({}))
    expect(await Bun.file(path.join(dir, ".rift", "tasks", "ses_1", "state.json")).exists()).toBe(true)
    expect(await fs.readdir(path.join(dir, ".rift", "tasks", "ses_1", "checkpoints")).catch(() => [])).toEqual([])
  })
})

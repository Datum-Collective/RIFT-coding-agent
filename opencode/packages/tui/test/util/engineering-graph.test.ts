import { describe, expect, test } from "bun:test"
import { task } from "../../src/util/task"
import type { TaskPart } from "../../src/util/task"
import { deriveGraph, withLiveEdits } from "../../src/util/engineering-graph"

const base = { messages: [], parts: () => [] }

describe("deriveGraph", () => {
  test("is empty for a task with nothing to show yet", () => {
    expect(deriveGraph(task({ ...base, title: "Hello" }), "build")).toEqual([])
  })

  test("builds the task as the root with its plan steps and changed files underneath", () => {
    const nodes = deriveGraph(
      task({
        ...base,
        title: "Build the Datum site",
        todos: [
          { content: "Research Datum Collective", status: "completed" },
          { content: "Build animated website", status: "in_progress" },
        ],
        diff: [{ file: "/Users/me/Desktop/test/index.html", added: 120, removed: 0 }],
      }),
      "build",
    )
    expect(nodes.map((node) => [node.id, node.parent_id, node.title, node.status, node.owner])).toEqual([
      ["task", undefined, "Build the Datum site", nodes[0].status, "build"],
      ["task.1", "task", "Research Datum Collective", "done", "build"],
      ["task.2", "task", "Build animated website", "in_progress", "build"],
    ])
    expect(nodes[0].files).toEqual(["/Users/me/Desktop/test/index.html"])
  })
})

const tool = (name: string, input: unknown, status = "completed"): TaskPart =>
  ({ type: "tool", tool: name, state: { status, input } }) as TaskPart

const turn = (title: string, parts: TaskPart[], extra: Partial<Parameters<typeof task>[0]> = {}) =>
  task({
    messages: [
      { id: "u", role: "user" },
      { id: "a", role: "assistant" },
    ],
    // A task is named after the request that started it.
    parts: (id) => (id === "u" ? [{ type: "text", text: title }] : parts),
    busy: true,
    ...extra,
  })

describe("deriveGraph while the agent is still working", () => {
  test("shows the task as soon as the agent starts, before any plan, edit or diff exists", () => {
    const nodes = deriveGraph(turn("Build the Roadster site", []), "build")
    expect(nodes.map((node) => [node.id, node.title, node.status])).toEqual([["task", "Build the Roadster site", "in_progress"]])
  })

  test("lists files as the edit tools run, without waiting for the session diff", () => {
    const nodes = deriveGraph(
      turn("Build", [
        tool("write", { filePath: "/p/index.html" }),
        tool("edit", { filePath: "/p/css/site.css" }, "running"),
        tool("apply_patch", { patchText: "*** Begin Patch\n*** Update File: /p/js/app.js\n*** End Patch" }),
        tool("edit", { filePath: "/p/index.html" }),
      ]),
      "build",
    )
    expect(nodes[0].files).toEqual(["/p/index.html", "/p/css/site.css", "/p/js/app.js"])
  })

  test("puts each edit under the plan step that was active when it happened", () => {
    const todos = (...statuses: string[]) => ({
      todos: ["Markup", "Styles", "Script"].map((content, index) => ({ content, status: statuses[index], priority: "high" })),
    })
    const nodes = deriveGraph(
      turn(
        "Build",
        [
          tool("todowrite", todos("in_progress", "pending", "pending")),
          tool("write", { filePath: "/p/index.html" }),
          tool("todowrite", todos("completed", "in_progress", "pending")),
          tool("write", { filePath: "/p/site.css" }),
          tool("edit", { filePath: "/p/site.css" }),
        ],
        { todos: [{ content: "Markup", status: "completed" }, { content: "Styles", status: "in_progress" }, { content: "Script", status: "pending" }] },
      ),
      "build",
    )
    const files = Object.fromEntries(nodes.map((node) => [node.title, node.files]))
    expect(files["Markup"]).toEqual(["/p/index.html"])
    expect(files["Styles"]).toEqual(["/p/site.css"])
    expect(files["Script"]).toEqual([])
  })

  test("the finished diff and the live edits describe one file once, with the diff's counts", () => {
    const built = turn("Build", [tool("write", { filePath: "/Users/me/p/index.html" })], {
      diff: [{ file: "index.html", added: 40, removed: 2 }],
    })
    expect(built.changes.files).toEqual([{ file: "index.html", added: 40, removed: 2 }])
    expect(built.changes.added).toBe(40)
  })

  test("edits from an earlier request do not leak into the one in flight", () => {
    const built = task({
      title: "Second",
      messages: [
        { id: "u1", role: "user" },
        { id: "a1", role: "assistant" },
        { id: "u2", role: "user" },
        { id: "a2", role: "assistant" },
      ],
      parts: (id) =>
        id === "a1"
          ? [tool("write", { filePath: "/p/old.html" })]
          : id === "a2"
            ? [tool("write", { filePath: "/p/new.html" })]
            : [{ type: "text", text: "go" }],
      busy: true,
    })
    expect(built.changes.files.map((item) => item.file)).toEqual(["/p/new.html"])
  })
})

describe("deriveGraph without a plan", () => {
  test("groups the edited files into one node per directory, the one being worked in marked active", () => {
    const nodes = deriveGraph(
      turn("Build", [
        tool("write", { filePath: "/p/site/index.html" }),
        tool("write", { filePath: "/p/site/css/main.css" }),
        tool("write", { filePath: "/p/site/css/hero.css" }),
        tool("write", { filePath: "/p/site/js/app.js" }),
      ]),
      "build",
    )
    expect(nodes.slice(1).map((node) => [node.parent_id, node.title, node.status, node.files])).toEqual([
      ["task", "Project files", "done", ["/p/site/index.html"]],
      ["task", "css", "done", ["/p/site/css/main.css", "/p/site/css/hero.css"]],
      ["task", "js", "in_progress", ["/p/site/js/app.js"]],
    ])
  })

  test("marks the directory of the newest edit, even when it was created earlier", () => {
    const nodes = deriveGraph(
      turn("Build", [
        tool("write", { filePath: "/p/css/main.css" }),
        tool("write", { filePath: "/p/js/app.js" }),
        tool("edit", { filePath: "/p/css/hero.css" }),
      ]),
      "build",
    )
    expect(nodes.slice(1).map((node) => [node.title, node.status])).toEqual([
      ["css", "in_progress"],
      ["js", "done"],
    ])
  })

  test("adds no groups when everything is in one place", () => {
    const nodes = deriveGraph(turn("Build", [tool("write", { filePath: "/p/a.html" }), tool("write", { filePath: "/p/b.html" })]), "build")
    expect(nodes.map((node) => node.id)).toEqual(["task"])
  })

  test("a plan's steps are used instead of directory groups", () => {
    const nodes = deriveGraph(
      turn("Build", [tool("write", { filePath: "/p/x/a.html" }), tool("write", { filePath: "/p/y/b.html" })], {
        todos: [{ content: "Do it", status: "in_progress" }],
      }),
      "build",
    )
    expect(nodes.map((node) => node.title)).toEqual(["Build", "Do it"])
  })
})

describe("withLiveEdits", () => {
  const declared = [
    { id: "app", title: "App", status: "in_progress" as const, owner: "build", dependencies: [], files: ["/p/index.html"], checks: [], decisions: [] },
    { id: "app.css", parent_id: "app", title: "Styles", status: "not_started" as const, owner: "build", dependencies: [], files: [], checks: [], decisions: [] },
  ]

  test("keeps the agent's graph as it is when every edit is already covered", () => {
    const built = turn("Build", [tool("write", { filePath: "/p/index.html" })])
    expect(withLiveEdits(declared, built)).toBe(declared)
  })

  test("adds a node for this turn's edits the agent's graph does not mention yet", () => {
    const built = turn("Build", [
      tool("write", { filePath: "/p/index.html" }),
      tool("write", { filePath: "/p/site.css" }),
      tool("write", { filePath: "/p/app.js" }),
    ])
    const nodes = withLiveEdits(declared, built)
    expect(nodes.slice(0, 2)).toEqual(declared)
    expect(nodes[2]).toMatchObject({
      parent_id: "app",
      title: "Edited since the last graph update",
      status: "in_progress",
      files: ["/p/site.css", "/p/app.js"],
    })
  })

  test("leaves a graph alone when the task has no live edits", () => {
    expect(withLiveEdits(declared, task({ messages: [], parts: () => [], title: "Idle" }))).toBe(declared)
  })
})

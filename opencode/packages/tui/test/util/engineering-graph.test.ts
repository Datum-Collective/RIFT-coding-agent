import { describe, expect, test } from "bun:test"
import { task } from "../../src/util/task"
import { deriveGraph } from "../../src/util/engineering-graph"

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

import { expect, test } from "bun:test"
import type { Rift } from "@opencode/schema/rift"
import { tree } from "../../src/feature-plugins/sidebar/rift"
import { bar, count, layout } from "../../src/feature-plugins/sidebar/rift-graph"
import { stages, status } from "../../src/feature-plugins/sidebar/rift-run"

const node = (id: string, parent?: string): Rift.Node => ({ id, parent, title: id, verdict: "unproven", because: [] })
const shape = (nodes: Rift.Node[]) => tree(nodes).map((line) => [line.node.id, line.depth])

test("children sit under their parents, whatever order they arrive in", () => {
  expect(shape([node("b", "a"), node("c", "b"), node("a")])).toEqual([["a", 0], ["b", 1], ["c", 2]])
})

test("a node whose parent is missing is still shown", () => {
  expect(shape([node("a", "ghost")])).toEqual([["a", 0]])
})

test("a cycle is shown once, without hanging", () => {
  expect(shape([node("a", "b"), node("b", "a")])).toEqual([["a", 0], ["b", 1]])
})

const v = (id: string, parent: string | undefined, verdict: Rift.Node["verdict"], because: string[] = []): Rift.Node => ({
  id,
  parent,
  title: id.toUpperCase(),
  verdict,
  because,
})

test("connectors show the last child differently and carry the trunk down", () => {
  const lines = layout([v("a", undefined, "unproven"), v("b", "a", "proven"), v("c", "a", "proven"), v("d", "b", "proven")])
  expect(lines.map((line) => line.prefix + line.node.id)).toEqual(["a", "├─ b", "│  └─ d", "└─ c"])
})

test("what a node waits on is named by title, and long lists are cut", () => {
  const lines = layout([
    v("a", undefined, "at_risk", ["x", "y", "z"]),
    v("x", "a", "unproven"),
    v("y", "a", "failed"),
    v("z", "a", "stale"),
  ])
  expect(lines[0]!.waiting).toEqual(["X", "Y", "+1"])
  expect(layout([v("a", undefined, "proven")])[0]!.waiting).toEqual([])
})

test("a long graph folds a fully proven branch, never one with a failure, and never a root", () => {
  const many = Array.from({ length: 8 }, (_, i) => v(`p${i}`, "ok", "proven"))
  const nodes = [
    v("root", undefined, "at_risk", ["ok", "bad"]),
    v("ok", "root", "proven"),
    ...many,
    v("bad", "root", "failed"),
    v("bad1", "bad", "proven"),
    v("bad2", "bad", "proven"),
    v("bad3", "bad", "proven"),
  ]
  const lines = layout(nodes, 10)
  const ok = lines.find((line) => line.node.id === "ok")!
  expect(ok.folded).toBe(8)
  expect(lines.some((line) => line.node.id === "p0")).toBe(false)
  expect(lines.find((line) => line.node.id === "bad")!.folded).toBe(0)
  expect(lines.some((line) => line.node.id === "bad1")).toBe(true)
  expect(lines[0]!.folded).toBe(0)
  // A short graph is never folded.
  expect(layout(nodes, 99).some((line) => line.node.id === "p0")).toBe(true)
})

test("every node is drawn once, even in a cycle", () => {
  expect(layout([v("a", "b", "unproven"), v("b", "a", "unproven")]).map((line) => line.node.id)).toEqual(["a", "b"])
})

test("the summary counts verdicts and the bar fills in proportion", () => {
  const counts = count([v("a", undefined, "proven"), v("b", undefined, "proven"), v("c", undefined, "failed"), v("d", undefined, "stale")])
  expect(counts).toMatchObject({ proven: 2, failed: 1, stale: 1, total: 4 })
  expect(bar(counts, 8)).toBe("████░░░░")
  expect(bar(count([]), 4)).toBe("░░░░")
})

const run = (statuses: Rift.Stage["status"][]): Rift.Run => ({
  id: "r",
  tree: "t",
  started: 0,
  phase: "running",
  stages: statuses.map((item, index) => ({ id: `${index}`, unit: ".", kind: "test", command: `step ${index}`, status: item })),
})

test("a long run folds its passes into one line, and keeps everything else", () => {
  const lines = stages(run(["passed", "passed", "failed", "passed", "skipped", "passed", "not_run"]))
  expect(lines.map((line) => `${line.glyph} ${line.text}`)).toEqual(["✗ step 2", "⊘ step 4", "○ step 6", "✓ 4 passed"])
  expect(stages(run(["passed", "flaky"])).map((line) => `${line.glyph} ${line.text}`)).toEqual(["✓ step 0", "~ step 1 (flaky)"])
})

test("the header says what a run is doing, and how it ended", () => {
  expect(status(run(["passed", "running", "pending"])).text).toBe("running 1/3")
  expect(status({ ...run([]), phase: "asking" }).text).toBe("waiting for permission")
  expect(status({ ...run([]), phase: "done", finished: 1, verdict: "unproven", headline: "", receipt: "" })).toEqual({ text: "unproven", tone: "warning" })
  expect(status({ ...run([]), phase: "cancelled", finished: 1, reason: "RIFT restarted" }).text).toBe("stopped: RIFT restarted")
})

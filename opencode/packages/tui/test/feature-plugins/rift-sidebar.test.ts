import { expect, test } from "bun:test"
import type { Rift } from "@opencode/schema/rift"
import { tree } from "../../src/feature-plugins/sidebar/rift"
import { bar, count, layout } from "../../src/feature-plugins/sidebar/rift-graph"

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

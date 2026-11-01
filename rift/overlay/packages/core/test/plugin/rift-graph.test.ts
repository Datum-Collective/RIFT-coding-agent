import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { RiftGraph } from "../../src/plugin/rift-verify/graph.js"

const node = (id: string, extra: Partial<RiftGraph.Node> = {}): RiftGraph.Node => ({
  id,
  title: id,
  status: "in_progress",
  dependencies: [],
  files: [],
  checks: [{ label: id, command: `test ${id}` }],
  decisions: [],
  ...extra,
})
const proof = (id: string, status: RiftGraph.Proof["status"] = "passed", inputs = "i"): RiftGraph.Proof => ({
  node: id,
  label: id,
  command: `test ${id}`,
  status,
  inputs,
})
const verdicts = (nodes: RiftGraph.Node[], proofs: RiftGraph.Proof[], inputs: (node: RiftGraph.Node) => string = () => "i") =>
  Object.fromEntries(RiftGraph.assess(nodes, proofs, inputs).map((item) => [item.node, item.verdict]))

describe("RiftGraph", () => {
  test("a node the agent marks done is not proven without evidence", () => {
    expect(verdicts([node("a", { status: "done" })], [])).toEqual({ a: "unproven" })
  })

  test("a passing check on the current inputs proves a node", () => {
    expect(verdicts([node("a")], [proof("a")])).toEqual({ a: "proven" })
  })

  test("changed inputs make a proof stale, even a failed one", () => {
    expect(verdicts([node("a")], [proof("a", "passed", "old")])).toEqual({ a: "stale" })
    expect(verdicts([node("a")], [proof("a", "failed", "old")])).toEqual({ a: "stale" })
  })

  test("a failed check fails, and a check that could not run is never a pass", () => {
    expect(verdicts([node("a")], [proof("a", "failed")])).toEqual({ a: "failed" })
    expect(verdicts([node("a")], [proof("a", "timed_out")])).toEqual({ a: "failed" })
    expect(verdicts([node("a")], [proof("a", "not_run")])).toEqual({ a: "unproven" })
  })

  test("a broken dependency puts everything built on it at risk, through the whole chain", () => {
    const nodes = [node("a"), node("b", { dependencies: ["a"] }), node("c", { dependencies: ["b"] })]
    expect(verdicts(nodes, [proof("a", "failed"), proof("b"), proof("c")])).toEqual({ a: "failed", b: "at_risk", c: "at_risk" })
  })

  test("a parent without checks is proven only through its children", () => {
    const nodes = [node("root", { checks: [] }), node("a", { parent_id: "root" }), node("b", { parent_id: "root" })]
    expect(verdicts(nodes, [proof("a"), proof("b")]).root).toBe("proven")
    expect(verdicts(nodes, [proof("a")]).root).toBe("at_risk")
  })

  test("a node with no checks and nothing beneath it is unproven, however its files look", () => {
    expect(verdicts([node("a", { checks: [], files: ["a.ts"] })], [])).toEqual({ a: "unproven" })
  })

  test("a missing dependency or a cycle can never be proven", () => {
    expect(verdicts([node("a", { dependencies: ["ghost"] })], [proof("a")])).toEqual({ a: "at_risk" })
    const nodes = [node("a", { dependencies: ["b"] }), node("b", { dependencies: ["a"] })]
    expect(verdicts(nodes, [proof("a"), proof("b")])).toEqual({ a: "at_risk", b: "at_risk" })
  })

  test("declaring a new check leaves the node unproven until it runs", () => {
    const nodes = [node("a", { checks: [{ label: "a", command: "test a" }, { label: "new", command: "test new" }] })]
    expect(verdicts(nodes, [proof("a")])).toEqual({ a: "stale" })
  })

  test("the hash follows content, reverts, missing files and dependencies", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "rift-graph-"))
    const file = path.join(root, "low.ts")
    writeFileSync(file, "1")
    const nodes = [node("low", { files: ["low.ts"] }), node("high", { dependencies: ["low"], files: [] })]
    const high = nodes[1]!
    const before = RiftGraph.hash(root, nodes, high)
    writeFileSync(file, "2")
    expect(RiftGraph.hash(root, nodes, high)).not.toBe(before)
    writeFileSync(file, "1")
    expect(RiftGraph.hash(root, nodes, high)).toBe(before)
  })

  test("only checks without a current proof are due", () => {
    const item = node("a")
    expect(RiftGraph.due(item, item.checks[0]!, [proof("a")], "i")).toBe(false)
    expect(RiftGraph.due(item, item.checks[0]!, [proof("a")], "changed")).toBe(true)
    expect(RiftGraph.due(item, item.checks[0]!, [proof("a", "not_run")], "i")).toBe(true)
    expect(RiftGraph.due(item, item.checks[0]!, [], "i")).toBe(true)
  })
})

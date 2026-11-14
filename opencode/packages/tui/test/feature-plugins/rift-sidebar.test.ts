import { expect, test } from "bun:test"
import type { Rift } from "@opencode/schema/rift"
import { tree } from "../../src/feature-plugins/sidebar/rift"
import { bar, count, layout } from "../../src/feature-plugins/sidebar/rift-graph"
import { details, disputes, notes, place, stages, status, strays, wrap } from "../../src/feature-plugins/sidebar/rift-run"

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

const checked = (overrides: Partial<Rift.Stage>): Rift.Stage => ({ id: "s", unit: ".", kind: "test", command: "bun run test", status: "failed", ...overrides })
const texts = (rows: { text: string }[]) => rows.map((row) => row.text)

test("a failed check is spelled out: why it ran, what ran, how it ended, and the output it ended on", () => {
  const rows = details(checked({ why: "Tests say whether behaviour holds.", ms: 3200, introduced: 2, evidence: "expected 2\nreceived 3" }), false, 60)
  expect(texts(rows)).toEqual([
    "why      Tests say whether behaviour holds.",
    "ran      bun run test",
    "result   failed (2 new) in 3.2s",
    "output   expected 2",
    "         received 3",
  ])
})

test("a long sentence wraps inside the width and every later row hangs under the first word", () => {
  const rows = details(checked({ why: "The project's own tests say whether existing behaviour still holds on the change." }), false, 30)
  const why = texts(rows).slice(0, texts(rows).findIndex((row) => row.startsWith("ran")))
  expect(why.length).toBeGreaterThan(2)
  for (const row of texts(rows)) expect(row.length).toBeLessThanOrEqual(30)
  expect(why[0]!.startsWith("why      ")).toBe(true)
  for (const row of why.slice(1)) expect(row.startsWith(" ".repeat(9))).toBe(true)
})

test("a word longer than the row is cut, never run off the side", () => {
  for (const row of wrap("x".repeat(50), 20)) expect(row.length).toBeLessThanOrEqual(20)
  expect(wrap("", 20)).toEqual([])
  expect(wrap("a b c", 20)).toEqual(["a b c"])
})

test("a passing check stays one line until the user opens it, then shows the digest it passed with", () => {
  const passing = checked({ status: "passed", why: "w", ms: 1000, evidence: "exit 0 in 1.0s, output sha256 abc" })
  expect(details(passing, false)).toEqual([])
  expect(texts(details(passing, true, 60))).toEqual(["why      w", "ran      bun run test", "result   passed in 1.0s", "output   exit 0 in 1.0s, output sha256 abc"])
})

test("a check that did not run says so, rather than looking like a pass", () => {
  expect(texts(details(checked({ status: "not_run", reason: "declined" }), false, 60))).toContain("result   not run: declined")
})

test("long output is cut to its end, where the failure is", () => {
  const evidence = Array.from({ length: 20 }, (_, index) => `row ${index}`).join("\n")
  const shown = texts(details(checked({ evidence }), false, 60)).filter((row) => row.startsWith("output") || row.startsWith("         row"))
  expect(shown).toHaveLength(6)
  expect(shown.at(-1)).toBe("         row 19")
})

test("disagreements read as the verifier's claim, then how it ended", () => {
  const base = { stage: "s", check: "bun run test", raised: 1, round: 1, claim: "bun run test fails on the agent's change" }
  expect(disputes(undefined)).toEqual([])
  expect(texts(disputes([{ ...base, status: "open" }], 80))).toEqual([
    "bun run test · open",
    "verifier bun run test fails on the agent's change. Sent back in round 1.",
    "outcome  not fixed yet",
  ])
  const done = disputes([{ ...base, status: "resolved", resolution: "passed in a later run (receipt abc)" }], 80)
  expect(done[0]).toMatchObject({ glyph: "✓", tone: "success" })
  expect(texts(done).at(-1)).toBe("outcome  passed in a later run (receipt abc)")
  expect(disputes([{ ...base, status: "unresolved", resolution: "still failing after 3 fix rounds" }])[0]).toMatchObject({ glyph: "✗", tone: "error" })
})

test("a folder is shown by its last two parts", () => {
  expect(place("/Users/me/Desktop/tests")).toBe("…/Desktop/tests")
  expect(place("/work")).toBe("/work")
})

test("edits outside the folder are named and said to be unchecked; none, no warning", () => {
  expect(strays([])).toEqual([])
  expect(strays(undefined)).toEqual([])
  const rows = strays(["/Users/me/Desktop/tests/cart.ts"], 60)
  expect(rows[0]).toMatchObject({ glyph: "⚠", tone: "warning", text: "1 file edited outside this folder" })
  expect(texts(rows)).toContain("…/tests/cart.ts")
  expect(texts(rows).at(-1)).toContain("No check covers them.")
})

test("a check skipped because an earlier one failed stays one line until the user opens it", () => {
  const skipped = checked({ status: "skipped", reason: "waits on a stage that did not pass", why: "w" })
  expect(details(skipped, false)).toEqual([])
  expect(texts(details(skipped, true, 60))).toContain("result   not run: waits on a stage that did not pass")
})

test("a run that passed but could not vouch for something says what, in the words of the review", () => {
  const done = (verdict: Rift.RunVerdict, found?: string[]): Rift.Run => ({ id: "r", tree: "t", started: 0, stages: [], phase: "done", finished: 1, verdict, headline: "h", receipt: "x", notes: found })
  const rows = notes(done("unproven", ["cart.ts: new code with no test in this change: export const totalWithTax = (p) => p"]), 36)
  expect(rows[0]).toMatchObject({ glyph: "!", tone: "warning" })
  expect(rows[0]!.text.startsWith("cart.ts: new code with no")).toBe(true)
  for (const row of rows) expect(row.text.length).toBeLessThanOrEqual(34)
  expect(notes(done("tampered", ["a.test.ts: deleted"]))[0]).toMatchObject({ tone: "error" })
  expect(notes(done("verified"))).toEqual([])
  expect(notes({ ...done("verified"), phase: "running" } as unknown as Rift.Run)).toEqual([])
})

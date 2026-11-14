import { describe, expect, test } from "bun:test"
import { RiftIntegrity } from "../../src/plugin/rift-verify/integrity.js"
import { RiftMutation } from "../../src/plugin/rift-verify/mutation.js"
import { RiftStages } from "../../src/plugin/rift-verify/stages.js"
import { RiftVerdict } from "../../src/plugin/rift-verify/verdict.js"

const attempt = (status: RiftVerdict.Attempt["status"], failures: string[] = [], reason?: string): RiftVerdict.Attempt => ({
  status,
  ms: 10,
  tail: `${status} output`,
  digest: status,
  failures,
  reason,
})
const ids = (...names: string[]) => names.map((name) => `.:test:${name}` as RiftStages.StageId)
const stage = (kind: RiftStages.Kind, name = kind): RiftStages.Stage => ({
  id: `.:${kind}:${name}` as RiftStages.StageId,
  unit: "." as RiftStages.UnitDir,
  kind,
  name,
  command: `run ${name}`,
  cwd: ".",
  needs: [],
  rerun: kind === "test",
  timeoutMs: 1000,
})
const planOf = (...stages: RiftStages.Stage[]): RiftStages.Plan => ({ stages, notes: [], uncovered: [] })
const broken = (tests: string[], attribution: RiftVerdict.Attribution): RiftVerdict.Outcome => ({
  status: "failed",
  attempts: [attempt("failed", tests)],
  tests,
  flaky: [],
  attribution,
})
const passed: RiftVerdict.Outcome = { status: "passed", attempts: [attempt("passed")] }
const block: RiftIntegrity.Finding = { severity: "block", rule: "skipped-test", file: "a.test.ts", detail: "x" }

describe("RiftVerdict.failures", () => {
  test("reads failing test names from the common runners", () => {
    const output = "(fail) adds [1.20ms]\n✕ subtracts 3ms\nFAILED t.py::a\n--- FAIL: TestB (0.1s)\ntest tests::c ... FAILED\ntest tests::d ... ok"
    expect(RiftVerdict.failures(output)).toEqual(["TestB", "adds", "subtracts", "t.py::a", "tests::c"])
  })
})

describe("RiftVerdict.settle", () => {
  test("a pass is a pass, and a fail then a pass is flaky, never a pass", () => {
    expect(RiftVerdict.settle([attempt("passed")]).status).toBe("passed")
    expect(RiftVerdict.settle([attempt("failed", ["a"]), attempt("passed")])).toMatchObject({ status: "flaky", tests: ["a"] })
  })

  test("tests that fail every time are kept apart from ones that fail only sometimes", () => {
    const settled = RiftVerdict.settle([attempt("failed", ["a", "b"]), attempt("failed", ["a"]), attempt("failed", ["a", "c"])])
    expect(settled).toMatchObject({ status: "failed", tests: ["a"], flaky: ["b", "c"] })
  })

  test("an attempt that could not run is not run, with its reason", () => {
    expect(RiftVerdict.settle([attempt("failed"), attempt("not_run", [], "cancelled")])).toEqual({ status: "not_run", reason: "cancelled" })
  })

  test("only a failed attempt of a rerunnable kind gets another, up to the cap", () => {
    expect(RiftVerdict.again(stage("test"), [attempt("failed")], 3)).toBe(true)
    expect(RiftVerdict.again(stage("test"), [attempt("failed"), attempt("failed"), attempt("failed")], 3)).toBe(false)
    expect(RiftVerdict.again(stage("test"), [attempt("timed_out")], 3)).toBe(false)
    expect(RiftVerdict.again(stage("test"), [attempt("passed")], 3)).toBe(false)
    expect(RiftVerdict.again(stage("lint"), [attempt("failed")], 3)).toBe(false)
  })
})

describe("RiftVerdict.attribute", () => {
  const candidate = (tests: string[]): RiftVerdict.Broken => ({ status: "failed", attempts: [attempt("failed", tests)], tests, flaky: [] })
  const at = (tests: string[]) => RiftVerdict.settle([attempt("failed", tests)])

  test("separates failures a change introduced from ones that were already there", () => {
    expect(RiftVerdict.attribute(candidate(["old", "new"]), at(["old"]))).toEqual({ kind: "mixed", introduced: ["new"], preexisting: ["old"] })
    expect(RiftVerdict.attribute(candidate(["old"]), at(["old"]))).toEqual({ kind: "preexisting", tests: ["old"] })
    expect(RiftVerdict.attribute(candidate(["new"]), RiftVerdict.settle([attempt("passed")]))).toEqual({ kind: "introduced", tests: ["new"] })
  })

  test("a test that only flaked at the baseline is not blamed on the change", () => {
    const flaky = RiftVerdict.settle([attempt("failed", ["slow"]), attempt("passed")])
    expect(RiftVerdict.attribute(candidate(["slow"]), flaky)).toEqual({ kind: "preexisting", tests: ["slow"] })
  })

  test("a run that fails without naming tests is compared by status", () => {
    expect(RiftVerdict.attribute(candidate([]), at([]))).toEqual({ kind: "preexisting", tests: [] })
    expect(RiftVerdict.attribute(candidate([]), at(["old"]))).toEqual({ kind: "introduced", tests: [] })
    expect(RiftVerdict.attribute(candidate(["a"]), at([])).kind).toBe("unknown")
  })

  test("a stage the baseline lacks is new, one it could not run is unknown, and a clean tree has nothing to compare", () => {
    expect(RiftVerdict.attribute(candidate(["a"]), "absent")).toEqual({ kind: "introduced", tests: ["a"] })
    expect(RiftVerdict.attribute(candidate(["a"]), { status: "not_run", reason: "declined" }).kind).toBe("unknown")
    expect(RiftVerdict.attribute(candidate(["a"]), "unchanged")).toEqual({ kind: "unchanged" })
  })
})

describe("RiftVerdict.judge", () => {
  const plan = planOf(stage("lint"), stage("test"))
  const judge = (lint: RiftVerdict.Outcome, test: RiftVerdict.Outcome, findings: RiftIntegrity.Finding[] = [], needsTest = true) =>
    RiftVerdict.judge(plan, new Map([[plan.stages[0]!.id, lint], [plan.stages[1]!.id, test]]), findings, needsTest)

  test("the verdict is never better than the evidence", () => {
    expect(judge(passed, passed)).toBe("verified")
    expect(judge(passed, { status: "not_run", reason: "declined" })).toBe("unproven")
    expect(judge(passed, { status: "skipped", because: ids("build") as [RiftStages.StageId] })).toBe("unproven")
    expect(judge(passed, { status: "flaky", attempts: [attempt("failed"), attempt("passed")], tests: [] })).toBe("unproven")
    expect(RiftVerdict.judge(planOf(), new Map(), [], false)).toBe("unproven")
    expect(RiftVerdict.judge(plan, new Map(), [], false)).toBe("unproven")
  })

  test("tampering outranks a regression, which outranks failures that were already there", () => {
    expect(judge(passed, passed, [block])).toBe("tampered")
    expect(judge(broken(["a"], { kind: "introduced", tests: ["a"] }), passed, [block])).toBe("tampered")
    expect(judge(broken(["a"], { kind: "preexisting", tests: ["a"] }), broken([], { kind: "unknown", reason: "x" }))).toBe("regressed")
    expect(judge(broken(["a"], { kind: "preexisting", tests: ["a"] }), broken([], { kind: "unchanged" }))).toBe("failing")
  })

  test("a full verification with no test stage proves nothing", () => {
    const lintOnly = planOf(stage("lint"))
    const outcomes = new Map([[lintOnly.stages[0]!.id, passed]])
    expect(RiftVerdict.judge(lintOnly, outcomes, [], true)).toBe("unproven")
    expect(RiftVerdict.judge(lintOnly, outcomes, [], false)).toBe("verified")
  })
})

describe("RiftVerdict.decide", () => {
  test("anything broken goes back to the agent until the rounds run out, and unproven work never does", () => {
    expect(RiftVerdict.decide("regressed", 2, 3)).toEqual({ type: "fix" })
    expect(RiftVerdict.decide("failing", 0, 3)).toEqual({ type: "fix" })
    expect(RiftVerdict.decide("tampered", 3, 3)).toEqual({ type: "give_up" })
    expect(RiftVerdict.decide("unproven", 0, 3)).toEqual({ type: "report" })
    expect(RiftVerdict.decide("verified", 3, 3)).toEqual({ type: "report" })
  })
})

describe("RiftVerdict.format and headline", () => {
  const plan: RiftStages.Plan = {
    ...planOf(stage("install"), stage("lint"), stage("test"), stage("e2e")),
    uncovered: [{ path: "tools/requirements.txt", why: "python without uv.lock or poetry.lock" }],
  }
  const summary = (outcomes: RiftVerdict.Outcome[], verdict: RiftVerdict.Verdict): RiftVerdict.Summary => ({
    verdict,
    plan,
    outcomes: new Map(plan.stages.map((item, index) => [item.id, outcomes[index]!])),
    against: "HEAD",
    where: "a clean checkout",
    findings: [],
    receipt: "abcdef0123456789",
  })
  const report = summary(
    [
      passed,
      { status: "not_run", reason: "declined" },
      { ...broken(["cart", "old"], { kind: "mixed", introduced: ["cart"], preexisting: ["old"] }), flaky: ["upload"] } as RiftVerdict.Outcome,
      { status: "skipped", because: [plan.stages[2]!.id] },
    ],
    "regressed",
  )

  test("every stage says what happened and what it means, and nothing unrun reads as ok", () => {
    const text = RiftVerdict.format(report)
    expect(text).toContain("RIFT verification: REGRESSED (a clean checkout, compared with HEAD)")
    expect(text).toContain("- ok: run install")
    expect(text).toContain("- NOT RUN: run lint (declined)")
    expect(text).not.toContain("ok: run lint")
    expect(text).toContain("- FAILED: run test")
    expect(text).toContain("new, not failing at HEAD: cart")
    expect(text).toContain("already failing at HEAD: old")
    expect(text).toContain("flaky, failed only sometimes: upload")
    expect(text).toContain("failed output")
    expect(text).toContain("- SKIPPED: run e2e (waits on run test)")
    expect(text).toContain("- tools/requirements.txt (python without uv.lock or poetry.lock)")
    expect(text).toContain("Receipt abcdef012345: regressed")
  })

  test("the notice row counts new failures apart from old ones, and names what is not covered", () => {
    expect(RiftVerdict.headline(report)).toBe(
      "Verify: regressed (1 area not covered) · 1 new failure, 1 already failing at HEAD, 1 passed, 1 skipped, 1 not run · receipt abcdef",
    )
  })

  test("surviving mutants and test tampering are in the report", () => {
    const text = RiftVerdict.format({
      ...report,
      findings: [block],
      mutation: { total: 2, killed: 1, survivors: [{ file: "a.ts", line: 3, from: "a <= b", to: "a < b" }], unsupported: ["x.py"] },
    })
    expect(text).toContain("1 of 2 small changes to the changed lines were caught")
    expect(text).toContain("- a.ts:3 `a <= b` -> `a < b`")
    expect(text).toContain("does not cover: x.py")
    expect(text).toContain("BLOCKED: a.test.ts")
  })

  test("finding nothing says what was looked for", () => {
    expect(RiftVerdict.nothing(RiftStages.LOOKED)).toContain("package.json scripts")
  })
})

describe("RiftMutation", () => {
  const diff = [
    "diff --git a/m.ts b/m.ts",
    "--- a/m.ts",
    "+++ b/m.ts",
    "@@ -2 +2 @@",
    "-export const g = 2",
    "+export const g = a <= b",
    "diff --git a/m.test.ts b/m.test.ts",
    "--- a/m.test.ts",
    "+++ b/m.test.ts",
    "@@ -1 +1 @@",
    "+expect(1 === 1)",
    "diff --git a/n.py b/n.py",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/n.py",
    "@@ -0,0 +1 @@",
    "+x = 1",
  ].join("\n")
  const files: Record<string, string> = { "m.ts": "export const f = 1\nexport const g = a <= b\n" }

  test("mutates only changed lines of non-test files, and names languages it cannot mutate", () => {
    const result = RiftMutation.mutants(diff, (file) => files[file], 40)
    expect(result.mutants.map((item) => [item.file, item.line, item.to])).toEqual([["m.ts", 2, "export const g = a < b"]])
    expect(result.unsupported).toEqual(["n.py"])
  })

  test("does not mutate text inside strings, or comments", () => {
    expect(RiftMutation.mutate("a", 1, `const s = "a === b"`)).toEqual([])
    expect(RiftMutation.mutate("a", 1, `// a === b`)).toEqual([])
    expect(RiftMutation.mutate("a", 1, `if (a === b) {`)[0]?.to).toBe(`if (a !== b) {`)
    expect(RiftMutation.mutate("a.go", 1, `if a == b {`)[0]?.to).toBe(`if a != b {`)
  })

  test("the budget is shared across files, so one large file cannot use it all", () => {
    const big = Array.from({ length: 20 }, (_, index) => `x${index} = a && b`).join("\n")
    const twoFiles = [
      "+++ b/big.ts",
      "@@ -0,0 +1,20 @@",
      "+++ b/small.ts",
      "@@ -0,0 +1 @@",
    ].join("\n")
    const read = (file: string) => (file === "big.ts" ? big : "y = c || d")
    const chosen = RiftMutation.mutants(twoFiles, read, 4).mutants.map((item) => item.file)
    expect(chosen).toHaveLength(4)
    expect(chosen).toContain("small.ts")
  })
})

describe("RiftVerdict.judge with a gap", () => {
  const plan = planOf(stage("test"))
  const gap: RiftIntegrity.Finding = { severity: "gap", rule: "untested-addition", file: "cart.ts", detail: "x" }

  test("passing checks are not enough when the change added code nothing tests", () => {
    const outcomes = new Map([[plan.stages[0]!.id, passed]])
    expect(RiftVerdict.judge(plan, outcomes, [], true)).toBe("verified")
    expect(RiftVerdict.judge(plan, outcomes, [gap], true)).toBe("unproven")
  })

  test("a failure still outranks a gap", () => {
    const outcomes = new Map([[plan.stages[0]!.id, broken(["a"], { kind: "introduced", tests: ["a"] })]])
    expect(RiftVerdict.judge(plan, outcomes, [gap], true)).toBe("regressed")
  })

  test("the report says which file has no test", () => {
    expect(RiftIntegrity.format([gap])).toContain("cart.ts")
  })
})

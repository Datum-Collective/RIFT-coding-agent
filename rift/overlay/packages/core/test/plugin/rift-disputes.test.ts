import { describe, expect, test } from "bun:test"
import type { Rift } from "@opencode/schema/rift"
import { RiftDisputes } from "../../src/plugin/rift-verify/disputes.js"

const stage = (id: string, status: Rift.Stage["status"], evidence?: string): Rift.Stage => ({
  id,
  unit: ".",
  kind: "test",
  command: `run ${id}`,
  status,
  evidence,
})
const run = (...stages: Rift.Stage[]): Rift.Run => ({
  id: "r",
  tree: "t",
  started: 1,
  stages,
  phase: "done",
  finished: 2,
  verdict: stages.some((item) => item.status === "failed") ? "regressed" : "verified",
  headline: "h",
  receipt: "abc",
})

describe("a dispute is a failing check the agent was sent back to fix", () => {
  test("opens one per failing check, with the real output as evidence, and not twice", () => {
    const failing = run(stage("a", "failed", "expected 2, got 3"), stage("b", "passed"))
    const once = RiftDisputes.raise([], failing, 1, 100)
    expect(once).toHaveLength(1)
    expect(once[0]).toMatchObject({ stage: "a", status: "open", round: 1, evidence: "expected 2, got 3", raised: 100 })
    expect(RiftDisputes.raise(once, failing, 2, 200)).toEqual(once)
  })

  test("is resolved only when a later run passes that same check", () => {
    const open = RiftDisputes.raise([], run(stage("a", "failed")), 1, 100)
    const stillFailing = RiftDisputes.settle(open, run(stage("a", "failed")), 200)
    expect(stillFailing[0]!.status).toBe("open")
    const unrelated = RiftDisputes.settle(open, run(stage("b", "passed")), 200)
    expect(unrelated[0]!.status).toBe("open")
    const fixed = RiftDisputes.settle(open, run(stage("a", "passed")), 300)
    expect(fixed[0]).toMatchObject({ status: "resolved", closed: 300 })
    expect(fixed[0]!.resolution).toContain("passed")
    expect(fixed[0]!.resolution).toContain("abc")
  })

  test("a run that has not finished settles nothing", () => {
    const open = RiftDisputes.raise([], run(stage("a", "failed")), 1, 100)
    const running = { ...run(stage("a", "passed")), phase: "running" } as Rift.Run
    expect(RiftDisputes.settle(open, running, 200)[0]!.status).toBe("open")
  })

  test("stays unresolved when the fix rounds run out, and is not reopened by a pass afterwards", () => {
    const open = RiftDisputes.raise([], run(stage("a", "failed")), 3, 100)
    const given = RiftDisputes.giveUp(open, 3, 200)
    expect(given[0]).toMatchObject({ status: "unresolved", closed: 200 })
    expect(given[0]!.resolution).toContain("3")
    expect(RiftDisputes.settle(given, run(stage("a", "passed")), 300)[0]!.status).toBe("unresolved")
  })

  test("a check that failed again after being resolved is a new dispute", () => {
    const open = RiftDisputes.raise([], run(stage("a", "failed")), 1, 100)
    const fixed = RiftDisputes.settle(open, run(stage("a", "passed")), 200)
    const again = RiftDisputes.raise(fixed, run(stage("a", "failed")), 2, 300)
    expect(again.map((item) => item.status)).toEqual(["resolved", "open"])
  })
})

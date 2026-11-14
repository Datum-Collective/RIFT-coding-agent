import { describe, expect, test } from "bun:test"
import type { Rift } from "@opencode/schema/rift"
import { RiftRepair } from "../../src/plugin/rift-verify/repair.js"

const stage = (id: string, status: Rift.Stage["status"], evidence?: string): Rift.Stage => ({ id, unit: ".", kind: "test", command: id, status, evidence })
const run = (...stages: Rift.Stage[]): Rift.Run => ({ id: "r", tree: "t", started: 1, stages, phase: "done", finished: 2, verdict: "regressed", headline: "h", receipt: "x" })

describe("telling a fix that changed something from one that did not", () => {
  test("the same failure with different timings and counts is the same failure", () => {
    const first = RiftRepair.signature(run(stage("a", "failed", "expected 6 got 7 in 12ms (fail) totals [3.20ms]")))
    const second = RiftRepair.signature(run(stage("a", "failed", "expected 6 got 7 in 98ms (fail) totals [4.91ms]")))
    expect(second).toBe(first)
  })

  test("a different check failing, or different output, is different", () => {
    const base = RiftRepair.signature(run(stage("a", "failed", "expected 6 got 7")))
    expect(RiftRepair.signature(run(stage("b", "failed", "expected 6 got 7")))).not.toBe(base)
    expect(RiftRepair.signature(run(stage("a", "failed", "TypeError: x is undefined")))).not.toBe(base)
  })

  test("passing checks do not count", () => {
    expect(RiftRepair.signature(run(stage("a", "failed", "e"), stage("b", "passed")))).toBe(RiftRepair.signature(run(stage("a", "failed", "e"))))
  })

  test("repeats counts how many fixes in a row left the failure as it was", () => {
    expect(RiftRepair.repeats(["a"])).toBe(0)
    expect(RiftRepair.repeats(["a", "b"])).toBe(0)
    expect(RiftRepair.repeats(["a", "a"])).toBe(1)
    expect(RiftRepair.repeats(["x", "a", "a", "a"])).toBe(2)
    expect(RiftRepair.repeats([])).toBe(0)
  })

  test("a repeated failure gets a different instruction, and a third gives up", () => {
    expect(RiftRepair.next(0)).toMatchObject({ type: "diagnose" })
    expect(RiftRepair.next(1)).toMatchObject({ type: "rethink" })
    expect(RiftRepair.next(2)).toMatchObject({ type: "stop" })
    expect(RiftRepair.next(1).type === "rethink" && RiftRepair.next(1)).toHaveProperty("text")
  })

  test("every instruction forbids weakening the checks", () => {
    for (const step of [RiftRepair.next(0), RiftRepair.next(1)]) expect("text" in step && step.text).toMatch(/not the (checks|tests)|never the checks/i)
  })
})

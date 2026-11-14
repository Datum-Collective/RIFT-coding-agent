import { describe, expect, test } from "bun:test"
import type { Rift } from "@opencode/schema/rift"
import { RiftShip } from "../../src/plugin/rift-verify/ship.js"

const done = (verdict: Rift.RunVerdict, tree = "t1"): Rift.Run => ({ id: "r", tree, started: 1, stages: [], phase: "done", finished: 2, verdict, headline: "h", receipt: "abcdef123456" })
const dispute = (status: Rift.Dispute["status"]): Rift.Dispute => ({ stage: "s", check: "c", raised: 1, round: 1, claim: "x", status })

describe("who RIFT is on a commit", () => {
  test("a name and an email in angle brackets", () => {
    expect(RiftShip.identity("RIFT <1234+rift@users.noreply.github.com>")).toEqual({ name: "RIFT", email: "1234+rift@users.noreply.github.com" })
  })

  test("nothing, or something that is not a name and an email, is no identity", () => {
    for (const text of [undefined, "", "RIFT", "<a@b.c>", "RIFT <not an email>", "RIFT <a@b.c> extra", "RI\nFT <a@b.c>"]) expect(RiftShip.identity(text)).toBeUndefined()
  })
})

describe("the co-author trailer", () => {
  const who = { name: "RIFT", email: "r@x.dev" }
  const line = "Co-Authored-By: RIFT <r@x.dev>"

  test("goes after a blank line at the end of the message", () => {
    expect(RiftShip.withTrailer("fix totals", who)).toBe(`fix totals\n\n${line}\n`)
  })

  test("joins an existing trailer block instead of opening a second one", () => {
    expect(RiftShip.withTrailer("fix\n\nbody\n\nSigned-off-by: A <a@b.c>", who)).toBe(`fix\n\nbody\n\nSigned-off-by: A <a@b.c>\n${line}\n`)
  })

  test("is added once, whatever the case of the key", () => {
    const once = RiftShip.withTrailer("fix", who)
    expect(RiftShip.withTrailer(once, who)).toBe(once)
    expect(RiftShip.withTrailer("fix\n\nco-authored-by: RIFT <r@x.dev>", who)).toBe("fix\n\nco-authored-by: RIFT <r@x.dev>")
  })

  test("leaves a message alone when there is no identity, and never adds to an empty one", () => {
    expect(RiftShip.withTrailer("fix", undefined)).toBe("fix")
    expect(RiftShip.withTrailer("   ", who)).toBe("   ")
  })
})

describe("when work is ready to ship", () => {
  test("a verified run of this very tree, with nothing in dispute, is ready", () => {
    expect(RiftShip.gate({ run: done("verified"), tree: "t1", disputes: [dispute("resolved")] })).toEqual({ ready: true, reasons: [] })
  })

  test("no run, an unfinished run, or a run of another tree is not ready, and says which", () => {
    expect(RiftShip.gate({ run: undefined, tree: "t1", disputes: [] }).reasons[0]).toContain("nothing has been verified")
    const running = { ...done("verified"), phase: "running" } as Rift.Run
    expect(RiftShip.gate({ run: running, tree: "t1", disputes: [] }).reasons[0]).toContain("still running")
    expect(RiftShip.gate({ run: done("verified", "old"), tree: "t1", disputes: [] }).reasons[0]).toContain("changed since")
  })

  test("any verdict but verified blocks, even one that is only unproven", () => {
    for (const verdict of ["regressed", "failing", "unproven", "tampered"] as const) {
      const gate = RiftShip.gate({ run: done(verdict), tree: "t1", disputes: [] })
      expect(gate.ready).toBe(false)
      expect(gate.reasons[0]).toContain(verdict)
    }
  })

  test("an open or unresolved disagreement blocks", () => {
    expect(RiftShip.gate({ run: done("verified"), tree: "t1", disputes: [dispute("open")] }).ready).toBe(false)
    expect(RiftShip.gate({ run: done("verified"), tree: "t1", disputes: [dispute("unresolved")] }).reasons.join(" ")).toContain("disagreement")
  })
})

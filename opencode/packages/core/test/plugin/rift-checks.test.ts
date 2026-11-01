import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { RiftChecks } from "../../src/plugin/rift-verify/checks.js"

const dir = () => mkdtempSync(path.join(os.tmpdir(), "rift-checks-"))
const repo = () => {
  const root = dir()
  execFileSync("git", ["init", "-q"], { cwd: root })
  return root
}
const result = (status: RiftChecks.Status): RiftChecks.Result => ({ name: "t", command: "t", dir: "/", status, ms: 0, output: "boom" })

describe("RiftChecks", () => {
  test("an unchanged tree has no edits, and a new file is one", async () => {
    const root = repo()
    const before = await RiftChecks.tree(root)
    expect(RiftChecks.edited(before, before!)).toEqual([])
    writeFileSync(path.join(root, "a.ts"), "1")
    expect(RiftChecks.edited(before, (await RiftChecks.tree(root))!)).toEqual(["a.ts"])
  })

  test("changing a file that was already dirty still counts as an edit", async () => {
    const root = repo()
    writeFileSync(path.join(root, "a.ts"), "1")
    const before = await RiftChecks.tree(root)
    writeFileSync(path.join(root, "a.ts"), "22")
    expect(RiftChecks.edited(before, (await RiftChecks.tree(root))!)).toEqual(["a.ts"])
  })

  test("outside git there is no tree", async () => {
    expect(await RiftChecks.tree(dir())).toBeUndefined()
  })

  test("detects scripts and ignores the npm placeholder", () => {
    const root = dir()
    writeFileSync(path.join(root, "bun.lock"), "")
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { typecheck: "tsc", test: 'echo "Error: no test specified" && exit 1' } }),
    )
    expect(RiftChecks.detect(root, root).map((check) => check.command)).toEqual(["bun run typecheck"])
  })

  test("uses the nearest package of an edited file", () => {
    const root = dir()
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "root" } }))
    mkdirSync(path.join(root, "pkg/src"), { recursive: true })
    writeFileSync(path.join(root, "pkg/package.json"), JSON.stringify({ scripts: { test: "pkg" } }))
    expect(RiftChecks.resolve(root, ["pkg/src/a.ts"]).map((check) => check.dir)).toEqual([path.join(root, "pkg")])
  })

  test("docs-only edits are recognised", () => {
    expect(RiftChecks.docsOnly(["a.md", "b.txt"])).toBe(true)
    expect(RiftChecks.docsOnly(["a.md", "b.ts"])).toBe(false)
    expect(RiftChecks.docsOnly([])).toBe(false)
  })

  test("run reports real exit codes, timeouts and cancellation", async () => {
    const check = (command: string) => ({ name: command, command, dir: dir() })
    expect((await RiftChecks.run(check("exit 0"), 5_000)).status).toBe("passed")
    const failed = await RiftChecks.run(check("echo boom; exit 3"), 5_000)
    expect([failed.status, failed.output]).toEqual(["failed", "boom"])
    expect((await RiftChecks.run(check("sleep 10"), 50)).status).toBe("timed_out")
    const cancelled = new AbortController()
    cancelled.abort()
    const stopped = await RiftChecks.run(check("exit 0"), 5_000, cancelled.signal)
    expect([stopped.status, stopped.reason]).toEqual(["not_run", "cancelled"])
  })

  test("a check that could not run is never a pass, and never starts a fix round", () => {
    expect(RiftChecks.decide([result("not_run")], 0, 3)).toEqual({ type: "report" })
    expect(RiftChecks.format([result("not_run")])).toContain("NOT RUN")
    expect(RiftChecks.format([result("not_run")])).not.toContain("ok:")
  })

  test("failures go back to the agent until the rounds run out", () => {
    expect(RiftChecks.decide([result("failed")], 2, 3)).toEqual({ type: "fix" })
    expect(RiftChecks.decide([result("timed_out")], 3, 3)).toEqual({ type: "give_up" })
    expect(RiftChecks.decide([result("passed")], 3, 3)).toEqual({ type: "report" })
  })
})

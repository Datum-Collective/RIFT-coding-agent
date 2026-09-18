import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Verify } from "../../src/session/verify"

async function project(files: Record<string, string>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verify-"))
  for (const [name, content] of Object.entries(files)) await Bun.write(path.join(dir, name), content)
  return dir
}

describe("verify", () => {
  test("detects package scripts with the right runner and skips placeholders", async () => {
    const dir = await project({
      "package.json": JSON.stringify({
        scripts: { test: 'echo "Error: no test specified" && exit 1', typecheck: "tsc", lint: "eslint ." },
      }),
      "bun.lock": "",
    })
    expect(await Verify.detect(dir)).toEqual([
      { name: "typecheck", command: "bun run typecheck" },
      { name: "lint", command: "bun run lint" },
    ])
  })

  test("detects go projects", async () => {
    const dir = await project({ "go.mod": "module x" })
    expect((await Verify.detect(dir)).map((c) => c.command)).toEqual(["go vet ./...", "go test ./..."])
  })

  test("runs real commands and reports pass/fail with output", async () => {
    const dir = await project({})
    const pass = await Verify.runCheck({ name: "ok", command: "echo hello" }, dir, { timeoutMs: 0 })
    const fail = await Verify.runCheck({ name: "bad", command: "echo broken >&2; exit 3" }, dir, { timeoutMs: 0 })
    expect(pass.status).toBe("passed")
    expect(fail.status).toBe("failed")
    expect(fail.code).toBe(3)
    expect(fail.output).toContain("broken")
  })

  test("times out slow checks and reports cancellation as not run", async () => {
    const dir = await project({})
    const slow = await Verify.runCheck({ name: "slow", command: "sleep 5" }, dir, { timeoutMs: 200 })
    expect(slow.status).toBe("timed_out")
    const cancel = new AbortController()
    const pending = Verify.runCheck({ name: "slow", command: "sleep 5" }, dir, { timeoutMs: 0, cancel: cancel.signal })
    setTimeout(() => cancel.abort(), 100)
    expect((await pending).status).toBe("not_run")
  })

  test.skipIf(process.platform === "win32")("kills the whole process tree on timeout, not just the shell", async () => {
    const dir = await project({})
    const result = await Verify.runCheck({ name: "orphan", command: "(sleep 1; touch late-marker) & wait" }, dir, {
      timeoutMs: 200,
    })
    expect(result.status).toBe("timed_out")
    await Bun.sleep(1500)
    expect(await Bun.file(path.join(dir, "late-marker")).exists()).toBe(false)
  })

  test("resolve prefers explicit commands over detection", async () => {
    const dir = await project({ "go.mod": "module x" })
    expect(await Verify.resolve(dir, { commands: ["make check"] })).toEqual([
      { name: "make check", command: "make check" },
    ])
  })

  test("format distinguishes not configured, running, passed, failed and not run", () => {
    const check = (command: string) => ({ name: command, command })
    expect(Verify.format({ entries: [], scopeFiles: [], scopeWarnFiles: 15, done: true })).toContain("Not configured")

    const running = Verify.format({
      entries: [
        { check: check("a"), result: { ...check("a"), status: "passed", ms: 1000, output: "" } },
        { check: check("b") },
      ],
      scopeFiles: [],
      scopeWarnFiles: 15,
      done: false,
    })
    expect(running).toContain("`a` ✓ passed")
    expect(running).toContain("`b` … queued")
    expect(running).not.toContain("passed,")

    const done = Verify.format({
      entries: [
        { check: check("a"), result: { ...check("a"), status: "passed", ms: 1000, output: "" } },
        { check: check("b"), result: { ...check("b"), status: "failed", code: 2, ms: 500, output: "boom" } },
        { check: check("c"), result: Verify.notRun(check("c"), "permission denied") },
      ],
      scopeFiles: [],
      scopeWarnFiles: 15,
      done: true,
    })
    expect(done).toContain("`b` ✗ failed (exit 2)")
    expect(done).toContain("`c` – not run (permission denied)")
    expect(done).toContain("boom")
    expect(done).toContain("1 passed, 1 failed, 1 not run.")
    expect(done).toContain("Do not treat this task as done")
  })

  test("scope warning is soft and only above the threshold", () => {
    const files = Array.from({ length: 20 }, (_, i) => `f${i}.ts`)
    const entries = [{ check: { name: "a", command: "a" }, result: Verify.notRun({ name: "a", command: "a" }, "x") }]
    expect(Verify.format({ entries, scopeFiles: files, scopeWarnFiles: 15, done: true })).toContain("20 files changed")
    expect(Verify.format({ entries, scopeFiles: files, scopeWarnFiles: 0, done: true })).not.toContain("Scope")
    expect(Verify.format({ entries, scopeFiles: files.slice(0, 3), scopeWarnFiles: 15, done: true })).not.toContain(
      "Scope",
    )
  })

  test("only counts completed edit-like tools as edits", () => {
    expect(Verify.editedFiles([{ tool: "read", status: "completed" }])).toBe(false)
    expect(Verify.editedFiles([{ tool: "edit", status: "error" }])).toBe(false)
    expect(Verify.editedFiles([{ tool: "apply_patch", status: "completed" }])).toBe(true)
  })
})

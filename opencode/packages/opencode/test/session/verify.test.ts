import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
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
    const dir = await project({
      "fail.js": 'process.stderr.write("broken\\n"); process.exit(3)',
    })
    const pass = await Verify.runCheck({ name: "ok", command: "echo hello" }, dir, { timeoutMs: 0 })
    const fail = await Verify.runCheck({ name: "bad", command: "bun fail.js" }, dir, { timeoutMs: 0 })
    expect(pass.status).toBe("passed")
    expect(fail.status).toBe("failed")
    expect(fail.code).toBe(3)
    expect(fail.output).toContain("broken")
  })

  test("times out slow checks and reports cancellation as not run", async () => {
    const dir = await project({ "slow.js": "setTimeout(() => {}, 5000)" })
    const slow = await Verify.runCheck({ name: "slow", command: "bun slow.js" }, dir, { timeoutMs: 200 })
    expect(slow.status).toBe("timed_out")
    const cancel = new AbortController()
    const pending = Verify.runCheck({ name: "slow", command: "bun slow.js" }, dir, {
      timeoutMs: 0,
      cancel: cancel.signal,
    })
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

  describe("monorepos", () => {
    const pkg = (scripts: Record<string, string>) => JSON.stringify({ scripts })

    test("uses the nearest package that has checks for each edited file", async () => {
      const dir = await project({
        "package.json": pkg({ test: "root-test" }),
        "packages/a/package.json": pkg({ typecheck: "tsc" }),
        "packages/a/src/x.ts": "",
        "packages/b/package.json": pkg({ test: "b-test" }),
        "packages/b/src/y.ts": "",
        "packages/c/src/z.ts": "",
      })
      const checks = await Verify.resolve(dir, {
        files: [
          path.join(dir, "packages/a/src/x.ts"),
          path.join(dir, "packages/b/src/y.ts"),
          path.join(dir, "packages/c/src/z.ts"),
        ],
      })
      expect(checks.map((c) => [c.where, c.command])).toEqual([
        ["", "npm run test"],
        ["packages/a", "npm run typecheck"],
        ["packages/b", "npm run test"],
      ])
      expect(checks.find((c) => c.where === "packages/a")?.dir).toBe(path.join(dir, "packages/a"))
    })

    test("finds the package manager from the workspace root lockfile", async () => {
      const dir = await project({
        "bun.lock": "",
        "packages/a/package.json": pkg({ test: "x" }),
        "packages/a/f.ts": "",
      })
      const checks = await Verify.resolve(dir, { files: [path.join(dir, "packages/a/f.ts")] })
      expect(checks.map((c) => c.command)).toEqual(["bun run test"])
    })

    test("falls back to the root for root files and unknown files inside the project", async () => {
      const dir = await project({ "package.json": pkg({ test: "root-test" }) })
      for (const file of [path.join(dir, "index.ts"), path.join(dir, "nope/deep/file.ts")]) {
        expect((await Verify.resolve(dir, { files: [file] })).map((c) => c.command)).toEqual(["npm run test"])
      }
      expect((await Verify.resolve(dir)).map((c) => c.command)).toEqual(["npm run test"])
    })

    test("never runs the project's checks for edits that all landed outside it", async () => {
      const dir = await project({ "package.json": pkg({ test: "root-test" }) })
      const bare = await project({ "index.html": "" })
      expect(await Verify.resolve(dir, { files: [path.join(bare, "index.html")] })).toEqual([])
    })

    test("checks an outside folder in place when it has checks of its own", async () => {
      const dir = await project({ "package.json": pkg({ test: "root-test" }) })
      const site = await project({ "package.json": pkg({ typecheck: "tsc" }), "src/app.ts": "" })
      const checks = await Verify.resolve(dir, { files: [path.join(site, "src/app.ts")] })
      expect(checks.map((c) => [c.where, c.dir, c.command])).toEqual([[site, site, "npm run typecheck"]])
    })

    test("explicit commands ignore edited files and always run at the root", async () => {
      const dir = await project({ "packages/a/package.json": pkg({ test: "x" }) })
      const checks = await Verify.resolve(dir, { commands: ["make ci"], files: [path.join(dir, "packages/a/f.ts")] })
      expect(checks).toEqual([{ name: "make ci", command: "make ci" }])
    })

    test("runs a package check in the package directory", async () => {
      const dir = await project({ "packages/a/marker": "", "packages/a/check.js": 'require("fs").statSync("marker")' })
      const result = await Verify.runCheck(
        { name: "check", command: "bun check.js", dir: path.join(dir, "packages/a") },
        dir,
        { timeoutMs: 0 },
      )
      expect(result.status).toBe("passed")
    })

    test("extracts edited paths from write/edit inputs and apply_patch text", () => {
      const root = "/repo"
      const paths = Verify.editedPaths(
        [
          { tool: "write", status: "completed", input: { filePath: "/repo/a.ts" } },
          { tool: "edit", status: "completed", input: { filePath: "b.ts" } },
          { tool: "edit", status: "error", input: { filePath: "ignored.ts" } },
          { tool: "read", status: "completed", input: { filePath: "read.ts" } },
          {
            tool: "apply_patch",
            status: "completed",
            input: {
              patchText:
                "*** Begin Patch\n*** Update File: pkg/c.ts\n@@\n-a\n+b\n*** Add File: pkg/d.ts\n+x\n*** End Patch",
            },
          },
        ],
        root,
      )
      expect(paths.sort()).toEqual(["/repo/a.ts", "/repo/b.ts", "/repo/pkg/c.ts", "/repo/pkg/d.ts"])
    })

    test("format shows where a package check ran", () => {
      const check = { name: "t", command: "npm run test", where: "packages/a" }
      const text = Verify.format({
        entries: [{ check, result: { ...check, status: "passed", ms: 100, output: "" } }],
        scopeFiles: [],
        scopeWarnFiles: 15,
        done: true,
      })
      expect(text).toContain("`npm run test` in packages/a ✓ passed")
    })
  })

  test("the structured summary agrees with the printed report", () => {
    const check = (command: string) => ({ name: command, command })
    const entries = [
      { check: check("a"), result: { ...check("a"), status: "passed" as const, ms: 100, output: "" } },
      { check: check("b"), result: Verify.notRun(check("b"), "permission denied") },
      { check: check("c") },
    ]
    const running = Verify.summarize({ entries, scopeFiles: [], scopeWarnFiles: 15, done: false })
    // A check that has not started is queued in both the prose and the structured twin.
    expect(running.checks.map((item) => item.status)).toEqual(["passed", "not_run", "queued"])
    expect(running.checks.filter((item) => item.status === "not_run").length).toBe(running.notRun)
    expect(Verify.format({ entries, scopeFiles: [], scopeWarnFiles: 15, done: false })).toContain("… queued")

    const done = Verify.summarize({ entries, scopeFiles: [], scopeWarnFiles: 15, done: true })
    expect(done.checks.map((item) => item.status)).toEqual(["passed", "not_run", "not_run"])
    expect(done.passed).toBe(1)
    expect(done.checks[1]?.reason).toBe("permission denied")
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

  test("reviewer context includes file contents and the git diff, and stays inside the project", async () => {
    const dir = await project({ "a.ts": "const a = 1\n", "big.ts": "x".repeat(50) })
    const git = (...args: string[]) =>
      Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir })
    git("init", "-q")
    git("add", ".")
    git("commit", "-q", "-m", "init")
    await Bun.write(path.join(dir, "a.ts"), "const a = 2\n")

    const diff = await Verify.diffOf(dir, ["a.ts", "../outside.ts"])
    expect(diff).toContain("-const a = 1")
    expect(diff).toContain("+const a = 2")
    expect(await Verify.diffOf(dir, ["big.ts"])).toBe("")
    expect(await Verify.diffOf(dir, ["../outside.ts"])).toBe("")

    const contents = await Verify.fileContents(dir, ["a.ts", "missing.ts", "../outside.ts", "big.ts"], 20)
    expect(contents).toContain("--- a.ts ---\nconst a = 2")
    expect(contents).toContain("truncated, 30 more characters")
    expect(contents).not.toContain("missing.ts")
    expect(contents).not.toContain("outside.ts")
  })

  describe("claims check", () => {
    const gitInit = (dir: string) => {
      const git = (...args: string[]) =>
        Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir })
      git("init", "-q")
      git("add", ".")
      git("commit", "-q", "-m", "init", "--allow-empty")
    }

    test("turnDiff shows tracked edits and renders untracked files as additions", async () => {
      const dir = await project({ "tracked.ts": "const a = 1\n" })
      gitInit(dir)
      await Bun.write(path.join(dir, "tracked.ts"), "const a = 2\n")
      await Bun.write(path.join(dir, "brand-new.ts"), "export const b = 3\n")

      const diff = await Verify.turnDiff(dir, ["tracked.ts", "brand-new.ts"])
      expect(diff).toContain("-const a = 1")
      expect(diff).toContain("+const a = 2")
      expect(diff).toContain("--- new file: brand-new.ts ---")
      expect(diff).toContain("+export const b = 3")
    })

    test("turnDiff shows current contents for files with no git history to diff against", async () => {
      const bare = await project({ "a.ts": "x" })
      expect(await Verify.turnDiff(bare, ["a.ts"])).toBe("--- current contents, no git history: a.ts ---\n+x")

      const dir = await project({ "a.ts": "x" })
      gitInit(dir)
      const site = await project({ "index.html": "<h1>hi</h1>" })
      const file = path.join(site, "index.html")
      expect(await Verify.turnDiff(dir, [file])).toBe(
        `--- current contents, no git history: ${file} ---\n+<h1>hi</h1>`,
      )
      expect(await Verify.turnDiff(dir, [path.join(site, "missing.html")])).toBe("")
    })

    test("parseClaims reads verdicts and rejects unusable replies", () => {
      expect(Verify.parseClaims('{"mismatches":[]}')).toEqual([])
      expect(Verify.parseClaims('noise {"mismatches":[{"claim":" a ","reality":"b"}]} trailing')).toEqual([
        { claim: "a", reality: "b" },
      ])
      // Anything unreadable must be undefined so the caller reports "not run", never agreement.
      for (const bad of ["", "no json here", "{broken", '{"other":1}', '{"mismatches":"nope"}']) {
        expect(Verify.parseClaims(bad)).toBeUndefined()
      }
      // Malformed entries are dropped rather than failing the whole verdict.
      expect(Verify.parseClaims('{"mismatches":[{"claim":"a","reality":"b"},{"claim":""},null,{"x":1}]}')).toEqual([
        { claim: "a", reality: "b" },
      ])
    })

    test("format renders each claims state distinctly", () => {
      const base = { entries: [], scopeFiles: [], scopeWarnFiles: 15, done: true }
      expect(Verify.format({ ...base, claims: { status: "off" } })).not.toContain("Summary")
      expect(Verify.format({ ...base, claims: { status: "pending" } })).toContain("Checking the summary")
      expect(Verify.format({ ...base, claims: { status: "ok" } })).toContain("Summary matches the diff.")
      expect(Verify.format({ ...base, claims: { status: "not_run", reason: "no diff available" } })).toContain(
        "Summary vs diff: not run (no diff available).",
      )
      const mismatch = Verify.format({
        ...base,
        claims: { status: "mismatch", items: [{ claim: "added retries", reality: "no retry code in the diff" }] },
      })
      expect(mismatch).toContain("⚠ Summary does not match the diff (1):")
      expect(mismatch).toContain("Claimed: added retries")
      expect(mismatch).toContain("Actually: no retry code in the diff")
    })
  })

  test("only counts completed edit-like tools as edits", () => {
    expect(Verify.editedFiles([{ tool: "read", status: "completed" }])).toBe(false)
    expect(Verify.editedFiles([{ tool: "edit", status: "error" }])).toBe(false)
    expect(Verify.editedFiles([{ tool: "apply_patch", status: "completed" }])).toBe(true)
  })
})

describe("browser check", () => {
  test("reports a page that rendered cleanly", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response("<!doctype html><title>Fine</title><p>ok</p>", { headers: { "content-type": "text/html" } }),
    })
    try {
      const result = await Verify.checkBrowser(`http://localhost:${server.port}/`)
      if (result.status === "not_run") return // no browser on this machine
      expect(result.status).toBe("passed")
      expect(result.title).toBe("Fine")
      expect(result.httpStatus).toBe(200)
      expect(result.errors).toEqual([])
    } finally {
      server.stop(true)
    }
  }, 60_000)

  test("fails a page that renders but throws in the console", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response("<!doctype html><title>Looks fine</title><h1>Looks fine</h1><script>boom()</script>", {
          headers: { "content-type": "text/html" },
        }),
    })
    try {
      const result = await Verify.checkBrowser(`http://localhost:${server.port}/`)
      if (result.status === "not_run") return
      // The page rendered and returned 200; only the console reveals it is broken.
      expect(result.httpStatus).toBe(200)
      expect(result.title).toBe("Looks fine")
      expect(result.status).toBe("failed")
      expect(result.errors.join(" ")).toMatch(/boom|not defined/)
    } finally {
      server.stop(true)
    }
  }, 60_000)

  test("fails an error status even with a clean console", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("<title>Gone</title>", { status: 500, headers: { "content-type": "text/html" } }),
    })
    try {
      const result = await Verify.checkBrowser(`http://localhost:${server.port}/`)
      if (result.status === "not_run") return
      expect(result.httpStatus).toBe(500)
      expect(result.status).toBe("failed")
    } finally {
      server.stop(true)
    }
  }, 60_000)

  test("picks a page the turn built, index.html first, and only if it exists", async () => {
    const site = await project({ "about.html": "", "index.html": "", "app.js": "" })
    const url = (file: string) => pathToFileURL(path.join(site, file)).href
    expect(await Verify.editedPage([path.join(site, "about.html"), path.join(site, "index.html")])).toBe(
      url("index.html"),
    )
    expect(await Verify.editedPage([path.join(site, "about.html"), path.join(site, "app.js")])).toBe(url("about.html"))
    expect(await Verify.editedPage([path.join(site, "app.js")])).toBeUndefined()
    expect(await Verify.editedPage([path.join(site, "gone.html")])).toBeUndefined()
  })

  test("checks a local page with no server, and still catches console errors", async () => {
    const site = await project({
      "index.html": "<!doctype html><title>Static site</title><p>hi</p>",
      "broken.html": "<!doctype html><title>Broken</title><script>boom()</script>",
    })
    const clean = await Verify.checkBrowser(pathToFileURL(path.join(site, "index.html")).href)
    if (clean.status === "not_run") return
    expect(clean.status).toBe("passed")
    expect(clean.title).toBe("Static site")
    const broken = await Verify.checkBrowser(pathToFileURL(path.join(site, "broken.html")).href)
    expect(broken.status).toBe("failed")
    expect(broken.errors.join(" ")).toMatch(/boom|not defined/)
  }, 60_000)

  test("an unreachable page never passes, even though its console is clean", async () => {
    const result = await Verify.checkBrowser("http://localhost:1/", 10_000)
    expect(result.status).not.toBe("passed")
    if (result.status === "failed") expect(result.reason).toMatch(/did not load/)
  }, 60_000)

  test("the report names the page and its console errors", () => {
    const base = { entries: [], scopeFiles: [], scopeWarnFiles: 15, done: true }
    expect(
      Verify.format({ ...base, browser: { url: "http://x/", status: "passed", httpStatus: 200, errors: [] } }),
    ).toContain("✓ rendered (200), no console errors")
    expect(
      Verify.format({
        ...base,
        browser: { url: "http://x/", status: "failed", httpStatus: 200, errors: ["boom is not defined"] },
      }),
    ).toContain("boom is not defined")
    expect(
      Verify.format({
        ...base,
        browser: { url: "http://x/", status: "not_run", reason: "no browser found", errors: [] },
      }),
    ).toContain("not checked (no browser found)")
  })
})

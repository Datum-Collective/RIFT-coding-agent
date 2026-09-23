import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { Evidence } from "../../src/session/evidence"
import { Verify } from "../../src/session/verify"
import type { EngineeringGraph } from "../../src/session/engineering-graph"

async function project(files: Record<string, string>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-"))
  for (const [name, content] of Object.entries(files)) await Bun.write(path.join(dir, name), content)
  return dir
}

const node = (fields: Partial<EngineeringGraph.Info> & Pick<EngineeringGraph.Info, "id" | "title">) => ({
  status: "in_progress" as const,
  owner: "build",
  dependencies: [],
  files: [],
  checks: [],
  decisions: [],
  ...fields,
})

const options = (directory: string) => ({ directory, timeoutMs: 10_000 })

describe("evidence", () => {
  test("plans Implementation from a node's files, then each check it declared", () => {
    const planned = Evidence.plan([
      node({ id: "product", title: "Product" }),
      node({
        id: "upload",
        title: "Users can upload a 500MB video",
        files: ["src/upload.ts"],
        checks: [
          { kind: "unit", command: "bun test upload" },
          { kind: "load", label: "p95 under 2s", command: "k6 run load.js" },
        ],
      }),
    ])
    expect(planned.map((item) => [item.node, item.label])).toEqual([
      ["upload", "Implementation"],
      ["upload", "Unit tests"],
      ["upload", "p95 under 2s"],
    ])
  })

  test("Implementation passes only when every declared file exists", async () => {
    const dir = await project({ "src/upload.ts": "export {}" })
    const [present] = Evidence.plan([node({ id: "a", title: "A", files: ["src/upload.ts"] })])
    expect(await Evidence.run(present, options(dir))).toMatchObject({ status: "passed", detail: "1 file present" })
    const [missing] = Evidence.plan([node({ id: "b", title: "B", files: ["src/upload.ts", "src/gone.ts"] })])
    expect(await Evidence.run(missing, options(dir))).toMatchObject({ status: "failed", detail: "missing: src/gone.ts" })
  })

  test("a command proves a node by its real exit code, in the declared directory", async () => {
    const dir = await project({ "ok.js": "", "site/fail.js": 'console.error("upload too slow"); process.exit(2)' })
    const [pass, fail] = Evidence.plan([
      node({
        id: "n",
        title: "N",
        checks: [
          { kind: "unit", command: "bun ok.js" },
          { kind: "load", command: "bun fail.js", cwd: path.join(dir, "site") },
        ],
      }),
    ])
    expect(await Evidence.run(pass, options(dir))).toMatchObject({ status: "passed", detail: "bun ok.js (exit 0)" })
    const failed = await Evidence.run(fail, options(dir))
    expect(failed).toMatchObject({ status: "failed", detail: "bun fail.js (exit 2)" })
    expect(failed.output).toContain("upload too slow")
  })

  test("an http check passes on 2xx and fails on 4xx or an unreachable server", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: (request) => new Response("", { status: new URL(request.url).pathname === "/health" ? 200 : 503 }),
    })
    try {
      const base = `http://localhost:${server.port}`
      const [ok, down, gone] = Evidence.plan([
        node({
          id: "n",
          title: "N",
          checks: [
            { kind: "http", url: `${base}/health` },
            { kind: "production", url: `${base}/broken` },
            { kind: "http", url: "http://localhost:1/" },
          ],
        }),
      ])
      expect((await Evidence.run(ok, options("/"))).status).toBe("passed")
      expect(await Evidence.run(down, options("/"))).toMatchObject({ status: "failed" })
      expect((await Evidence.run(down, options("/"))).detail).toContain("HTTP 503")
      expect((await Evidence.run(gone, options("/"))).status).toBe("failed")
    } finally {
      server.stop(true)
    }
  })

  test("a browser check on a local page fails on console errors", async () => {
    const dir = await project({ "broken.html": "<!doctype html><title>x</title><script>boom()</script>" })
    const [item] = Evidence.plan([
      node({ id: "n", title: "N", checks: [{ kind: "browser", url: pathToFileURL(path.join(dir, "broken.html")).href }] }),
    ])
    const record = await Evidence.run(item, options(dir))
    if (record.status === "not_run") return // no browser on this machine
    expect(record.status).toBe("failed")
    expect(record.detail).toMatch(/console error/)
  }, 60_000)

  test("a check with nothing to run is reported as not run, never as passed", async () => {
    const [item] = Evidence.plan([node({ id: "n", title: "N", checks: [{ kind: "security" }] })])
    expect(await Evidence.run(item, options("/"))).toMatchObject({ status: "not_run" })
  })

  test("each item asks the permission its tool call would need", () => {
    const [cmd, file, web] = Evidence.plan([
      node({
        id: "n",
        title: "N",
        checks: [
          { kind: "unit", command: "bun test" },
          { kind: "browser", url: "file:///repo/site/index.html" },
          { kind: "http", url: "https://example.com/health" },
        ],
      }),
    ])
    expect(Evidence.permission(cmd, "/repo")).toEqual({ permission: "bash", patterns: ["bun test"] })
    expect(Evidence.permission(file, "/repo")).toEqual({ permission: "read", patterns: ["site/index.html"] })
    expect(Evidence.permission(web, "/repo")).toEqual({
      permission: "browser_open",
      patterns: ["https://example.com/health"],
    })
    const [implementation] = Evidence.plan([node({ id: "m", title: "M", files: ["a.ts"] })])
    expect(Evidence.permission(implementation, "/repo")).toBeUndefined()
  })

  test("the report shows evidence per requirement and says what is unproven", () => {
    const text = Verify.format({
      entries: [],
      scopeFiles: [],
      scopeWarnFiles: 0,
      done: true,
      evidence: [
        { node: "u", title: "Users can upload a 500MB video", kind: "implementation", label: "Implementation", status: "passed", detail: "3 files present", ms: 1 },
        { node: "u", title: "Users can upload a 500MB video", kind: "load", label: "Load test", status: "failed", detail: "k6 run (exit 1)", ms: 9, output: "p95 4.2s" },
        { node: "u", title: "Users can upload a 500MB video", kind: "production", label: "Production check", status: "not_run", detail: "permission denied", ms: 0 },
      ],
    })
    expect(text).not.toContain("Not configured")
    expect(text).toContain("- Users can upload a 500MB video")
    expect(text).toContain("  ✓ Implementation: 3 files present")
    expect(text).toContain("  ✗ Load test: k6 run (exit 1)")
    expect(text).toContain("  ○ Production check: permission denied")
    expect(text).toContain("p95 4.2s")
    expect(text).toContain("2 requirement checks are not proven")
    expect(Verify.summarize({ entries: [], scopeFiles: [], scopeWarnFiles: 0, done: true, evidence: [
      { node: "u", title: "U", kind: "load", label: "Load test", status: "failed", detail: "x", ms: 1, output: "long" },
    ] }).evidence).toEqual([{ node: "u", title: "U", kind: "load", label: "Load test", status: "failed", detail: "x", ms: 1 }])
  })
})

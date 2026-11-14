import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect, Fiber } from "effect"
import { Agent } from "@opencode/schema/agent"
import type { Rift } from "@opencode/schema/rift"
import type { Session } from "@opencode/schema/session"
import { Permission } from "../../src/permission.js"
import { RiftPipeline } from "../../src/plugin/rift-verify/pipeline.js"
import { RiftVerdict } from "../../src/plugin/rift-verify/verdict.js"
import { RiftReceipt } from "../../src/plugin/rift-verify/receipt.js"
import type { RiftStages } from "../../src/plugin/rift-verify/stages.js"
import { RiftWorkspace } from "../../src/plugin/rift-verify/workspace.js"

const sessionID = "ses_pipeline" as Session.ID
const agent = Agent.ID.make("build")
const temp = () => mkdtempSync(path.join(os.tmpdir(), "rift-pipeline-"))

const project = (files: Record<string, string>, install = false) => {
  const root = temp()
  const write = (name: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    writeFileSync(path.join(root, name), text)
  }
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" })
  for (const [name, text] of Object.entries({ ".gitignore": "node_modules\ndist\n", ...files })) write(name, text)
  if (install) execFileSync("bun", ["install"], { cwd: root, stdio: "ignore" })
  git("init", "-q")
  git("add", "-A")
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init")
  return { root, write, git }
}

/** A project whose tests need its one dependency, so they pass only after a real install. */
const ladder = (scripts: Record<string, string> = {}) =>
  project(
    {
      "local/package.json": JSON.stringify({ name: "local", version: "1.0.0", main: "index.js" }),
      "local/index.js": "module.exports = 2\n",
      "package.json": JSON.stringify({
        name: "t",
        dependencies: { local: "file:./local" },
        scripts: { lint: "test -f m.ts", build: "mkdir -p dist && echo built > dist/out", test: "bun test", ...scripts },
      }),
      "m.ts": "export const f = (a: number) => a + 1\n",
      "m.test.ts": 'import { expect, test } from "bun:test"\nimport { f } from "./m"\ntest("adds", () => expect(f(1)).toBe(2))\ntest("dep", () => expect(require("local")).toBe(2))\n',
    },
    true,
  )

const harness = (root: string, answer: "ask" | "allow" | "decline" = "ask") => {
  const store = new Map<string, unknown>()
  const views: Rift.Run[] = []
  const asked: (readonly string[])[] = []
  const permission = {
    allows: () => Effect.succeed(answer === "allow"),
    assertNotDenied: () => Effect.void,
    assert: (input: Permission.AssertInput): Effect.Effect<void> =>
      answer === "decline" ? Effect.die(new Permission.DeclinedError()) : Effect.sync(() => void asked.push(input.resources)),
  }
  const pipeline = Effect.runSync(
    RiftPipeline.make({
      root,
      storage: {
        get: (key) => Effect.sync(() => store.get(key) as never),
        set: (key, value) => Effect.sync(() => void store.set(key, value)),
      },
      permission,
      publish: (_, __, view) => Effect.sync(() => void views.push(view)),
    }),
  )
  const verify = (tier: RiftPipeline.Tier, options: { baseline?: RiftWorkspace.TreeId; scope?: RiftStages.Scope; mutate?: boolean } = {}) =>
    Effect.gen(function* () {
      const candidate = (yield* RiftWorkspace.snapshot(root))!
      return yield* pipeline.run({
        sessionID,
        agent,
        tier,
        candidate,
        baseline: tier === "project" ? candidate.headTree : options.baseline,
        scope: options.scope ?? { kind: "all" },
        mutate: options.mutate ?? false,
      })
    })
  const report = async (tier: RiftPipeline.Tier, options?: Parameters<typeof verify>[1]) => {
    const result = await Effect.runPromise(verify(tier, options))
    if (result.kind !== "ran") throw new Error("nothing ran")
    return result.report
  }
  const last = () => views.at(-1)!
  const stage = (command: string) => last().stages.find((item) => item.command === command)
  const receipts = () => (store.get(`receipts:${sessionID}`) ?? []) as RiftReceipt.Sealed[]
  return { pipeline, store, views, asked, verify, report, last, stage, receipts }
}

describe("RiftPipeline, the full tier", () => {
  test("installs from the lockfile in a clean checkout, runs the ladder, and asks once for every command", async () => {
    const { root, git } = ladder()
    const status = git("status", "--porcelain=v1", "--ignored")
    const run = harness(root)
    const report = await run.report("project")
    expect(run.asked).toEqual([["bun install --frozen-lockfile", "bun run lint", "bun run build", "bun run test"]])
    expect(report.verdict).toBe("verified")
    expect(run.last()).toMatchObject({ phase: "done", verdict: "verified" })
    expect(run.last().stages.map((item) => item.status)).toEqual(["passed", "passed", "passed", "passed"])
    expect(git("status", "--porcelain=v1", "--ignored")).toBe(status)
    expect(existsSync(path.join(root, "dist"))).toBe(false)
    expect(RiftReceipt.audit(run.receipts())).toBeUndefined()
    expect(run.receipts()[0]).toMatchObject({ version: 2, tier: "project", verdict: "verified", environment: { kind: "clean" } })
  }, 60_000)

  test("a failed build skips the tests, while lint still reports", async () => {
    const { root } = ladder({ build: "exit 2" })
    const run = harness(root, "allow")
    const report = await run.report("project")
    expect(run.stage("bun run lint")?.status).toBe("passed")
    expect(run.stage("bun run build")?.status).toBe("failed")
    expect(run.stage("bun run test")?.status).toBe("skipped")
    expect(report.verdict).toBe("failing")
    expect(report.text).toContain("SKIPPED: bun run test (waits on bun run build)")
    expect(report.text).not.toContain("ok: bun run test")
  }, 60_000)

  test("a test that fails and then passes on the same code is flaky, not a pass", async () => {
    const flag = path.join(temp(), "flag")
    const { root } = project({ "package.json": JSON.stringify({ scripts: { test: `test -f ${flag} || (touch ${flag}; exit 1)` } }) })
    const run = harness(root, "allow")
    const report = await run.report("project")
    expect(run.last().stages[0]).toMatchObject({ status: "flaky", attempt: 2 })
    expect(report.verdict).toBe("unproven")
    expect(report.headline).toContain("1 flaky")
  }, 60_000)

  test("separates what uncommitted changes broke from what HEAD already broke, and compares with HEAD once", async () => {
    const log = path.join(temp(), "runs")
    const { root, write, git } = project({
      "bun.lock": "",
      "package.json": JSON.stringify({ scripts: { test: `echo run >> ${log} && bun test` } }),
      "cart.ts": "export const total = (a: number, b: number) => a + b\n",
      "cart.test.ts":
        'import { expect, test } from "bun:test"\nimport { total } from "./cart"\ntest("cart", () => expect(total(1, 2)).toBe(3))\ntest("old", () => expect(1).toBe(2))\n',
    })
    write("cart.ts", "export const total = (a: number, b: number) => a - b\n")
    const status = git("status", "--porcelain=v1")
    const run = harness(root, "allow")
    const report = await run.report("project")
    expect(report.verdict).toBe("regressed")
    expect(run.stage("bun run test")).toMatchObject({ status: "failed", introduced: 1, preexisting: 1 })
    expect(report.text).toContain("new, not failing at HEAD: cart")
    expect(report.text).toContain("already failing at HEAD: old")
    expect(report.headline).toContain("1 new failure, 1 already failing at HEAD")
    const runs = () => readFileSync(log, "utf8").trim().split("\n").length
    expect(runs()).toBe(6)
    await run.report("project")
    expect(runs()).toBe(9)
    expect(git("status", "--porcelain=v1")).toBe(status)
  }, 60_000)

  test("a declined permission runs nothing, and the run ends unproven rather than stuck", async () => {
    const marker = path.join(temp(), "ran")
    const { root } = project({ "package.json": JSON.stringify({ scripts: { test: `touch ${marker}` } }) })
    const run = harness(root, "decline")
    const report = await run.report("project")
    expect(existsSync(marker)).toBe(false)
    expect(report.verdict).toBe("unproven")
    expect(run.last()).toMatchObject({ phase: "done", verdict: "unproven", stages: [{ status: "not_run", reason: "declined" }] })
    expect(report.text).toContain("NOT RUN")
  }, 60_000)

  test("stopping a run kills its commands and still seals an unproven receipt", async () => {
    const marker = path.join(temp(), "finished")
    const { root } = project({ "package.json": JSON.stringify({ scripts: { test: `sleep 2 && touch ${marker}` } }) })
    const run = harness(root, "allow")
    const fiber = Effect.runFork(run.verify("project"))
    for (let i = 0; i < 100 && !run.views.some((view) => view.stages.some((item) => item.status === "running")); i++)
      await new Promise((resolve) => setTimeout(resolve, 20))
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(run.last()).toMatchObject({ phase: "cancelled", stages: [{ status: "not_run", reason: "cancelled" }] })
    expect(run.receipts().map((receipt) => receipt.verdict)).toEqual(["unproven"])
    await new Promise((resolve) => setTimeout(resolve, 2500))
    expect(existsSync(marker)).toBe(false)
  }, 60_000)

  test("finding no checks is said, not a pass", async () => {
    const { root } = project({ "README.md": "hi" })
    const result = await Effect.runPromise(harness(root).verify("project"))
    expect(result).toMatchObject({ kind: "empty" })
  })
})

describe("RiftPipeline, mutation testing", () => {
  const mutated = (assertion: string) => {
    const { root, write } = project({
      "package.json": JSON.stringify({ scripts: { test: "bun test" } }),
      "m.ts": "export const f = (a: number) => a\n",
      "m.test.ts": `import { expect, test } from "bun:test"\nimport { f } from "./m"\ntest("t", () => ${assertion})\n`,
    })
    write("m.ts", "export const f = (a: number) => a + 1\n")
    return root
  }

  test("a test that pins the behaviour kills the mutants, and a thin one lets them survive", async () => {
    const strong = await harness(mutated("expect(f(2)).toBe(3)"), "allow").report("project", { mutate: true })
    expect(strong.mutation?.total).toBeGreaterThan(0)
    expect(strong.mutation?.survivors).toEqual([])
    const thin = await harness(mutated("expect(f(2)).toBeDefined()"), "allow").report("project", { mutate: true })
    expect(thin.mutation?.total).toBeGreaterThan(0)
    expect(thin.mutation?.survivors).toHaveLength(thin.mutation!.total)
    expect(thin.text).toContain("No test notices these")
    expect(thin.verdict).toBe("verified")
  }, 60_000)

  test("a suite that already fails mutates nothing, so no mutant looks caught", async () => {
    const report = await harness(mutated("expect(1).toBe(2)"), "allow").report("project", { mutate: true })
    expect(report.mutation?.total ?? 0).toBe(0)
  }, 60_000)
})

describe("RiftPipeline, the change tier", () => {
  test("checks the edited unit in a snapshot that uses the live dependencies, with no install or build", async () => {
    const { root, write, git } = ladder()
    const run = harness(root)
    const baseline = (await Effect.runPromise(RiftWorkspace.snapshot(root)))!.tree
    write("m.ts", "export const f = (a: number) => a + 1 // edited\n")
    const status = git("status", "--porcelain=v1")
    const report = await run.report("change", { baseline, scope: { kind: "files", files: ["m.ts"] } })
    expect(run.asked).toEqual([["bun run lint", "bun run test"]])
    expect(report.verdict).toBe("verified")
    expect(run.receipts()[0]).toMatchObject({ tier: "change", environment: { kind: "snapshot" }, inputs: { files: [{ path: "m.ts" }] } })
    expect(git("status", "--porcelain=v1")).toBe(status)
  }, 60_000)

  test("a graph check runs as a proof stage and its proof is recorded against the code it saw", async () => {
    const { root, write } = project({ "a.ts": "export const a = 1\n" })
    const run = harness(root, "allow")
    const baseline = (await Effect.runPromise(RiftWorkspace.snapshot(root)))!.tree
    await Effect.runPromise(
      run.pipeline.ledger.writeGraph(sessionID, [
        { id: "a", title: "a", status: "in_progress", dependencies: [], files: ["a.ts"], decisions: [], checks: [{ label: "a holds", command: "grep -q 2 a.ts" }] },
      ]),
    )
    write("a.ts", "export const a = 2\n")
    const report = await run.report("change", { baseline, scope: { kind: "files", files: ["a.ts"] } })
    expect(report.verdict).toBe("verified")
    const graph = await Effect.runPromise(run.pipeline.ledger.graph(sessionID))
    expect(graph.proofs).toMatchObject([{ node: "a", label: "a holds", status: "passed" }])
    expect(report.text).toContain("- proven: a")
  }, 60_000)
})

describe("what the sidebar can check a result against", () => {
  const attempt = (status: "passed" | "failed", tail: string): RiftVerdict.Attempt => ({ status, ms: 1500, tail, digest: "a".repeat(64), failures: [] })
  const planned = (kind: RiftStages.Kind): Rift.Run =>
    RiftPipeline.step(
      { id: "r", tree: "t", started: 1, stages: [], phase: "preparing" },
      { type: "planned", plan: { stages: [{ id: `.:${kind}:x` as RiftStages.StageId, unit: "." as RiftStages.UnitDir, kind, name: "x", command: "run x", cwd: ".", needs: [], rerun: false, timeoutMs: 1 }], notes: [], uncovered: [] } },
    )

  test("every planned check says why it runs", () => {
    expect(planned("test").stages[0]!.why).toContain("tests")
    expect(planned("typecheck").stages[0]!.why).toBeTruthy()
  })

  test("a failure carries the end of its real output, a pass carries the output digest", () => {
    const lines = Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n")
    const failed = RiftPipeline.step(planned("test"), {
      type: "finished",
      stage: ".:test:x" as RiftStages.StageId,
      outcome: { status: "failed", attempts: [attempt("failed", lines)], tests: ["a"], flaky: [], attribution: { kind: "introduced", tests: ["a"] } },
    }).stages[0]!
    expect(failed.why).toBeTruthy()
    expect(failed.evidence).toContain("line 39")
    expect(failed.evidence).not.toContain("line 0\n")
    const passed = RiftPipeline.step(planned("test"), {
      type: "finished",
      stage: ".:test:x" as RiftStages.StageId,
      outcome: { status: "passed", attempts: [attempt("passed", "ok")] },
    }).stages[0]!
    expect(passed.evidence).toBe(`exit 0 in 1.5s, output sha256 ${"a".repeat(12)}`)
    expect(passed.why).toBeTruthy()
  })
})

describe("what a finished run tells the sidebar beyond its checks", () => {
  test("the findings of the integrity review travel with the verdict", () => {
    const view = RiftPipeline.step(
      { id: "r", tree: "t", started: 1, stages: [], phase: "running" },
      { type: "done", at: 2, verdict: "unproven", headline: "h", receipt: "x", notes: ["cart.ts: new code with no test in this change"] },
    )
    expect(view).toMatchObject({ phase: "done", verdict: "unproven", notes: ["cart.ts: new code with no test in this change"] })
  })
})

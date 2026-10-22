import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { CheckRunner } from "../../src/session/check-runner"
import { Verify } from "../../src/session/verify"

let dir: string

async function git(...args: string[]) {
  await Bun.spawn(["git", ...args], { cwd: dir, stdout: "ignore", stderr: "ignore" }).exited
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "check-runner-"))
  await git("init", "-q")
  await Bun.write(path.join(dir, "a.ts"), "export const a = 1\n")
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const options = { timeoutMs: 10_000 }

describe("fingerprint", () => {
  test("changes when a file changes and is stable otherwise", async () => {
    const first = await CheckRunner.fingerprint(dir)
    expect(first).toBeString()
    expect(await CheckRunner.fingerprint(dir)).toBe(first)
    await Bun.write(path.join(dir, "a.ts"), "export const a = 22\n")
    expect(await CheckRunner.fingerprint(dir)).not.toBe(first)
  })

  test("is undefined outside git, which turns caching off", async () => {
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), "check-runner-plain-"))
    expect(await CheckRunner.fingerprint(plain)).toBeUndefined()
    await fs.rm(plain, { recursive: true, force: true })
  })
})

describe("run", () => {
  test("runs a command once per tree and shares the result", async () => {
    const tree = await CheckRunner.fingerprint(dir)
    const check = { name: "count", command: "echo x >> runs.log" }
    const [one, two] = await Promise.all([
      CheckRunner.run(check, dir, tree, options),
      CheckRunner.run(check, dir, tree, options),
    ])
    const three = await CheckRunner.run(check, dir, tree, options)
    expect([one.status, two.status, three.status]).toEqual(["passed", "passed", "passed"])
    expect((await Bun.file(path.join(dir, "runs.log")).text()).trim().split("\n")).toHaveLength(1)
  })

  test("runs again for a different tree", async () => {
    const check = { name: "count", command: "echo x >> ../runs-elsewhere.log" }
    await CheckRunner.run(check, dir, "tree-one", options)
    await CheckRunner.run(check, dir, "tree-two", options)
    const log = path.join(path.dirname(dir), "runs-elsewhere.log")
    expect((await Bun.file(log).text()).trim().split("\n")).toHaveLength(2)
    await fs.rm(log, { force: true })
  })

  test("runs a batch in parallel", async () => {
    const started = Date.now()
    const results = await CheckRunner.runAll(
      [
        { name: "one", command: "sleep 0.4" },
        { name: "two", command: "sleep 0.4" },
        { name: "three", command: "sleep 0.4" },
      ],
      dir,
      undefined,
      options,
    )
    expect(results.map((result) => result.status)).toEqual(["passed", "passed", "passed"])
    expect(Date.now() - started).toBeLessThan(1000)
  })

  test("a cancelled consumer gets not run, and the result is not cached", async () => {
    const tree = await CheckRunner.fingerprint(dir)
    const check = { name: "slow", command: "sleep 5" }
    const controller = new AbortController()
    const pending = CheckRunner.run(check, dir, tree, { ...options, cancel: controller.signal })
    controller.abort()
    expect((await pending).status).toBe("not_run")
  })
})

describe("live checks", () => {
  test("reports a failure once, and only while the tree is unchanged", async () => {
    await CheckRunner.kick("ses_live", {
      dir,
      checks: [{ name: "test", command: "echo boom && exit 3" }],
      options,
    })
    let failures: Verify.CheckResult[] = []
    for (let i = 0; i < 50 && failures.length === 0; i++) {
      await Bun.sleep(50)
      failures = await CheckRunner.failures("ses_live", dir)
    }
    expect(failures).toHaveLength(1)
    expect(failures[0]!.code).toBe(3)
    expect(CheckRunner.failureReminder(failures)).toContain("boom")
    expect(await CheckRunner.failures("ses_live", dir)).toEqual([])
    CheckRunner.stop("ses_live")
  })

  test("does not repeat a failure the agent was already told about", async () => {
    const check = { name: "test", command: "echo same && exit 1" }
    await CheckRunner.kick("ses_once", { dir, checks: [check], options })
    await Bun.sleep(400)
    expect(await CheckRunner.failures("ses_once", dir)).toHaveLength(1)
    await Bun.write(path.join(dir, "a.ts"), "export const a = 4\n")
    await CheckRunner.kick("ses_once", { dir, checks: [check], options })
    await Bun.sleep(400)
    expect(await CheckRunner.failures("ses_once", dir)).toEqual([])
    CheckRunner.stop("ses_once")
  })

  test("drops results for a tree that has since changed", async () => {
    await CheckRunner.kick("ses_stale", { dir, checks: [{ name: "test", command: "exit 1" }], options })
    await Bun.sleep(300)
    await Bun.write(path.join(dir, "a.ts"), "export const a = 3\n")
    expect(await CheckRunner.failures("ses_stale", dir)).toEqual([])
    CheckRunner.stop("ses_stale")
  })
})

describe("docsOnly", () => {
  test("only documentation counts", () => {
    expect(CheckRunner.docsOnly(["/r/README.md", "/r/docs/guide.mdx", "/r/LICENSE"])).toBe(true)
    expect(CheckRunner.docsOnly(["/r/README.md", "/r/src/a.ts"])).toBe(false)
    expect(CheckRunner.docsOnly(["/r/data.txt"])).toBe(false)
    expect(CheckRunner.docsOnly([])).toBe(false)
  })
})

describe("deterministicClaims", () => {
  const failedTest: Verify.CheckResult = {
    name: "test",
    command: "bun run test",
    status: "failed",
    code: 1,
    ms: 10,
    output: "",
  }

  test("flags a passing-tests claim RIFT saw fail", () => {
    const items = Verify.deterministicClaims("Added sum(). All tests pass.", [failedTest], ["/r/src/sum.ts"])
    expect(items).toHaveLength(1)
    expect(items[0]!.reality).toContain("bun run test")
  })

  test("flags a file the turn never edited", () => {
    const items = Verify.deterministicClaims("I updated `src/other.ts` to export it.", [], ["/r/src/sum.ts"])
    expect(items[0]!.reality).toContain("src/other.ts")
  })

  test("accepts a summary the results and edits support", () => {
    const passed = { ...failedTest, status: "passed" as const, code: 0 }
    expect(Verify.deterministicClaims("Created `src/sum.ts`. Tests pass.", [passed], ["/r/src/sum.ts"])).toEqual([])
  })
})

test("diffSize counts changed lines only", () => {
  expect(Verify.diffSize("--- a/x\n+++ b/x\n@@\n-old\n+new\n+more\n context")).toBe(3)
})

import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect, Fiber } from "effect"
import { RiftWorkspace } from "../../src/plugin/rift-verify/workspace.js"

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)
const temp = () => mkdtempSync(path.join(os.tmpdir(), "rift-workspace-"))
const repo = (files: Record<string, string> = { "a.ts": "1\n" }) => {
  const root = temp()
  const write = (name: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    writeFileSync(path.join(root, name), text)
  }
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" })
  for (const [name, text] of Object.entries(files)) write(name, text)
  git("init", "-q")
  git("add", "-A")
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init")
  return { root, write, git }
}
const snap = async (root: string) => (await run(RiftWorkspace.snapshot(root)))!

describe("RiftWorkspace.snapshot", () => {
  test("leaves the user's index and status exactly as they were", async () => {
    const { root, write, git } = repo()
    write("a.ts", "2\n")
    write("new.ts", "n\n")
    git("add", "new.ts")
    write("other.ts", "o\n")
    const status = git("status", "--porcelain=v1")
    const index = readFileSync(path.join(root, ".git/index"))
    await snap(root)
    expect(git("status", "--porcelain=v1")).toBe(status)
    expect(readFileSync(path.join(root, ".git/index")).equals(index)).toBe(true)
  })

  test("takes tracked and untracked files, leaves ignored ones out, and names the same content the same way", async () => {
    const { root, write } = repo({ "a.ts": "1\n", ".gitignore": "*.log\nnode_modules\n" })
    const clean = await snap(root)
    expect(clean.tree).toBe(clean.headTree!)
    write("debug.log", "noise")
    expect((await snap(root)).tree).toBe(clean.tree)
    write("b.ts", "b\n")
    const edited = await snap(root)
    expect(edited.tree).not.toBe(clean.tree)
    expect(await run(RiftWorkspace.changed(root, clean.tree, edited.tree))).toEqual(["b.ts"])
    expect((await snap(root)).tree).toBe(edited.tree)
  })

  test("undoing an edit gives back the same tree, and editing an already-dirty file is still a change", async () => {
    const { root, write } = repo()
    write("a.ts", "dirty\n")
    const before = await snap(root)
    write("a.ts", "dirtier\n")
    const after = await snap(root)
    expect(await run(RiftWorkspace.changed(root, before.tree, after.tree))).toEqual(["a.ts"])
    write("a.ts", "dirty\n")
    expect((await snap(root)).tree).toBe(before.tree)
  })

  test("an edit that keeps the size and the timestamp git last saw is still seen", async () => {
    const { root, write, git } = repo({ "a.ts": "export const a = 1\n" })
    // An index entry and an index file stamped in the same second: git must read the file to trust it.
    const then = new Date(Math.floor(Date.now() / 1000) * 1000 - 100_000)
    utimesSync(path.join(root, "a.ts"), then, then)
    git("add", "a.ts")
    utimesSync(path.join(root, ".git/index"), then, then)
    write("a.ts", "export const a = 2\n")
    utimesSync(path.join(root, "a.ts"), then, then)
    const edited = await snap(root)
    expect(edited.tree).not.toBe(edited.headTree!)
    expect(await run(RiftWorkspace.changed(root, edited.headTree!, edited.tree))).toEqual(["a.ts"])
  })

  test("a project in a subdirectory of the repository is snapshotted on its own", async () => {
    const { root, write } = repo({ "app/a.ts": "1\n", "other/b.ts": "2\n" })
    const app = path.join(root, "app")
    const before = await snap(app)
    write("other/b.ts", "3\n")
    expect((await snap(app)).tree).toBe(before.tree)
    write("app/c.ts", "c\n")
    const after = await snap(app)
    expect(await run(RiftWorkspace.changed(app, before.tree, after.tree))).toEqual(["c.ts"])
    const tree = await run(RiftWorkspace.reader(app, after.tree))
    expect([...tree.files].sort()).toEqual(["a.ts", "c.ts"])
  })

  test("outside git there is no snapshot", async () => {
    expect(await run(RiftWorkspace.snapshot(temp()))).toBeUndefined()
  })

  test("a new file shows in the diff as an addition of its whole content", async () => {
    const { root, write } = repo()
    const before = await snap(root)
    write("t.test.ts", "it.skip('x', () => {})\n")
    const text = await run(RiftWorkspace.diff(root, before.tree, (await snap(root)).tree))
    expect(text).toContain("diff --git a/t.test.ts b/t.test.ts")
    expect(text).toContain("new file mode")
    expect(text).toContain("+it.skip('x', () => {})")
  })

  test("the reader lists the tree and reads manifests without copying the project", async () => {
    const { root } = repo({ "package.json": '{"scripts":{"test":"t"}}', "src/a.ts": "x" })
    const tree = await run(RiftWorkspace.reader(root, (await snap(root)).tree))
    expect([...tree.files].sort()).toEqual(["package.json", "src/a.ts"])
    expect(tree.read("package.json")).toBe('{"scripts":{"test":"t"}}')
    expect(tree.read("src/a.ts")).toBeUndefined()
    expect(tree.size("src/a.ts")).toBe(1)
  })
})

describe("RiftWorkspace.materialize", () => {
  test("a clean checkout has what git would commit and nothing ignored, and is gone when the scope closes", async () => {
    const { root, write } = repo({ "a.ts": "1\n", ".gitignore": "node_modules\n.env\n" })
    write("new.ts", "n\n")
    write(".env", "SECRET=1")
    write("node_modules/dep/index.js", "x")
    const tree = (await snap(root)).tree
    const seen = await run(
      Effect.scoped(
        Effect.gen(function* () {
          const dir = yield* RiftWorkspace.runDir(`test-${Date.now()}`)
          const workspace = yield* RiftWorkspace.materialize(root, tree, { kind: "clean" }, dir)
          return {
            dir: workspace.dir,
            files: ["a.ts", "new.ts", ".env", "node_modules"].map((name) => existsSync(path.join(workspace.dir, name))),
          }
        }),
      ),
    )
    expect(seen.files).toEqual([true, true, false, false])
    expect(existsSync(seen.dir)).toBe(false)
  })

  test("a snapshot checkout links the live dependency directories instead of installing", async () => {
    const { root, write } = repo({ "a.ts": "1\n", ".gitignore": "node_modules\n" })
    write("node_modules/dep/index.js", "x")
    const tree = (await snap(root)).tree
    const linked = await run(
      Effect.scoped(
        Effect.gen(function* () {
          const dir = yield* RiftWorkspace.runDir(`test-${Date.now()}`)
          const workspace = yield* RiftWorkspace.materialize(root, tree, { kind: "snapshot", live: root, links: ["node_modules"] }, dir)
          return lstatSync(path.join(workspace.dir, "node_modules")).isSymbolicLink()
        }),
      ),
    )
    expect(linked).toBe(true)
    expect(existsSync(path.join(root, "node_modules/dep/index.js"))).toBe(true)
  })
})

describe("RiftWorkspace.exec", () => {
  const workspace = (): RiftWorkspace.Workspace => ({ dir: temp(), tree: "t" as RiftWorkspace.TreeId, env: "clean" })

  test("reports real exit codes, output and failing tests, with CI set", async () => {
    const ws = workspace()
    expect((await run(RiftWorkspace.exec(ws, ".", "exit 0", {}, 30_000))).status).toBe("passed")
    const failed = await run(RiftWorkspace.exec(ws, ".", 'echo "(fail) adds [1ms]"; echo "CI=$CI"; exit 3', {}, 30_000))
    expect(failed.status).toBe("failed")
    expect(failed.tail).toContain("CI=1")
    expect(failed.failures).toEqual(["adds"])
    expect((await run(RiftWorkspace.exec(ws, ".", "echo $EXTRA", { EXTRA: "given" }, 30_000))).tail).toBe("given")
  })

  test("a timeout is its own status, and a missing tool is not run rather than failed", async () => {
    const ws = workspace()
    expect((await run(RiftWorkspace.exec(ws, ".", "sleep 10", {}, 50))).status).toBe("timed_out")
    const missing = await run(RiftWorkspace.exec(ws, ".", "definitely-not-a-tool --version", {}, 30_000))
    expect([missing.status, missing.reason]).toEqual(["not_run", "tool missing: definitely-not-a-tool"])
    const nowhere = await run(RiftWorkspace.exec(ws, "missing", "true", {}, 30_000))
    expect(nowhere.status).toBe("not_run")
  })

  test("the digest covers the whole output, not just the tail", async () => {
    const ws = workspace()
    const lines = (first: string) => `echo ${first}; for i in $(seq 1 100); do echo line $i; done; exit 1`
    const a = await run(RiftWorkspace.exec(ws, ".", lines("one"), {}, 30_000))
    const b = await run(RiftWorkspace.exec(ws, ".", lines("two"), {}, 30_000))
    expect(a.tail).toBe(b.tail)
    expect(a.digest).not.toBe(b.digest)
  })

  test("interrupting a stage kills its whole process group", async () => {
    const ws = workspace()
    const marker = path.join(ws.dir, "survived")
    const fiber = Effect.runFork(RiftWorkspace.exec(ws, ".", `(sleep 1; touch ${marker}) & sleep 1; touch ${marker}`, {}, 30_000))
    await new Promise((resolve) => setTimeout(resolve, 200))
    await Effect.runPromise(Fiber.interrupt(fiber))
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(existsSync(marker)).toBe(false)
  })
})

describe("RiftWorkspace.sweep", () => {
  test("removes run directories left by a process that is gone, and keeps live ones", async () => {
    const base = path.join(os.tmpdir(), "rift-verify")
    const dead = path.join(base, `dead-${Date.now()}`)
    mkdirSync(dead, { recursive: true })
    // A pid far above any real one on the test machine.
    writeFileSync(path.join(dead, "owner.json"), JSON.stringify({ pid: 2 ** 30, started: 0 }))
    const live = await run(
      Effect.scoped(
        Effect.gen(function* () {
          const dir = yield* RiftWorkspace.runDir(`live-${Date.now()}`)
          yield* RiftWorkspace.sweep()
          return existsSync(dir)
        }),
      ),
    )
    expect(live).toBe(true)
    expect(existsSync(dead)).toBe(false)
  })
})

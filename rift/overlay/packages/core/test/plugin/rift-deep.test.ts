import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { RiftDeep } from "../../src/plugin/rift-verify/deep.js"

const project = (source: string, tests: string) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rift-deep-"))
  const write = (name: string, text: string) => writeFileSync(path.join(root, name), text)
  write("m.ts", source)
  write("m.test.ts", `import { test, expect } from "bun:test"\nimport { f } from "./m"\n${tests}`)
  execFileSync("git", ["init", "-q"], { cwd: root })
  execFileSync("git", ["add", "-A"], { cwd: root })
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "i"], { cwd: root })
  return { root, write }
}

describe("RiftDeep", () => {
  test("reads failing test names from the common runners", () => {
    expect(RiftDeep.failures("(fail) adds [1.20ms]\n✕ subtracts 3ms\nFAILED t.py::a\n--- FAIL: TestB (0.1s)")).toEqual([
      "TestB",
      "adds",
      "subtracts",
      "t.py::a",
    ])
  })

  test("separates failures a change introduced from ones that were already there", () => {
    const run = (failures: string[]): RiftDeep.Run => ({ passed: failures.length === 0, failures, output: "" })
    expect(RiftDeep.compare(run(["old"]), run(["old", "new"]))).toEqual({
      introduced: ["new"],
      existing: ["old"],
      fixed: [],
      broken: false,
    })
    expect(RiftDeep.compare(run([]), { passed: false, failures: [], output: "crash" }).broken).toBe(true)
  })

  test("finds changed lines and leaves tests out", () => {
    const { root, write } = project("export const f = 1\nexport const g = 2\n", `test("t", () => expect(f).toBe(1))\n`)
    write("m.ts", "export const f = 1\nexport const g = 3\n")
    write("m.test.ts", "// changed\n")
    expect([...RiftDeep.changedLines(root)].map(([file, lines]) => [file, [...lines]])).toEqual([["m.ts", [2]]])
  })

  test("does not mutate text inside strings, or comments", () => {
    expect(RiftDeep.mutate("a", 1, `const s = "a === b"`)).toEqual([])
    expect(RiftDeep.mutate("a", 1, `// a === b`)).toEqual([])
    expect(RiftDeep.mutate("a", 1, `if (a === b) {`)[0]?.to).toBe(`if (a !== b) {`)
  })

  test("a test that pins the behaviour kills the mutant, and a thin one lets it survive", () => {
    const strong = project("export const f = (a: number) => a\n", `test("t", () => expect(f(2)).toBe(3))\n`)
    strong.write("m.ts", "export const f = (a: number) => a + 1\n")
    expect(RiftDeep.mutation(strong.root, "bun test").survivors).toEqual([])
    const thin = project("export const f = (a: number) => a\n", `test("t", () => expect(f(2)).toBeDefined())\n`)
    thin.write("m.ts", "export const f = (a: number) => a + 1\n")
    const report = RiftDeep.mutation(thin.root, "bun test")
    expect(report.total).toBeGreaterThan(0)
    expect(report.survivors).toHaveLength(report.total)
  })

  test("a suite that already fails does not make every mutant look caught", () => {
    const old = `test("old", () => expect(1).toBe(2))\n`
    const { root, write } = project("export const f = (a: number) => a\n", `test("t", () => expect(f).toBeDefined())\n${old}`)
    write("m.ts", "export const f = (a: number) => a + 1\n")
    const report = RiftDeep.mutation(root, "bun test")
    expect(report.total).toBeGreaterThan(0)
    expect(report.survivors).toHaveLength(report.total)
  })

  test("the user's files are untouched", () => {
    const { root, write } = project("export const f = 0\n", `test("t", () => expect(f).toBe(1))\n`)
    write("m.ts", "export const f = 1\n")
    RiftDeep.mutation(root, "bun test")
    expect(execFileSync("git", ["diff", "--stat"], { cwd: root, encoding: "utf8" })).toContain("m.ts")
    expect(RiftDeep.atHead(root, (dir) => RiftDeep.run("bun test", dir).passed)).toBe(false)
  })
})

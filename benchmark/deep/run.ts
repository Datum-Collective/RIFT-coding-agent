/** Scores each verification layer against changes whose truth is known. Run with `bun run benchmark/deep/run.ts`. */
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { RiftDeep } from "../../opencode/packages/core/src/plugin/rift-verify/deep.js"

type Case = { name: string; group: "bug-strong" | "bug-weak" | "ok-strong" | "ok-weak" | "ok-red"; before: string; after: string; test: string; testAfter?: string }
const T = (body: string) => `import { test, expect } from "bun:test"\nimport * as m from "./m"\n${body}\n`
const RED = `\ntest("unrelated old failure", () => expect(1).toBe(2))`
const cases: Case[] = [
  // Real bugs, and tests that pin the behaviour.
  { name: "clamp upper bound", group: "bug-strong", before: `export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))\n`, after: `export const clamp = (v: number, lo: number, hi: number) => Math.max(hi, Math.max(lo, v))\n`, test: T(`test("c", () => { expect(m.clamp(5, 0, 3)).toBe(3); expect(m.clamp(-1, 0, 3)).toBe(0) })`) },
  { name: "paging offset", group: "bug-strong", before: `export const offset = (page: number, size: number) => (page - 1) * size\n`, after: `export const offset = (page: number, size: number) => page * size\n`, test: T(`test("o", () => expect(m.offset(1, 10)).toBe(0))`) },
  { name: "discount sign", group: "bug-strong", before: `export const price = (p: number, d: number) => p - d\n`, after: `export const price = (p: number, d: number) => p + d\n`, test: T(`test("p", () => expect(m.price(10, 2)).toBe(8))`) },
  { name: "empty guard flipped", group: "bug-strong", before: `export const first = (a: number[]) => { if (a.length === 0) return undefined\n  return a[0] }\n`, after: `export const first = (a: number[]) => { if (a.length !== 0) return undefined\n  return a[0] }\n`, test: T(`test("f", () => expect(m.first([4])).toBe(4))`) },
  // Real bugs the tests cannot see.
  { name: "off by one at limit", group: "bug-weak", before: `export const ok = (n: number) => n < 10\n`, after: `export const ok = (n: number) => n <= 10\n`, test: T(`test("o", () => { expect(m.ok(1)).toBe(true); expect(m.ok(50)).toBe(false) })`) },
  { name: "retry never stops early", group: "bug-weak", before: `export const retries = (n: number) => n > 0 ? n : 0\n`, after: `export const retries = (n: number) => n > 0 ? n + 1 : 0\n`, test: T(`test("r", () => expect(m.retries(0)).toBe(0))`) },
  { name: "auth check weakened", group: "bug-weak", before: `export const allow = (admin: boolean, owner: boolean) => admin && owner\n`, after: `export const allow = (admin: boolean, owner: boolean) => admin || owner\n`, test: T(`test("a", () => { expect(m.allow(true, true)).toBe(true); expect(m.allow(false, false)).toBe(false) })`) },
  { name: "fee on wrong side", group: "bug-weak", before: `export const fee = (a: number) => a * 2\n`, after: `export const fee = (a: number) => a + 2\n`, test: T(`test("f", () => expect(m.fee(2)).toBe(4))`) },
  { name: "agent test only checks defined", group: "bug-weak", before: `export const avg = (a: number[]) => 0\n`, after: `export const avg = (a: number[]) => a.reduce((x, y) => x + y, 1) / a.length\n`, test: T(`test("a", () => expect(m.avg).toBeDefined())`), testAfter: T(`test("a", () => expect(m.avg([1, 2])).toBeDefined())`) },
  // Correct changes with strong tests.
  { name: "add tax", group: "ok-strong", before: `export const total = (a: number) => a\n`, after: `export const total = (a: number) => a * 2\n`, test: T(`test("t", () => expect(m.total(1)).toBe(1))`), testAfter: T(`test("t", () => { expect(m.total(1)).toBe(2); expect(m.total(3)).toBe(6) })`) },
  { name: "strict limit", group: "ok-strong", before: `export const ok = (n: number) => true\n`, after: `export const ok = (n: number) => n < 10\n`, test: T(`test("o", () => expect(m.ok(1)).toBe(true))`), testAfter: T(`test("o", () => { expect(m.ok(9)).toBe(true); expect(m.ok(10)).toBe(false) })`) },
  { name: "both flags", group: "ok-strong", before: `export const on = (a: boolean, b: boolean) => a\n`, after: `export const on = (a: boolean, b: boolean) => a && b\n`, test: T(`test("o", () => expect(m.on(true, true)).toBe(true))`), testAfter: T(`test("o", () => { expect(m.on(true, true)).toBe(true); expect(m.on(true, false)).toBe(false); expect(m.on(false, true)).toBe(false) })`) },
  { name: "guard", group: "ok-strong", before: `export const head = (a: number[]) => a[0]!\n`, after: `export const head = (a: number[]) => { if (a.length === 0) return -5\n  return a[0]! }\n`, test: T(`test("h", () => expect(m.head([1])).toBe(1))`), testAfter: T(`test("h", () => { expect(m.head([1])).toBe(1); expect(m.head([])).toBe(-5) })`) },
  // Correct changes with thin tests.
  { name: "correct but barely tested", group: "ok-weak", before: `export const dbl = (a: number) => a\n`, after: `export const dbl = (a: number) => a * 2\n`, test: T(`test("d", () => expect(m.dbl).toBeDefined())`) },
  { name: "correct limit, no boundary test", group: "ok-weak", before: `export const ok = (n: number) => true\n`, after: `export const ok = (n: number) => n < 10\n`, test: T(`test("o", () => expect(m.ok(1)).toBe(true))`), testAfter: T(`test("o", () => { expect(m.ok(1)).toBe(true); expect(m.ok(50)).toBe(false) })`) },
  { name: "correct and untested", group: "ok-weak", before: `export const a = 1\nexport const inc = (n: number) => n\n`, after: `export const a = 1\nexport const inc = (n: number) => n + 1\n`, test: T(`test("a", () => expect(m.a).toBe(1))`) },
  // Correct changes in a project that was already failing.
  { name: "already red, correct edit", group: "ok-red", before: `export const n = (a: number) => a\n`, after: `export const n = (a: number) => a * 2\n`, test: T(`test("n", () => expect(m.n(1)).toBe(1))${RED}`), testAfter: T(`test("n", () => { expect(m.n(1)).toBe(2); expect(m.n(2)).toBe(4) })${RED}`) },
  { name: "already red, new function", group: "ok-red", before: `export const a = 1\n`, after: `export const a = 1\nexport const sub = (x: number, y: number) => x - y\n`, test: T(`test("a", () => expect(m.a).toBe(1))${RED}`), testAfter: T(`test("a", () => expect(m.a).toBe(1))\ntest("s", () => { expect(m.sub(3, 1)).toBe(2); expect(m.sub(1, 3)).toBe(-2) })${RED}`) },
  { name: "already red, flag", group: "ok-red", before: `export const f = (a: boolean) => a\n`, after: `export const f = (a: boolean) => !a\n`, test: T(`test("f", () => expect(m.f(true)).toBe(true))${RED}`), testAfter: T(`test("f", () => { expect(m.f(true)).toBe(false); expect(m.f(false)).toBe(true) })${RED}`) },
  { name: "already red, but a real bug", group: "bug-strong", before: `export const g = (a: number) => a + 1\n`, after: `export const g = (a: number) => a - 1\n`, test: T(`test("g", () => expect(m.g(1)).toBe(2))${RED}`) },
]
const rows: any[] = []
for (const item of cases) {
  const root = mkdtempSync(path.join(os.tmpdir(), "rift-bench-"))
  const write = (name: string, text: string) => writeFileSync(path.join(root, name), text)
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root })
  write("m.ts", item.before); write("m.test.ts", item.test)
  git("init", "-q"); git("add", "-A"); git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "i")
  write("m.ts", item.after); if (item.testAfter) write("m.test.ts", item.testAfter)
  const started = Date.now()
  const after = RiftDeep.run("bun test", root)
  const basicMs = Date.now() - started
  const before = RiftDeep.atHead(root, (dir) => RiftDeep.run("bun test", dir))!
  const comparison = RiftDeep.compare(before, after)
  const differentialMs = Date.now() - started
  const mutated = RiftDeep.mutation(root, "bun test")
  rows.push({
    name: item.name, group: item.group, bug: item.group.startsWith("bug"),
    basic: !after.passed,
    differential: comparison.introduced.length > 0 || comparison.broken,
    mutants: mutated.total, survivors: mutated.survivors.length,
    thin: mutated.survivors.length > 0,
    basicMs, differentialMs, totalMs: Date.now() - started,
  })
  rmSync(root, { recursive: true, force: true })
}
const flag = (value: boolean) => (value ? "FLAG" : "-")
console.log("case".padEnd(34), "group".padEnd(11), "basic diff  mut (survived/total)  ms")
for (const row of rows) console.log(row.name.padEnd(34), row.group.padEnd(11), flag(row.basic).padEnd(5), flag(row.differential).padEnd(5), `${flag(row.thin).padEnd(5)}${row.survivors}/${row.mutants}`.padEnd(20), row.totalMs)
const score = (name: string, pick: (row: any) => boolean) => {
  const bugs = rows.filter((row) => row.bug), good = rows.filter((row) => !row.bug)
  console.log(`${name.padEnd(34)} bugs caught ${bugs.filter(pick).length}/${bugs.length}   false alarms ${good.filter(pick).length}/${good.length}`)
}
console.log()
score("basic (exit code)", (row) => row.basic)
score("before/after comparison", (row) => row.differential)
score("comparison + thin-test flag", (row) => row.differential || row.thin)
const avg = (key: string) => Math.round(rows.reduce((sum, row) => sum + row[key], 0) / rows.length)
console.log(`\nmean ms: basic ${avg("basicMs")}, +comparison ${avg("differentialMs")}, +mutation ${avg("totalMs")}`)
await Bun.write("benchmark/deep/results.json", JSON.stringify(rows, null, 2))

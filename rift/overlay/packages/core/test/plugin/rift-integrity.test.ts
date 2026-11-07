import { describe, expect, test } from "bun:test"
import { RiftChecks } from "../../src/plugin/rift-verify/checks.js"
import { RiftIntegrity } from "../../src/plugin/rift-verify/integrity.js"
import { RiftReceipt } from "../../src/plugin/rift-verify/receipt.js"

const diff = (path: string, body: string, header = "") =>
  `diff --git a/${path} b/${path}\n${header}--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n${body}`
const rules = (text: string) => RiftIntegrity.review(RiftIntegrity.parse(text)).map((f) => `${f.severity}:${f.rule}:${f.file}`)

describe("RiftIntegrity.parse", () => {
  test("reads statuses and added and removed lines", () => {
    const files = RiftIntegrity.parse(
      [
        diff("a.test.ts", "-expect(a).toBe(1)\n+expect(a).toBe(2)"),
        "diff --git a/gone.test.ts b/gone.test.ts\ndeleted file mode 100644\n--- a/gone.test.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-test('x', () => {})",
        "diff --git a/new.ts b/new.ts\nnew file mode 100644\n+export const n = 1",
      ].join("\n"),
    )
    expect(files.map((f) => [f.path, f.status, f.added.length, f.removed.length])).toEqual([
      ["a.test.ts", "modified", 1, 1],
      ["gone.test.ts", "deleted", 0, 1],
      ["new.ts", "added", 1, 0],
    ])
  })
  test("empty input is no files", () => expect(RiftIntegrity.parse("")).toEqual([]))
})

describe("RiftIntegrity.review", () => {
  test("a deleted test file blocks", () => {
    const text = "diff --git a/src/a.test.ts b/src/a.test.ts\ndeleted file mode 100644\n-test('x', () => {})"
    expect(rules(text)).toEqual(["block:deleted-test:src/a.test.ts"])
  })
  test("skipping a test blocks, across languages", () => {
    for (const [file, line] of [
      ["a.test.ts", "+it.skip('x', () => {})"],
      ["a.spec.js", "+xit('x', () => {})"],
      ["test_a.py", "+@pytest.mark.skip"],
      ["a_test.go", '+\tt.Skip("later")'],
      ["lib.rs_test.rs", "+#[ignore]"],
    ] as const)
      expect(rules(diff(file, line))).toEqual([`block:skipped-test:${file}`])
  })
  test("a focused test warns", () => expect(rules(diff("a.test.ts", "+it.only('x', () => {})"))).toEqual(["warn:focused-test:a.test.ts"]))
  test("taking assertions out of a test warns, adding as many does not", () => {
    expect(rules(diff("a.test.ts", "-expect(a).toBe(1)\n-expect(b).toBe(2)\n-expect(c).toBe(3)\n+expect(a).toBe(1)"))).toEqual([
      "warn:weakened-assertions:a.test.ts",
    ])
    expect(rules(diff("a.test.ts", "-expect(a).toBe(1)\n-expect(b).toBe(2)\n+expect(a).toBe(1)\n+expect(b).toBe(2)"))).toEqual([])
  })
  test("making a check always succeed blocks", () => {
    expect(rules(diff("package.json", '-    "test": "bun test",\n+    "test": "bun test || true",'))).toEqual(["block:forced-pass:package.json"])
    expect(rules(diff(".github/workflows/ci.yml", "+        continue-on-error: true"))).toEqual(["block:forced-pass:.github/workflows/ci.yml"])
    expect(rules(diff("package.json", '+    "test": "vitest --passWithNoTests",'))).toEqual(["block:forced-pass:package.json"])
  })
  test("a manifest change that is not a check script is ignored", () => {
    expect(rules(diff("package.json", '-  "version": "1.0.0",\n+  "version": "1.0.1",'))).toEqual([])
    expect(rules(diff("package.json", '+    "left-pad": "^1.3.0"'))).toEqual([])
  })
  test("turning off compiler strictness warns, other check config warns generically", () => {
    expect(rules(diff("tsconfig.json", '-    "strict": true,\n+    "strict": false,'))).toEqual(["warn:loosened-compiler:tsconfig.json"])
    expect(rules(diff("biome.json", '+  "rules": {}'))).toEqual(["warn:check-config:biome.json"])
  })
  test("suppressing errors in source warns", () => {
    expect(rules(diff("src/a.ts", "+// @ts-ignore\n+foo()"))).toEqual(["warn:suppression:src/a.ts"])
  })
  test("an ordinary change to source and tests says nothing", () => {
    expect(rules([diff("src/a.ts", "-const a = 1\n+const a = 2"), diff("src/a.test.ts", "-expect(a).toBe(1)\n+expect(a).toBe(2)")].join("\n"))).toEqual([])
  })
  test("only block findings count as tampering", () => {
    expect(RiftIntegrity.tampered(RiftIntegrity.review(RiftIntegrity.parse(diff("a.test.ts", "+it.only('x', () => {})"))))).toBe(false)
    expect(RiftIntegrity.tampered(RiftIntegrity.review(RiftIntegrity.parse(diff("a.test.ts", "+it.skip('x', () => {})"))))).toBe(true)
  })
  test("the report names the file, the rule and whether it blocks", () => {
    const text = RiftIntegrity.format(RiftIntegrity.review(RiftIntegrity.parse(diff("a.test.ts", "+it.skip('x', () => {})"))))
    expect(text).toContain("Test integrity")
    expect(text).toContain("BLOCKED: a.test.ts")
    expect(text).toContain("[skipped-test]")
    expect(RiftIntegrity.format([])).toBe("")
  })
})

const result = (status: RiftChecks.Status): RiftChecks.Result => ({ name: "t", command: "bun run test", dir: "/", status, ms: 5, output: "out" })

describe("RiftReceipt", () => {
  const seal = (status: RiftChecks.Status, prev?: string, findings: RiftIntegrity.Finding[] = []) =>
    RiftReceipt.sealChecks({ session: "s", root: "/nonexistent", files: ["b.ts", "a.ts"], results: [result(status)], findings, prev, now: new Date(0) })

  test("the verdict is never better than the evidence", () => {
    const block: RiftIntegrity.Finding = { severity: "block", rule: "skipped-test", file: "a.test.ts", detail: "x" }
    expect(RiftReceipt.verdict([result("passed")], [])).toBe("verified")
    expect(RiftReceipt.verdict([result("failed")], [])).toBe("failed")
    expect(RiftReceipt.verdict([result("timed_out")], [])).toBe("failed")
    expect(RiftReceipt.verdict([result("not_run")], [])).toBe("unproven")
    expect(RiftReceipt.verdict([], [])).toBe("unproven")
    expect(RiftReceipt.verdict([result("passed")], [block])).toBe("tampered")
    expect(RiftReceipt.verdict([result("failed")], [block])).toBe("failed")
  })
  test("the same inputs give the same digest, in sorted file order", () => {
    const a = seal("passed")
    expect(a.digest).toBe(seal("passed").digest)
    expect(a.files.map((f) => f.path)).toEqual(["a.ts", "b.ts"])
    expect(seal("failed").digest).not.toBe(a.digest)
  })
  test("a chain audits clean, and any edit, removal or reorder is found", () => {
    const one = seal("passed")
    const two = seal("passed", one.digest)
    const three = seal("failed", two.digest)
    expect(RiftReceipt.audit([one, two, three])).toBeUndefined()
    expect(RiftReceipt.audit([two, three])).toBeUndefined()
    expect(RiftReceipt.audit([one, three])).toContain("does not follow")
    expect(RiftReceipt.audit([one, { ...two, verdict: "verified", checks: [] }, three])).toContain("does not match its digest")
    expect(RiftReceipt.audit([two, one, three])).toContain("does not")
  })
  test("a changed check output changes the receipt", () => {
    const a = RiftReceipt.sealChecks({ session: "s", root: "/x", files: [], results: [{ ...result("passed"), output: "one" }], findings: [], now: new Date(0) })
    const b = RiftReceipt.sealChecks({ session: "s", root: "/x", files: [], results: [{ ...result("passed"), output: "two" }], findings: [], now: new Date(0) })
    expect(a.digest).not.toBe(b.digest)
  })
})

describe("RiftChecks.decide with tampering", () => {
  test("a pass that tampered is handled like a failure, until the rounds run out", () => {
    expect(RiftChecks.decide([result("passed")], 0, 3, true)).toEqual({ type: "fix" })
    expect(RiftChecks.decide([result("passed")], 3, 3, true)).toEqual({ type: "give_up" })
    expect(RiftChecks.decide([result("passed")], 0, 3)).toEqual({ type: "report" })
  })
})

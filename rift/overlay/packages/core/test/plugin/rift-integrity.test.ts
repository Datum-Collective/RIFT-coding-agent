import { describe, expect, test } from "bun:test"
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

const receipt = (status: "passed" | "failed", prev?: string, output = "out"): RiftReceipt.ReceiptV2 => ({
  version: 2,
  session: "s",
  run: "r",
  tier: "change",
  time: new Date(0).toISOString(),
  inputs: { tree: "t", files: [{ path: "a.ts", sha256: "x" }], lockfiles: [] },
  environment: { kind: "snapshot", platform: "test" },
  stages: [{ id: ".:test:test", kind: "test", command: "bun run test", status, attempts: [{ status, ms: 5, output }] }],
  integrity: [],
  verdict: status === "passed" ? "verified" : "regressed",
  prev,
})

describe("RiftReceipt", () => {
  const seal = (status: "passed" | "failed", prev?: string) => RiftReceipt.seal(receipt(status, prev))

  test("the same receipt always has the same digest, and a different one does not", () => {
    expect(seal("passed").digest).toBe(seal("passed").digest)
    expect(seal("failed").digest).not.toBe(seal("passed").digest)
  })
  test("a chain audits clean, and any edit, removal or reorder is found", () => {
    const one = seal("passed")
    const two = seal("passed", one.digest)
    const three = seal("failed", two.digest)
    expect(RiftReceipt.audit([one, two, three])).toBeUndefined()
    expect(RiftReceipt.audit([two, three])).toBeUndefined()
    expect(RiftReceipt.audit([one, three])).toContain("does not follow")
    expect(RiftReceipt.audit([one, { ...receipt("passed", one.digest), stages: [], digest: two.digest }, three])).toContain("does not match its digest")
    expect(RiftReceipt.audit([two, one, three])).toContain("does not")
  })
  test("a changed stage output changes the receipt", () => {
    expect(RiftReceipt.seal(receipt("passed", undefined, "one")).digest).not.toBe(RiftReceipt.seal(receipt("passed", undefined, "two")).digest)
  })
  test("receipts written before the pipeline still audit, in a chain with new ones", () => {
    const old: RiftReceipt.ReceiptV1 = {
      version: 1,
      session: "s",
      time: new Date(0).toISOString(),
      files: [{ path: "a.ts", sha256: "x" }],
      checks: [{ name: "test", command: "bun run test", status: "passed", ms: 5, output: "y" }],
      integrity: [],
      verdict: "verified",
    }
    const first = { ...old, digest: RiftReceipt.digest(old) }
    const next = seal("passed", first.digest)
    expect(RiftReceipt.audit([first, next])).toBeUndefined()
    expect(RiftReceipt.audit([{ ...first, verdict: "failed" }, next])).toContain("does not match its digest")
  })
})

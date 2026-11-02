export * as RiftIntegrity from "./integrity.js"

/**
 * Test integrity: did the agent make the checks pass by changing the checks instead of the code?
 *
 * A passing run proves little if the same edit also deleted the failing test, skipped it, took the assertion out,
 * or told the runner to exit 0. This reads the diff of what the agent changed and reports those moves. It works on
 * text, so it can be wrong in both directions: a `block` finding is something that is almost never a legitimate way
 * to get a green run, a `warn` is something worth a look. Neither is proof of intent.
 */

export type Severity = "block" | "warn"

export interface Finding {
  readonly severity: Severity
  readonly rule: string
  readonly file: string
  readonly detail: string
}

export interface FileDiff {
  readonly path: string
  readonly status: "modified" | "added" | "deleted"
  readonly added: readonly string[]
  readonly removed: readonly string[]
}

const TEST_FILE =
  /(^|\/)(__tests__|tests?|specs?)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py|rs)$|(^|\/)test_[^/]+\.py$|(Test|Tests|IT)\.(java|kt)$|(^|\/)[^/]*_spec\.rb$/i
const CONFIG_FILE =
  /(^|\/)(tsconfig[^/]*\.json|\.eslintrc[^/]*|eslint\.config\.[cm]?[jt]s|biome\.jsonc?|\.oxlintrc\.json|jest\.config\.[^/]+|vitest\.config\.[^/]+|bunfig\.toml|pytest\.ini|tox\.ini|setup\.cfg|\.golangci\.[^/]+|clippy\.toml|rustfmt\.toml|\.flake8|ruff\.toml)$|(^|\/)\.github\/workflows\//
// Manifests change all the time for dependencies. Only their check scripts matter here.
const MANIFEST = /(^|\/)(package\.json|pyproject\.toml|Makefile|justfile)$/
const SCRIPT_KEY = /^\s*"?(test|lint|typecheck|check|verify|ci|build)[\w:.-]*"?\s*[:=]/i

const SKIP =
  /\b(?:it|test|describe|context)\.(?:skip|todo|fixme)\b|\b(?:xit|xdescribe|xtest)\s*\(|@pytest\.mark\.(?:skip|xfail)|@unittest\.skip|\bpytest\.skip\s*\(|\bt\.Skip(?:f|Now)?\s*\(|#\[ignore\]|@Disabled\b|\bpending\s*(?:\(|$)/
const FOCUS = /\b(?:it|test|describe|context)\.only\s*\(|\bfit\s*\(|\bfdescribe\s*\(/
const ASSERT = /\b(?:expect|assert\w*|should|require\.\w+|ok)\s*[.(]|\bt\.(?:Error|Fatal)f?\s*\(|\bassert!?\s*\(|\bself\.assert\w*/
const FORCED = /\|\|\s*true\b|;\s*true\s*$|\bexit\s+0\b|--passWithNoTests|--allow-empty|continue-on-error\s*:\s*true|--no-verify|-\s*run\s*:\s*['"]?(?:true|echo)\b/
const LOOSENED = /"(?:strict|noImplicitAny|strictNullChecks|noUncheckedIndexedAccess)"\s*:\s*false/
const SUPPRESS = /@ts-(?:ignore|nocheck)|eslint-disable|biome-ignore|#\s*type:\s*ignore|#\s*noqa|\/\/\s*nolint|#!?\[allow\(|@SuppressWarnings/

const MAX_FINDINGS = 20

/** Reads `git diff --unified=0` into files with their added and removed lines. */
export const parse = (diff: string): FileDiff[] => {
  const files: { path: string; status: FileDiff["status"]; added: string[]; removed: string[] }[] = []
  let current: (typeof files)[number] | undefined
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
      current = { path: match?.[2] ?? "", status: "modified", added: [], removed: [] }
      files.push(current)
    } else if (!current) continue
    else if (line.startsWith("deleted file mode")) current.status = "deleted"
    else if (line.startsWith("new file mode")) current.status = "added"
    else if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue
    else if (line.startsWith("+")) current.added.push(line.slice(1))
    else if (line.startsWith("-")) current.removed.push(line.slice(1))
  }
  return files.filter((file) => file.path !== "")
}

const count = (lines: readonly string[], pattern: RegExp) => lines.filter((line) => pattern.test(line)).length

export const isTest = (file: string) => TEST_FILE.test(file)

export const review = (diffs: readonly FileDiff[]): Finding[] => {
  const findings: Finding[] = []
  const add = (severity: Severity, rule: string, file: string, detail: string) =>
    findings.push({ severity, rule, file, detail })

  for (const file of diffs) {
    if (isTest(file.path)) {
      if (file.status === "deleted") {
        add("block", "deleted-test", file.path, "the test file was deleted")
        continue
      }
      const skipped = count(file.added, SKIP)
      if (skipped > 0) add("block", "skipped-test", file.path, `${skipped} test${skipped > 1 ? "s" : ""} skipped or marked expected to fail`)
      const focused = count(file.added, FOCUS)
      if (focused > 0) add("warn", "focused-test", file.path, "`.only` runs this test and silently skips the rest of the suite")
      const removed = count(file.removed, ASSERT)
      const added = count(file.added, ASSERT)
      if (file.status === "modified" && removed - added >= 2)
        add("warn", "weakened-assertions", file.path, `${removed} assertions removed, ${added} added`)
      continue
    }

    if (CONFIG_FILE.test(file.path) || MANIFEST.test(file.path)) {
      const manifest = MANIFEST.test(file.path)
      const changed = [...file.added, ...file.removed].filter((line) => (manifest ? SCRIPT_KEY.test(line) : true))
      if (changed.length === 0) continue
      const forced = file.added.filter((line) => FORCED.test(line))
      if (forced.length > 0)
        add("block", "forced-pass", file.path, `a check was made to always succeed: ${forced[0]!.trim().slice(0, 80)}`)
      else if (file.status === "deleted") add("block", "deleted-check-config", file.path, "a check configuration was deleted")
      else if (file.added.some((line) => LOOSENED.test(line)))
        add("warn", "loosened-compiler", file.path, "a strictness option was turned off")
      else add("warn", "check-config", file.path, `${changed.length} line${changed.length > 1 ? "s" : ""} of check configuration changed`)
      continue
    }

    const suppressed = count(file.added, SUPPRESS)
    if (suppressed > 0) add("warn", "suppression", file.path, `${suppressed} lint or type error${suppressed > 1 ? "s" : ""} suppressed`)
  }
  return findings.slice(0, MAX_FINDINGS)
}

export const tampered = (findings: readonly Finding[]) => findings.some((finding) => finding.severity === "block")

export const format = (findings: readonly Finding[]) =>
  findings.length === 0
    ? ""
    : [
        "Test integrity",
        ...findings.map((finding) => `- ${finding.severity === "block" ? "BLOCKED" : "check"}: ${finding.file}: ${finding.detail} [${finding.rule}]`),
      ].join("\n")

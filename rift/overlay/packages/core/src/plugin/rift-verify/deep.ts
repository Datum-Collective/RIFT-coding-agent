export * as RiftDeep from "./deep.js"

import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const TEST = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[^/]+$/

export interface Run {
  readonly passed: boolean
  readonly failures: readonly string[]
  readonly output: string
}

/** Test names from the common runners, so one failing test is not mistaken for another. */
export const failures = (output: string) => {
  const names = new Set<string>()
  for (const line of output.split("\n")) {
    const match =
      line.match(/^\(fail\) (.+?)(?: \[[\d.]+ms\])?$/) ?? // bun
      line.match(/^\s*(?:✕|×|FAIL)\s+(.+?)(?: \d+ms)?$/) ?? // jest, vitest
      line.match(/^FAILED (\S+)/) ?? // pytest
      line.match(/^--- FAIL: (\S+)/) // go
    if (match) names.add(match[1]!)
  }
  return [...names].sort()
}

export const run = (command: string, dir: string, timeoutMs = 60_000): Run => {
  const result = spawnSync(process.env.SHELL ?? "sh", ["-c", command], {
    cwd: dir,
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, CI: "1" },
  })
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
  return { passed: result.status === 0, failures: failures(output), output }
}

export interface Comparison {
  /** Fails after the change and did not fail before it. Only these count against the change. */
  readonly introduced: readonly string[]
  /** Failed before the change too. */
  readonly existing: readonly string[]
  readonly fixed: readonly string[]
  /** The run failed in a way no test name explains, such as a crash at startup. */
  readonly broken: boolean
}

export const compare = (before: Run, after: Run): Comparison => {
  const old = new Set(before.failures)
  const now = new Set(after.failures)
  return {
    introduced: after.failures.filter((name) => !old.has(name)),
    existing: after.failures.filter((name) => old.has(name)),
    fixed: before.failures.filter((name) => !now.has(name)),
    broken: !after.passed && after.failures.length === 0 && before.passed,
  }
}

const git = (dir: string, args: string[]) => {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  return result.status === 0 ? result.stdout : undefined
}

const link = (from: string, to: string) => {
  const modules = path.join(from, "node_modules")
  if (existsSync(modules) && !existsSync(path.join(to, "node_modules"))) symlinkSync(modules, path.join(to, "node_modules"))
}

/** Runs `use` on a clean copy of HEAD, so a comparison never touches the user's working tree. */
export const atHead = <T>(root: string, use: (dir: string) => T) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rift-head-"))
  try {
    const archive = spawnSync("git", ["archive", "--format=tar", "HEAD"], { cwd: root, maxBuffer: 1024 * 1024 * 1024 })
    if (archive.status !== 0) return undefined
    spawnSync("tar", ["-x", "-C", dir], { input: archive.stdout })
    link(root, dir)
    return use(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Lines the working tree adds or changes against HEAD, per file. Untracked files count in full. */
export const changedLines = (root: string) => {
  const lines = new Map<string, Set<number>>()
  const add = (file: string, line: number) => {
    if (!SOURCE.test(file) || TEST.test(file)) return
    if (!lines.has(file)) lines.set(file, new Set())
    lines.get(file)!.add(line)
  }
  let current: string | undefined
  for (const line of (git(root, ["diff", "-U0", "HEAD"]) ?? "").split("\n")) {
    if (line.startsWith("+++ ")) current = line.startsWith("+++ b/") ? line.slice(6) : undefined
    const hunk = line.match(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/)
    if (!hunk || !current) continue
    const count = hunk[2] === undefined ? 1 : Number(hunk[2])
    for (let index = 0; index < count; index++) add(current, Number(hunk[1]) + index)
  }
  for (const file of (git(root, ["ls-files", "--others", "--exclude-standard"]) ?? "").split("\n").filter(Boolean)) {
    if (!SOURCE.test(file)) continue
    readFileSync(path.join(root, file), "utf8")
      .split("\n")
      .forEach((_, index) => add(file, index + 1))
  }
  return lines
}

export interface Mutant {
  readonly file: string
  readonly line: number
  readonly from: string
  readonly to: string
}

const OPERATORS: readonly (readonly [RegExp, string])[] = [
  [/===/, "!=="],
  [/!==/, "==="],
  [/<=/, "<"],
  [/>=/, ">"],
  [/(?<![=<>!-])>(?![=>])/, ">="],
  [/(?<![<=])<(?![=<])/, "<="],
  [/&&/, "||"],
  [/\|\|/, "&&"],
  [/ \+ /, " - "],
  [/ - /, " + "],
  [/ \* /, " / "],
  [/ \/ /, " * "],
  [/\btrue\b/, "false"],
  [/\bfalse\b/, "true"],
  [/\b1\b/, "2"],
  [/\b0\b/, "1"],
]

const comment = (line: string) => /^\s*(\/\/|\*|\/\*|import\b|export \* )/.test(line)

/** Small deliberate breaks in one line: a test that protects the line should notice each of them. */
export const mutate = (file: string, line: number, source: string): Mutant[] => {
  if (comment(source)) return []
  const code = source.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, (text) => " ".repeat(text.length))
  const found: Mutant[] = []
  for (const [pattern, replacement] of OPERATORS) {
    const match = code.match(pattern)
    if (match?.index === undefined) continue
    const to = source.slice(0, match.index) + replacement + source.slice(match.index + match[0].length)
    found.push({ file, line, from: source, to })
  }
  return found
}

export interface MutationReport {
  readonly total: number
  readonly killed: number
  readonly survivors: readonly Mutant[]
}

/**
 * Breaks each changed line on a private copy and runs the tests. A mutant that survives is changed behaviour
 * no test can see. It means the tests are thin there, not that the code is wrong.
 */
export const mutation = (root: string, command: string, limit = 40): MutationReport => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rift-mutants-"))
  try {
    cpSync(root, dir, { recursive: true, filter: (from) => !/(^|\/)(\.git|node_modules)(\/|$)/.test(path.relative(root, from)) })
    link(root, dir)
    const mutants: Mutant[] = []
    for (const [file, lines] of changedLines(root)) {
      const text = readFileSync(path.join(root, file), "utf8").split("\n")
      for (const line of [...lines].sort((a, b) => a - b)) {
        const source = text[line - 1]
        if (source !== undefined) mutants.push(...mutate(file, line, source))
      }
    }
    const chosen = mutants.slice(0, limit)
    const survivors: Mutant[] = []
    // A suite that already fails fails for every mutant too, so a mutant only counts as caught by a new failure.
    const clean = run(command, dir)
    for (const mutant of chosen) {
      const target = path.join(dir, mutant.file)
      const original = readFileSync(target, "utf8")
      const lines = original.split("\n")
      lines[mutant.line - 1] = mutant.to
      writeFileSync(target, lines.join("\n"))
      const comparison = compare(clean, run(command, dir))
      if (comparison.introduced.length === 0 && !comparison.broken) survivors.push(mutant)
      writeFileSync(target, original)
    }
    return { total: chosen.length, killed: chosen.length - survivors.length, survivors }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export * as RiftMutation from "./mutation.js"

import { RiftIntegrity } from "./integrity.js"

/** Languages the operator table understands. */
const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|go|rs)$/
/** Code in other languages: said in the report rather than silently left out. */
const OTHER = /\.(py|rb|java|kt|kts|scala|php|cs|swift|c|cc|cpp|h|hpp|ex|exs)$/

export interface Mutant {
  readonly file: string
  readonly line: number
  readonly from: string
  readonly to: string
}

export interface Report {
  readonly total: number
  readonly killed: number
  readonly survivors: readonly Mutant[]
  /** Changed files in languages the operator table does not cover. */
  readonly unsupported: readonly string[]
}

const OPERATORS: readonly (readonly [RegExp, string])[] = [
  [/===/, "!=="],
  [/!==/, "==="],
  [/(?<![=!<>])==(?!=)/, "!="],
  [/!=(?!=)/, "=="],
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

const comment = (line: string) => /^\s*(\/\/|\*|\/\*|import\b|export \* |package\b|use\b)/.test(line)

/** Small deliberate breaks in one line: a test that protects the line should notice each of them. */
export const mutate = (file: string, line: number, source: string): Mutant[] => {
  if (comment(source)) return []
  // Text inside strings is blanked so an operator in a message is never mutated.
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

/** Lines the diff adds or changes, per file, read from `git diff --unified=0`. */
export const changed = (diff: string) => {
  const lines = new Map<string, number[]>()
  let current: string | undefined
  for (const text of diff.split("\n")) {
    if (text.startsWith("+++ ")) current = text.startsWith("+++ b/") ? text.slice(6) : undefined
    const hunk = text.match(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/)
    if (!hunk || !current) continue
    const count = hunk[2] === undefined ? 1 : Number(hunk[2])
    const list = lines.get(current) ?? []
    for (let index = 0; index < count; index++) list.push(Number(hunk[1]) + index)
    lines.set(current, list)
  }
  return lines
}

/**
 * Mutants on the changed lines of non-test files, taken round-robin across files so one big file cannot use the
 * whole budget.
 */
export const mutants = (diff: string, read: (file: string) => string | undefined, limit: number) => {
  const unsupported: string[] = []
  const perFile: Mutant[][] = []
  for (const [file, lines] of changed(diff)) {
    if (RiftIntegrity.isTest(file)) continue
    if (!SOURCE.test(file)) {
      if (OTHER.test(file)) unsupported.push(file)
      continue
    }
    const text = read(file)?.split("\n")
    if (!text) continue
    perFile.push(lines.flatMap((line) => (text[line - 1] === undefined ? [] : mutate(file, line, text[line - 1]!))))
  }
  const chosen: Mutant[] = []
  for (let round = 0; chosen.length < limit && perFile.some((list) => list.length > round); round++)
    for (const list of perFile) if (list[round] && chosen.length < limit) chosen.push(list[round]!)
  return { mutants: chosen, unsupported: unsupported.sort() }
}

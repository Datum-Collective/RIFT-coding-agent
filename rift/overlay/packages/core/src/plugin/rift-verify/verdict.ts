export * as RiftVerdict from "./verdict.js"

import type { RiftIntegrity } from "./integrity.js"
import type { RiftMutation } from "./mutation.js"
import type { RiftStages } from "./stages.js"

export type NonEmpty<T> = readonly [T, ...T[]]

export interface Attempt {
  readonly status: "passed" | "failed" | "timed_out" | "not_run"
  readonly ms: number
  /** The last lines of the output, for the report. */
  readonly tail: string
  /** sha256 of the full output, so a receipt covers more than the tail. */
  readonly digest: string
  readonly reason?: string
  /** Failing test names the output gave. Empty when it names none. */
  readonly failures: readonly string[]
}

/** Test names from the common runners, so one failing test is not mistaken for another. */
export const failures = (output: string) => {
  const names = new Set<string>()
  for (const line of output.split("\n")) {
    const match =
      line.match(/^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/) ?? // bun
      line.match(/^\s*(?:✕|×|FAIL)\s+(.+?)(?: \d+ms)?$/) ?? // jest, vitest
      line.match(/^FAILED (\S+)/) ?? // pytest
      line.match(/^--- FAIL: (\S+)/) ?? // go
      line.match(/^test (\S+) \.\.\. FAILED$/) // cargo
    if (match) names.add(match[1]!)
  }
  return [...names].sort()
}

/** A failed or timed-out stage after its reruns, before the baseline is consulted. */
export interface Broken {
  readonly status: "failed" | "timed_out"
  readonly attempts: NonEmpty<Attempt>
  /** Failed in every attempt. */
  readonly tests: readonly string[]
  /** Failed in some attempts and not others: reported, never counted. */
  readonly flaky: readonly string[]
}

export type Attribution =
  /** Fails here and not at the baseline, or the named failures are new. */
  | { readonly kind: "introduced"; readonly tests: readonly string[] }
  /** Fails the same way at the baseline. Not the change's doing. */
  | { readonly kind: "preexisting"; readonly tests: readonly string[] }
  | { readonly kind: "mixed"; readonly introduced: readonly string[]; readonly preexisting: readonly string[] }
  /** The baseline could not settle it. Counted against the change, since only a baseline can clear it. */
  | { readonly kind: "unknown"; readonly reason: string }
  /** The candidate is the baseline (a clean tree), so there is nothing to compare. */
  | { readonly kind: "unchanged" }

export type Outcome =
  | { readonly status: "passed"; readonly attempts: NonEmpty<Attempt> }
  /** Failed, then passed on the same code. Not a pass and not a regression. */
  | { readonly status: "flaky"; readonly attempts: NonEmpty<Attempt>; readonly tests: readonly string[] }
  | (Broken & { readonly attribution: Attribution })
  /** A stage it needs did not pass. */
  | { readonly status: "skipped"; readonly because: NonEmpty<RiftStages.StageId> }
  /** Declined, denied by a rule, cancelled, or the tool is missing. Never a pass. */
  | { readonly status: "not_run"; readonly reason: string }

export type Settled = Exclude<Outcome, { readonly status: "failed" | "timed_out" | "skipped" }> | Broken

export const broken = <T extends Settled | Outcome>(outcome: T): outcome is Extract<T, Broken> =>
  outcome.status === "failed" || outcome.status === "timed_out"

/** Whether a stage gets another attempt: a rerunnable kind whose last attempt failed, under the tier's cap. */
export const again = (stage: RiftStages.Stage, attempts: readonly Attempt[], max: number) =>
  stage.rerun && attempts.length < max && attempts.at(-1)?.status === "failed"

/** Folds attempts into passed, flaky, not run, or broken with the tests that failed every time. */
export const settle = (attempts: NonEmpty<Attempt>): Settled => {
  const last = attempts[attempts.length - 1]!
  if (last.status === "not_run") return { status: "not_run", reason: last.reason ?? "did not run" }
  const failed = attempts.filter((attempt) => attempt.status === "failed" || attempt.status === "timed_out")
  const some = [...new Set(failed.flatMap((attempt) => attempt.failures))].sort()
  if (failed.length === 0) return { status: "passed", attempts }
  if (failed.length < attempts.length) return { status: "flaky", attempts, tests: some }
  const every = some.filter((name) => failed.every((attempt) => attempt.failures.includes(name)))
  return {
    status: last.status as Broken["status"],
    attempts,
    tests: every,
    flaky: some.filter((name) => !every.includes(name)),
  }
}

const split = (tests: readonly string[], before: readonly string[]): Attribution => {
  const old = new Set(before)
  const introduced = tests.filter((name) => !old.has(name))
  const preexisting = tests.filter((name) => old.has(name))
  if (introduced.length === 0) return { kind: "preexisting", tests: preexisting }
  if (preexisting.length === 0) return { kind: "introduced", tests: introduced }
  return { kind: "mixed", introduced, preexisting }
}

/**
 * SWE-bench's split: compare the candidate's consistent failures with the baseline's outcome for the same stage.
 * `absent`: the baseline has no such stage, so everything it reports is new.
 */
export const attribute = (candidate: Broken, baseline: Settled | "absent" | "unchanged"): Attribution => {
  if (baseline === "unchanged") return { kind: "unchanged" }
  if (baseline === "absent") return { kind: "introduced", tests: candidate.tests }
  if (baseline.status === "not_run") return { kind: "unknown", reason: `it did not run at the baseline: ${baseline.reason}` }
  if (baseline.status === "passed") return { kind: "introduced", tests: candidate.tests }
  if (baseline.status === "flaky") return split(candidate.tests, baseline.tests)
  const before = [...baseline.tests, ...baseline.flaky]
  // A failure that names no tests (a crash, a compile error) can only be compared by status.
  if (candidate.tests.length === 0) return before.length === 0 ? { kind: "preexisting", tests: [] } : { kind: "introduced", tests: [] }
  if (before.length === 0) return { kind: "unknown", reason: "the baseline failed without naming tests" }
  return split(candidate.tests, before)
}

export type Verdict = "verified" | "regressed" | "failing" | "unproven" | "tampered"

const NOT_RUN: Outcome = { status: "not_run", reason: "did not run" }
export const outcome = (outcomes: ReadonlyMap<RiftStages.StageId, Outcome>, stage: RiftStages.Stage) =>
  outcomes.get(stage.id) ?? NOT_RUN

/**
 * One function decides the verdict for both tiers, first match wins: tampered (an integrity block) > regressed
 * (a broken stage attributed introduced, mixed or unknown) > failing (broken, all already failing) > unproven
 * (nothing ran, anything not run, skipped or flaky, no test stage when the tier needs one, or added code with no
 * test in the change) > verified.
 */
export const judge = (
  plan: RiftStages.Plan,
  outcomes: ReadonlyMap<RiftStages.StageId, Outcome>,
  findings: readonly RiftIntegrity.Finding[],
  needsTest: boolean,
): Verdict => {
  const all = plan.stages.map((stage) => outcome(outcomes, stage))
  if (findings.some((finding) => finding.severity === "block")) return "tampered"
  const failed = all.filter(broken)
  if (failed.some((item) => ["introduced", "mixed", "unknown"].includes(item.attribution.kind))) return "regressed"
  if (failed.length > 0) return "failing"
  if (all.length === 0 || all.some((item) => item.status !== "passed")) return "unproven"
  if (needsTest && !plan.stages.some((stage) => stage.kind === "test" || stage.kind === "e2e")) return "unproven"
  // Everything that ran passed, but a gap is code nothing exercises: passing says nothing about it.
  if (findings.some((finding) => finding.severity === "gap")) return "unproven"
  return "verified"
}

export type Decision =
  | { readonly type: "report" }
  /** Hand the failures back to the agent in the same run. */
  | { readonly type: "fix" }
  /** The rounds ran out: tell the user the work is not proven and stop. */
  | { readonly type: "give_up" }

const FIXABLE: ReadonlySet<Verdict> = new Set(["tampered", "regressed", "failing"])

/** Anything broken goes back to the agent, until the rounds run out. Unproven work is reported, never sent back. */
export const decide = (verdict: Verdict, round: number, maxRounds: number): Decision => {
  if (!FIXABLE.has(verdict)) return { type: "report" }
  return round < maxRounds ? { type: "fix" } : { type: "give_up" }
}

export const fixable = (verdict: Verdict) => FIXABLE.has(verdict)

export interface Summary {
  readonly verdict: Verdict
  readonly plan: RiftStages.Plan
  readonly outcomes: ReadonlyMap<RiftStages.StageId, Outcome>
  /** What failures were compared with: "HEAD", "the start of this prompt". */
  readonly against: string
  /** Where the commands ran: "a clean checkout", "a snapshot of the working tree". */
  readonly where: string
  readonly mutation?: RiftMutation.Report
  readonly findings: readonly RiftIntegrity.Finding[]
  /** Other sections, such as the engineering graph, already formatted. */
  readonly sections?: readonly string[]
  readonly receipt: string
}

const MARK: Record<Outcome["status"], string> = {
  passed: "ok",
  flaky: "FLAKY",
  failed: "FAILED",
  timed_out: "TIMED OUT",
  skipped: "SKIPPED",
  not_run: "NOT RUN",
}

const list = (names: readonly string[]) => names.join(", ")

const blame = (attribution: Attribution, against: string): string[] => {
  switch (attribution.kind) {
    case "introduced":
      return [attribution.tests.length > 0 ? `new, not failing at ${against}: ${list(attribution.tests)}` : `new, not failing at ${against}`]
    case "preexisting":
      return [attribution.tests.length > 0 ? `already failing at ${against}: ${list(attribution.tests)}` : `already failing at ${against}`]
    case "mixed":
      return [`new, not failing at ${against}: ${list(attribution.introduced)}`, `already failing at ${against}: ${list(attribution.preexisting)}`]
    case "unknown":
      return [`not compared with ${against}: ${attribution.reason}`]
    case "unchanged":
      return [`no changes from ${against}, so it already fails there`]
  }
}

const line = (stage: RiftStages.Stage, result: Outcome, plan: RiftStages.Plan) => {
  const command = stage.command
  if (result.status === "skipped") {
    const waits = result.because.map((id) => plan.stages.find((item) => item.id === id)?.command ?? id)
    return `- ${MARK.skipped}: ${command} (waits on ${list(waits)})`
  }
  if (result.status === "not_run") return `- ${MARK.not_run}: ${command} (${result.reason})`
  const ms = result.attempts.reduce((sum, attempt) => sum + attempt.ms, 0)
  const tries = result.attempts.length > 1 ? `${result.attempts.length} attempts, ` : ""
  return `- ${MARK[result.status]}: ${command} [${tries}${ms} ms]`
}

/** The model's text: verdict, every stage with what it means, what is not covered, mutants, integrity, receipt. */
export const format = (summary: Summary) => {
  const { plan, outcomes, against } = summary
  const stages = plan.stages.map((stage) => {
    const result = outcome(outcomes, stage)
    const head = line(stage, result, plan)
    if (result.status === "flaky") return [head, `  failed, then passed on the same code: ${list(result.tests) || "no test named"}`].join("\n")
    if (!broken(result)) return head
    return [
      head,
      ...blame(result.attribution, against).map((text) => `  ${text}`),
      ...(result.flaky.length > 0 ? [`  flaky, failed only sometimes: ${list(result.flaky)}`] : []),
      result.attempts[result.attempts.length - 1]!.tail,
    ].join("\n")
  })
  const mutation = summary.mutation
  return [
    [`RIFT verification: ${summary.verdict.toUpperCase()} (${summary.where}, compared with ${against})`, ...stages].join("\n"),
    plan.uncovered.length > 0
      ? ["Not covered, so not verified:", ...plan.uncovered.map((item) => `- ${item.path} (${item.why})`)].join("\n")
      : "",
    plan.notes.length > 0 ? ["Notes:", ...plan.notes.map((note) => `- ${note}`)].join("\n") : "",
    mutation && mutation.total > 0
      ? [
          `Mutation testing: ${mutation.killed} of ${mutation.total} small changes to the changed lines were caught by a test.`,
          ...(mutation.survivors.length > 0 ? ["No test notices these:"] : []),
          ...mutation.survivors.map((item) => `- ${item.file}:${item.line} \`${item.from.trim()}\` -> \`${item.to.trim()}\``),
        ].join("\n")
      : "",
    mutation && mutation.unsupported.length > 0 ? `Mutation testing does not cover: ${list(mutation.unsupported)}` : "",
    ...(summary.sections ?? []),
    findingsText(summary.findings),
    `Receipt ${summary.receipt.slice(0, 12)}: ${summary.verdict}`,
  ]
    .filter(Boolean)
    .join("\n\n")
}

const findingsText = (findings: readonly RiftIntegrity.Finding[]) =>
  findings.length === 0
    ? ""
    : [
        "Test integrity",
        ...findings.map((finding) => `- ${finding.severity === "block" ? "BLOCKED" : finding.severity === "gap" ? "NOT TESTED" : "check"}: ${finding.file}: ${finding.detail} [${finding.rule}]`),
      ].join("\n")

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/** Failing tests per side: a stage that names none counts as one. */
export const counts = (attribution: Attribution, tests: readonly string[]) => {
  const one = (names: readonly string[]) => Math.max(1, names.length)
  switch (attribution.kind) {
    case "introduced":
    case "unknown":
      return { introduced: one(tests), preexisting: 0 }
    case "preexisting":
    case "unchanged":
      return { introduced: 0, preexisting: one(tests) }
    case "mixed":
      return { introduced: attribution.introduced.length, preexisting: attribution.preexisting.length }
  }
}

/** The notice row: "Verify: regressed · 2 new failures, 1 already failing at HEAD, 1 flaky, 12 passed · receipt 1a2b3c". */
export const headline = (summary: Summary) => {
  const all = summary.plan.stages.map((stage) => outcome(summary.outcomes, stage))
  let introduced = 0
  let preexisting = 0
  for (const result of all) {
    if (!broken(result)) continue
    const count = counts(result.attribution, result.tests)
    introduced += count.introduced
    preexisting += count.preexisting
  }
  const tally = (status: Outcome["status"]) => all.filter((result) => result.status === status).length
  const parts = [
    introduced > 0 ? plural(introduced, "new failure") : "",
    preexisting > 0 ? `${preexisting} already failing at ${summary.against}` : "",
    tally("flaky") > 0 ? `${tally("flaky")} flaky` : "",
    tally("passed") > 0 ? `${tally("passed")} passed` : "",
    tally("skipped") > 0 ? `${tally("skipped")} skipped` : "",
    tally("not_run") > 0 ? `${tally("not_run")} not run` : "",
  ].filter(Boolean)
  const uncovered = summary.plan.uncovered.length
  const verdict = uncovered > 0 ? `${summary.verdict} (${plural(uncovered, "area")} not covered)` : summary.verdict
  return [`Verify: ${verdict}`, parts.join(", "), `receipt ${summary.receipt.slice(0, 6)}`].filter(Boolean).join(" · ")
}

/** "No checks found. Looked for: package.json scripts, go.mod, ..." */
export const nothing = (looked: readonly string[]) => `No checks found. Looked for: ${list(looked)}.`

export * as RiftPipeline from "./pipeline.js"

import { createHash, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Agent } from "@opencode/schema/agent"
import type { Rift } from "@opencode/schema/rift"
import type { Session } from "@opencode/schema/session"
import { Cause, Effect, Exit, Option, Schema, Semaphore } from "effect"
import { Permission } from "../../permission.js"
import { RiftGraph } from "./graph.js"
import { RiftIntegrity } from "./integrity.js"
import { RiftMutation } from "./mutation.js"
import { RiftReceipt } from "./receipt.js"
import { RiftStages } from "./stages.js"
import { RiftVerdict } from "./verdict.js"
import { RiftWorkspace } from "./workspace.js"

export type Tier = "change" | "project"

interface Profile {
  readonly env: RiftWorkspace.Env["kind"]
  readonly kinds: ReadonlySet<RiftStages.Kind>
  /** Total attempts for a rerunnable stage, including the first. */
  readonly attempts: number
  readonly mutation: boolean
  /** Without a test stage a run proves nothing about behaviour. */
  readonly needsTest: boolean
  /** Graph checks to run: those without a proof for the current inputs, or every one. */
  readonly proofs: "due" | "all"
  readonly where: string
  readonly against: string
}

/** The only difference between the per-turn loop and /verify. */
export const TIERS: Readonly<Record<Tier, Profile>> = {
  change: {
    env: "snapshot",
    kinds: new Set<RiftStages.Kind>(["format", "lint", "typecheck", "test", "proof"]),
    attempts: 2,
    mutation: false,
    needsTest: false,
    proofs: "due",
    where: "a snapshot of the working tree",
    against: "the start of this prompt",
  },
  project: {
    env: "clean",
    kinds: new Set(RiftStages.KINDS),
    attempts: 3,
    mutation: true,
    needsTest: true,
    proofs: "all",
    where: "a clean checkout",
    against: "HEAD",
  },
}

export interface Request {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly tier: Tier
  readonly candidate: RiftWorkspace.Snapshot
  /** The tree the prompt started from (change), or HEAD's tree (project). Undefined: nothing to compare with. */
  readonly baseline?: RiftWorkspace.TreeId
  readonly scope: RiftStages.Scope
  /** Honoured only where the tier mutates. `/verify quick` turns it off. */
  readonly mutate: boolean
}

export interface Report {
  readonly verdict: RiftVerdict.Verdict
  readonly plan: RiftStages.Plan
  readonly outcomes: ReadonlyMap<RiftStages.StageId, RiftVerdict.Outcome>
  readonly mutation?: RiftMutation.Report
  readonly findings: readonly RiftIntegrity.Finding[]
  readonly sealed: RiftReceipt.Sealed
  readonly text: string
  readonly headline: string
}

export type Result = { readonly kind: "empty"; readonly looked: readonly string[] } | { readonly kind: "ran"; readonly report: Report }

/** The single writer of the receipt chain and the graph's proofs. The chain links each receipt to the last, so writes take one permit. */
export interface Ledger {
  readonly graph: (sessionID: string) => Effect.Effect<{ readonly nodes: readonly RiftGraph.Node[]; readonly proofs: readonly RiftGraph.Proof[] }>
  readonly writeGraph: (sessionID: string, nodes: readonly RiftGraph.Node[]) => Effect.Effect<void>
  readonly receipts: (sessionID: string) => Effect.Effect<readonly RiftReceipt.Sealed[]>
}

export interface Pipeline {
  /**
   * Plans from the candidate tree, asks once for every command, runs the stages in a private checkout with
   * reruns, compares each broken stage with the baseline, mutates changed lines, reviews integrity, judges,
   * seals a receipt and publishes progress for the tier. Interrupting it kills its processes and still seals an
   * unproven receipt. Never fails: a stage that cannot run is an outcome, not an error.
   */
  readonly run: (request: Request) => Effect.Effect<Result>
  readonly ledger: Ledger
}

export interface Deps {
  readonly root: string
  readonly storage: Pick<Context["storage"], "get" | "set">
  readonly permission: Pick<Permission.Interface, "assert" | "allows" | "assertNotDenied">
  readonly publish: (sessionID: Session.ID, tier: Tier, view: Rift.Run) => Effect.Effect<void>
}

export type Progress =
  | { readonly type: "planned"; readonly plan: RiftStages.Plan }
  | { readonly type: "asking" }
  | { readonly type: "started"; readonly stage: RiftStages.StageId; readonly attempt: number }
  | { readonly type: "finished"; readonly stage: RiftStages.StageId; readonly outcome: RiftVerdict.Outcome | RiftVerdict.Settled }
  | { readonly type: "comparing" }
  | { readonly type: "mutating"; readonly done: number; readonly total: number }
  | { readonly type: "done"; readonly at: number; readonly verdict: RiftVerdict.Verdict; readonly headline: string; readonly receipt: string; readonly notes?: readonly string[] }
  | { readonly type: "cancelled"; readonly at: number; readonly reason: string }

const MAX_RECEIPTS = 50
const MUTANTS = 40
const MUTATION_BUDGET_MS = 5 * 60 * 1000
const LOCKFILES = /(^|\/)(bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum|uv\.lock|poetry\.lock)$/
const LINKS = [...new Set(RiftStages.ECOSYSTEMS.flatMap((ecosystem) => ecosystem.links))]

const Saved = Schema.Struct({ nodes: Schema.Array(RiftGraph.Node), proofs: Schema.Array(RiftGraph.Proof) })
const decodeSaved = Schema.decodeUnknownOption(Saved)
// Storage holds JSON. This drops the undefined fields the type checker cannot rule out.
const json = (value: unknown) => JSON.parse(JSON.stringify(value))
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex")

type Skipped = Extract<RiftVerdict.Outcome, { readonly status: "skipped" }>
type Ran = RiftVerdict.Settled | Skipped
type Answer = { readonly ok: true } | { readonly ok: false; readonly reason: string }
type Grant = ReadonlyMap<string, Answer>
const OK: Answer = { ok: true }

type Active = Exclude<Rift.Run["phase"], "done" | "cancelled">
const ACTIVE: ReadonlySet<string> = new Set<Active>(["preparing", "asking", "running", "comparing", "mutating"])
const base = (view: Rift.Run) => ({ id: view.id, tree: view.tree, started: view.started, stages: view.stages })
const active = (view: Rift.Run): Active => (ACTIVE.has(view.phase) ? (view.phase as Active) : "running")

const EVIDENCE_LINES = 12
const EVIDENCE_CHARS = 900

/**
 * What the user can check a result against. A failure shows the end of the real output of its last attempt; a pass
 * shows how it ended and the digest of the full output, which the sealed receipt also holds.
 */
export const evidence = (outcome: RiftVerdict.Outcome | RiftVerdict.Settled): string | undefined => {
  if (outcome.status === "skipped" || outcome.status === "not_run") return undefined
  const last = outcome.attempts[outcome.attempts.length - 1]!
  if (outcome.status === "passed") return `exit 0 in ${(last.ms / 1000).toFixed(1)}s, output sha256 ${last.digest.slice(0, 12)}`
  const lines = last.tail.trimEnd().split("\n").slice(-EVIDENCE_LINES).join("\n")
  const text = lines.length > EVIDENCE_CHARS ? lines.slice(-EVIDENCE_CHARS) : lines
  return text.length > 0 ? text : undefined
}

/** The sidebar's view of one stage's outcome. */
const settled = (stage: Rift.Stage, outcome: RiftVerdict.Outcome | RiftVerdict.Settled): Rift.Stage => {
  const { id, unit, kind, command, why } = stage
  if (outcome.status === "skipped") return { id, unit, kind, command, why, status: "skipped", reason: "waits on a stage that did not pass" }
  if (outcome.status === "not_run") return { id, unit, kind, command, why, status: "not_run", reason: outcome.reason }
  const ms = outcome.attempts.reduce((sum, attempt) => sum + attempt.ms, 0)
  const counts = "attribution" in outcome ? RiftVerdict.counts(outcome.attribution, outcome.tests) : undefined
  return { id, unit, kind, command, why, status: outcome.status, attempt: outcome.attempts.length, ms, evidence: evidence(outcome), ...counts }
}

/** Pure reducer from engine events to the sidebar's view. */
export const step = (view: Rift.Run, event: Progress): Rift.Run => {
  const update = (id: string, change: (stage: Rift.Stage) => Rift.Stage) => view.stages.map((stage) => (stage.id === id ? change(stage) : stage))
  switch (event.type) {
    case "planned":
      return {
        ...base(view),
        phase: "running",
        stages: event.plan.stages.map((stage) => ({ id: stage.id, unit: stage.unit, kind: stage.kind, command: stage.command, why: RiftStages.why(stage.kind), status: "pending" as const })),
      }
    case "asking":
      return { ...base(view), phase: "asking" }
    case "started":
      return { ...base(view), phase: "running", stages: update(event.stage, (stage) => ({ ...stage, status: "running", attempt: event.attempt })) }
    case "finished":
      return { ...base(view), phase: active(view), stages: update(event.stage, (stage) => settled(stage, event.outcome)) }
    case "comparing":
      return { ...base(view), phase: "comparing" }
    case "mutating":
      return { ...base(view), phase: "mutating", mutants: { done: event.done, total: event.total } }
    case "done":
      return { ...base(view), phase: "done", finished: event.at, verdict: event.verdict, headline: event.headline, receipt: event.receipt, notes: event.notes }
    case "cancelled":
      return {
        ...base(view),
        phase: "cancelled",
        finished: event.at,
        reason: event.reason,
        stages: view.stages.map((stage) =>
          stage.status === "pending" || stage.status === "running" ? { ...stage, status: "not_run" as const, reason: event.reason } : stage,
        ),
      }
  }
}

export const make = (deps: Deps) =>
  Effect.gen(function* () {
    const { root, storage, permission } = deps
    const lock = Semaphore.makeUnsafe(1)

    const graph = Effect.fn("RiftPipeline.graph")(function* (sessionID: string) {
      const saved = Option.getOrUndefined(decodeSaved(yield* storage.get(`graph:${sessionID}`)))
      return { nodes: saved?.nodes ?? ([] as readonly RiftGraph.Node[]), proofs: saved?.proofs ?? ([] as readonly RiftGraph.Proof[]) }
    })
    const receipts = Effect.fn("RiftPipeline.receipts")(function* (sessionID: string) {
      const saved = yield* storage.get(`receipts:${sessionID}`)
      return Array.isArray(saved) ? (saved as unknown as RiftReceipt.Sealed[]) : []
    })
    const ledger: Ledger = {
      graph,
      receipts,
      // Proofs survive a rewrite of the graph. Each one still has to match a declared check and its inputs.
      writeGraph: (sessionID, nodes) =>
        lock.withPermits(1)(
          graph(sessionID).pipe(Effect.flatMap((saved) => storage.set(`graph:${sessionID}`, json({ nodes, proofs: saved.proofs })))),
        ),
    }
    const append = (sessionID: string, receipt: Omit<RiftReceipt.ReceiptV2, "prev">, proofs: readonly RiftGraph.Proof[]) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const chain = yield* receipts(sessionID)
          const sealed = RiftReceipt.seal({ ...receipt, prev: chain.at(-1)?.digest })
          yield* storage.set(`receipts:${sessionID}`, json([...chain, sealed].slice(-MAX_RECEIPTS)))
          const saved = yield* graph(sessionID)
          const key = (proof: RiftGraph.Proof) => `${proof.node}\0${proof.label}\0${proof.command}`
          const replaced = new Set(proofs.map(key))
          const all = [...saved.proofs.filter((proof) => !replaced.has(key(proof))), ...proofs]
          if (saved.nodes.length > 0) yield* storage.set(`graph:${sessionID}`, json({ nodes: saved.nodes, proofs: all }))
          return { sealed, graph: { nodes: saved.nodes, proofs: all } }
        }),
      )

    /**
     * One permission decision for a plan. Commands the rules allow run, commands a rule denies do not, and every
     * other command goes into a single request the TUI shows as a list; "always" saves them all. Reruns, the
     * baseline and mutants reuse granted commands and ask nothing more.
     */
    const grant = Effect.fn("RiftPipeline.grant")(function* (request: Request, commands: readonly string[], asking: Effect.Effect<void>) {
      const answers = new Map<string, Answer>()
      const ask: string[] = []
      for (const command of commands) {
        const input = { sessionID: request.sessionID, agent: request.agent, action: "shell", resources: [command] }
        if (yield* permission.allows(input).pipe(Effect.orElseSucceed(() => false))) answers.set(command, OK)
        else if (yield* permission.assertNotDenied(input).pipe(Effect.as(false), Effect.orElseSucceed(() => true)))
          answers.set(command, { ok: false, reason: "denied by a permission rule" })
        else ask.push(command)
      }
      if (ask.length > 0) {
        yield* asking
        const answer = yield* permission
          .assert({
            sessionID: request.sessionID,
            agent: request.agent,
            action: "shell",
            resources: ask,
            save: ask,
            metadata: { source: "rift-verify", tier: request.tier },
          })
          .pipe(
            Effect.as(OK),
            Effect.catchTag("Permission.CorrectedError", (error) => Effect.succeed<Answer>({ ok: false, reason: `declined: ${error.feedback}` })),
            Effect.catchTag("Permission.BlockedError", () => Effect.succeed<Answer>({ ok: false, reason: "denied by a permission rule" })),
            Effect.orElseSucceed((): Answer => ({ ok: false, reason: "permission could not be asked" })),
            // A plain reject reaches here as a defect, by upstream's design (see Permission.assert).
            Effect.catchDefect((defect) =>
              defect instanceof Permission.DeclinedError ? Effect.succeed<Answer>({ ok: false, reason: "declined" }) : Effect.die(defect),
            ),
          )
        for (const command of ask) answers.set(command, answer)
      }
      return answers as Grant
    })

    const run = (request: Request): Effect.Effect<Result> =>
      Effect.gen(function* () {
        const profile = TIERS[request.tier]
        const { candidate, baseline, sessionID } = request
        const saved = yield* graph(sessionID)
        const proofs = saved.nodes.flatMap((node) => {
          const inputs = profile.proofs === "due" ? RiftGraph.hash(root, saved.nodes, node) : ""
          return node.checks
            .filter((check) => profile.proofs === "all" || RiftGraph.due(node, check, saved.proofs, inputs))
            .map((check): RiftStages.Declared => ({
              kind: "proof",
              name: `${node.id}/${check.label}`,
              command: check.command,
              cwd: check.cwd,
              proof: { node: node.id, label: check.label },
            }))
        })
        const detect = (reader: RiftStages.TreeReader) => RiftStages.plan(RiftStages.detect(reader), profile.kinds, request.scope, proofs)
        const tree = yield* RiftWorkspace.reader(root, candidate.tree)
        const plan = detect(tree)
        if (plan.stages.length === 0) return { kind: "empty", looked: RiftStages.LOOKED } as const
        const lockfiles = tree.files.filter((file) => LOCKFILES.test(file))

        const id = randomUUID()
        let view: Rift.Run = { id, tree: candidate.tree, started: Date.now(), stages: [], phase: "preparing" }
        const emit = (event: Progress) =>
          Effect.suspend(() => {
            view = step(view, event)
            return deps.publish(sessionID, request.tier, view)
          })
        const compared = baseline !== undefined && baseline !== candidate.tree
        const diff = compared ? yield* RiftWorkspace.diff(root, baseline, candidate.tree) : ""
        const files = compared ? yield* RiftWorkspace.changed(root, baseline, candidate.tree) : []
        const cache = path.join(os.tmpdir(), "rift-verify-cache", sha(root).slice(0, 16), profile.env)
        const env = (stage: RiftStages.Stage) => (stage.ecosystem ? (RiftStages.ecosystem(stage.ecosystem).env?.(path.join(cache, stage.ecosystem)) ?? {}) : {})
        const dirs = new Set(plan.stages.flatMap((stage) => RiftStages.ancestors(stage.unit)))
        const where: RiftWorkspace.Env =
          profile.env === "clean" ? { kind: "clean" } : { kind: "snapshot", live: root, links: [...dirs].flatMap((dir) => LINKS.map((link) => RiftStages.join(dir, link))) }
        const ran = new Map<RiftStages.StageId, Ran>()

        /** Runs a plan's stages in order in one workspace, with reruns, skipping what a failed stage gates. */
        const execute = (stages: RiftStages.Plan, workspace: RiftWorkspace.Workspace, granted: Grant, into: Map<RiftStages.StageId, Ran>, events: boolean) =>
          Effect.gen(function* () {
            for (const stage of stages.stages) {
              const blocked = stage.needs.filter((need) => {
                const result = into.get(need)
                return result?.status !== "passed" && result?.status !== "flaky"
              })
              const answer = granted.get(stage.command)
              let result: Ran
              if (blocked.length > 0) result = { status: "skipped", because: blocked as unknown as RiftVerdict.NonEmpty<RiftStages.StageId> }
              else if (!answer?.ok) result = { status: "not_run", reason: answer?.reason ?? "not approved for this run" }
              else {
                const attempts: RiftVerdict.Attempt[] = []
                do {
                  if (events) yield* emit({ type: "started", stage: stage.id, attempt: attempts.length + 1 })
                  attempts.push(yield* RiftWorkspace.exec(workspace, stage.cwd, stage.command, env(stage), stage.timeoutMs))
                } while (RiftVerdict.again(stage, attempts, profile.attempts))
                result = RiftVerdict.settle(attempts as unknown as RiftVerdict.NonEmpty<RiftVerdict.Attempt>)
              }
              into.set(stage.id, result)
              if (events) yield* emit({ type: "finished", stage: stage.id, outcome: result })
            }
          })
        const unrun = (stages: RiftStages.Plan, reason: string, into: Map<RiftStages.StageId, Ran>) =>
          Effect.sync(() => stages.stages.forEach((stage) => into.set(stage.id, { status: "not_run", reason })))

        const outcomes = (attributions: ReadonlyMap<RiftStages.StageId, RiftVerdict.Attribution>) =>
          new Map(
            plan.stages.flatMap((stage): [RiftStages.StageId, RiftVerdict.Outcome][] => {
              const result = ran.get(stage.id)
              if (!result) return []
              if (!RiftVerdict.broken(result)) return [[stage.id, result]]
              return [[stage.id, { ...result, attribution: attributions.get(stage.id) ?? { kind: "unknown", reason: "cancelled before the comparison" } }]]
            }),
          )

        const seal = (
          verdict: RiftVerdict.Verdict,
          results: ReadonlyMap<RiftStages.StageId, RiftVerdict.Outcome>,
          evidence: Evidence,
          findings: readonly RiftIntegrity.Finding[],
          mutation?: RiftMutation.Report,
        ) =>
          append(
            sessionID,
            {
              version: 2,
              session: sessionID,
              run: id,
              tier: request.tier,
              time: new Date().toISOString(),
              inputs: { head: candidate.head, tree: candidate.tree, baseline, files: evidence.files, lockfiles: evidence.lockfiles },
              environment: { kind: profile.env, platform: `${process.platform}-${process.arch}` },
              stages: plan.stages.map((stage) => {
                const result = RiftVerdict.outcome(results, stage)
                const attribution = "attribution" in result ? result.attribution : undefined
                return {
                  id: stage.id,
                  kind: stage.kind,
                  command: stage.command,
                  status: result.status,
                  attempts: "attempts" in result ? result.attempts.map((attempt) => ({ status: attempt.status, ms: attempt.ms, output: attempt.digest })) : [],
                  introduced: attribution?.kind === "introduced" ? attribution.tests : attribution?.kind === "mixed" ? attribution.introduced : undefined,
                  preexisting: attribution?.kind === "preexisting" ? attribution.tests : attribution?.kind === "mixed" ? attribution.preexisting : undefined,
                  flaky: result.status === "flaky" ? result.tests : RiftVerdict.broken(result) && result.flaky.length > 0 ? result.flaky : undefined,
                  reason: "reason" in result ? result.reason : undefined,
                }
              }),
              integrity: findings,
              mutation: mutation ? { total: mutation.total, killed: mutation.killed } : undefined,
              verdict,
            },
            evidence.proofs(results),
          )

        let evidence: Evidence = { files: files.map((file) => ({ path: file, sha256: "missing" })), lockfiles: [], proofs: () => [] }
        const body = Effect.scoped(
          Effect.gen(function* () {
            yield* emit({ type: "planned", plan })
            const granted = yield* grant(request, [...new Set(plan.stages.map((stage) => stage.command))], emit({ type: "asking" }))
            const dir = yield* RiftWorkspace.runDir(id)

            const mutation = yield* Effect.scoped(
              RiftWorkspace.materialize(root, candidate.tree, where, dir).pipe(
                Effect.flatMap((workspace) =>
                  Effect.gen(function* () {
                    evidence = collect(workspace, plan, saved.nodes, files, lockfiles)
                    yield* execute(plan, workspace, granted, ran, true)
                    if (!profile.mutation || !request.mutate || !compared) return undefined
                    return yield* mutate(workspace, plan, ran, diff, env, (done, total) => emit({ type: "mutating", done, total }))
                  }),
                ),
                Effect.catchTag("RiftWorkspace.Error", (error) =>
                  Effect.gen(function* () {
                    yield* unrun(plan, `could not check out the project: ${error.reason}`, ran)
                    for (const stage of plan.stages) yield* emit({ type: "finished", stage: stage.id, outcome: ran.get(stage.id)! })
                    return undefined
                  }),
                ),
              ),
            )

            const broken = plan.stages.filter((stage) => RiftVerdict.broken(ran.get(stage.id)!)).map((stage) => stage.id)
            const before = new Map<RiftStages.StageId, RiftVerdict.Settled | "absent" | "unchanged">()
            if (broken.length > 0 && !compared) for (const stage of broken) before.set(stage, baseline === undefined ? "absent" : "unchanged")
            if (broken.length > 0 && compared) {
              const key = (stage: RiftStages.Stage) => `baseline:${profile.env}:${baseline}:${stage.id}:${sha(stage.command)}`
              const byId = new Map(plan.stages.map((stage) => [stage.id, stage]))
              for (const stage of broken) {
                const cached = yield* storage.get(key(byId.get(stage)!))
                if (cached) before.set(stage, cached as unknown as RiftVerdict.Settled)
              }
              const missing = broken.filter((stage) => !before.has(stage))
              if (missing.length > 0) {
                yield* emit({ type: "comparing" })
                const old = detect(yield* RiftWorkspace.reader(root, baseline))
                const same = (stage: RiftStages.StageId) => old.stages.find((item) => item.id === stage && item.command === byId.get(stage)!.command)
                const targets = missing.filter(same)
                for (const stage of missing.filter((item) => !same(item))) before.set(stage, "absent")
                const results = new Map<RiftStages.StageId, Ran>()
                const closure = RiftStages.closure(old, targets)
                yield* Effect.scoped(
                  RiftWorkspace.materialize(root, baseline, where, dir).pipe(
                    Effect.flatMap((workspace) => execute(closure, workspace, granted, results, false)),
                    Effect.catchTag("RiftWorkspace.Error", (error) => unrun(closure, `could not check out the baseline: ${error.reason}`, results)),
                  ),
                )
                for (const stage of targets) {
                  const result = results.get(stage)!
                  const settled: RiftVerdict.Settled = result.status === "skipped" ? { status: "not_run", reason: "a stage it needs did not pass" } : result
                  before.set(stage, settled)
                  // A stage that did not run may run next time, so only real results are kept.
                  if (settled.status !== "not_run")
                    yield* storage.set(key(byId.get(stage)!), json({ ...settled, attempts: "attempts" in settled ? settled.attempts.map((attempt) => ({ ...attempt, tail: "" })) : [] }))
                }
              }
            }
            const attributions = new Map(
              broken.map((stage) => [stage, RiftVerdict.attribute(ran.get(stage) as RiftVerdict.Broken, before.get(stage) ?? "absent")]),
            )
            const results = outcomes(attributions)
            for (const stage of broken) yield* emit({ type: "finished", stage, outcome: results.get(stage)! })

            const findings = RiftIntegrity.review(RiftIntegrity.parse(diff))
            const verdict = RiftVerdict.judge(plan, results, findings, profile.needsTest)
            const { sealed, graph: written } = yield* seal(verdict, results, evidence, findings, mutation)
            const assessments = RiftGraph.assess(written.nodes, written.proofs, (node) => RiftGraph.hash(root, written.nodes, node))
            const summary: RiftVerdict.Summary = {
              verdict,
              plan,
              outcomes: results,
              against: profile.against,
              where: profile.where,
              mutation,
              findings,
              sections: written.nodes.length > 0 ? [RiftGraph.format(written.nodes, assessments)] : [],
              receipt: sealed.digest,
            }
            const report: Report = {
              verdict,
              plan,
              outcomes: results,
              mutation,
              findings,
              sealed,
              text: RiftVerdict.format(summary),
              headline: RiftVerdict.headline(summary),
            }
            yield* emit({ type: "done", at: Date.now(), verdict, headline: report.headline, receipt: sealed.digest, notes: findings.map((finding) => `${finding.file}: ${finding.detail}`) })
            return { kind: "ran", report } as const
          }),
        )
        // A stopped or broken run still leaves a receipt and a final view, so the sidebar never stays on "running".
        return yield* body.pipe(
          Effect.onExit((exit) => {
            if (Exit.isSuccess(exit)) return Effect.void
            const reason = Cause.hasInterruptsOnly(exit.cause) ? "cancelled" : "verification failed"
            const results = outcomes(new Map())
            for (const stage of plan.stages) if (!results.has(stage.id)) results.set(stage.id, { status: "not_run", reason })
            return seal(RiftVerdict.judge(plan, results, [], profile.needsTest), results, evidence, []).pipe(
              Effect.andThen(emit({ type: "cancelled", at: Date.now(), reason })),
              Effect.catchCause((cause) => Effect.logWarning("failed to record a stopped verification", { cause })),
            )
          }),
        )
      })

    return { run, ledger } satisfies Pipeline
  })

interface Evidence {
  readonly files: readonly { readonly path: string; readonly sha256: string }[]
  readonly lockfiles: readonly { readonly path: string; readonly sha256: string }[]
  readonly proofs: (results: ReadonlyMap<RiftStages.StageId, RiftVerdict.Outcome>) => RiftGraph.Proof[]
}

const hashIn = (dir: string, file: string) => {
  try {
    return sha(readFileSync(path.join(dir, file)))
  } catch {
    return "deleted"
  }
}

const PROOF: Record<RiftVerdict.Outcome["status"], RiftGraph.Proof["status"]> = {
  passed: "passed",
  failed: "failed",
  timed_out: "timed_out",
  flaky: "not_run",
  skipped: "not_run",
  not_run: "not_run",
}

/** What the receipt and the graph record about the candidate, read from its checkout while it exists. */
const collect = (
  workspace: RiftWorkspace.Workspace,
  plan: RiftStages.Plan,
  nodes: readonly RiftGraph.Node[],
  files: readonly string[],
  lockfiles: readonly string[],
): Evidence => {
  const inputs = new Map(nodes.map((node) => [node.id, RiftGraph.hash(workspace.dir, nodes, node)]))
  const hashed = (list: readonly string[]) => [...list].sort().map((file) => ({ path: file, sha256: hashIn(workspace.dir, file) }))
  return {
    files: hashed(files),
    lockfiles: hashed(lockfiles),
    proofs: (results) =>
      plan.stages.flatMap((stage) => {
        const node = stage.proof && nodes.find((item) => item.id === stage.proof!.node)
        if (!stage.proof || !node) return []
        const result = RiftVerdict.outcome(results, stage)
        const detail =
          result.status === "not_run"
            ? result.reason
            : result.status === "flaky"
              ? "failed, then passed"
              : result.status === "skipped"
                ? "a stage it needs did not pass"
                : undefined
        return [{ node: node.id, label: stage.proof.label, command: stage.command, status: PROOF[result.status], inputs: inputs.get(node.id)!, detail }]
      }),
  }
}

const read = (dir: string, file: string) => {
  try {
    return readFileSync(path.join(dir, file), "utf8")
  } catch {
    return undefined
  }
}

/** Mutants on the changed lines, each run by the passing test stage of the unit that owns its file. */
const mutate = (
  workspace: RiftWorkspace.Workspace,
  plan: RiftStages.Plan,
  ran: ReadonlyMap<RiftStages.StageId, Ran>,
  diff: string,
  env: (stage: RiftStages.Stage) => Readonly<Record<string, string>>,
  progress: (done: number, total: number) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const green = plan.stages.flatMap((stage) => {
      const result = ran.get(stage.id)
      return stage.kind === "test" && result?.status === "passed" ? [{ stage, attempt: result.attempts[result.attempts.length - 1]! }] : []
    })
    const { mutants, unsupported } = RiftMutation.mutants(diff, (file) => read(workspace.dir, file), MUTANTS)
    const jobs = mutants.flatMap((mutant): RiftMutation.Job[] => {
      const owner = green
        .filter((item) => RiftStages.inside(mutant.file, item.stage.unit))
        .sort((a, b) => b.stage.unit.length - a.stage.unit.length)[0]
      return owner ? [{ mutant, stage: owner.stage, env: env(owner.stage), green: owner.attempt }] : []
    })
    if (jobs.length === 0 && unsupported.length === 0) return undefined
    yield* progress(0, jobs.length)
    const result = yield* RiftMutation.run(workspace, jobs, MUTATION_BUDGET_MS, (done) => progress(done, jobs.length))
    return { ...result, unsupported } satisfies RiftMutation.Report
  })

export * as RiftVerifyPlugin from "./rift-verify.js"

import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { define } from "@opencode/plugin/effect/plugin"
import { Session } from "@opencode/schema/session"
import { ToolFailure } from "@opencode/ai/effect"
import { Cause, Duration, Effect, FiberMap, Option, Schema } from "effect"
import { Agent } from "@opencode/schema/agent"
import { Rift } from "@opencode/schema/rift"
import { Permission } from "../permission.js"
import type { PluginInternal } from "./internal.js"
import { RiftDisputes } from "./rift-verify/disputes.js"
import { RiftGraph } from "./rift-verify/graph.js"
import { RiftPipeline } from "./rift-verify/pipeline.js"
import { RiftRepair } from "./rift-verify/repair.js"
import { RiftShip } from "./rift-verify/ship.js"
import { RiftScope } from "./rift-verify/scope.js"
import { RiftStages } from "./rift-verify/stages.js"
import { RiftVerdict } from "./rift-verify/verdict.js"
import { RiftWorkspace } from "./rift-verify/workspace.js"
import DESCRIPTION from "./rift-verify/graph.txt"

export const ID = "rift.verify"
export const MAX_ROUNDS = 3

/** How long to wait after the last edit before running continuous verification. */
const DEBOUNCE = Duration.millis(2000)
/** File extensions RIFT treats as source worth checking while the model writes. */
const SOURCE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|go|rs|py|java|kt|kts|rb|ex|exs)$/
/** Directories whose edits are never worth verifying continuously. */
const IGNORE = /(^|\/)(node_modules|\.git|dist|build|out|target|\.next|coverage|\.expo)\//

/** One session's pending edits awaiting the debounce. */
const editSessions = new Map<string, { generation: number; files: Set<string> }>()

const GraphInput = Schema.Struct({
  nodes: Schema.Array(RiftGraph.Node).annotate({ description: "The full node list" }),
})
const GraphOutput = Schema.Struct({ nodes: Schema.Number })
/** A run as stored: the process that ran it, and for the per-turn tier the fix rounds used on the prompt. */
const Stored = Schema.Struct({ boot: Schema.String, run: Rift.Run, round: Schema.Number })
const decodeStored = Schema.decodeUnknownOption(Stored)
// Identifies this server process, so a run another process left active is known to be dead. Created on first use:
// Workers forbid random values while a module loads.
let processBoot: string | undefined
const boot = () => (processBoot ??= crypto.randomUUID())
// Storage holds JSON. This drops the undefined fields the type checker cannot rule out.
const json = (value: unknown) => JSON.parse(JSON.stringify(value))
const key = (sessionID: string, tier: RiftPipeline.Tier) => `run:${sessionID}:${tier}`
const disputeKey = (sessionID: string) => `disputes:${sessionID}`
const outsideKey = (sessionID: string) => `outside:${sessionID}`
const decodeOutside = Schema.decodeUnknownOption(Schema.Array(Schema.String))
const decodeDisputes = Schema.decodeUnknownOption(Schema.Array(Rift.Dispute))

interface Loop {
  /** The tree when the current prompt started, so edits the user already had are not counted. */
  baseline?: RiftWorkspace.TreeId
  /** The tree the last verification saw, so unchanged work is not checked twice. */
  verified?: RiftWorkspace.TreeId
  round: number
  /** What each round's failure looked like, so a fix that changed nothing is seen as that. */
  signatures: string[]
  /** The edits outside the folder this prompt that the user was already told about. */
  toldOutside: string
  /** The rounds ran out for this prompt, so nothing runs again until the next one. */
  finished: boolean
}

const USAGE = "Usage: /verify [quick] [fix] [path...] | stop"

export type Args =
  | { readonly kind: "run"; readonly quick: boolean; readonly fix: boolean; readonly paths: readonly string[] }
  | { readonly kind: "stop" }
  | { readonly kind: "usage"; readonly message: string }

/** `stop` alone, or `quick`, `fix` and paths in any order. A directory literally named `quick` is written `./quick`. */
export const parseArgs = (text: string): Args => {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 1 && words[0] === "stop") return { kind: "stop" }
  if (words.includes("stop")) return { kind: "usage", message: USAGE }
  const paths: string[] = []
  for (const word of words.filter((item) => item !== "quick" && item !== "fix")) {
    const normal = path.posix.normalize(word.replaceAll("\\", "/")).replace(/(.)\/+$/, "$1")
    if (path.posix.isAbsolute(normal) || normal === ".." || normal.startsWith("../"))
      return { kind: "usage", message: `${USAGE}\nA path must be inside the project: ${word}` }
    paths.push(normal)
  }
  return { kind: "run", quick: words.includes("quick"), fix: words.includes("fix"), paths }
}

const FIX =
  "The user ran /verify fix. Fix the failures this report marks as new first, then the ones that were already failing. Fix the code, never the checks or what the tests expect."

/** What the agent is told to do with a report it is sent back. */
const INSTRUCTION: Record<"tampered" | "regressed" | "failing", string> = {
  tampered: "Your changes weakened the tests or the checks. Restore them and fix the code instead.",
  regressed: "These checks failed on your changes. Fix the code, not the checks.",
  failing:
    "These were already failing before your change. If the user asked you to fix them, keep going; otherwise tell the user and stop. Fix the code, not the checks.",
}

/** After the agent finishes editing, runs the project's own checks on a snapshot of its work and reports the real output. */
export const Plugin = define({
  id: ID,
  effect: Effect.fn("RiftVerify.Plugin")(function* (ctx) {
    if (process.env.RIFT_VERIFY === "0") return
    const root = ctx.location.directory
    const permission = yield* Permission.Service
    const scope = yield* Effect.scope

    const graphView = Effect.fn("RiftVerify.graphView")(function* (sessionID: string) {
      const graph = yield* pipeline.ledger.graph(sessionID)
      const assessments = RiftGraph.assess(graph.nodes, graph.proofs, (node) => RiftGraph.hash(root, graph.nodes, node))
      return assessments.map(({ node, verdict, because }) => {
        const info = graph.nodes.find((item) => item.id === node)
        return { id: node, parent: info?.parent_id ?? undefined, title: info?.title ?? node, verdict, because }
      })
    })

    // Each writer has its own key; the state clients see is put together here, on every read.
    const state = Effect.fn("RiftVerify.state")(function* (sessionID: string) {
      const change = Option.getOrUndefined(decodeStored(yield* ctx.storage.get(key(sessionID, "change"))))
      const project = Option.getOrUndefined(decodeStored(yield* ctx.storage.get(key(sessionID, "project"))))
      const graph = yield* graphView(sessionID)
      const disputes = Option.getOrElse(decodeDisputes(yield* ctx.storage.get(disputeKey(sessionID))), () => [] as readonly Rift.Dispute[])
      const outside = Option.getOrElse(decodeOutside(yield* ctx.storage.get(outsideKey(sessionID))), () => [] as readonly string[])
      if (!change && !project && graph.length === 0 && outside.length === 0) return null
      return { change: change && { run: change.run, round: change.round }, project: project?.run, graph, disputes, root, outside } satisfies Rift.State
    })

    const rpc = yield* ctx.rpc.register(Rift.Definition, { get: (input) => state(input.sessionID) }).pipe(Effect.orDie)

    // Clients read the state through `get` and follow `changed`, so every write publishes the new value.
    const changed = Effect.fn("RiftVerify.changed")(function* (sessionID: string) {
      const next = yield* state(sessionID)
      if (next)
        yield* rpc.events
          .emit("changed", { sessionID, state: next })
          .pipe(Effect.catchCause((cause) => Effect.logWarning("failed to publish verification", { sessionID, cause })))
    })

    const loops = new Map<string, Loop>()
    const loop = (sessionID: string) => {
      const existing = loops.get(sessionID)
      if (existing) return existing
      const created: Loop = { round: 0, signatures: [], toldOutside: "", finished: false }
      loops.set(sessionID, created)
      return created
    }

    const publish = Effect.fn("RiftVerify.publish")(function* (sessionID: string, tier: RiftPipeline.Tier, view: Rift.Run) {
      yield* ctx.storage.set(key(sessionID, tier), json({ boot: boot(), run: view, round: tier === "change" ? loop(sessionID).round : 0 }))
      yield* changed(sessionID)
    })

    /** The dispute ledger changes only through RiftDisputes, from the run that was just stored. */
    const dispute = Effect.fn("RiftVerify.dispute")(function* (
      sessionID: Session.ID,
      tier: RiftPipeline.Tier,
      change: (disputes: readonly Rift.Dispute[], run: Rift.Run) => Rift.Dispute[],
    ) {
      const stored = Option.getOrUndefined(decodeStored(yield* ctx.storage.get(key(sessionID, tier))))
      if (!stored) return
      const before = Option.getOrElse(decodeDisputes(yield* ctx.storage.get(disputeKey(sessionID))), () => [] as readonly Rift.Dispute[])
      const after = change(before, stored.run)
      if (JSON.stringify(after) === JSON.stringify(before)) return
      yield* ctx.storage.set(disputeKey(sessionID), json(after))
      yield* changed(sessionID)
    })

    /** Remembers files edited outside the verified folder, so the sidebar can say they were not checked. */
    const away = Effect.fn("RiftVerify.away")(function* (sessionID: Session.ID, files: readonly string[]) {
      const known = Option.getOrElse(decodeOutside(yield* ctx.storage.get(outsideKey(sessionID))), () => [] as readonly string[])
      yield* ctx.storage.set(outsideKey(sessionID), json(RiftScope.remember(known, files)))
      yield* changed(sessionID)
    })

    const pipeline: RiftPipeline.Pipeline = yield* RiftPipeline.make({ root, storage: ctx.storage, permission, publish })

    // A run an earlier process left active will never finish, so it is shown as stopped. Storage is shared by every
    // project this process has open, so a run of this process is left alone.
    for (let after: string | undefined, more = true; more; ) {
      const page = yield* ctx.storage.scan({ prefix: "run:", after })
      for (const entry of page.entries) {
        const stored = Option.getOrUndefined(decodeStored(entry.value))
        if (!stored || stored.boot === boot() || stored.run.phase === "done" || stored.run.phase === "cancelled") continue
        const stopped = RiftPipeline.step(stored.run, { type: "cancelled", at: Date.now(), reason: "RIFT restarted" })
        yield* ctx.storage.set(entry.key, json({ ...stored, run: stopped }))
      }
      after = page.next
      more = after !== undefined
    }
    yield* RiftWorkspace.sweep().pipe(Effect.forkScoped)

    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: "graphwrite",
          options: { codemode: false },
          description: DESCRIPTION,
          input: GraphInput,
          output: GraphOutput,
          execute: (input, context) =>
            pipeline.ledger.writeGraph(context.sessionID, input.nodes).pipe(
              Effect.andThen(changed(context.sessionID)),
              Effect.as({
                output: { nodes: input.nodes.length },
                content: `Graph updated: ${input.nodes.length} nodes. RIFT runs their checks when you finish.`,
              }),
              Effect.mapError((error) => new ToolFailure({ message: "Unable to update the graph", error })),
            ),
        })
      })
      .pipe(Effect.orDie)

    /** Run the change tier on the files the model just edited and publish to the sidebar. */
    const runEditVerification = Effect.fn("RiftVerify.runEditVerification")(function* (
      sessionID: Session.ID,
      files: readonly string[],
    ) {
      const snapshot = yield* RiftWorkspace.snapshot(root)
      if (!snapshot) return
      const current = loop(sessionID)
      const baseline = current.verified ?? snapshot.headTree
      if (!baseline || snapshot.tree === baseline) return
      const result = yield* pipeline.run({
        sessionID,
        agent: (yield* ctx.session.get({ sessionID })).agent ?? Agent.ID.make("build"),
        tier: "change",
        candidate: snapshot,
        baseline,
        scope: { kind: "files", files },
        mutate: false,
      })
      current.verified = snapshot.tree
      if (result.kind === "empty") {
        yield* changed(sessionID)
        return
      }
      yield* dispute(sessionID, "change", (list, run) => RiftDisputes.settle(list, run, Date.now()))
      // emit("done") during the run already wrote the final view to storage; re-emit so clients see it.
      yield* changed(sessionID)
    })

    /** Debounced verification for one session: after the model stops editing source files for a moment,
     * run the change tier on what changed and publish so the sidebar shows verified / failing live.
     * A fresh loop is forked on every edit; only the newest generation actually runs, so rapid edits
     * never lose work and never run stale checks. */
    const verifyEdits = Effect.fn("RiftVerify.verifyEdits")(function* (sessionID: Session.ID) {
      const entry = editSessions.get(sessionID)
      if (!entry) return
      const generation = entry.generation
      const files = [...entry.files]
      // Do not clear files yet: a newer edit may still be adding them. Clear only once this generation
      // is confirmed stable after the debounce.
      yield* Effect.sleep(DEBOUNCE)
      const current = editSessions.get(sessionID)
      if (!current || current.generation !== generation) return // a newer edit took over
      editSessions.delete(sessionID)
      entry.files.clear()
      if (files.length > 0) {
        yield* runEditVerification(sessionID, files).pipe(
          Effect.catchCause((cause) => Effect.logWarning("continuous verification failed", { sessionID, cause })),
        )
      }
    })

    // Continuous verification while the model writes code: after write/edit/patch on a source file,
    // debounce briefly, then run the change tier on what changed and publish so the sidebar shows
    // verified / failing live as the session progresses.
    yield* ctx.tool
      .hook("execute.after", (event) => {
        if (event.tool !== "write" && event.tool !== "edit" && event.tool !== "patch") return Effect.void
        if (event.status !== "completed") return Effect.void
        const files = RiftScope.edited(event.tool, event.input, event.result)
        const elsewhere = RiftScope.outside(root, files.filter((file) => !IGNORE.test(file)))
        const warn =
          elsewhere.length > 0
            ? away(event.sessionID, elsewhere).pipe(
                Effect.catchCause((cause) => Effect.logWarning("failed to record an edit outside the project", { cause })),
                Effect.forkIn(scope, { startImmediately: true }),
                Effect.asVoid,
              )
            : Effect.void
        const code = files.filter((file) => SOURCE.test(file) && !IGNORE.test(file) && !elsewhere.includes(path.resolve(root, file)))
        if (code.length === 0) return warn
        const entry = editSessions.get(event.sessionID) ?? { generation: 0, files: new Set<string>() }
        entry.generation++
        for (const file of code) entry.files.add(file)
        editSessions.set(event.sessionID, entry)
        return warn.pipe(
          Effect.andThen(
            verifyEdits(event.sessionID).pipe(
              Effect.forkIn(scope, { startImmediately: true }),
              Effect.asVoid,
            ),
          ),
        )
      })
      .pipe(Effect.orDie)

    // At most one /verify per session. A command returns at once; the TUI follows the run through `changed`.
    const runs = yield* FiberMap.make<string>()

    // The user sees one notice row. The model reads the report on its next turn, or now with `fix`.
    const deliver = Effect.fn("RiftVerify.deliver")(function* (
      sessionID: Session.ID,
      snapshot: RiftWorkspace.Snapshot,
      result: RiftPipeline.Result,
      fix: boolean,
    ) {
      if (result.kind === "empty") {
        yield* ctx.session.synthetic({
          sessionID,
          text: RiftVerdict.nothing(result.looked),
          description: "Verify: no checks found",
          metadata: { source: "rift-verify", tier: "project", verdict: "unproven" },
          resume: false,
        })
        return
      }
      yield* dispute(sessionID, "project", (list, run) => RiftDisputes.settle(list, run, Date.now()))
      const { report } = result
      const wake = fix && RiftVerdict.fixable(report.verdict)
      if (wake) {
        // The agent's fixes are checked each turn against the tree this run verified.
        const current = loop(sessionID)
        current.baseline = snapshot.tree
        current.verified = snapshot.tree
        current.round = 0
        current.signatures = []
        current.toldOutside = ""
        current.finished = false
      }
      yield* ctx.session.synthetic({
        sessionID,
        text: wake ? `${report.text}\n\n${FIX}` : report.text,
        description: report.headline,
        metadata: { source: "rift-verify", tier: "project", verdict: report.verdict, ...(wake ? { decision: "fix" } : {}) },
        resume: wake,
      })
    })

    yield* ctx.command.transform((editor) => {
      editor.add({
        name: "verify",
        description: "verify the whole project from a clean checkout, like CI [quick] [fix] [path...] | stop",
        execute: (input) =>
          Effect.gen(function* () {
            const args = parseArgs(input.prompt.text)
            if (args.kind === "usage") return yield* Effect.fail(new Error(args.message))
            const running = yield* FiberMap.has(runs, input.sessionID)
            if (args.kind === "stop") {
              if (!running) return yield* Effect.fail(new Error("No /verify is running."))
              return yield* FiberMap.remove(runs, input.sessionID)
            }
            if (running) return yield* Effect.fail(new Error("/verify is already running. /verify stop cancels it."))
            const missing = args.paths.filter((item) => !existsSync(path.join(root, item)))
            if (missing.length > 0) return yield* Effect.fail(new Error(`No such path in the project: ${missing.join(", ")}`))
            const snapshot = yield* RiftWorkspace.snapshot(root)
            if (!snapshot) return yield* Effect.fail(new Error("/verify needs a git repository to make a clean copy of the project."))
            const session = yield* ctx.session.get({ sessionID: input.sessionID })
            yield* FiberMap.run(
              runs,
              input.sessionID,
              pipeline
                .run({
                  sessionID: input.sessionID,
                  agent: session.agent ?? Agent.ID.make("build"),
                  tier: "project",
                  candidate: snapshot,
                  baseline: snapshot.headTree,
                  scope: args.paths.length > 0 && !args.paths.includes(".") ? { kind: "paths", paths: args.paths } : { kind: "all" },
                  mutate: !args.quick,
                })
                .pipe(
                  Effect.flatMap((result) => deliver(input.sessionID, snapshot, result, args.fix)),
                  Effect.catchCause((cause) =>
                    Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.logWarning("/verify failed", { sessionID: input.sessionID, cause }),
                  ),
                ),
              { onlyIfMissing: true },
            )
          }),
      })
    })

    // Ships only what the verifier has passed, as it stands now. A commit, never a push; RIFT is named as a co-author
    // only when an account's identity is configured (RIFT_COAUTHOR="Name <email>").
    yield* ctx.command.transform((editor) => {
      editor.add({
        name: "ship",
        description: "commit the verified work with RIFT as co-author: /ship <commit message>",
        execute: (input) =>
          Effect.gen(function* () {
            const message = input.prompt.text.trim()
            if (message.length === 0) return yield* Effect.fail(new Error("Usage: /ship <commit message>"))
            const snapshot = yield* RiftWorkspace.snapshot(root)
            if (!snapshot) return yield* Effect.fail(new Error("/ship needs a git repository."))
            const now = yield* state(input.sessionID)
            const run = [now?.change?.run, now?.project].filter((item): item is Rift.Run => item !== undefined).sort((a, b) => b.started - a.started)[0]
            const gate = RiftShip.gate({ run, tree: snapshot.tree, disputes: now?.disputes ?? [] })
            const notice = (text: string, description: string, verdict: string) =>
              ctx.session.synthetic({ sessionID: input.sessionID, text, description, metadata: { source: "rift-verify", tier: "ship", verdict }, resume: false })
            if (!gate.ready) {
              yield* notice(`Not shipped: ${gate.reasons.join("; ")}. Run /verify, or let RIFT finish, and try again.`, "Ship: blocked", "unproven")
              return
            }
            const full = RiftShip.withTrailer(message, RiftShip.identity(process.env.RIFT_COAUTHOR))
            const committed = yield* Effect.try({
              try: () => {
                execFileSync("git", ["add", "-A"], { cwd: root, stdio: "pipe" })
                execFileSync("git", ["commit", "-q", "-F", "-"], { cwd: root, input: full, stdio: ["pipe", "pipe", "pipe"] })
                return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
              },
              catch: (error) => new Error(`git could not commit: ${String((error as { stderr?: Buffer }).stderr ?? error).trim()}`),
            })
            const credited = RiftShip.identity(process.env.RIFT_COAUTHOR)
            yield* notice(
              `Shipped ${committed}: the verifier passed this tree (receipt ${run!.phase === "done" ? run!.receipt.slice(0, 12) : ""}). Committed locally, not pushed.${credited ? ` ${credited.name} is credited as co-author.` : " No co-author identity is set (RIFT_COAUTHOR), so the commit has no RIFT credit."}`,
              `Ship: committed ${committed}`,
              "verified",
            )
          }),
      })
    })

    yield* ctx.session.hook("prompt", (event) =>
      // Edits elsewhere are reported per prompt: a new prompt starts with none.
      ctx.storage.set(outsideKey(event.sessionID), json([])).pipe(
        Effect.andThen(changed(event.sessionID)),
        Effect.andThen(RiftWorkspace.snapshot(root)),
      ).pipe(
        Effect.map((snapshot) => {
          const current = loop(event.sessionID)
          current.baseline = snapshot?.tree
          current.verified = undefined
          current.round = 0
          current.signatures = []
          current.toldOutside = ""
          current.finished = false
        }),
      ),
    )

    const idle = Effect.fn("RiftVerify.idle")(function* (sessionID: Session.ID) {
      const session = yield* ctx.session.get({ sessionID })
      if (session.parentID) return
      const current = loop(sessionID)
      // Work done somewhere else was checked by nothing. Say so, once, instead of letting a quiet turn read as fine.
      const away = Option.getOrElse(decodeOutside(yield* ctx.storage.get(outsideKey(sessionID))), () => [] as readonly string[])
      const told = away.join("\n")
      if (away.length > 0 && told !== current.toldOutside) {
        current.toldOutside = told
        yield* ctx.session.wait({ sessionID }).pipe(
          Effect.andThen(
            ctx.session.synthetic({
              sessionID,
              text: `RIFT verification covers ${root}. ${away.length === 1 ? "This file was" : "These files were"} edited outside it:\n${away.map((file) => `- ${file}`).join("\n")}\nNo check ran on them. Open RIFT in the folder where the work is, or run its checks and read the output yourself.`,
              description: "Verify: edits outside the project were not checked",
              metadata: { source: "rift-verify", tier: "change", verdict: "unproven" },
              resume: false,
            }),
          ),
          Effect.catchCause((cause) => Effect.logWarning("failed to post the outside-edit notice", { sessionID, cause })),
          Effect.forkIn(scope),
        )
      }
      const now = yield* RiftWorkspace.snapshot(root)
      // Without a prompt in this process, the work is compared with HEAD.
      const baseline = current.baseline ?? now?.headTree
      if (!now || !baseline || current.finished || now.tree === current.verified) return
      const files = yield* RiftWorkspace.changed(root, baseline, now.tree)
      if (files.length === 0 || RiftStages.docsOnly(files)) return
      const result = yield* pipeline.run({
        sessionID,
        agent: session.agent ?? Agent.ID.make("build"),
        tier: "change",
        candidate: now,
        baseline,
        scope: { kind: "files", files },
        mutate: false,
      })
      // The checks can take minutes; verify the tree they actually saw, and let a later edit run them again.
      current.verified = now.tree
      if (result.kind === "empty") return
      yield* dispute(session.id, "change", (list, run) => RiftDisputes.settle(list, run, Date.now()))
      const { report } = result
      const latest = Option.getOrUndefined(decodeStored(yield* ctx.storage.get(key(sessionID, "change"))))
      if (latest && RiftVerdict.fixable(report.verdict)) current.signatures.push(RiftRepair.signature(latest.run))
      const step = RiftRepair.next(RiftRepair.repeats(current.signatures))
      // A fix that changed nothing twice is a guess that is not working: stop and say so, rather than spend the rounds.
      const decision: RiftVerdict.Decision = step.type === "stop" ? { type: "give_up" } : RiftVerdict.decide(report.verdict, current.round, MAX_ROUNDS)
      const metadata = { source: "rift-verify", tier: "change", decision: decision.type, verdict: report.verdict }
      if (decision.type === "report") {
        if (report.verdict === "verified") return
        // Unproven work is shown to the user and left for the model's next turn. Input admitted during this hook
        // would continue the execution, so the notice waits until the Session is idle.
        yield* ctx.session.wait({ sessionID }).pipe(
          Effect.andThen(ctx.session.synthetic({ sessionID, text: report.text, description: report.headline, metadata, resume: false })),
          Effect.catchCause((cause) => Effect.logWarning("failed to post a verification notice", { sessionID, cause })),
          Effect.forkIn(scope),
        )
        return
      }
      if (decision.type === "fix") {
        current.round++
        yield* dispute(session.id, "change", (list, run) => RiftDisputes.raise(list, run, current.round, Date.now()))
      } else {
        current.finished = true
        yield* dispute(session.id, "change", (list) => RiftDisputes.giveUp(list, MAX_ROUNDS, Date.now()))
      }
      const stored = Option.getOrUndefined(decodeStored(yield* ctx.storage.get(key(sessionID, "change"))))
      if (stored) yield* publish(sessionID, "change", stored.run)
      yield* ctx.session.synthetic({
        sessionID,
        text:
          decision.type === "fix"
            ? `${report.text}\n\n${INSTRUCTION[report.verdict as keyof typeof INSTRUCTION]}${step.type === "stop" ? "" : ` ${step.text}`}`
            : step.type === "stop"
              ? `${report.text}\n\nThe last fixes left this failure exactly as it was. Stopped. Tell the user this work is not proven and what you tried. Change nothing else.`
              : `${report.text}\n\nStopped after ${MAX_ROUNDS} fix rounds. Tell the user this work is not proven. Change nothing else.`,
        metadata,
      })
    })

    yield* ctx.session.hook("experimental.idle", (event) =>
      event.background.length > 0
        ? Effect.void
        : idle(event.sessionID).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.interrupt
                : Effect.logWarning("verification failed to run", { sessionID: event.sessionID, cause }),
            ),
          ),
    )
  }),
} satisfies PluginInternal.InternalPlugin)

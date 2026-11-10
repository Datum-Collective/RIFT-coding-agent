export * as RiftVerifyPlugin from "./rift-verify.js"

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
import { RiftGraph } from "./rift-verify/graph.js"
import { RiftPipeline } from "./rift-verify/pipeline.js"
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

interface Loop {
  /** The tree when the current prompt started, so edits the user already had are not counted. */
  baseline?: RiftWorkspace.TreeId
  /** The tree the last verification saw, so unchanged work is not checked twice. */
  verified?: RiftWorkspace.TreeId
  round: number
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
      if (!change && !project && graph.length === 0) return null
      return { change: change && { run: change.run, round: change.round }, project: project?.run, graph } satisfies Rift.State
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
      const created: Loop = { round: 0, finished: false }
      loops.set(sessionID, created)
      return created
    }

    const publish = Effect.fn("RiftVerify.publish")(function* (sessionID: string, tier: RiftPipeline.Tier, view: Rift.Run) {
      yield* ctx.storage.set(key(sessionID, tier), json({ boot: boot(), run: view, round: tier === "change" ? loop(sessionID).round : 0 }))
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
        const files: string[] = []
        if (event.tool === "write") {
          const r = (event.result as { readonly resource?: string }).resource
          if (typeof r === "string") files.push(r)
        } else if (event.tool === "edit") {
          const p = (event.input as { readonly path?: string }).path
          if (typeof p === "string") files.push(p)
        } else {
          const a = (event.result as { readonly applied?: unknown })?.applied
          if (Array.isArray(a))
            for (const item of a) {
              const r = (item as { readonly resource?: string }).resource
              if (typeof r === "string") files.push(r)
            }
        }
        const code = files.filter((file) => SOURCE.test(file) && !IGNORE.test(file))
        if (code.length === 0) return Effect.void
        const entry = editSessions.get(event.sessionID) ?? { generation: 0, files: new Set<string>() }
        entry.generation++
        for (const file of code) entry.files.add(file)
        editSessions.set(event.sessionID, entry)
        return verifyEdits(event.sessionID).pipe(
          Effect.forkIn(scope, { startImmediately: true }),
          Effect.asVoid,
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
      const { report } = result
      const wake = fix && RiftVerdict.fixable(report.verdict)
      if (wake) {
        // The agent's fixes are checked each turn against the tree this run verified.
        const current = loop(sessionID)
        current.baseline = snapshot.tree
        current.verified = snapshot.tree
        current.round = 0
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

    yield* ctx.session.hook("prompt", (event) =>
      RiftWorkspace.snapshot(root).pipe(
        Effect.map((snapshot) => {
          const current = loop(event.sessionID)
          current.baseline = snapshot?.tree
          current.verified = undefined
          current.round = 0
          current.finished = false
        }),
      ),
    )

    const idle = Effect.fn("RiftVerify.idle")(function* (sessionID: Session.ID) {
      const session = yield* ctx.session.get({ sessionID })
      if (session.parentID) return
      const current = loop(sessionID)
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
      const { report } = result
      const decision = RiftVerdict.decide(report.verdict, current.round, MAX_ROUNDS)
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
      if (decision.type === "fix") current.round++
      else current.finished = true
      const stored = Option.getOrUndefined(decodeStored(yield* ctx.storage.get(key(sessionID, "change"))))
      if (stored) yield* publish(sessionID, "change", stored.run)
      yield* ctx.session.synthetic({
        sessionID,
        text:
          decision.type === "fix"
            ? `${report.text}\n\n${INSTRUCTION[report.verdict as keyof typeof INSTRUCTION]}`
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

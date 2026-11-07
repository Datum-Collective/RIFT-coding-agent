export * as RiftVerifyPlugin from "./rift-verify.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Session } from "@opencode/schema/session"
import { ToolFailure } from "@opencode/ai/effect"
import { Cause, Effect, Option, Schema } from "effect"
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

const GraphInput = Schema.Struct({
  nodes: Schema.Array(RiftGraph.Node).annotate({ description: "The full node list" }),
})
const GraphOutput = Schema.Struct({ nodes: Schema.Number })
const Change = Schema.Struct({ run: Rift.Run, round: Schema.Number })
const decodeChange = Schema.decodeUnknownOption(Change)
const decodeRun = Schema.decodeUnknownOption(Rift.Run)
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
      const change = Option.getOrUndefined(decodeChange(yield* ctx.storage.get(key(sessionID, "change"))))
      const project = Option.getOrUndefined(decodeRun(yield* ctx.storage.get(key(sessionID, "project"))))
      const graph = yield* graphView(sessionID)
      if (!change && !project && graph.length === 0) return null
      return { change, project, graph } satisfies Rift.State
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
      yield* ctx.storage.set(key(sessionID, tier), json(tier === "change" ? { run: view, round: loop(sessionID).round } : view))
      yield* changed(sessionID)
    })

    const pipeline: RiftPipeline.Pipeline = yield* RiftPipeline.make({ root, storage: ctx.storage, permission, publish })

    // A run left active by an earlier process will never finish, so it is shown as stopped.
    const stale = (yield* ctx.storage.scan({ prefix: "run:" })).entries
    for (const entry of stale) {
      const change = Option.getOrUndefined(decodeChange(entry.value))
      const run = change?.run ?? Option.getOrUndefined(decodeRun(entry.value))
      if (!run || run.phase === "done" || run.phase === "cancelled") continue
      const stopped = RiftPipeline.step(run, { type: "cancelled", at: Date.now(), reason: "RIFT restarted" })
      yield* ctx.storage.set(entry.key, json(change ? { ...change, run: stopped } : stopped))
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
      const stored = Option.getOrUndefined(decodeChange(yield* ctx.storage.get(key(sessionID, "change"))))
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

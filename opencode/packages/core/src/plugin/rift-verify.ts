export * as RiftVerifyPlugin from "./rift-verify.js"

import path from "node:path"
import { define } from "@opencode/plugin/effect/plugin"
import { Session } from "@opencode/schema/session"
import { ToolFailure } from "@opencode/ai/effect"
import { Cause, Effect, Option, Schema } from "effect"
import { Agent } from "@opencode/schema/agent"
import { Rift } from "@opencode/schema/rift"
import { Permission } from "../permission.js"
import type { PluginInternal } from "./internal.js"
import { RiftChecks } from "./rift-verify/checks.js"
import { RiftGraph } from "./rift-verify/graph.js"
import DESCRIPTION from "./rift-verify/graph.txt"

export const ID = "rift.verify"
export const MAX_ROUNDS = 3
const TIMEOUT_MS = 10 * 60 * 1000

const GraphInput = Schema.Struct({
  nodes: Schema.Array(RiftGraph.Node).annotate({ description: "The full node list" }),
})
const GraphOutput = Schema.Struct({ nodes: Schema.Number })
const Saved = Schema.Struct({
  nodes: Schema.Array(RiftGraph.Node),
  proofs: Schema.Array(RiftGraph.Proof),
})
const decodeSaved = Schema.decodeUnknownOption(Saved)
const decodeState = Schema.decodeUnknownOption(Rift.State)
// Storage holds JSON. This drops the undefined fields the type checker cannot rule out.
const plain = (value: typeof Saved.Type) => JSON.parse(JSON.stringify(value))

interface State {
  /** The tree when the current work started, so edits the user already had are not counted. */
  baseline?: RiftChecks.Tree
  /** The tree the last verification saw, so unchanged work is not checked twice. */
  verified?: string
  round: number
  /** The rounds ran out for this prompt, so nothing runs again until the next one. */
  finished: boolean
}

/** After the agent finishes editing, runs the project's own checks and reports the real output. */
export const Plugin = define({
  id: ID,
  effect: Effect.fn("RiftVerify.Plugin")(function* (ctx) {
    if (process.env.RIFT_VERIFY === "0") return
    const directory = ctx.location.directory
    const permission = yield* Permission.Service

    const readGraph = Effect.fn("RiftVerify.readGraph")(function* (sessionID: string) {
      const saved = Option.getOrUndefined(decodeSaved(yield* ctx.storage.get(`graph:${sessionID}`)))
      return {
        nodes: saved?.nodes ?? ([] as readonly RiftGraph.Node[]),
        proofs: saved?.proofs ?? ([] as readonly RiftGraph.Proof[]),
      }
    })

    const rpc = yield* ctx.rpc
      .register(Rift.Definition, {
        get: (input) =>
          ctx.storage
            .get(`state:${input.sessionID}`)
            .pipe(Effect.map((value) => Option.getOrNull(decodeState(value)))),
      })
      .pipe(Effect.orDie)

    // Clients read the state through `get` and follow `changed`, so every write publishes the new value.
    const publish = Effect.fn("RiftVerify.publish")(function* (sessionID: string, next: Rift.State) {
      yield* ctx.storage.set(`state:${sessionID}`, JSON.parse(JSON.stringify(next)))
      yield* rpc.events
        .emit("changed", { sessionID, state: next })
        .pipe(Effect.catchCause((cause) => Effect.logWarning("failed to publish verification", { sessionID, cause })))
    })

    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: "graphwrite",
          options: { codemode: false },
          description: DESCRIPTION,
          input: GraphInput,
          output: GraphOutput,
          execute: (input, context) =>
            Effect.gen(function* () {
              // Proofs survive a rewrite of the graph. Each one still has to match a declared check and its inputs.
              const saved = yield* readGraph(context.sessionID)
              yield* ctx.storage.set(`graph:${context.sessionID}`, plain({ nodes: input.nodes, proofs: saved.proofs }))
              return {
                output: { nodes: input.nodes.length },
                content: `Graph updated: ${input.nodes.length} nodes. RIFT runs their checks when you finish.`,
              }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: "Unable to update the graph", error }))),
        })
      })
      .pipe(Effect.orDie)
    const states = new Map<string, State>()
    const state = (sessionID: string) => {
      const existing = states.get(sessionID)
      if (existing) return existing
      const created: State = { round: 0, finished: false }
      states.set(sessionID, created)
      return created
    }

    yield* ctx.session.hook("prompt", (event) =>
      Effect.promise(async () => {
        const current = state(event.sessionID)
        current.baseline = await RiftChecks.tree(directory)
        current.verified = undefined
        current.round = 0
        current.finished = false
      }),
    )

    const idle = Effect.fn("RiftVerify.idle")(function* (sessionID: Session.ID) {
      const session = yield* ctx.session.get({ sessionID })
      if (session.parentID) return
      const current = state(sessionID)
      const tree = yield* Effect.promise(() => RiftChecks.tree(directory))
      if (current.finished || !tree || tree.fingerprint === current.verified) return
      const files = RiftChecks.edited(current.baseline, tree)
      if (files.length === 0 || RiftChecks.docsOnly(files)) return
      const checks = RiftChecks.resolve(directory, files)
      const graph = yield* readGraph(sessionID)
      const inputs = new Map(graph.nodes.map((node) => [node.id, RiftGraph.hash(directory, graph.nodes, node)]))
      const planned = graph.nodes.flatMap((node) =>
        node.checks
          .filter((check) => RiftGraph.due(node, check, graph.proofs, inputs.get(node.id)!))
          .map((check) => ({ node, check })),
      )
      if (checks.length === 0 && planned.length === 0) return

      // A real permission request, as for a shell tool call: the user approves or declines it, and rules still apply.
      const permitted = (command: string) =>
        permission
          .assert({
            sessionID,
            agent: session.agent ?? Agent.ID.make("build"),
            action: "shell",
            resources: [command],
            save: [command],
          })
          .pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          )
      const gated = Effect.fn("RiftVerify.gated")(function* (check: RiftChecks.Check) {
        if (yield* permitted(check.command)) return yield* Effect.promise((signal) => RiftChecks.run(check, TIMEOUT_MS, signal))
        return RiftChecks.blocked(check, "permission denied")
      })

      const declared = planned.map(({ node, check }) => ({
        name: check.label,
        command: check.command,
        dir: check.cwd ? path.resolve(directory, check.cwd) : directory,
      }))
      yield* publish(sessionID, { running: true, round: current.round, checks: [], graph: [] })
      const [own, evidence] = yield* Effect.all(
        [Effect.all(checks.map(gated)), Effect.all(declared.map(gated))],
        // One request at a time, so permission prompts do not stack up.
      )
      const results = [...own, ...evidence]
      const proofs: RiftGraph.Proof[] = evidence.map((result, index) => {
        const { node, check } = planned[index]!
        return {
          node: node.id,
          label: check.label,
          command: check.command,
          status: result.status,
          inputs: inputs.get(node.id)!,
          detail: result.reason,
        }
      })
      const replaced = new Set(proofs.map((proof) => `${proof.node}\0${proof.label}\0${proof.command}`))
      const allProofs = [
        ...graph.proofs.filter((proof) => !replaced.has(`${proof.node}\0${proof.label}\0${proof.command}`)),
        ...proofs,
      ]
      if (graph.nodes.length > 0) yield* ctx.storage.set(`graph:${sessionID}`, plain({ nodes: graph.nodes, proofs: allProofs }))
      const assessments = RiftGraph.assess(graph.nodes, allProofs, (node) => inputs.get(node.id)!)
      // The checks can take minutes; verify the tree they actually saw, and let a later edit run them again.
      current.verified = tree.fingerprint
      const decision = RiftChecks.decide(results, current.round, MAX_ROUNDS)
      const text =
        graph.nodes.length > 0
          ? `${RiftChecks.format(results)}\n\n${RiftGraph.format(graph.nodes, assessments)}`
          : RiftChecks.format(results)
      const metadata = { source: "rift-verify", decision: decision.type }
      yield* publish(sessionID, {
        running: false,
        round: current.round + (decision.type === "fix" ? 1 : 0),
        checks: results.map(({ command, status, reason, ms }) => ({ command, status, reason, ms })),
        graph: assessments.map(({ node, verdict, because }) => {
          const info = graph.nodes.find((item) => item.id === node)
          return { id: node, parent: info?.parent_id ?? undefined, title: info?.title ?? node, verdict, because }
        }),
      })
      if (decision.type === "report") {
        // Anything admitted to the inbox wakes the model, so a result with no failures is stored for clients instead.
        yield* ctx.storage.set(`session:${sessionID}`, { text, time: Date.now() })
        yield* Effect.logInfo("verification finished", { sessionID })
        return
      }
      if (decision.type === "fix") current.round++
      else current.finished = true
      yield* ctx.session.synthetic({
        sessionID,
        text:
          decision.type === "fix"
            ? `${text}\n\nThese checks failed on your changes. Fix the code, not the checks.`
            : `${text}\n\nStopped after ${MAX_ROUNDS} fix rounds. Tell the user this work is not proven. Change nothing else.`,
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

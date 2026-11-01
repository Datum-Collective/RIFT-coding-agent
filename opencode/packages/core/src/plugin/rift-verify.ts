export * as RiftVerifyPlugin from "./rift-verify.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Session } from "@opencode/schema/session"
import { Cause, Effect } from "effect"
import type { PluginInternal } from "./internal.js"
import { RiftChecks } from "./rift-verify/checks.js"

export const ID = "rift.verify"
export const MAX_ROUNDS = 3
const TIMEOUT_MS = 10 * 60 * 1000

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
      if (checks.length === 0) return

      const results = yield* Effect.promise((signal) =>
        Promise.all(checks.map((check) => RiftChecks.run(check, TIMEOUT_MS, signal))),
      )
      // The checks can take minutes; verify the tree they actually saw, and let a later edit run them again.
      current.verified = tree.fingerprint
      const decision = RiftChecks.decide(results, current.round, MAX_ROUNDS)
      const text = RiftChecks.format(results)
      const metadata = { source: "rift-verify", decision: decision.type }
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

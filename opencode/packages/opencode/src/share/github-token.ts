import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppProcess } from "@opencode-ai/core/process"
import { Context, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"

export class MissingTokenError extends Schema.TaggedErrorClass<MissingTokenError>()("MissingTokenError", {}) {
  override get message() {
    return "Sharing saves the session as a secret GitHub Gist. Sign in with `gh auth login`, or set GITHUB_TOKEN, then share again."
  }
}

export interface Interface {
  readonly get: () => Effect.Effect<string, MissingTokenError>
  /** Drop the remembered token, e.g. after GitHub rejects it, so the next get looks it up again. */
  readonly forget: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@rift/GitHubToken") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const appProcess = yield* AppProcess.Service
    // Asking gh costs a process spawn on every gist write; a shared session writes every few
    // seconds while it changes, so the token is looked up once. Failures aren't remembered, so
    // signing in with gh mid-session works on the next share.
    let remembered: string | undefined

    const get = Effect.fn("GitHubToken.get")(function* () {
      if (remembered) return remembered
      const env = process.env["GH_TOKEN"] || process.env["GITHUB_TOKEN"]
      const result = env
        ? undefined
        : yield* appProcess
            .run(ChildProcess.make("gh", ["auth", "token"], { extendEnv: true }))
            .pipe(Effect.catch(() => Effect.succeed(undefined)))
      const token = env || (result?.exitCode === 0 ? result.stdout.toString("utf8").trim() : "")
      if (!token) return yield* new MissingTokenError()
      remembered = token
      return token
    })

    const forget = () =>
      Effect.sync(() => {
        remembered = undefined
      })

    return Service.of({ get, forget })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [AppProcess.node] })

export * as GitHubToken from "./github-token"

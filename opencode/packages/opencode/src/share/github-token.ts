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
}

export class Service extends Context.Service<Service, Interface>()("@rift/GitHubToken") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const appProcess = yield* AppProcess.Service

    const get = Effect.fn("GitHubToken.get")(function* () {
      const env = process.env["GH_TOKEN"] || process.env["GITHUB_TOKEN"]
      if (env) return env
      const result = yield* appProcess
        .run(ChildProcess.make("gh", ["auth", "token"], { extendEnv: true }))
        .pipe(Effect.catch(() => Effect.succeed(undefined)))
      const token = result?.exitCode === 0 ? result.stdout.toString("utf8").trim() : ""
      if (!token) return yield* new MissingTokenError()
      return token
    })

    return Service.of({ get })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [AppProcess.node] })

export * as GitHubToken from "./github-token"

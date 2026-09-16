import { Effect, Schema, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import * as Tool from "./tool"
import DESCRIPTION from "./browser_open.txt"

export const Parameters = Schema.Struct({
  url: Schema.String.annotate({ description: "The URL to open in the default browser" }),
})

function command(url: string) {
  if (process.platform === "darwin") return ChildProcess.make("open", [url])
  if (process.platform === "win32") return ChildProcess.make("cmd", ["/c", "start", "", url])
  return ChildProcess.make("xdg-open", [url])
}

export const BrowserOpenTool = Tool.define(
  "browser_open",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const url = params.url.startsWith("http://") ? params.url.replace("http://", "https://") : params.url
          if (!url.startsWith("https://")) {
            throw new Error("URL must start with http:// or https://")
          }

          yield* ctx.ask({
            permission: "browser_open",
            patterns: [url],
            always: ["*"],
            metadata: {
              url,
            },
          })

          const code = yield* Effect.scoped(
            Effect.gen(function* () {
              const handle = yield* spawner.spawn(command(url))
              yield* Effect.forkScoped(Stream.runDrain(handle.all))
              return yield* handle.exitCode
            }),
          )
          if (code !== 0) {
            throw new Error(`Unable to open browser (exit code ${code})`)
          }

          return {
            title: `BrowserOpen ${url}`,
            output: `Opened ${url} in the default browser.`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)

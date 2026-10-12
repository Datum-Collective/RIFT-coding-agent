export * as NpmConfig from "./npm-config"

import { fileURLToPath } from "url"
import { Effect } from "effect"

const npmPath = fileURLToPath(new URL("..", import.meta.url))

export const load = (dir: string) =>
  Effect.tryPromise({
    try: async () => {
      // npm's config reader (and the glob/workspace code it drags in) is only needed for installs
      // and upgrades, so it loads on first use instead of with every process.
      // @ts-expect-error npm does not publish types for this internal config API.
      const { default: Config } = await import("@npmcli/config")
      // @ts-expect-error npm does not publish types for this internal config API.
      const { definitions, flatten, nerfDarts, shorthands } = await import("@npmcli/config/lib/definitions/index.js")
      const config = new Config({
        npmPath,
        cwd: dir,
        env: { ...process.env },
        argv: [process.execPath, process.execPath],
        execPath: process.execPath,
        platform: process.platform,
        definitions,
        flatten,
        nerfDarts,
        shorthands,
        warn: false,
      })
      await config.load()
      return config.flat as Record<string, unknown>
    },
    catch: (cause) => cause,
  }).pipe(Effect.orElseSucceed(() => ({}) as Record<string, unknown>))

export const registry = (dir: string) =>
  load(dir).pipe(
    Effect.map((config) => {
      const registry = typeof config.registry === "string" ? config.registry : "https://registry.npmjs.org"
      return registry.endsWith("/") ? registry.slice(0, -1) : registry
    }),
  )

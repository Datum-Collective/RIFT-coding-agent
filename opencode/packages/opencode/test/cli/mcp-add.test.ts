import { describe, expect } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { cliIt } from "../lib/cli-process"

const json = (file: string) => Effect.promise(() => Bun.file(file).json())

describe("rift mcp add / add-json / remove (subprocess)", () => {
  cliIt.concurrent(
    "adds an http server with headers to the user scope",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const result = yield* opencode.spawn([
          "mcp",
          "add",
          "--scope",
          "user",
          "--transport",
          "http",
          "github",
          "https://example.com/mcp",
          "--header",
          "Authorization: Bearer ${GITHUB_TOKEN}",
          "-H",
          "X-Option: one=two",
        ])
        opencode.expectExit(result, 0)
        const file = yield* json(path.join(home, ".rift", "mcp.json"))
        expect(file.mcpServers.github).toEqual({
          type: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer ${GITHUB_TOKEN}", "X-Option": "one=two" },
        })
      }),
    60_000,
  )

  cliIt.concurrent(
    "adds a stdio server to the local scope, keeping argv and env values",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const result = yield* opencode.spawn([
          "mcp",
          "add",
          "local",
          "-e",
          "API_KEY=secret",
          "--env",
          "VALUE=one=two",
          "--",
          "npx",
          "-y",
          "@example/server",
          "--port",
          "3000",
          "--label",
          "two words",
        ])
        opencode.expectExit(result, 0)
        const config = yield* json(path.join(home, "rift.json"))
        expect(config.mcp.local).toEqual({
          type: "local",
          command: ["npx", "-y", "@example/server", "--port", "3000", "--label", "two words"],
          environment: { API_KEY: "secret", VALUE: "one=two" },
        })
      }),
    60_000,
  )

  cliIt.concurrent(
    "add-json writes the mcpServers shape to .mcp.json as given, and remove deletes it",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const added = yield* opencode.spawn([
          "mcp",
          "add-json",
          "-s",
          "project",
          "db",
          '{"command":"${DB_CMD:-pg-mcp}","args":["--ro"],"env":{"URL":"${DATABASE_URL}"}}',
        ])
        opencode.expectExit(added, 0)
        const file = yield* json(path.join(home, ".mcp.json"))
        expect(file.mcpServers.db).toEqual({ command: "${DB_CMD:-pg-mcp}", args: ["--ro"], env: { URL: "${DATABASE_URL}" } })

        const removed = yield* opencode.spawn(["mcp", "remove", "-s", "project", "db"])
        opencode.expectExit(removed, 0)
        const after = yield* json(path.join(home, ".mcp.json"))
        expect(after.mcpServers).toEqual({})
      }),
    60_000,
  )

  cliIt.concurrent(
    "rejects a URL with stdio-only flags",
    ({ opencode }) =>
      Effect.gen(function* () {
        const result = yield* opencode.spawn(["mcp", "add", "x", "https://example.com/mcp", "-e", "A=b"])
        expect(result.exitCode).not.toBe(0)
        expect(result.stderr.toString()).toContain("--env is only valid for stdio servers")
      }),
    60_000,
  )
})

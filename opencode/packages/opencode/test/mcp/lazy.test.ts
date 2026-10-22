// Servers start on first use, project servers wait for approval, and a slow server does not hold
// up the first request.
import path from "node:path"
import fs from "node:fs"
import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { MCP } from "../../src/mcp/index"
import { McpConfig } from "../../src/mcp/config"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(MCP.node))
const fake = path.join(import.meta.dir, "../fixture/mcp-fake-server.ts")
const local = (name: string, ...extra: string[]) => ({
  type: "local" as const,
  command: [process.execPath, fake, "--name", name, "--tools", "2", ...extra],
})

it.instance(
  "a configured server does not start until its tools are needed",
  () =>
    Effect.gen(function* () {
      const mcp = yield* MCP.Service
      expect((yield* mcp.status()).alpha).toEqual({ status: "pending" })
      expect(Object.keys(yield* mcp.clients())).toEqual([])

      expect(Object.keys(yield* mcp.tools())).toEqual(["mcp__alpha__list_issue", "mcp__alpha__get_issue"])
      expect((yield* mcp.status()).alpha).toEqual({ status: "connected" })
    }),
  { config: { mcp: { alpha: local("alpha") } } },
)

it.instance(
  "a project .mcp.json server waits for approval; once starts it, deny is remembered",
  () =>
    Effect.gen(function* () {
      const mcp = yield* MCP.Service
      const test = yield* TestInstance
      expect((yield* mcp.status()).proj).toEqual({ status: "needs_approval" })
      expect(Object.keys(yield* mcp.tools())).toEqual([])

      yield* mcp.approve("proj", "once")
      yield* mcp.settle()
      expect((yield* mcp.status()).proj).toEqual({ status: "connected" })
      expect(Object.keys(yield* mcp.tools())).toContain("mcp__proj__list_issue")
      expect(McpConfig.decision(test.directory, "proj")).toBeUndefined()

      yield* mcp.approve("proj", "deny")
      expect((yield* mcp.status()).proj).toEqual({ status: "disabled" })
      expect(Object.keys(yield* mcp.tools())).toEqual([])
      expect(McpConfig.decision(test.directory, "proj")).toBe("deny")
      McpConfig.remember(test.directory, "proj", undefined)
    }),
  {
    init: (directory) =>
      Effect.sync(() =>
        fs.writeFileSync(
          path.join(directory, ".mcp.json"),
          JSON.stringify({ mcpServers: { proj: { command: process.execPath, args: [fake, "--name", "proj", "--tools", "2"] } } }),
        ),
      ),
  },
)

it.instance(
  "a slow server does not hold up the first request past the startup wait",
  () =>
    Effect.gen(function* () {
      const previous = process.env.OPENCODE_MCP_STARTUP_WAIT
      // Long enough for a cold CI runner to start the fast server, and well under the slow one's 3s.
      process.env.OPENCODE_MCP_STARTUP_WAIT = "1200"
      try {
        const mcp = yield* MCP.Service
        const started = Date.now()
        const tools = Object.keys(yield* mcp.tools())
        expect(Date.now() - started).toBeLessThan(2_800)
        expect(tools).toContain("mcp__fast__list_issue")
        expect(tools).not.toContain("mcp__slow__list_issue")
        expect((yield* mcp.status()).slow).toEqual({ status: "connecting" })

        yield* mcp.settle()
        expect(Object.keys(yield* mcp.tools())).toContain("mcp__slow__list_issue")
      } finally {
        if (previous === undefined) delete process.env.OPENCODE_MCP_STARTUP_WAIT
        else process.env.OPENCODE_MCP_STARTUP_WAIT = previous
      }
    }),
  { config: { mcp: { fast: local("fast"), slow: local("slow", "--delay", "3000") } } },
)

it.instance(
  "turning a server off in /mcp is remembered for the project",
  () =>
    Effect.gen(function* () {
      const mcp = yield* MCP.Service
      const test = yield* TestInstance
      yield* mcp.tools()
      yield* mcp.disconnect("alpha")
      expect(McpConfig.disabled(test.directory).has("alpha")).toBe(true)
      expect(Object.keys(yield* mcp.tools())).toEqual([])
      yield* mcp.connect("alpha")
      expect(McpConfig.disabled(test.directory).has("alpha")).toBe(false)
      expect(Object.keys(yield* mcp.tools())).toContain("mcp__alpha__list_issue")
    }),
  { config: { mcp: { alpha: local("alpha") } } },
)

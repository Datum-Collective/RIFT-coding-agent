// End to end: an MCP server in ~/.rift/mcp.json starts on first use, the first request lists its
// tools by name only through `mcp_search`, a search loads one tool, and the next step can call it.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import fs from "fs"
import path from "path"
import { cliIt } from "../lib/cli-process"

const fake = path.resolve(import.meta.dir, "../fixture/mcp-fake-server.ts")
const toolNames = (body: Record<string, unknown>) =>
  ((body.tools as { function: { name: string } }[] | undefined) ?? []).map((tool) => tool.function.name)

describe("MCP tool search (subprocess)", () => {
  cliIt.concurrent(
    "names only until mcp_search loads a tool, then the tool is callable",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        fs.mkdirSync(path.join(home, ".rift"), { recursive: true })
        fs.writeFileSync(
          path.join(home, ".rift", "mcp.json"),
          JSON.stringify({
            mcpServers: { gh: { command: process.execPath, args: [fake, "--name", "gh", "--tools", "4"] } },
          }),
        )
        yield* llm.tool("mcp_search", { query: "select:mcp__gh__get_issue" })
        yield* llm.tool("mcp__gh__get_issue", { owner: "o", repo: "r" })
        yield* llm.text("done")

        const result = yield* opencode.run("look up the issue", {
          extraArgs: ["--dangerously-skip-permissions"],
          env: { OPENCODE_MCP_TOOL_SEARCH: "always" },
        })
        opencode.expectExit(result, 0)

        const inputs = (yield* llm.inputs).filter((body) => toolNames(body).length > 0)
        expect(inputs.length).toBeGreaterThanOrEqual(3)
        const [first, second, third] = inputs

        // First request: only the search tool, which names the deferred tools.
        expect(toolNames(first).filter((name) => name.startsWith("mcp"))).toEqual(["mcp_search"])
        const search = (first.tools as { function: { name: string; description: string } }[]).find(
          (tool) => tool.function.name === "mcp_search",
        )!
        expect(search.function.description).toContain("- gh: list_issue, get_issue, create_issue, update_issue")

        // After the search, the loaded tool is sent with its full schema.
        expect(toolNames(second)).toContain("mcp__gh__get_issue")
        expect(toolNames(second)).not.toContain("mcp__gh__list_issue")

        // And its call reached the server.
        expect(JSON.stringify(third.messages)).toContain('\\"server\\":\\"gh\\",\\"tool\\":\\"get_issue\\"')
        expect(result.stdout).toContain("done")
      }),
    90_000,
  )

  cliIt.concurrent(
    "a large MCP result is capped near 25k tokens with a truncation note",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        fs.mkdirSync(path.join(home, ".rift"), { recursive: true })
        fs.writeFileSync(
          path.join(home, ".rift", "mcp.json"),
          JSON.stringify({
            mcpServers: {
              big: { command: process.execPath, args: [fake, "--name", "big", "--tools", "1", "--result-bytes", "400000"] },
            },
          }),
        )
        yield* llm.tool("mcp__big__list_issue", { owner: "o", repo: "r" })
        yield* llm.text("done")
        const result = yield* opencode.run("fetch it", {
          extraArgs: ["--dangerously-skip-permissions"],
          env: { OPENCODE_MCP_TOOL_SEARCH: "never" },
        })
        opencode.expectExit(result, 0)
        const last = (yield* llm.inputs).filter((body) => toolNames(body).length > 0).at(-1)!
        const messages = last.messages as { role: string; content: unknown }[]
        const toolResult = JSON.stringify(messages.filter((message) => message.role === "tool"))
        expect(toolResult).toContain("bytes truncated")
        expect(toolResult.length).toBeLessThan(110_000)
        expect(toolResult.length).toBeGreaterThan(90_000)
      }),
    90_000,
  )
})

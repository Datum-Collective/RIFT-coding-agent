// A stdio MCP server with a configurable number of realistic tools, used to measure what MCP
// tool schemas cost per request and to exercise lazy connect and tool search.
// usage: bun mcp-fake-server.ts --name github --tools 20 [--delay 2000]
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const arg = (flag: string, fallback: string) => {
  const index = process.argv.indexOf(flag)
  return index === -1 ? fallback : process.argv[index + 1]
}
const name = arg("--name", "fake")
const count = Number(arg("--tools", "10"))
const delay = Number(arg("--delay", "0"))
const big = Number(arg("--result-bytes", "0"))

const verbs = ["list", "get", "create", "update", "delete", "search", "merge", "close", "assign", "comment"]
const nouns = ["issue", "pull_request", "branch", "file", "commit", "release", "label", "workflow", "review", "user"]

const tools = Array.from({ length: count }, (_, i) => {
  const verb = verbs[i % verbs.length]
  const noun = nouns[Math.floor(i / verbs.length) % nouns.length]
  return {
    name: `${verb}_${noun}${i >= 100 ? `_${i}` : ""}`,
    description: `${verb[0].toUpperCase()}${verb.slice(1)} a ${noun.replace("_", " ")} in the ${name} service. Returns the ${noun.replace("_", " ")} as JSON, including its id, title, state, author, timestamps and URL. Use the owner and repo of the current project unless the user names another.`,
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Account or organisation that owns the repository" },
        repo: { type: "string", description: "Repository name without the owner" },
        id: { type: "number", description: `Numeric id of the ${noun.replace("_", " ")}` },
        query: { type: "string", description: "Free-text filter applied to titles and bodies" },
        state: { type: "string", enum: ["open", "closed", "all"], description: "Filter by state" },
        per_page: { type: "number", description: "Results per page, 1 to 100" },
      },
      required: ["owner", "repo"],
    },
  }
})

if (delay) await new Promise((resolve) => setTimeout(resolve, delay))

const server = new Server({ name, version: "1.0.0" }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, () => Promise.resolve({ tools }))
server.setRequestHandler(CallToolRequestSchema, (request) =>
  Promise.resolve({
    content: [
      {
        type: "text" as const,
        text: big ? "x".repeat(big) : JSON.stringify({ server: name, tool: request.params.name, args: request.params.arguments }),
      },
    ],
  }),
)
await server.connect(new StdioServerTransport())

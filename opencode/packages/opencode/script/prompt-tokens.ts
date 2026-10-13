// Prints the fixed per-request overhead of the first model request: system prompt,
// tool definitions (with the skill block called out) and the user message.
// usage: bun script/prompt-tokens.ts [model] [--tokenizer <path to gpt-tokenizer>] [--mcp]
// --mcp adds five stdio MCP servers (58 tools, test/fixture/mcp-fake-server.ts) to the config.
import path from "path"
import { capture, mainRequest } from "../test/guard/capture"

const args = process.argv.slice(2)
const model = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--tokenizer") ?? "opencode/space-bunny-free"
const tokPath = args.includes("--tokenizer") ? args[args.indexOf("--tokenizer") + 1] : "gpt-tokenizer"
const { encode } = (await import(tokPath)) as { encode: (s: string) => number[] }
const count = (s: string) => encode(s).length

const [provider] = model.split("/")
const fake = path.resolve(import.meta.dir, "../test/fixture/mcp-fake-server.ts")
const mcp = args.includes("--mcp")
  ? Object.fromEntries(
      (
        [
          ["github", 20],
          ["linear", 14],
          ["sentry", 10],
          ["postgres", 8],
          ["slack", 6],
        ] as const
      ).map(([name, tools]) => [
        name,
        { type: "local", command: [process.execPath, fake, "--name", name, "--tools", String(tools)] },
      ]),
    )
  : undefined
const result = await capture({
  model,
  config: (base) => ({
    ...(mcp && { mcp }),
    ...(provider === "opencode"
      ? { provider: { opencode: { options: { baseURL: base + "/zen/v1" } } } }
      : {
          provider: {
            [provider]: {
              npm: "@ai-sdk/openai-compatible",
              options: { baseURL: base + "/v1", apiKey: "k" },
              models: { [model.slice(provider.length + 1)]: { name: "m" } },
            },
          },
        }),
  }),
})
const req = mainRequest(result.requests)
if (!req?.body) {
  console.error("no request captured", result.stdout, result.stderr)
  process.exit(1)
}
const body = req.body
const messages: any[] = body.messages ?? body.input ?? []
const text = (c: any) => (typeof c === "string" ? c : JSON.stringify(c))
const system = [
  ...(typeof body.system === "string" ? [body.system] : Array.isArray(body.system) ? body.system.map(text) : []),
  ...messages.filter((m) => m.role === "system" || m.role === "developer").map((m) => text(m.content)),
]
const tools: any[] = body.tools ?? []
const toolName = (t: any) => t.function?.name ?? t.name
const toolText = (t: any) => JSON.stringify(t)
const skill = tools.find((t) => toolName(t) === "skill")
const builtin = new Set(["bash", "read", "glob", "grep", "edit", "write", "apply_patch", "task", "webfetch", "todowrite", "skill", "browser", "graphwrite", "question", "websearch", "list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"])
const mcpTools = tools.filter((t) => !builtin.has(toolName(t)))
const out = {
  model,
  path: req.path,
  system: { tokens: system.reduce((n, s) => n + count(s), 0), chars: system.join("").length },
  tools: {
    count: tools.length,
    tokens: tools.reduce((n, t) => n + count(toolText(t)), 0),
    skill_tool_tokens: skill ? count(toolText(skill)) : 0,
    mcp: { count: mcpTools.length, tokens: mcpTools.reduce((n, t) => n + count(toolText(t)), 0) },
    per_tool: Object.fromEntries(tools.map((t) => [toolName(t), count(toolText(t))])),
  },
}
console.log(JSON.stringify({ ...out, fixed_total: out.system.tokens + out.tools.tokens }, null, 2))
if (args.includes("--dump")) await Bun.write("/tmp/first-request.json", JSON.stringify(body, null, 2))

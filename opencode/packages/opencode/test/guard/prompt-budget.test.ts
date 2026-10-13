// Guard: the fixed per-request overhead (system prompt plus tool definitions) stays small.
// Counted in characters so the test needs no tokenizer. The real measure is
// script/prompt-tokens.ts, which gave about 2,950 tokens when these limits were set.
import { describe, expect, test } from "bun:test"
import { capture, mainRequest } from "./capture"

describe("prompt budget", () => {
  test("system prompt and tool definitions stay under the budget", async () => {
    const result = await capture({
      model: "opencode/space-bunny-free",
      config: (base) => ({ provider: { opencode: { options: { baseURL: base + "/zen/v1" } } } }),
    })
    const body = mainRequest(result.requests)?.body
    expect(body).toBeDefined()
    const system = (body.messages as { role: string; content: unknown }[])
      .filter((message) => message.role === "system")
      .map((message) => String(message.content))
      .join("")
    const tools = JSON.stringify(body.tools)
    expect(system.length).toBeLessThan(2600)
    expect(tools.length).toBeLessThan(11500)
  }, 90_000)
})

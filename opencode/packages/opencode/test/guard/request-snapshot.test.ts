// Guard: the model request RIFT sends must not change during the debloat.
// Each case runs the real CLI against a local server and snapshots the final URL path, method,
// header names and values, and the body shape (keys and types, not prompt text).
// Run before and after any change to provider, transport or request construction code.
import { describe, expect, test } from "bun:test"
import { capture, mainRequest, normalizeHeaders, shape } from "./capture"

const zen = (base: string) => ({ provider: { opencode: { options: { baseURL: base + "/zen/v1" } } } })

async function snapshot(model: string, config: (base: string) => unknown) {
  const result = await capture({ model, config })
  const req = mainRequest(result.requests)
  expect(req, `no request captured: ${result.stderr}`).toBeDefined()
  return {
    method: req!.method,
    path: req!.path,
    headers: normalizeHeaders(req!.headers, result.base),
    body: shape(req!.body),
    model: req!.body?.model,
    stream: req!.body?.stream,
  }
}

describe("request guard", () => {
  test("opencode free model, openai-compatible transport", async () => {
    expect(await snapshot("opencode/space-bunny-free", zen)).toMatchSnapshot()
  }, 90_000)

  test("opencode model with a key, anthropic transport", async () => {
    expect(
      await snapshot("opencode/claude-haiku-5-5", (base) => ({
        provider: { opencode: { options: { baseURL: base + "/zen/v1", apiKey: "test-key" } } },
      })),
    ).toMatchSnapshot()
  }, 90_000)

  test("opencode free model, openai responses transport", async () => {
    expect(await snapshot("opencode/muse-spark-1.3-contributor-free", zen)).toMatchSnapshot()
  }, 90_000)

  test("custom openai-compatible provider", async () => {
    expect(
      await snapshot("local/some-model", (base) => ({
        provider: {
          local: {
            npm: "@ai-sdk/openai-compatible",
            name: "Local",
            options: { baseURL: base + "/v1", apiKey: "test-key" },
            models: { "some-model": { name: "Some Model" } },
          },
        },
      })),
    ).toMatchSnapshot()
  }, 90_000)

  test("no key: paid opencode models are filtered, free ones stay", async () => {
    const result = await capture({ model: "opencode/gpt-5.4", config: zen })
    // The paid model is not available without a key, so no model request is sent for it.
    expect(result.requests.filter((r) => r.path.includes("/zen/v1/")).length).toBe(0)
  }, 90_000)
})

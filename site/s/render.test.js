import { describe, expect, test } from "bun:test"
import { markdown, render } from "./render.js"

const snapshot = (messages, extra = {}) => ({
  format: "rift-share",
  version: 1,
  session: { id: "ses_1", title: "Fix flaky upload test", time: { created: 0, updated: 14 * 60_000 } },
  messages,
  diffs: [],
  models: [],
  ...extra,
})

const user = (text) => ({
  info: { id: "m1", role: "user", time: { created: 0 } },
  parts: [{ id: "p1", type: "text", text }],
})

const assistant = (parts) => ({
  info: { id: "m2", role: "assistant", modelID: "claude-opus-5-5", agent: "build", time: { created: 1 } },
  parts,
})

describe("render", () => {
  test("shows the title, the model, how long it took and both sides of the conversation", () => {
    const html = render(
      snapshot([user("the upload test fails on CI only"), assistant([{ id: "p2", type: "text", text: "Found it." }])]),
    )
    expect(html).toContain("Fix flaky upload test")
    expect(html).toContain("claude-opus-5-5")
    expect(html).toContain("14 min")
    expect(html).toContain("the upload test fails on CI only")
    expect(html).toContain("Found it.")
  })

  test("folds a tool call into a summary line with its output behind it", () => {
    const html = render(
      snapshot([
        assistant([
          {
            id: "p3",
            type: "tool",
            tool: "bash",
            state: { status: "completed", input: { command: "bun test upload" }, output: "12 passed", title: "bun test upload" },
          },
        ]),
      ]),
    )
    expect(html).toContain("<details")
    expect(html).toContain("bun test upload")
    expect(html).toContain("12 passed")
  })

  test("marks a failed tool call as failed", () => {
    const html = render(
      snapshot([
        assistant([{ id: "p4", type: "tool", tool: "bash", state: { status: "error", input: {}, error: "exit 1" } }]),
      ]),
    )
    expect(html).toContain("exit 1")
    expect(html).toContain("failed")
  })

  test("colours added and removed lines in a diff", () => {
    const html = render(
      snapshot([], {
        diffs: [{ file: "a.ts", patch: "@@ -1 +1 @@\n-old\n+new\n", additions: 1, deletions: 1 }],
      }),
    )
    expect(html).toContain('class="add"')
    expect(html).toContain('class="del"')
    expect(html).toContain("a.ts")
  })

  test("shows the checks RIFT ran, with the result of each", () => {
    const html = render(
      snapshot([
        assistant([
          {
            id: "p5",
            type: "text",
            text: "Done.",
            metadata: {
              rift_verification: {
                checks: [
                  { command: "bun test", status: "passed", ms: 900 },
                  { command: "bun run typecheck", status: "failed", reason: "2 errors", ms: 400 },
                ],
              },
            },
          },
        ]),
      ]),
    )
    expect(html).toContain("✓")
    expect(html).toContain("bun test")
    expect(html).toContain("✗")
    expect(html).toContain("2 errors")
  })

  test("never lets shared content inject markup or script", () => {
    const html = render(
      snapshot([
        user('<img src=x onerror="alert(1)"> [click](javascript:alert(1))'),
        assistant([
          {
            id: "p6",
            type: "tool",
            tool: "<script>alert(1)</script>",
            state: { status: "completed", input: {}, output: "<script>alert(2)</script>", title: "<b>t</b>" },
          },
        ]),
      ]),
    )
    expect(html).not.toContain("<img")
    expect(html).not.toContain("<script")
    expect(html).not.toContain("<b>t")
    expect(html).not.toContain('href="javascript:')
  })
})

describe("render with hostile change counts", () => {
  test("treats change counts as numbers, never as markup", () => {
    const html = render(
      snapshot([], { diffs: [{ file: "a.ts", patch: "", additions: "<b>9</b>", deletions: '"><i>x' }] }),
    )
    expect(html).not.toContain("<b>9")
    expect(html).not.toContain("<i>x")
  })

  test("keeps the change summary formatted when there is no model or duration", () => {
    const html = render({
      ...snapshot([], { diffs: [{ file: "a.ts", patch: "", additions: 3, deletions: 1 }] }),
      session: { id: "s", title: "t", time: { created: 0, updated: 0 } },
    })
    expect(html).toContain('<span class="add">+3</span>')
    expect(html).not.toContain("&lt;span")
  })
})

describe("markdown", () => {
  test("renders code fences, inline code, bold, lists and safe links", () => {
    const html = markdown("**Fix**: use `waitFor`\n\n- one\n- two\n\n```ts\nconst a = 1 < 2\n```\n\n[docs](https://example.com)")
    expect(html).toContain("<strong>Fix</strong>")
    expect(html).toContain("<code>waitFor</code>")
    expect(html).toContain("<li>one</li>")
    expect(html).toContain("const a = 1 &lt; 2")
    expect(html).toContain('<a href="https://example.com"')
  })
})

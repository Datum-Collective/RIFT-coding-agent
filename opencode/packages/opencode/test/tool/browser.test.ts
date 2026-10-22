import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { BrowserTool, closeBrowser, parseSteps } from "../../src/tool/browser"
import { find } from "../../src/browser/discover"
import { SessionID, MessageID } from "../../src/session/schema"
import { Tool } from "@/tool/tool"
import { testEffect } from "../lib/effect"
import { provideTmpdirInstance } from "../fixture/fixture"

// The first browser launch on a cold machine can take longer than the 30s default.
setDefaultTimeout(90_000)

const it = testEffect(LayerNode.compile(LayerNode.group([Truncate.node, Agent.node, CrossSpawnSpawner.node])))

const asked: { permission: string; patterns: readonly string[] }[] = []
const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_message"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: (input: { permission: string; patterns: readonly string[] }) => {
    asked.push({ permission: input.permission, patterns: input.patterns })
    return Effect.void
  },
}

const exec = Effect.fn("BrowserToolTest.exec")(function* (args: Tool.InferParameters<typeof BrowserTool>) {
  const info = yield* BrowserTool
  const tool = yield* info.init()
  return yield* tool.execute(args, ctx)
})

let server: ReturnType<typeof Bun.serve>
let base = ""

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const pathname = new URL(request.url).pathname
      const broken = pathname === "/broken"
      if (pathname === "/slow") await Bun.sleep(300)
      return new Response(
        `<!doctype html><title>${broken ? "Broken page" : "Tool page"}</title>
         <p id="body">hello from the page</p><input id="field">
         ${broken ? "<script>missingFunction()</script>" : ""}`,
        { headers: { "content-type": "text/html" } },
      )
    },
  })
  base = `http://localhost:${server.port}`
})
afterAll(async () => {
  await closeBrowser()
  server?.stop(true)
})

describe("tool.browser steps", () => {
  test("parses a one-line script", () => {
    expect(parseSteps("click #inc; text #count\n type #name = Ada Lovelace ; screenshot;")).toEqual([
      { action: "click", selector: "#inc" },
      { action: "text", selector: "#count" },
      { action: "type", selector: "#name", value: "Ada Lovelace" },
      { action: "screenshot", selector: undefined },
    ])
  })

  test("an = inside the selector is not where the typed text starts", () => {
    expect(parseSteps('type input[name=email] = bad; type [data-x="a=b"]=c=d')).toEqual([
      { action: "type", selector: "input[name=email]", value: "bad" },
      { action: "type", selector: '[data-x="a=b"]', value: "c=d" },
    ])
  })

  test("names a bad step instead of guessing", () => {
    expect(() => parseSteps("click #a; hover #b")).toThrow('Unknown step "hover #b"')
    expect(() => parseSteps("type #a")).toThrow("type <selector> = <text>")
  })
})

describe("tool.browser", () => {
  it.effect("registers with the browser id", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const info = yield* BrowserTool
        expect(info.id).toBe("browser")
      }),
    ),
  )

  it.effect("rejects a url that is not http, https or file", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        for (const url of ["ftp://example.com", "javascript:alert(1)", "example.com"]) {
          expect((yield* Effect.exit(exec({ action: "open", url })))._tag).toBe("Failure")
        }
      }),
    ),
  )

  it.effect("names the missing argument instead of failing obscurely", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        expect((yield* Effect.exit(exec({ action: "open" })))._tag).toBe("Failure")
        expect((yield* Effect.exit(exec({ action: "click" })))._tag).toBe("Failure")
        expect((yield* Effect.exit(exec({ action: "type", selector: "#field" })))._tag).toBe("Failure")
      }),
    ),
  )

  if (find()) {
    it.effect("opens a page, asks permission for it, and reports what rendered", () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          asked.length = 0
          const result = yield* exec({ action: "open", url: `${base}/` })
          expect(result.output).toContain("Title: Tool page")
          expect(result.output).toContain("HTTP status: 200")
          expect(result.output).toContain("No console errors.")
          // Driving a page reaches the network, so it goes through the same permission as
          // opening a URL rather than quietly acquiring a new capability.
          expect(asked).toEqual([{ permission: "browser_open", patterns: [`${base}/`] }])
        }),
      ),
    )

    it.effect("opens a local file page, asking the same permissions as reading that file", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const inside = path.join(dir, "index.html")
          yield* Effect.promise(() => Bun.write(inside, "<!doctype html><title>Local site</title><p>hi</p>"))
          asked.length = 0
          const result = yield* exec({ action: "open", url: pathToFileURL(inside).href })
          expect(result.output).toContain("Title: Local site")
          expect(asked.map((item) => item.permission)).toEqual(["read"])
          expect(asked[0].patterns[0].endsWith("index.html")).toBe(true)

          const site = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "browser-site-")))
          const outside = path.join(site, "index.html")
          yield* Effect.promise(() => Bun.write(outside, "<!doctype html><title>Desktop site</title>"))
          asked.length = 0
          expect((yield* exec({ action: "open", url: pathToFileURL(outside).href })).output).toContain(
            "Title: Desktop site",
          )
          expect(asked.map((item) => item.permission)).toEqual(["external_directory", "read"])
        }),
      ),
    )

    it.effect("opens a project file given as a plain path", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => Bun.write(path.join(dir, "page.html"), "<title>Plain path</title><p>hi</p>"))
          const result = yield* exec({ action: "open", url: "page.html", steps: "text" })
          expect(result.output).toContain("Title: Plain path")
          expect(result.output).toContain("hi")
        }),
      ),
    )

    it.effect("surfaces console errors on a page that still looks fine", () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const result = yield* exec({ action: "open", url: `${base}/broken` })
          expect(result.output).toContain("Title: Broken page")
          expect(result.output).toContain("console")
          expect(result.output).toMatch(/missingFunction|not defined/)
        }),
      ),
    )

    it.effect("reads text and interacts with the page it already opened", () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          yield* exec({ action: "open", url: `${base}/` })
          const text = yield* exec({ action: "text", selector: "#body" })
          expect(text.output.trim()).toBe("hello from the page")

          const typed = yield* exec({ action: "type", selector: "#field", value: "abc" })
          expect(typed.output).toContain("#field")

          const missing = yield* Effect.exit(exec({ action: "click", selector: "#absent" }))
          expect(missing._tag).toBe("Failure")
        }),
      ),
    )

    it.effect("runs a whole check in one call with steps", () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const result = yield* exec({
            action: "open",
            url: `${base}/`,
            steps: "type #field = abc; text #body; screenshot",
          })
          expect(result.output).toContain("[1] Browser open")
          expect(result.output).toContain("Set #field")
          expect(result.output).toContain("hello from the page")
          expect(result.attachments?.[0]?.mime).toBe("image/png")
        }),
      ),
    )

    it.effect("stops the steps at the first one that fails and says why", () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const result = yield* exec({
            action: "open",
            url: `${base}/`,
            steps: "click #absent; screenshot",
          })
          expect(result.output).toContain("[2] Browser click")
          expect(result.output).toContain("Failed: ")
          expect(result.attachments ?? []).toEqual([])
        }),
      ),
    )

    it.effect("accepts steps as the action, opening the url first", () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const result = yield* exec({ action: "steps", url: `${base}/`, steps: "text #body" })
          expect(result.output).toContain("[1] Browser open")
          expect(result.output).toContain("hello from the page")
          // What the model actually sent: no steps at all, meaning just the page.
          const bare = yield* exec({ action: "steps", url: `${base}/` })
          expect(bare.output).toContain("Title: Tool page")
        }),
      ),
    )

    it.effect("calls made at the same time each report their own page", () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const [slow, fast] = yield* Effect.all(
            [exec({ action: "open", url: `${base}/slow` }), exec({ action: "open", url: `${base}/fast` })],
            { concurrency: "unbounded" },
          )
          expect(slow.output).toContain(`URL: ${base}/slow`)
          expect(fast.output).toContain(`URL: ${base}/fast`)
        }),
      ),
    )

    it.effect("starts a new browser when the old one died", () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          yield* exec({ action: "open", url: `${base}/` })
          const browsers = Bun.spawnSync(["ps", "-Ao", "pid,ppid,command"])
            .stdout.toString()
            .split("\n")
            .map((line) => line.trim().split(/\s+/))
            .filter((row) => row[1] === String(process.pid) && row.some((part) => part.includes("rift-browser-")))
          expect(browsers.length).toBeGreaterThan(0)
          browsers.forEach((row) => process.kill(Number(row[0]), "SIGKILL"))
          yield* Effect.promise(() => Bun.sleep(300))
          const result = yield* exec({ action: "open", url: `${base}/` })
          expect(result.output).toContain("Title: Tool page")
        }),
      ),
    )

    it.effect("captures a screenshot as a png attachment", () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          yield* exec({ action: "open", url: `${base}/` })
          const result = yield* exec({ action: "screenshot" })
          const attachment = result.attachments?.[0]
          expect(attachment?.mime).toBe("image/png")
          expect(attachment?.url.startsWith("data:image/png;base64,")).toBe(true)
        }),
      ),
    )

    it.effect("loads a url and screenshots it in one call, asking permission for the url", () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          asked.length = 0
          const result = yield* exec({ action: "screenshot", url: `${base}/broken` })
          expect(result.attachments?.[0]?.mime).toBe("image/png")
          // Looking once should also say what rendered, so no separate open call is needed.
          expect(result.output).toContain("Title: Broken page")
          expect(result.output).toMatch(/missingFunction|not defined/)
          expect(asked).toEqual([{ permission: "browser_open", patterns: [`${base}/broken`] }])
        }),
      ),
    )
  }
})

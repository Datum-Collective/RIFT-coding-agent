import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./browser.txt"
import { BrowserSession, type ConsoleEntry, type PageState } from "../browser/session"
import { find, NOT_FOUND } from "../browser/discover"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["open", "read", "text", "click", "type", "screenshot"]).annotate({
    description: "What to do with the page",
  }),
  url: Schema.optional(Schema.String).annotate({ description: "URL to load. Required for `open`" }),
  selector: Schema.optional(Schema.String).annotate({
    description: "CSS selector. Required for `click` and `type`, optional for `text`",
  }),
  value: Schema.optional(Schema.String).annotate({ description: "Text to enter. Required for `type`" }),
})

type Params = Schema.Schema.Type<typeof Parameters>

/**
 * One browser per RIFT process, opened on first use. Launching a browser costs a second or two,
 * so a session that opens a page and then reads and clicks it should not pay that each time.
 */
let shared: Promise<BrowserSession> | undefined

function session() {
  shared ??= BrowserSession.launch().catch((error) => {
    shared = undefined
    throw error
  })
  return shared
}

/** Closes the shared browser. Exported so a host can shut it down when it exits. */
export async function closeBrowser() {
  const pending = shared
  shared = undefined
  if (!pending) return
  await pending.then((item) => item.close()).catch(() => {})
}

function describeConsole(state: PageState) {
  if (state.console.length === 0) return "No console errors."
  const lines = state.console.map((entry) => `- ${entry.level}: ${entry.text}${entry.url ? ` (${entry.url})` : ""}`)
  return [`${state.console.length} console ${state.console.length === 1 ? "message" : "messages"}:`, ...lines].join(
    "\n",
  )
}

function describePage(state: PageState) {
  return [
    `URL: ${state.url}`,
    `Title: ${state.title || "(none)"}`,
    ...(state.status === undefined ? [] : [`HTTP status: ${state.status}`]),
    describeConsole(state),
  ].join("\n")
}

type Meta = {
  url?: string
  status?: number
  console?: ConsoleEntry[]
}

/** Every action returns the same shape, so the tool's metadata stays one type. */
function reply(input: {
  title: string
  output: string
  metadata?: Meta
  attachments?: { type: "file"; mime: string; filename: string; url: string }[]
}) {
  return {
    title: input.title,
    output: input.output,
    metadata: (input.metadata ?? {}) as Meta,
    ...(input.attachments ? { attachments: input.attachments } : {}),
  }
}

function required(value: string | undefined, name: string, action: string) {
  if (!value) throw new Error(`\`${name}\` is required for the \`${action}\` action`)
  return value
}

export const BrowserTool = Tool.define(
  "browser",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Params, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!find()) throw new Error(NOT_FOUND)

          // Driving a browser can reach anything on the network, so it asks the same way the
          // URL-opening tool does rather than quietly acquiring a new capability.
          const target = params.action === "open" ? required(params.url, "url", "open") : undefined
          if (target) {
            if (!/^https?:\/\//.test(target)) throw new Error("url must start with http:// or https://")
            yield* ctx.ask({
              permission: "browser_open",
              patterns: [target],
              always: ["*"],
              metadata: { url: target, action: params.action },
            })
          }

          const browser = yield* Effect.promise(() => session())

          switch (params.action) {
            case "open": {
              const state = yield* Effect.promise(() => browser.navigate(target!))
              return reply({
                title: `Browser open ${state.url}`,
                output: describePage(state),
                metadata: { url: state.url, status: state.status, console: state.console },
              })
            }
            case "read": {
              const state = yield* Effect.promise(() => browser.read())
              return reply({
                title: `Browser read ${state.url}`,
                output: describePage(state),
                metadata: { url: state.url, console: state.console },
              })
            }
            case "text": {
              const text = yield* Effect.promise(() => browser.text(params.selector))
              return reply({
                title: params.selector ? `Browser text ${params.selector}` : "Browser text",
                output: text || "(no text)",
                metadata: {},
              })
            }
            case "click": {
              const selector = required(params.selector, "selector", "click")
              yield* Effect.promise(() => browser.click(selector))
              const state = yield* Effect.promise(() => browser.read())
              return reply({
                title: `Browser click ${selector}`,
                output: [`Clicked ${selector}.`, describePage(state)].join("\n"),
                metadata: { console: state.console },
              })
            }
            case "type": {
              const selector = required(params.selector, "selector", "type")
              const value = required(params.value, "value", "type")
              yield* Effect.promise(() => browser.type(selector, value))
              return reply({
                title: `Browser type ${selector}`,
                output: `Set ${selector} to ${JSON.stringify(value)}.`,
                metadata: {},
              })
            }
            case "screenshot": {
              const data = yield* Effect.promise(() => browser.screenshot())
              const state = yield* Effect.promise(() => browser.read())
              return reply({
                title: `Browser screenshot ${state.url}`,
                output: `Captured a PNG of ${state.url} (${Math.round(data.length / 1024)} KB base64).`,
                metadata: { url: state.url },
                attachments: [
                  {
                    type: "file" as const,
                    mime: "image/png",
                    filename: "screenshot.png",
                    url: `data:image/png;base64,${data}`,
                  },
                ],
              })
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)

import { existsSync } from "fs"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { Cause, Effect, Schema, Semaphore, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import * as Tool from "./tool"
import DESCRIPTION from "./browser.txt"
import { BrowserSession, type ConsoleEntry, type PageState } from "../browser/session"
import { find, NOT_FOUND } from "../browser/discover"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["open", "read", "text", "click", "type", "screenshot", "steps", "external"]).annotate({
    description: "Page action",
  }),
  url: Schema.optional(Schema.String).annotate({
    description: "http(s):// or file:// url; needed for open and external",
  }),
  selector: Schema.optional(Schema.String).annotate({
    description: "CSS selector",
  }),
  value: Schema.optional(Schema.String).annotate({ description: "Text for type" }),
  steps: Schema.optional(Schema.String).annotate({
    description:
      'More actions on the same page in the same call, separated by ";", e.g. "click #inc; click #inc; text #count; type #name = Ada; screenshot"',
  }),
})

type Params = Schema.Schema.Type<typeof Parameters>

const STEP_ACTIONS = new Set(["read", "text", "click", "type", "screenshot"])

/** Index of the `=` that ends a type step's selector: not one inside `[name=email]` or quotes. */
function separator(target: string) {
  const state = { depth: 0, quote: "" }
  return [...target].findIndex((char) => {
    if (state.quote) {
      if (char === state.quote) state.quote = ""
      return false
    }
    if (char === '"' || char === "'") state.quote = char
    if (char === "[") state.depth++
    if (char === "]") state.depth--
    return char === "=" && state.depth === 0
  })
}

/**
 * Parses `steps`. A plain string rather than an array of objects: weaker models mangle nested
 * tool arguments, but write a short command line reliably.
 */
export function parseSteps(steps: string): Step[] {
  return steps
    .split(/;|\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [word = "", ...rest] = item.split(/\s+/)
      const action = word.toLowerCase()
      if (!STEP_ACTIONS.has(action))
        throw new Error(`Unknown step "${item}"; steps can be ${[...STEP_ACTIONS].join(", ")}`)
      const target = rest.join(" ")
      if (action !== "type") return { action: action as Step["action"], selector: target || undefined }
      const split = separator(target)
      if (split < 0) throw new Error(`Step "${item}" needs "type <selector> = <text>"`)
      return { action: "type" as const, selector: target.slice(0, split).trim(), value: target.slice(split + 1).trim() }
    })
}

/**
 * One browser per RIFT process, opened on first use. Launching a browser costs a second or two,
 * so a session that opens a page and then reads and clicks it should not pay that each time.
 * A browser that died (crashed, killed, out of memory) is replaced: kept, it failed every later
 * call with "browser session closed" for the rest of the session.
 */
let shared: Promise<BrowserSession> | undefined

async function session() {
  const current = await shared?.catch(() => undefined)
  if (current && !current.closed) return current
  if (current) current.close().catch(() => {})
  shared = BrowserSession.launch().catch((error) => {
    shared = undefined
    throw error
  })
  return shared
}

// The browser has one tab, and every call drives it. Two calls at once (models issue them in
// parallel) navigated over each other and each reported the other's page.
const turn = Semaphore.makeUnsafe(1)

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

function describeFailure(cause: Cause.Cause<unknown>) {
  const error = Cause.squash(cause)
  return error instanceof Error ? error.message : String(error)
}

function required(value: string | undefined, name: string, action: string) {
  if (!value) throw new Error(`\`${name}\` is required for the \`${action}\` action`)
  return value
}

function externalCommand(url: string) {
  if (process.platform === "darwin") return ChildProcess.make("open", [url])
  if (process.platform === "win32") return ChildProcess.make("cmd", ["/c", "start", "", url])
  return ChildProcess.make("xdg-open", [url])
}

export const BrowserTool = Tool.define(
  "browser",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Params, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (params.action === "external") {
            // Hand a page to the user's own browser. Nothing is read back, so no controlled browser is needed.
            const raw = required(params.url, "url", "external")
            const url = raw.startsWith("http://") ? raw.replace("http://", "https://") : raw
            if (!url.startsWith("https://")) throw new Error("URL must start with http:// or https://")
            yield* ctx.ask({
              permission: "browser_open",
              patterns: [url],
              always: ["*"],
              metadata: { url, action: "external" },
            })
            const code = yield* Effect.scoped(
              Effect.gen(function* () {
                const handle = yield* spawner.spawn(externalCommand(url))
                yield* Effect.forkScoped(Stream.runDrain(handle.all))
                return yield* handle.exitCode
              }),
            )
            if (code !== 0) throw new Error(`Unable to open browser (exit code ${code})`)
            return reply({ title: `Browser external ${url}`, output: `Opened ${url} in the default browser.` })
          }

          if (!find()) throw new Error(NOT_FOUND)

          // Driving a browser can reach anything on the network, so it asks the same way the
          // URL-opening tool does rather than quietly acquiring a new capability.
          const instance = yield* InstanceState.context
          const raw =
            params.action === "open"
              ? required(params.url, "url", "open")
              : params.action === "screenshot" || params.action === "steps"
                ? params.url
                : undefined
          // A bare path like `index.html` is a local file in the project, so the agent needs no
          // extra step to work out an absolute file:// url first.
          const local = raw && !/^[a-z][a-z0-9+.-]*:/i.test(raw) ? path.resolve(instance.directory, raw) : undefined
          const target = local && existsSync(local) ? pathToFileURL(local).href : raw
          if (target?.startsWith("file://")) {
            // A local page is a file read, so it asks exactly like the read tool does.
            const file = fileURLToPath(target)
            yield* assertExternalDirectoryEffect(ctx, file)
            yield* ctx.ask({
              permission: "read",
              patterns: [path.relative(instance.worktree, file)],
              always: ["*"],
              metadata: {},
            })
          }
          if (target && !target.startsWith("file://")) {
            if (!/^https?:\/\//.test(target)) throw new Error("url must start with http://, https:// or file://")
            yield* ctx.ask({
              permission: "browser_open",
              patterns: [target],
              always: ["*"],
              metadata: { url: target, action: params.action },
            })
          }

          // `steps` with nothing to run is still a clear request: the page at `url`, or the current one.
          const steps = params.steps?.trim() ? parseSteps(params.steps) : []

          return yield* Effect.gen(function* () {
            const browser = yield* Effect.promise(() => session())
            const first = yield* perform(browser, params, target)
            // One click per call is a model round trip per click; say so once the agent does it.
            if (steps.length === 0)
              return ["click", "type"].includes(params.action)
                ? { ...first, output: `${first.output}\n(Batch the rest of a check into one call with steps.)` }
                : first
            // A whole check (open, click, read, screenshot) in one call instead of one model turn each.
            const results = [first]
            for (const step of steps) {
              const result = yield* perform(browser, step, undefined).pipe(
                Effect.catchCause((cause) =>
                  Effect.succeed(
                    reply({ title: `Browser ${step.action}`, output: `Failed: ${describeFailure(cause)}` }),
                  ),
                ),
              )
              results.push(result)
              if (result.output.startsWith("Failed: ")) break
            }
            return reply({
              title: `${first.title} (+${results.length - 1} steps)`,
              output: results.map((result, i) => `[${i + 1}] ${result.title}\n${result.output}`).join("\n\n"),
              metadata: first.metadata,
              attachments: results.flatMap((result) => result.attachments ?? []),
            })
          }).pipe(turn.withPermits(1))
        }).pipe(Effect.orDie),
    }
  }),
)

type Step = Pick<Params, "action" | "selector" | "value">

function perform(browser: BrowserSession, params: Step, target: string | undefined) {
  return Effect.gen(function* () {
    switch (params.action) {
      case "steps":
      case "open": {
        if (!target) {
          const state = yield* Effect.promise(() => browser.read())
          return reply({
            title: `Browser read ${state.url}`,
            output: describePage(state),
            metadata: { url: state.url, console: state.console },
          })
        }
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
        // Loading and capturing in one call saves the agent a whole model turn per look.
        const opened = target ? yield* Effect.promise(() => browser.navigate(target)) : undefined
        const data = yield* Effect.promise(() => browser.screenshot())
        const state = opened ?? (yield* Effect.promise(() => browser.read()))
        const captured = `Captured a PNG of ${state.url} (${Math.round(data.length / 1024)} KB base64).`
        return reply({
          title: `Browser screenshot ${state.url}`,
          output: opened ? [describePage(opened), captured].join("\n") : captured,
          metadata: { url: state.url, status: opened?.status, console: opened?.console },
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
    throw new Error(`\`${params.action}\` is not a page action`)
  })
}

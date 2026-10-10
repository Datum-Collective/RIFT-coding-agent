// Runs the CLI against a local HTTP server and records every outgoing model request.
// The provider base URL is pointed at the server through config only, so the request is
// built by the same code path real traffic uses (headers, URL, body, transport).
import { mkdtempSync, mkdirSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

export type Captured = {
  method: string
  path: string
  headers: Record<string, string>
  body: any
  raw: string
}

const root = path.resolve(import.meta.dir, "../..")
export const fixtureModels = path.join(import.meta.dir, "fixtures", "models.json")

export async function capture(input: {
  model: string
  prompt?: string
  config: (baseURL: string) => unknown
  modelsPath?: string
  env?: Record<string, string>
  entry?: string
  args?: string[]
}) {
  const requests: Captured[] = []
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url)
      const raw = await req.text()
      let body: any = undefined
      try {
        body = raw ? JSON.parse(raw) : undefined
      } catch {}
      requests.push({
        method: req.method,
        path: url.pathname + url.search,
        headers: Object.fromEntries([...req.headers.entries()].sort(([a], [b]) => a.localeCompare(b))),
        body,
        raw,
      })
      // A non-retryable error ends the run fast; the request is what we are after.
      return new Response(JSON.stringify({ error: { message: "capture", type: "capture" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    },
  })
  const base = `http://127.0.0.1:${server.port}`
  const home = mkdtempSync(path.join(tmpdir(), "rift-capture-"))
  const project = path.join(home, "project")
  mkdirSync(project, { recursive: true })
  writeFileSync(path.join(project, "README.md"), "# capture\n")
  try {
    const proc = Bun.spawn(
      ["bun", "run", input.entry ?? path.join(root, "src/index.ts"), ...(input.args ?? []), "run", "--model", input.model, input.prompt ?? "reply with pong"],
      {
        cwd: project,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          PATH: process.env.PATH!,
          HOME: home,
          XDG_DATA_HOME: path.join(home, "share"),
          XDG_CACHE_HOME: path.join(home, "cache"),
          XDG_CONFIG_HOME: path.join(home, "config"),
          XDG_STATE_HOME: path.join(home, "state"),
          OPENCODE_MODELS_PATH: input.modelsPath ?? fixtureModels,
          OPENCODE_DISABLE_MODELS_FETCH: "1",
          OPENCODE_DISABLE_AUTOUPDATE: "1",
          OPENCODE_CONFIG_CONTENT: JSON.stringify(input.config(base)),
          ...input.env,
        },
      },
    )
    const timer = setTimeout(() => proc.kill(), 60_000)
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    await proc.exited
    clearTimeout(timer)
    return { requests, stdout, stderr, base }
  } finally {
    server.stop(true)
  }
}

// The main chat request is the one that carries tool definitions.
export function mainRequest(requests: Captured[]) {
  return requests.find((r) => Array.isArray(r.body?.tools) && r.body.tools.length > 0) ?? requests.at(-1)
}

const ID = /\b(ses|msg|prj|per|pro|usr|call)_[A-Za-z0-9]+\b/g

// Header names and values with run-specific ids and the version replaced by placeholders.
export function normalizeHeaders(headers: Record<string, string>, base: string) {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (k === "content-length") continue
    let value = v.replaceAll(base, "<base>").replace(ID, "<id>")
    if (k === "user-agent") value = value.replace(/opencode\/\S+/, "opencode/<version>").replace(/runtime\/bun\/\S+/, "runtime/bun/<v>")
    if (k === "host") value = "<host>"
    if (k === "x-opencode-project") value = "<project>"
    if (/^(x-opencode-session|x-opencode-request|x-session-affinity|x-session-id)$/.test(k)) value = "<id>"
    out[k] = value
  }
  return out
}

// The structure of a JSON value with leaf values reduced to their type. Prompt text and tool
// descriptions are allowed to change in the prompt diet; keys, nesting and transport are not.
export function shape(value: any, depth = 0): any {
  if (Array.isArray(value)) {
    if (value.length === 0) return []
    if (depth > 0 && value.length > 1 && value.every((v) => typeof v === "object" && v !== null)) {
      const keys = new Set(value.flatMap((v) => Object.keys(v)))
      return ["*", ...[...keys].sort()]
    }
    return value.slice(0, 3).map((v) => shape(v, depth + 1))
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, shape(v, depth + 1)]),
    )
  }
  return typeof value
}

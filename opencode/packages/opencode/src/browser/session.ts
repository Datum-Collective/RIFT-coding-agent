/**
 * Drives a real page: launch a browser, open a tab, navigate, read it, and collect the console
 * errors a screenshot would never show.
 */
import fs from "fs/promises"
import os from "os"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import { Shell } from "@opencode-ai/core/shell"
import { CdpSession } from "./cdp"
import { find, NOT_FOUND, type BrowserBinary } from "./discover"

export type ConsoleEntry = {
  level: "error" | "warning"
  text: string
  url?: string
}

export type PageState = {
  url: string
  title: string
  /** HTTP status of the main document, when the browser reported one. */
  status?: number
  console: ConsoleEntry[]
}

const LAUNCH_TIMEOUT_MS = 20_000

function endpointFrom(line: string) {
  const match = /ws:\/\/\S+/.exec(line)
  return match?.[0]
}

/** Reads the DevTools endpoint the browser prints on startup. */
function waitForEndpoint(proc: ChildProcess, timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    let buffered = ""
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`browser did not report a DevTools endpoint within ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)
    const onData = (chunk: Buffer) => {
      buffered += chunk.toString()
      const endpoint = endpointFrom(buffered)
      if (!endpoint) return
      cleanup()
      resolve(endpoint)
    }
    const onExit = (code: number | null) => {
      cleanup()
      reject(new Error(`browser exited with code ${code ?? "unknown"} before it was ready`))
    }
    function cleanup() {
      clearTimeout(timer)
      proc.stderr?.off("data", onData)
      proc.off("exit", onExit)
    }
    proc.stderr?.on("data", onData)
    proc.once("exit", onExit)
  })
}

export class BrowserSession {
  private constructor(
    private readonly proc: ChildProcess,
    private readonly socket: WebSocket,
    private readonly cdp: CdpSession,
    private readonly profile: string,
    readonly binary: BrowserBinary,
  ) {}

  private target?: string
  private entries: ConsoleEntry[] = []

  static async launch(options: { binary?: BrowserBinary; timeoutMs?: number } = {}) {
    const binary = options.binary ?? find()
    if (!binary) throw new Error(NOT_FOUND)

    // A throwaway profile keeps the user's real browser data untouched.
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), "rift-browser-"))
    const proc = spawn(
      binary.path,
      [
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-extensions",
        ...(binary.kind === "headless-shell" ? [] : ["--headless=new"]),
      ],
      { stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" },
    )

    let endpoint: string
    try {
      endpoint = await waitForEndpoint(proc, options.timeoutMs ?? LAUNCH_TIMEOUT_MS)
    } catch (error) {
      await Shell.killTree(proc).catch(() => {})
      await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
      throw error
    }

    const socket = new WebSocket(endpoint)
    const cdp = new CdpSession((payload) => socket.send(payload))
    socket.addEventListener("message", (event) => cdp.receive(String(event.data)))
    socket.addEventListener("close", () => cdp.close())
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true })
      socket.addEventListener("error", () => reject(new Error("could not connect to the browser")), { once: true })
    })

    return new BrowserSession(proc, socket, cdp, profile, binary)
  }

  /** Opens a tab and starts collecting console errors. */
  private async attach() {
    if (this.target) return this.target
    const created = await this.cdp.command("Target.createTarget", { url: "about:blank" })
    const targetId = String(created["targetId"])
    const attached = await this.cdp.command("Target.attachToTarget", { targetId, flatten: true })
    const sessionId = String(attached["sessionId"])
    this.target = sessionId

    this.cdp.on((event) => {
      if (event.sessionId !== sessionId) return
      if (event.method === "Runtime.exceptionThrown") {
        const details = event.params["exceptionDetails"] as Record<string, unknown> | undefined
        const exception = details?.["exception"] as Record<string, unknown> | undefined
        const text = String(exception?.["description"] ?? details?.["text"] ?? "uncaught exception")
        this.entries.push({ level: "error", text })
        return
      }
      if (event.method === "Log.entryAdded") {
        const entry = event.params["entry"] as Record<string, unknown> | undefined
        const level = String(entry?.["level"] ?? "")
        if (level !== "error" && level !== "warning") return
        this.entries.push({
          level,
          text: String(entry?.["text"] ?? ""),
          url: entry?.["url"] ? String(entry["url"]) : undefined,
        })
      }
    })

    await this.cdp.command("Page.enable", {}, sessionId)
    await this.cdp.command("Runtime.enable", {}, sessionId)
    await this.cdp.command("Log.enable", {}, sessionId)
    await this.cdp.command("Network.enable", {}, sessionId)
    return sessionId
  }

  async navigate(url: string, timeoutMs = 30_000): Promise<PageState> {
    const sessionId = await this.attach()
    this.entries = []

    let status: number | undefined
    const offResponse = this.cdp.on((event) => {
      if (event.sessionId !== sessionId || event.method !== "Network.responseReceived") return
      if (event.params["type"] !== "Document" || status !== undefined) return
      const response = event.params["response"] as Record<string, unknown> | undefined
      if (typeof response?.["status"] === "number") status = response["status"]
    })

    const loaded = this.cdp.waitFor("Page.loadEventFired", timeoutMs)
    await this.cdp.command("Page.navigate", { url }, sessionId)
    try {
      await loaded
    } finally {
      offResponse()
    }

    const state = await this.read()
    return { ...state, status }
  }

  /** Current url, title and everything the console has reported since navigation. */
  async read(): Promise<PageState> {
    const sessionId = await this.attach()
    const result = await this.cdp.command(
      "Runtime.evaluate",
      { expression: "({ url: location.href, title: document.title })", returnByValue: true },
      sessionId,
    )
    const value = (result["result"] as Record<string, unknown> | undefined)?.["value"] as
      | { url?: string; title?: string }
      | undefined
    return {
      url: value?.url ?? "about:blank",
      title: value?.title ?? "",
      console: [...this.entries],
    }
  }

  /** Visible text of the page, or of one selector, truncated for a model to read. */
  async text(selector?: string, limit = 20_000) {
    const sessionId = await this.attach()
    const expression = selector
      ? `(document.querySelector(${JSON.stringify(selector)})?.innerText ?? "")`
      : "(document.body?.innerText ?? '')"
    const result = await this.cdp.command("Runtime.evaluate", { expression, returnByValue: true }, sessionId)
    const value = String((result["result"] as Record<string, unknown> | undefined)?.["value"] ?? "")
    return value.length > limit ? `${value.slice(0, limit)}\n… (truncated)` : value
  }

  async click(selector: string) {
    return this.interact(selector, `el.click(); return "ok"`, `no element matched ${JSON.stringify(selector)}`)
  }

  async type(selector: string, value: string) {
    return this.interact(
      selector,
      `el.focus(); el.value = ${JSON.stringify(value)};
       el.dispatchEvent(new Event("input", { bubbles: true }));
       el.dispatchEvent(new Event("change", { bubbles: true })); return "ok"`,
      `no element matched ${JSON.stringify(selector)}`,
    )
  }

  private async interact(selector: string, body: string, missing: string) {
    const sessionId = await this.attach()
    const expression = `(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return "missing"; ${body} })()`
    const result = await this.cdp.command("Runtime.evaluate", { expression, returnByValue: true }, sessionId)
    const value = (result["result"] as Record<string, unknown> | undefined)?.["value"]
    if (value !== "ok") throw new Error(missing)
  }

  /** PNG screenshot as base64, for attaching to a reply. */
  async screenshot() {
    const sessionId = await this.attach()
    const result = await this.cdp.command("Page.captureScreenshot", { format: "png" }, sessionId)
    return String(result["data"] ?? "")
  }

  async close() {
    this.cdp.close()
    try {
      this.socket.close()
    } catch {
      // The socket may already be gone; the process kill below is what matters.
    }
    await Shell.killTree(this.proc).catch(() => {})
    await fs.rm(this.profile, { recursive: true, force: true }).catch(() => {})
  }
}

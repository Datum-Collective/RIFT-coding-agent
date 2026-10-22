/**
 * Drives a real page: launch a browser, open a tab, navigate, read it, and collect the console
 * errors a screenshot would never show.
 */
import { rmSync } from "fs"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import type { Readable, Writable } from "stream"
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

// A cold start (first launch on a fresh machine or CI runner) can take 10s or more.
const LAUNCH_TIMEOUT_MS = 45_000
const SPAWN_ATTEMPTS = 3

/**
 * Bun on Linux now and then throws "Failed to connect (ENOENT)" while wiring up the extra pipes of a
 * spawn, with nothing wrong on the next try; the browser it started exits at once when its end of
 * the pipes closes. So the spawn is tried again rather than failing the browser tool.
 */
function spawnWithPipes(command: string, args: string[]) {
  const attempt = (left: number): ChildProcess => {
    try {
      return spawn(command, args, {
        stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      })
    } catch (error) {
      if (left <= 1) throw error
      return attempt(left - 1)
    }
  }
  return attempt(SPAWN_ATTEMPTS)
}
// How long after a click to look for a navigation it started. A link schedules its navigation
// at once, so a short wait catches it without slowing down every click on a single page.
const CLICK_SETTLE_MS = 50
const CLICK_NAVIGATION_TIMEOUT_MS = 15_000

type Tab = { sessionId: string; targetId: string; off: () => void }

export class BrowserSession {
  private constructor(
    private readonly proc: ChildProcess,
    private readonly input: Writable,
    private readonly cdp: CdpSession,
    private readonly profile: string,
    readonly binary: BrowserBinary,
  ) {}

  private tab?: Tab
  private entries: ConsoleEntry[] = []

  /** True once the browser itself is gone; a new session has to be launched. */
  get closed() {
    return this.cdp.closed
  }

  static async launch(options: { binary?: BrowserBinary; timeoutMs?: number } = {}) {
    const binary = options.binary ?? find()
    if (!binary) throw new Error(NOT_FOUND)

    // A throwaway profile keeps the user's real browser data untouched.
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), "rift-browser-"))
    // DevTools over fds 3 and 4 rather than a WebSocket: the browser shuts down as soon as its end
    // of the pipe closes, so it dies with RIFT however RIFT dies, including a crash, a SIGKILL or
    // a TUI worker thread whose exit hooks never run. Its stdout and stderr are not read, so they
    // must not be pipes that fill up and block it.
    const args = [
      "--remote-debugging-pipe",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-extensions",
      ...(binary.kind === "headless-shell" ? [] : ["--headless=new"]),
    ]
    const proc = spawnWithPipes(binary.path, args)
    const input = proc.stdio[3] as Writable
    const output = proc.stdio[4] as Readable
    const cdp = new CdpSession((payload) => input.write(`${payload}\0`))
    // Messages are NUL-terminated JSON.
    let buffered = ""
    output.setEncoding("utf8")
    output.on("data", (chunk: string) => {
      const messages = (buffered + chunk).split("\0")
      buffered = messages.pop() ?? ""
      messages.forEach((message) => cdp.receive(message))
    })
    input.on("error", () => cdp.close("browser exited"))
    proc.once("exit", (code) => cdp.close(`browser exited with code ${code ?? "unknown"}`))

    const ready = await cdp
      .command("Browser.getVersion", {}, undefined, options.timeoutMs ?? LAUNCH_TIMEOUT_MS)
      .then(() => undefined)
      .catch((error: Error) => error)
    if (ready) {
      await Shell.killTree(proc).catch(() => {})
      await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
      throw new Error(`browser did not start: ${ready.message}`)
    }

    const session = new BrowserSession(proc, input, cdp, profile, binary)
    // The browser runs detached in its own process group, so it would outlive RIFT; every run
    // that used it used to leave a headless Chrome behind. Exit handlers must be synchronous.
    process.once("exit", session.closeNow)
    return session
  }

  /** Opens a tab and starts collecting console errors. */
  private async attach() {
    if (this.tab) return this.tab
    const created = await this.cdp.command("Target.createTarget", { url: "about:blank" })
    const targetId = String(created["targetId"])
    const attached = await this.cdp.command("Target.attachToTarget", { targetId, flatten: true })
    const sessionId = String(attached["sessionId"])

    const off = this.cdp.on((event) => {
      // A crashed tab never answers again, so every later call would wait out its timeout; drop
      // it instead, and the next call opens a fresh one.
      if (event.method === "Target.detachedFromTarget" && event.params["sessionId"] === sessionId)
        return this.drop(tab, "the page's tab closed; the next browser call opens a new one")
      if (event.sessionId !== sessionId) return
      if (event.method === "Inspector.targetCrashed")
        return this.drop(tab, "the page crashed; the next browser call opens a new tab")
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
        const url = entry?.["url"] ? String(entry["url"]) : undefined
        // Chrome asks for /favicon.ico on its own on some platforms and logs the 404 as an error.
        // The page never asked for it, and the agent would go and fix a problem that is not there.
        if (url && /\/favicon\.ico(\?.*)?$/.test(url)) return
        this.entries.push({ level, text: String(entry?.["text"] ?? ""), url })
      }
    })
    const tab: Tab = { sessionId, targetId, off }
    this.tab = tab

    await this.cdp.command("Inspector.enable", {}, sessionId)
    await this.cdp.command("Page.enable", {}, sessionId)
    await this.cdp.command("Runtime.enable", {}, sessionId)
    await this.cdp.command("Log.enable", {}, sessionId)
    await this.cdp.command("Network.enable", {}, sessionId)
    // The agent reopens a page to see its own edits. With the cache on, a dev server's
    // Last-Modified header lets the browser keep serving the old CSS and JS, and the agent loops
    // on fixes that already landed.
    await this.cdp.command("Network.setCacheDisabled", { cacheDisabled: true }, sessionId)
    return tab
  }

  private drop(tab: Tab, reason: string) {
    if (this.tab !== tab) return
    this.tab = undefined
    tab.off()
    this.cdp.fail(tab.sessionId, reason)
    this.cdp.command("Target.closeTarget", { targetId: tab.targetId }).catch(() => {})
  }

  async navigate(url: string, timeoutMs = 30_000): Promise<PageState> {
    const { sessionId } = await this.attach()
    this.entries = []

    let status: number | undefined
    const offResponse = this.cdp.on((event) => {
      if (event.sessionId !== sessionId || event.method !== "Network.responseReceived") return
      if (event.params["type"] !== "Document" || status !== undefined) return
      const response = event.params["response"] as Record<string, unknown> | undefined
      if (typeof response?.["status"] === "number") status = response["status"]
    })

    // Awaited together: when navigate fails first, a lone load wait would reject later with
    // nothing handling it, which kills a process that does not swallow unhandled rejections.
    await Promise.all([
      this.cdp.command("Page.navigate", { url }, sessionId, timeoutMs),
      this.cdp.waitFor("Page.loadEventFired", timeoutMs, sessionId),
    ]).finally(() => offResponse())

    const state = await this.read()
    return { ...state, status }
  }

  /** Current url, title and everything the console has reported since navigation. */
  async read(): Promise<PageState> {
    const { sessionId } = await this.attach()
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

  /**
   * Visible text of the page, or of one selector, truncated for a model to read. A form field
   * gives its value. A hidden element is marked as such: its text is still in the page, and an
   * error message the page never showed used to read as if it were on screen.
   */
  async text(selector?: string, limit = 20_000) {
    const { sessionId } = await this.attach()
    const expression = `(() => {
      const el = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : "document.body"}
      if (!el) return ${selector ? "null" : `""`}
      const text = ("value" in el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ? el.value : el.innerText).trim()
      const shown = el.checkVisibility({ visibilityProperty: true, opacityProperty: true })
      return shown || !text ? text : "(hidden, not shown on the page) " + text
    })()`
    const result = await this.cdp.command("Runtime.evaluate", { expression, returnByValue: true }, sessionId)
    const value = (result["result"] as Record<string, unknown> | undefined)?.["value"]
    if (value === null) throw new Error(`no element matched ${JSON.stringify(selector)}`)
    const text = String(value ?? "")
    return text.length > limit ? `${text.slice(0, limit)}\n… (truncated)` : text
  }

  /** Clicks, and when the click starts loading a new page, waits for it so a read sees that page. */
  async click(selector: string) {
    const { sessionId, targetId } = await this.attach()
    let loading: Promise<unknown> | undefined
    const off = this.cdp.on((event) => {
      if (loading || event.sessionId !== sessionId || event.params["frameId"] !== targetId) return
      if (event.method !== "Page.frameRequestedNavigation" && event.method !== "Page.frameStartedLoading") return
      loading = this.cdp.waitFor("Page.loadEventFired", CLICK_NAVIGATION_TIMEOUT_MS, sessionId).catch(() => {})
    })
    await this.interact(selector, `el.click(); return "ok"`, `no element matched ${JSON.stringify(selector)}`)
      .then(() => Bun.sleep(CLICK_SETTLE_MS))
      .finally(off)
    await loading
  }

  /**
   * Sets the value through the element's native setter: React and similar frameworks track a
   * field's value by intercepting \`el.value = ...\` and then ignore the input event, so a form
   * looked filled in but submitted empty.
   */
  async type(selector: string, value: string) {
    return this.interact(
      selector,
      `el.focus();
       let proto = Object.getPrototypeOf(el);
       while (proto && !Object.getOwnPropertyDescriptor(proto, "value")) proto = Object.getPrototypeOf(proto);
       const setter = proto && Object.getOwnPropertyDescriptor(proto, "value").set;
       if (setter) setter.call(el, ${JSON.stringify(value)});
       if (!setter) el.textContent = ${JSON.stringify(value)};
       el.dispatchEvent(new Event("input", { bubbles: true }));
       el.dispatchEvent(new Event("change", { bubbles: true })); return "ok"`,
      `no element matched ${JSON.stringify(selector)}`,
    )
  }

  private async interact(selector: string, body: string, missing: string) {
    const { sessionId } = await this.attach()
    const expression = `(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return "missing"; ${body} })()`
    const result = await this.cdp.command("Runtime.evaluate", { expression, returnByValue: true }, sessionId)
    const value = (result["result"] as Record<string, unknown> | undefined)?.["value"]
    if (value !== "ok") throw new Error(missing)
  }

  /** PNG screenshot as base64, for attaching to a reply. */
  async screenshot() {
    const { sessionId } = await this.attach()
    const result = await this.cdp.command("Page.captureScreenshot", { format: "png" }, sessionId)
    return String(result["data"] ?? "")
  }

  /** Kills the browser right away, for when RIFT itself is exiting and cannot wait. */
  readonly closeNow = () => {
    if (this.proc.pid !== undefined && this.proc.exitCode === null)
      try {
        process.kill(process.platform === "win32" ? this.proc.pid : -this.proc.pid, "SIGKILL")
      } catch {
        this.proc.kill("SIGKILL")
      }
    rmSync(this.profile, { recursive: true, force: true })
  }

  async close() {
    process.removeListener("exit", this.closeNow)
    this.cdp.close()
    this.input.end()
    await Shell.killTree(this.proc).catch(() => {})
    await fs.rm(this.profile, { recursive: true, force: true }).catch(() => {})
  }
}

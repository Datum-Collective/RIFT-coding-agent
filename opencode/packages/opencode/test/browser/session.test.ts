import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { find } from "../../src/browser/discover"
import { BrowserSession } from "../../src/browser/session"

// The first browser launch on a cold machine can take longer than the 30s default.
setDefaultTimeout(90_000)

const binary = find()
const suite = binary ? describe : describe.skip

let server: ReturnType<typeof Bun.serve>
let base: string

const PAGES: Record<string, string> = {
  "/": `<!doctype html><title>RIFT test page</title><h1>Hello</h1>
        <p id="body">The quick brown fox</p>
        <input id="field" value="">
        <button id="go" onclick="document.getElementById('body').textContent='clicked'">Go</button>`,
  "/broken": `<!doctype html><title>Broken</title><h1>Broken</h1>
        <script>null.explode()</script>`,
  "/missing": "",
  "/form": `<!doctype html><title>Form</title>
        <p id="error" style="display:none">Please enter a valid email address.</p>
        <p id="shown">Thanks</p>
        <input id="controlled"><p id="out"></p>
        <a id="next" href="/second">next</a>
        <script>
          // What React does to a controlled input: it records every value set through the element,
          // and ignores an input event when the value matches what it recorded.
          const el = document.getElementById("controlled")
          const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
          let tracked = ""
          Object.defineProperty(el, "value", {
            get() { return native.get.call(this) },
            set(value) { tracked = value; native.set.call(this, value) },
          })
          el.addEventListener("input", () => {
            if (el.value === tracked) return
            tracked = el.value
            document.getElementById("out").textContent = el.value
          })
        </script>`,
  "/icon": `<!doctype html><title>Icon</title><link rel="icon" href="/favicon.ico"><p>hi</p>`,
  "/second": `<!doctype html><title>Second</title><p>landed</p>`,
  "/slow": `<!doctype html><title>Slow</title>`,
  "/styled": `<!doctype html><link rel="stylesheet" href="/style.css"><p id="x">hi</p>
        <script>document.title = getComputedStyle(document.getElementById("x")).color</script>`,
}

// Served like a typical dev server: Last-Modified and no Cache-Control, which lets a browser
// cache it heuristically.
let css = ""

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url)
      if (pathname === "/slow") await Bun.sleep(5_000)
      if (pathname === "/missing") return new Response("gone", { status: 404 })
      if (pathname === "/style.css")
        return new Response(css, {
          headers: { "content-type": "text/css", "last-modified": new Date(Date.now() - 86_400_000).toUTCString() },
        })
      const body = PAGES[pathname]
      if (body === undefined) return new Response("not found", { status: 404 })
      return new Response(body, { headers: { "content-type": "text/html" } })
    },
  })
  base = `http://localhost:${server.port}`
})

afterAll(() => server?.stop(true))

// Each test drives its own browser. Sharing one across tests left the socket closed between
// them under the test runner, and a per-test browser is the honest thing to verify anyway.
async function withSession(run: (session: BrowserSession) => Promise<void>) {
  const session = await BrowserSession.launch()
  try {
    await run(session)
  } finally {
    await session.close()
  }
}

suite("browser session", () => {
  test("does not outlive the process that launched it", async () => {
    const script = `
      const { BrowserSession } = await import(${JSON.stringify(require.resolve("../../src/browser/session"))})
      await BrowserSession.launch()
      console.log("launched")
      process.exit(0)
    `
    const child = Bun.spawn(["bun", "-e", script], { stdout: "pipe", stderr: "inherit" })
    expect(await new Response(child.stdout).text()).toContain("launched")
    await child.exited
    await Bun.sleep(300)
    // Every launch uses a fresh rift-browser-* profile, so a browser left running shows up as a
    // process still holding one of those directories for this child's run.
    const ps = Bun.spawnSync(["ps", "-Ao", "ppid,command"]).stdout.toString()
    const orphans = ps
      .split("\n")
      .filter((line) => line.trim().startsWith("1 ") && line.includes("rift-browser-") && !line.includes("--type="))
    expect(orphans).toEqual([])
  })

  test("does not outlive a process killed outright", async () => {
    // SIGKILL runs no exit hooks, and neither does a TUI quit: the engine runs in a worker thread,
    // whose exit hooks never fire. Only the browser noticing its parent is gone covers both.
    const script = `
      const { BrowserSession } = await import(${JSON.stringify(require.resolve("../../src/browser/session"))})
      await BrowserSession.launch()
      console.log("launched")
      setInterval(() => {}, 1000)
    `
    const child = Bun.spawn(["bun", "-e", script], { stdout: "pipe", stderr: "inherit" })
    const reader = child.stdout.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("launched")
    const browsers = () =>
      Bun.spawnSync(["ps", "-Ao", "pid,ppid,command"])
        .stdout.toString()
        .split("\n")
        .filter((line) => line.includes("rift-browser-") && !line.includes("--type="))
        .map((line) => line.trim().split(/\s+/))
    const pid = browsers().find((row) => row[1] === String(child.pid))?.[0]
    expect(pid).toBeDefined()
    child.kill("SIGKILL")
    await child.exited
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline && browsers().some((row) => row[0] === pid)) await Bun.sleep(100)
    expect(browsers().some((row) => row[0] === pid)).toBe(false)
  })

  test("navigates and reports the page it actually landed on", async () =>
    withSession(async (session) => {
      const state = await session.navigate(`${base}/`)
      expect(state.title).toBe("RIFT test page")
      expect(state.url).toBe(`${base}/`)
      expect(state.status).toBe(200)
      expect(state.console).toEqual([])
    }))

  test("reopening a page shows an edited stylesheet, not a cached one", async () =>
    withSession(async (session) => {
      css = "#x { color: rgb(255, 0, 0) }"
      expect((await session.navigate(`${base}/styled`)).title).toBe("rgb(255, 0, 0)")
      css = "#x { color: rgb(0, 0, 255) }"
      expect((await session.navigate(`${base}/styled`)).title).toBe("rgb(0, 0, 255)")
    }))

  test("reports the HTTP status, so a broken route is not mistaken for a working page", async () =>
    withSession(async (session) => {
      const state = await session.navigate(`${base}/missing`)
      expect(state.status).toBe(404)
    }))

  test("captures console errors a screenshot would never show", async () =>
    withSession(async (session) => {
      const state = await session.navigate(`${base}/broken`)
      expect(state.title).toBe("Broken")
      // The page renders fine; only the console reveals that it is broken.
      expect(state.console.length).toBeGreaterThan(0)
      expect(state.console.some((entry) => entry.level === "error" && /explode|null/i.test(entry.text))).toBe(true)
    }))

  test("a missing favicon is not reported as a console error", async () =>
    withSession(async (session) => {
      expect((await session.navigate(`${base}/icon`)).console).toEqual([])
    }))

  test("console errors do not leak between navigations", async () =>
    withSession(async (session) => {
      await session.navigate(`${base}/broken`)
      const clean = await session.navigate(`${base}/`)
      expect(clean.console).toEqual([])
    }))

  test("reads page text, whole or by selector", async () =>
    withSession(async (session) => {
      await session.navigate(`${base}/`)
      expect(await session.text()).toContain("The quick brown fox")
      expect((await session.text("#body")).trim()).toBe("The quick brown fox")
    }))

  test("clicks and types, and says so when a selector matches nothing", async () =>
    withSession(async (session) => {
      await session.navigate(`${base}/`)
      await session.click("#go")
      expect((await session.text("#body")).trim()).toBe("clicked")

      await session.type("#field", "typed value")
      expect((await session.text("#field")) !== undefined).toBe(true)
      // A missing selector is reported, not silently ignored, so the agent cannot believe it
      // clicked something it never found.
      const clickError = await session.click("#nothing-here").then(
        () => undefined,
        (error: Error) => error,
      )
      expect(clickError?.message).toMatch(/no element matched/)
      const typeError = await session.type("#nothing-here", "x").then(
        () => undefined,
        (error: Error) => error,
      )
      expect(typeError?.message).toMatch(/no element matched/)
    }))

  test("says when the text it read is on an element the page hides", async () =>
    withSession(async (session) => {
      await session.navigate(`${base}/form`)
      expect(await session.text("#shown")).toBe("Thanks")
      expect(await session.text("#error")).toBe("(hidden, not shown on the page) Please enter a valid email address.")
      await expect(session.text("#nothing-here")).rejects.toThrow("no element matched")
    }))

  test("types into an input the way a framework that tracks its value sees it", async () =>
    withSession(async (session) => {
      await session.navigate(`${base}/form`)
      await session.type("#controlled", "ada@example.com")
      expect(await session.text("#out")).toBe("ada@example.com")
    }))

  test("a click that follows a link reports the page it landed on", async () =>
    withSession(async (session) => {
      await session.navigate(`${base}/form`)
      await session.click("#next")
      expect((await session.read()).title).toBe("Second")
    }))

  test("recovers when the tab's renderer crashes", async () =>
    withSession(async (session) => {
      await session.navigate(`${base}/`)
      // The event Chrome sends when a renderer dies, delivered by hand: whether chrome://crash
      // really kills the tab depends on the platform and the browser build.
      const internals = session as unknown as {
        tab: { sessionId: string }
        cdp: { receive(raw: string): void }
      }
      const pending = session.navigate(`${base}/slow`).catch((error: Error) => error)
      await Bun.sleep(300)
      internals.cdp.receive(
        JSON.stringify({ method: "Inspector.targetCrashed", params: {}, sessionId: internals.tab.sessionId }),
      )
      expect(String(await pending)).toMatch(/page crashed/)
      expect((await session.navigate(`${base}/second`)).title).toBe("Second")
    }))

  test("takes a screenshot of the real page", async () =>
    withSession(async (session) => {
      await session.navigate(`${base}/`)
      const shot = await session.screenshot()
      const bytes = Buffer.from(shot, "base64")
      expect(bytes.length).toBeGreaterThan(1000)
      // PNG magic number, so this is a real image rather than an error string.
      expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    }))
})

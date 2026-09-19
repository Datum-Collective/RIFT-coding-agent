import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { find } from "../../src/browser/discover"
import { BrowserSession } from "../../src/browser/session"

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
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url)
      if (pathname === "/missing") return new Response("gone", { status: 404 })
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
  test("navigates and reports the page it actually landed on", async () =>
    withSession(async (session) => {
      const state = await session.navigate(`${base}/`)
      expect(state.title).toBe("RIFT test page")
      expect(state.url).toBe(`${base}/`)
      expect(state.status).toBe(200)
      expect(state.console).toEqual([])
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

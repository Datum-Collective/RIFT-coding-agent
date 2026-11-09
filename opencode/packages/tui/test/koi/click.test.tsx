/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test"
import { createAppFixture } from "../fixture/app"

type App = Awaited<ReturnType<typeof createAppFixture>>

const isDot = (char: string) => char >= "⠁" && char <= "⣿"

/** The banner on the home screen: the cell its top left corner is in, and its rows as they are drawn now. */
function logo(app: App, at?: { col: number; row: number }) {
  const lines = app.captureCharFrame().split("\n")
  const where = at ?? (() => {
    const row = lines.findIndex((line) => [...line].some(isDot))
    const col = Math.min(...lines.slice(row, row + 12).map((line) => [...line].findIndex(isDot)).filter((col) => col >= 0))
    return { col, row }
  })()
  const rows = lines.slice(where.row, where.row + 12).map((line) => [...line].slice(where.col, where.col + 72).join(""))
  return { at: where, rows, dots: rows.join("").split("").filter(isDot).length }
}

/**
 * Whether the hole has opened: the cells just above the middle of the screen, which the logo's I and F
 * cover, are empty. The shadow is there, and nothing passes in front of it above its middle.
 */
function opened(app: App) {
  const lines = app.captureCharFrame().split("\n")
  return lines.slice(16, 20).every((line) => [...line].slice(56, 64).join("").trim() === "")
}

async function home(animations: boolean) {
  const app = await createAppFixture({ width: 120, height: 40, config: { animations } })
  await app.ready
  await app.waitForFrame((frame) => frame.includes("What should change"))
  await app.renderOnce()
  return app
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Renders until `done` holds, for up to `ms`. The scene moves on with the frames drawn, so a busy machine only makes this slower. */
async function until(app: App, done: () => boolean, ms = 15000) {
  const end = Date.now() + ms
  while (!done()) {
    if (Date.now() > end) throw new Error("timed out")
    await app.renderOnce()
    await wait(50)
  }
}

afterEach(() => {
  delete process.env.RIFT_NO_ANIMATION
})

test("a click on the logo opens the hole at once, from the logo exactly as it was drawn", async () => {
  await using app = await home(true)
  const before = logo(app)
  expect(before.dots).toBeGreaterThan(500)
  expect(opened(app)).toBe(false)
  expect(app.renderer.liveRequestCount).toBe(0)

  await app.mockMouse.click(before.at.col + 20, before.at.row + 5)
  await app.renderOnce()
  // Running: the renderer draws continuously, and the first frame is the logo, dot for dot.
  expect(app.renderer.liveRequestCount).toBe(1)
  expect(logo(app, before.at).rows).toEqual(before.rows)

  // Within a couple of seconds the shadow has opened in the middle of the logo.
  await until(app, () => opened(app))
}, 30000)

test("a second click while the hole is out does not start it again", async () => {
  await using app = await home(true)
  const before = logo(app)
  await app.mockMouse.click(before.at.col + 20, before.at.row + 5)
  await until(app, () => opened(app))
  await app.mockMouse.click(before.at.col + 20, before.at.row + 5)
  // Started again, the whole logo would be back on the next frame.
  for (let frame = 0; frame < 5; frame++) {
    await app.renderOnce()
    expect(opened(app)).toBe(true)
    await wait(50)
  }
  expect(app.renderer.liveRequestCount).toBe(1)
}, 30000)

test("the mouse alone does not send the hole away; a key does, the logo comes back, and drawing stops", async () => {
  await using app = await home(true)
  const before = logo(app)
  await app.mockMouse.click(before.at.col + 20, before.at.row + 5)
  await app.renderOnce()
  await app.mockMouse.moveTo(5, 35)
  await app.mockMouse.click(5, 2)
  await app.mockMouse.scroll(5, 35, "down")
  // Still out: the shadow opens as it does when nothing is touched.
  await until(app, () => opened(app))

  // Escape is a key to the hole but not typing to the koi above the composer, so nothing else draws after.
  app.mockInput.pressEscape()
  await until(app, () => logo(app, before.at).rows.join("\n") === before.rows.join("\n"))
  await app.renderOnce()
  expect(app.renderer.liveRequestCount).toBe(0)
}, 30000)

test("with animations turned off a click does nothing", async () => {
  await using app = await home(false)
  const before = logo(app)
  await app.mockMouse.click(before.at.col + 20, before.at.row + 5)
  await wait(2600)
  await app.renderOnce()
  expect(app.renderer.liveRequestCount).toBe(0)
  expect(logo(app, before.at).rows).toEqual(before.rows)
}, 30000)

test("with RIFT_NO_ANIMATION set a click does nothing", async () => {
  process.env.RIFT_NO_ANIMATION = "1"
  await using app = await home(true)
  const before = logo(app)
  await app.mockMouse.click(before.at.col + 20, before.at.row + 5)
  await wait(500)
  await app.renderOnce()
  expect(app.renderer.liveRequestCount).toBe(0)
  expect(logo(app, before.at).rows).toEqual(before.rows)
}, 30000)

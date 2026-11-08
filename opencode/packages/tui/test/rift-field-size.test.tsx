import { expect, test } from "bun:test"
import type { CapturedFrame } from "@opentui/core"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

const location = { directory, project: { id: "project", directory, canonical: directory } }
const session = {
  id: "ses_bar",
  title: "Bar size",
  projectID: "project",
  location: { directory },
  agent: "build",
  model: { providerID: "provider", id: "model" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}

const SIZES = [
  [80, 24],
  [120, 40],
  [200, 50],
] as const

function open(state: string, width: number, height: number, place: "home" | "session") {
  // Other app tests can leave a home draft in the process-wide stash.
  takeDraft(undefined)
  return createAppFixture({
    state,
    width,
    height,
    // The session docks its sidebar on a wide terminal; these compare the bar on the same column width.
    config: { animations: false, session: { sidebar: "hide" } },
    args: place === "session" ? { sessionID: session.id } : {},
    fetch: (url) => {
      if (url.pathname === "/api/fs/list") return json({ location, data: [] })
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }] })
    },
  })
}

type Setup = Awaited<ReturnType<typeof open>>

/** Each cell's character and background, row by row. */
function cells(frame: CapturedFrame) {
  return frame.lines.map((line) =>
    line.spans.flatMap((span) => {
      const chars = Array.from(span.text)
      return Array.from({ length: span.width }, (_, i) => ({ char: chars[i] ?? " ", bg: span.bg.toInts().join() }))
    }),
  )
}

/**
 * The composer bar: the run of one fill on the row holding the prompt glyph, from the padding row above it down to
 * its last row; and the two rows under it.
 */
function bar(frame: CapturedFrame) {
  const grid = cells(frame)
  for (let y = grid.length - 1; y > 0; y--) {
    const row = grid[y]!
    const left = row.findIndex((cell) => cell.char === "›" || cell.char === "$")
    if (left < 0) continue
    const fill = row[left]!.bg
    let width = 0
    while (row[left + width]?.bg === fill) width++
    if (width < 20) continue
    const same = (at: number) => grid[at]?.[left]?.bg === fill && grid[at]?.[left + width - 1]?.bg === fill
    let bottom = y
    while (same(bottom + 1)) bottom++
    const text = (at: number) => grid[at]!.map((cell) => cell.char).join("")
    // Where the draft (or its placeholder) starts on the prompt row.
    const column = text(y).slice(left + 1).search(/\S/) + left + 1
    return { top: y - 1, rows: bottom - y + 2, left, width, fill, column, glyph: row[left]!.char, under: [text(bottom + 1), text(bottom + 2)], grid }
  }
}

/** The composer has settled: the bar, then who answers and where (the branch arrives last), then the hint. */
const ready = (frame: string) => frame.includes("›") && /Build · Model · \S+:main/.test(frame) && frame.includes("commands")

async function settled(setup: Setup, ready: (frame: string) => boolean) {
  await setup.waitForFrame(ready)
  return bar(setup.captureSpans())!
}

for (const [width, height] of SIZES) {
  test(`at ${width}x${height} the bar is 3 rows by the width less a column each side, the same on home and in a session`, async () => {
    const sizes: Record<string, ReturnType<typeof bar>> = {}
    for (const place of ["home", "session"] as const) {
      await using state = await tmpdir()
      await using setup = await open(state.path, width, height, place)
      await setup.ready
      sizes[place] = await settled(setup, (frame) => ready(frame) && (place === "home" || frame.includes("Bar size")))
    }
    const { rows, left, width: span } = sizes.home!
    expect({ rows, left, width: span }).toEqual({ rows: 3, left: 1, width: width - 2 })
    expect({ rows: sizes.session!.rows, left: sizes.session!.left, width: sizes.session!.width }).toEqual({ rows, left, width: span })
  })
}

test("under the bar, on the draft's column: who answers and where, then the hint", async () => {
  await using state = await tmpdir()
  await using setup = await open(state.path, 120, 40, "home")
  await setup.ready
  const home = await settled(setup, ready)
  const column = home.column
  expect(home.under[0]!.slice(0, column).trim()).toBe("")
  expect(home.under[0]!.slice(column)).toStartWith("Build · Model · ")
  expect(home.under[0]).toContain(directory.split("/").at(-1)!)
  expect(home.under[1]!.slice(column)).toStartWith("ctrl+p commands")
})

test("a six-line draft grows the bar upward, and clearing it brings back the same bar", async () => {
  await using state = await tmpdir()
  await using setup = await open(state.path, 120, 40, "home")
  await setup.ready
  const empty = await settled(setup, ready)
  for (const [i, line] of ["one", "two", "three", "four", "five", "six"].entries()) {
    if (i) setup.mockInput.pressKey("j", { ctrl: true })
    await setup.mockInput.typeText(line)
  }
  const grown = await settled(setup, (frame) => ready(frame) && frame.includes("six"))
  expect(grown.rows).toBe(3 + 5)
  expect(grown.top).toBe(empty.top - 5)
  expect(grown.width).toBe(empty.width)
  expect(grown.under).toEqual(empty.under)
  for (let i = 0; i < 40; i++) setup.mockInput.pressBackspace()
  const cleared = await settled(setup, (frame) => ready(frame) && !frame.includes("one"))
  expect({ ...cleared, grid: undefined }).toEqual({ ...empty, grid: undefined })
})

test("shell mode puts $ in the glyph's cell and names the shell under the bar", async () => {
  await using state = await tmpdir()
  await using setup = await open(state.path, 120, 40, "home")
  await setup.ready
  const empty = await settled(setup, ready)
  await setup.mockInput.typeText("!")
  const shell = await settled(setup, (frame) => frame.includes("exit shell mode"))
  expect(shell.glyph).toBe("$")
  expect({ top: shell.top, rows: shell.rows, left: shell.left, width: shell.width }).toEqual({
    top: empty.top,
    rows: empty.rows,
    left: empty.left,
    width: empty.width,
  })
  expect(shell.under[0]!.slice(shell.column)).toStartWith("Shell · ")
  expect(shell.under[1]!.slice(shell.column)).toStartWith("esc exit shell mode")
})

test("the slash list stands on the bar: the same columns and fill, its text on the draft's column", async () => {
  await using state = await tmpdir()
  await using setup = await open(state.path, 120, 40, "home")
  await setup.ready
  const empty = await settled(setup, ready)
  await setup.mockInput.typeText("/")
  await setup.waitForFrame((frame) => /\/\w+\s{2,}\S/.test(frame) || frame.includes("No matching commands"))
  const open_ = bar(setup.captureSpans())!
  const list = open_.grid[open_.top - 1]!
  expect(list[open_.left - 1]!.bg).not.toBe(open_.fill)
  expect(list[open_.left]!.bg).toBe(open_.fill)
  expect(list[open_.left + open_.width - 1]!.bg).toBe(open_.fill)
  expect(list[open_.left + open_.width]?.bg).not.toBe(open_.fill)
  const text = list.map((cell) => cell.char).join("")
  expect(text.search(/\S/)).toBe(empty.column)
})

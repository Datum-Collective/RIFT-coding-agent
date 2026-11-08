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
 * The composer bar: the run of one fill around the prompt glyph, from the padding row above it down to its last row;
 * then every row under it, to the bottom of the terminal.
 */
function bar(frame: CapturedFrame) {
  const grid = cells(frame)
  for (let y = grid.length - 1; y > 0; y--) {
    const row = grid[y]!
    const mark = row.findIndex((cell) => cell.char === "›" || cell.char === "$")
    if (mark < 0) continue
    const fill = row[mark]!.bg
    let left = mark
    while (row[left - 1]?.bg === fill) left--
    let width = mark - left
    while (row[left + width]?.bg === fill) width++
    if (width < 20) continue
    const same = (at: number) => grid[at]?.[left]?.bg === fill && grid[at]?.[left + width - 1]?.bg === fill
    let bottom = y
    while (same(bottom + 1)) bottom++
    const text = (at: number) => grid[at]!.map((cell) => cell.char).join("")
    // Where the draft (or its placeholder) starts on the prompt row.
    const column = text(y).slice(mark + 1).search(/\S/) + mark + 1
    const under = grid.slice(bottom + 1).map((_, i) => text(bottom + 1 + i))
    return { top: y - 1, rows: bottom - y + 2, left, width, fill, mark, column, glyph: row[mark]!.char, under, grid }
  }
}

/** The composer has settled: the bar, then who answers and the hint, then the folder and its branch at the right. */
const ready = (frame: string) => frame.includes("›") && /Build · Model {2}ctrl\+p commands/.test(frame) && /:main\s*$/.test(frame)

async function settled(setup: Setup, ready: (frame: string) => boolean) {
  await setup.waitForFrame(ready)
  return bar(setup.captureSpans())!
}

/** First and last inked column of a row. */
const ink = (row: string) => ({ first: row.search(/\S/), last: row.trimEnd().length - 1 })

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

  test(`at ${width}x${height} one grid: glyph two in, the draft and the row under the bar on one column, the row ending on its mirror, one row above the bottom`, async () => {
    for (const place of ["home", "session"] as const) {
      await using state = await tmpdir()
      await using setup = await open(state.path, width, height, place)
      await setup.ready
      await settled(setup, (frame) => ready(frame) && (place === "home" || frame.includes("Bar size")))
      await setup.mockInput.typeText("x")
      const it = await settled(setup, (frame) => ready(frame) && /›\s+x/.test(frame))
      expect(it.mark).toBe(it.left + 2)
      expect(it.column).toBe(it.left + 4)
      // One row under the bar, and a blank row after it: the terminal's last.
      expect(it.under).toHaveLength(2)
      expect(it.under[1]!.trim()).toBe("")
      expect(it.top + it.rows).toBe(height - 2)
      const row = it.under[0]!
      expect(ink(row)).toEqual({ first: it.left + 4, last: it.left + it.width - 3 })
      expect(row.slice(it.left + 4)).toStartWith("Build · Model  ctrl+p commands")
      expect(row.trimEnd()).toEndWith(`${directory}:main`)
      if (width >= 100) expect(row).toContain("ctrl+p commands  test")
      else expect(row).not.toContain("test")
    }
  })
}

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

test("shell mode puts $ in the glyph's cell and names the shell and its way out under the bar", async () => {
  await using state = await tmpdir()
  await using setup = await open(state.path, 120, 40, "home")
  await setup.ready
  const empty = await settled(setup, ready)
  await setup.mockInput.typeText("!")
  const shell = await settled(setup, (frame) => frame.includes("exit shell mode"))
  expect(shell.glyph).toBe("$")
  expect({ top: shell.top, rows: shell.rows, left: shell.left, width: shell.width, mark: shell.mark }).toEqual({
    top: empty.top,
    rows: empty.rows,
    left: empty.left,
    width: empty.width,
    mark: empty.mark,
  })
  expect(shell.under[0]!.slice(empty.column)).toStartWith("Shell  esc exit shell mode")
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

test("home has no row of its own under the composer: the version lives in the composer's row", async () => {
  await using state = await tmpdir()
  await using setup = await open(state.path, 120, 40, "home")
  await setup.ready
  await settled(setup, ready)
  const lines = setup.captureCharFrame().trimEnd().split("\n")
  expect(lines.filter((line) => line.includes("test"))).toHaveLength(1)
  expect(lines.at(-1)).toContain("ctrl+p commands  test")
})

/**
 * Home in a deep folder with a failed MCP server for a status. Under the bar: agent and model, the hint, the version
 * from 100 columns; at the right the status, then the folder.
 */
const deep = "/srv/acme/platform/payments/checkout"
async function row(width: number) {
  await using state = await tmpdir()
  const here = { directory: deep, project: { id: "project", directory: deep, canonical: deep } }
  await using setup = await createAppFixture({
    state: state.path,
    width,
    height: 24,
    config: { animations: false },
    fetch: (url) => {
      if (url.pathname === "/api/location") return json(here)
      if (url.pathname === "/api/fs/list") return json({ location: here, data: [] })
      if (url.pathname === "/api/session") return json({ data: [], cursor: {} })
      if (url.pathname === "/api/vcs") return json({ location: here, data: { branch: { current: "main", default: "main" } } })
      if (url.pathname === "/api/mcp") return json({ location: here, data: [{ name: "alpha", status: { status: "failed", error: "refused" } }] })
      if (url.pathname === "/api/agent")
        return json({ location: here, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location: here, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/model")
        return json({ location: here, data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }] })
    },
  })
  await setup.ready
  const it = await settled(setup, (frame) => frame.includes("›") && /Model {2}ctrl\+p/.test(frame) && /:main\s*$/.test(frame) && frame.includes("MCP"))
  const line = it.under[0]!
  expect(ink(line)).toEqual({ first: it.left + 4, last: it.left + it.width - 3 })
  return line.slice(it.left + 4).trimEnd()
}

test("as the terminal narrows, the folder folds first, then the version, the hint's label and the status go; nothing overlaps", async () => {
  expect(await row(100)).toMatch(/^Build · Model {2}ctrl\+p commands {2}test {2,}⊙ 1 MCP failed \/mcps {2}\/…\/payments\/checkout:main$/)
  expect(await row(80)).toMatch(/^Build · Model {2}ctrl\+p {2,}⊙ 1 MCP failed \/mcps {2}\/…\/payments\/checkout:main$/)
  expect(await row(60)).toMatch(/^Build · Model {2}ctrl\+p {2,}\/…\/payments\/checkout:main$/)
  // Under 44 columns the agent's name gives way; the folder is cut in the middle, the model stays whole.
  expect(await row(40)).toMatch(/^Model {2}ctrl\+p {2,}\/…\/payme…out:main$/)
})

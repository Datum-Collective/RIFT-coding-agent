import { expect, test } from "bun:test"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

const location = { directory, project: { id: "project", directory, canonical: directory } }
const session = {
  id: "ses_field",
  title: "Field size",
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
    config: { animations: false },
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

/** The composer field in a frame: the text rows between its edges, and its ring's columns. */
function field(frame: string) {
  const rows = frame.split("\n")
  const bottom = rows.findLastIndex((row) => /▔{10,}/.test(row))
  if (bottom < 0) return undefined
  const top = rows.findLastIndex((row, i) => i < bottom && /▁{10,}/.test(row))
  const side = rows[top + 1]!
  const left = side.indexOf("▕")
  return { rows: bottom - top - 1, left, width: side.indexOf("▏", left) - left + 1, top }
}

const ready = (frame: string) => frame.includes("commands") && field(frame) !== undefined

for (const [width, height] of SIZES) {
  test(`at ${width}x${height} the empty field has three text rows and the same size on home and in a session`, async () => {
    const sizes: Record<string, ReturnType<typeof field>> = {}
    for (const place of ["home", "session"] as const) {
      await using state = await tmpdir()
      await using setup = await open(state.path, width, height, place)
      await setup.ready
      const frame = await setup.waitForFrame((frame) => ready(frame) && (place === "home" || frame.includes("Field size")))
      sizes[place] = field(frame)
    }
    expect(sizes.home!.rows).toBe(3)
    expect(sizes.home!.width).toBe(Math.min(80, width - 4))
    expect(sizes.session!.rows).toBe(sizes.home!.rows)
    expect(sizes.session!.width).toBe(sizes.home!.width)
  })
}

test("a six-line draft grows the field upward, and clearing it brings back the three rows", async () => {
  await using state = await tmpdir()
  await using setup = await open(state.path, 120, 40, "home")
  await setup.ready
  const empty = field(await setup.waitForFrame(ready))!
  for (const [i, line] of ["one", "two", "three", "four", "five", "six"].entries()) {
    if (i) setup.mockInput.pressKey("j", { ctrl: true })
    await setup.mockInput.typeText(line)
  }
  const grown = field(await setup.waitForFrame((frame) => frame.includes("six") && field(frame)!.rows === 6))!
  expect(grown.top).toBe(empty.top - 3)
  expect(grown.width).toBe(empty.width)
  for (let i = 0; i < 30; i++) setup.mockInput.pressBackspace()
  const cleared = field(await setup.waitForFrame((frame) => !frame.includes("one") && field(frame)!.rows === 3))!
  expect(cleared).toEqual(empty)
})

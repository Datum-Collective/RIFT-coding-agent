/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test"
import { RGBA, type CapturedFrame } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { JSX } from "solid-js"
import type { Context } from "@opencode/plugin/tui/context"
import type { Rift } from "@opencode/schema/rift"
import { barLook, barOutset, barTone, ComposerBar, TEXT_INSET, type BarColours, type BarLook } from "../src/component/prompt/frame"
import { landingDetail } from "../src/component/landing"
import { brief } from "../src/feature-plugins/sidebar/rift-run"
import { ComposerStatus } from "../src/feature-plugins/rift/status"

const colours: BarColours = {
  agent: RGBA.fromInts(169, 174, 255),
  shell: RGBA.fromInts(229, 181, 103),
  muted: RGBA.fromInts(143, 143, 143),
  raised: { base: RGBA.fromInts(12, 12, 12), high: RGBA.fromInts(24, 24, 24), max: RGBA.fromInts(80, 80, 80) },
}
const rgb = (colour: RGBA) => colour.toInts().slice(0, 3)
const look = (state: Partial<Parameters<typeof barTone>[0]> = {}) =>
  barLook(barTone({ quiet: false, focused: true, shell: false, draft: false, ...state }), colours)

afterEach(() => {
  delete process.env.RIFT_NO_ANIMATION
})

async function draw(view: () => JSX.Element, options: { width?: number; height?: number; wait?: number } = {}) {
  const app = await testRender(view, { width: options.width ?? 40, height: options.height ?? 10 })
  try {
    await app.renderOnce()
    if (options.wait) await new Promise((resolve) => setTimeout(resolve, options.wait))
    await app.renderOnce()
    return { rows: app.captureCharFrame().split("\n"), spans: app.captureSpans() }
  } finally {
    app.renderer.destroy()
  }
}

/** Each cell's background, row by row. */
function backgrounds(frame: CapturedFrame) {
  return frame.lines.map((line) => line.spans.flatMap((span) => Array(span.width).fill(rgb(span.bg))))
}

function bar(props: { look?: BarLook; busy?: boolean; lines?: string[] }) {
  return (
    <ComposerBar look={props.look ?? look()} busy={props.busy ?? false} animations={true}>
      <text>{(props.lines ?? ["fix the flaky test"]).join("\n")}</text>
    </ComposerBar>
  )
}

test("at rest the bar is three tinted rows: padding, the prompt row with the glyph in its first cell, padding", async () => {
  const { rows, spans } = await draw(() => bar({}))
  expect(rows.slice(0, 4)).toEqual(["", "› fix the flaky test", "", ""].map((row) => row.padEnd(40)))
  const fill = rgb(look().fill)
  for (const row of backgrounds(spans).slice(0, 3)) expect(row).toEqual(Array(40).fill(fill))
  expect(backgrounds(spans)[3]).not.toContainEqual(fill)
})

test("a longer draft makes the bar taller by whole rows and keeps a padding row above and below", async () => {
  const { rows, spans } = await draw(() => bar({ lines: ["one", "two", "three"] }))
  expect(rows.slice(0, 6).map((row) => row.trimEnd())).toEqual(["", "› one", "  two", "  three", "", ""])
  const fill = rgb(look().fill)
  const column = backgrounds(spans).map((row) => row[20])
  expect(column.slice(0, 5)).toEqual(Array(5).fill(fill))
  expect(column[5]).not.toEqual(fill)
})

test("the draft starts TEXT_INSET columns into the bar", async () => {
  const { rows } = await draw(() => bar({ lines: ["x"] }))
  expect(rows[1]!.indexOf("x")).toBe(TEXT_INSET)
})

test("shell mode swaps the glyph for an amber $ and keeps the draft's column", async () => {
  const { rows, spans } = await draw(() => bar({ look: look({ shell: true, draft: true }), lines: ["git status"] }))
  expect(rows[1]!.startsWith("$ git status")).toBe(true)
  expect(rgb(spans.lines[1]!.spans[0]!.fg)).toEqual(rgb(colours.shell))
})

test("idle, focused and quiet bars have three different fills; a draft and the shell keep the focused one", () => {
  const fills = { idle: look({ focused: false }), focused: look(), quiet: look({ quiet: true }) }
  expect(new Set(Object.values(fills).map((each) => rgb(each.fill).join())).size).toBe(3)
  expect(look({ draft: true }).fill).toEqual(fills.focused.fill)
  expect(look({ shell: true }).fill).toEqual(fills.focused.fill)
  const lightness = (each: BarLook) => rgb(each.fill)[0]!
  expect(lightness(fills.quiet)).toBeLessThan(lightness(fills.idle))
  expect(lightness(fills.idle)).toBeLessThan(lightness(fills.focused))
})

test("a quiet bar mutes its glyph whatever else holds; otherwise the glyph is whoever answers", () => {
  for (const state of [{}, { draft: true }, { shell: true }, { focused: false }])
    expect(look({ quiet: true, ...state }).glyph).toEqual(colours.muted)
  expect(look().glyph).toEqual(colours.agent)
  expect(look({ focused: false }).glyph).toEqual(colours.agent)
  expect(look({ shell: true })).toMatchObject({ glyph: colours.shell, mark: "$" })
  expect(look({ quiet: true, shell: true }).mark).toBe("›")
})

test("the bar reaches out of its column's padding to keep a one-column margin", () => {
  expect(barOutset(80)).toBe(1)
  expect(barOutset(200)).toBe(1)
  expect(barOutset(40)).toBe(0)
})

test("a crest runs along the bottom padding row while the session works", async () => {
  const still = await draw(() => bar({ busy: false }), { wait: 300 })
  expect(still.rows[2]).not.toMatch(/[▂▃▄]/)
  const busy = await draw(() => bar({ busy: true }), { wait: 300 })
  expect(busy.rows[2]).toMatch(/[▂▃▄]/)
  expect(busy.rows[0]!.trim()).toBe("")
  expect(busy.rows[1]!.startsWith("› fix")).toBe(true)
})

test("RIFT_NO_ANIMATION keeps the bar still while busy", async () => {
  process.env.RIFT_NO_ANIMATION = "1"
  const { rows } = await draw(() => bar({ busy: true }), { wait: 300 })
  expect(rows[2]!.trim()).toBe("")
})

const stage = (command: string, status: Rift.Stage["status"]): Rift.Stage => ({
  id: command,
  unit: ".",
  kind: "test",
  command,
  status,
})
const done = (verdict: Rift.RunVerdict, stages: Rift.Stage[] = [], started = 1): Rift.Run => ({
  id: verdict,
  tree: "t",
  started,
  stages,
  phase: "done",
  finished: started + 1,
  verdict,
  headline: verdict,
  receipt: "r",
})
const running: Rift.Run = {
  id: "running",
  tree: "t",
  started: 1,
  phase: "running",
  stages: [stage("lint", "passed"), stage("test", "running")],
}
const state = (run: Rift.Run, project?: Rift.Run): Rift.State => ({ change: { run, round: 0 }, project, graph: [] })

test("the status puts a waiting permission before any verification, and is empty with neither", () => {
  expect(brief({ permissions: 0 })).toBeUndefined()
  expect(brief({ permissions: 2, state: state(done("failing", [stage("test", "failed")])) })).toEqual({
    glyph: "⚠",
    tone: "warning",
    text: "2 permissions waiting",
  })
  expect(brief({ permissions: 1 })?.text).toBe("1 permission waiting")
})

test("the status says how the newest verification stands", () => {
  const failing = done("failing", [stage("lint", "passed"), stage("test", "failed"), stage("e2e", "timed_out")])
  expect(brief({ permissions: 0, state: state(failing) })).toEqual({ glyph: "✗", tone: "error", text: "2 failing", key: "/verify" })
  expect(brief({ permissions: 0, state: state(done("verified")) })).toEqual({ glyph: "✓", tone: "success", text: "verified" })
  expect(brief({ permissions: 0, state: state(running) })).toEqual({ glyph: "◌", tone: "muted", text: "running 1/2" })
  expect(brief({ permissions: 0, state: state(done("tampered", [stage("test", "failed")])) })?.text).toBe("tampered")
  const older = done("verified", [], 1)
  const newer = done("failing", [stage("test", "failed")], 2)
  expect(brief({ permissions: 0, state: state(older, newer) })?.text).toBe("1 failing")
  expect(brief({ permissions: 0, state: state(newer, older) })?.text).toBe("1 failing")
})

const grey = RGBA.fromInts(200, 200, 200)
const fakeContext = (rift: Rift.State | null, permissions = 0) =>
  ({
    theme: {
      text: {
        base: grey,
        muted: grey,
        feedback: { success: { base: grey }, error: { base: grey }, warning: { base: grey } },
      },
    },
    data: {
      session: {
        list: () => [{ id: "other" }],
        get: () => ({ location: { directory: "/workspace" } }),
        permission: { list: () => Array(permissions).fill({}) },
      },
      on: () => () => undefined,
    },
    client: { rpc: () => ({ get: async () => rift, events: { on: () => () => undefined } }) },
  }) as unknown as Context

async function footer(width: number, rift: Rift.State | null, permissions = 0) {
  const { rows } = await draw(
    () => (
      <box flexDirection="row" gap={2} width={width} height={1}>
        <text flexShrink={0}>ctrl+p commands</text>
        <ComposerStatus context={fakeContext(rift, permissions)} sessionID="session" />
      </box>
    ),
    { width, height: 1, wait: 10 },
  )
  return rows[0]!
}

test("the status sits at the right end of the hint's row", async () => {
  expect(await footer(60, state(done("failing", [stage("test", "failed")])))).toBe(
    "ctrl+p commands" + "✗ 1 failing · /verify".padStart(45),
  )
  expect(await footer(60, null, 1)).toBe("ctrl+p commands" + "⚠ 1 permission waiting".padStart(45))
})

test("on a short row the status drops its key, then itself, and the hint always reads whole", async () => {
  const failing = state(done("failing", [stage("test", "failed")]))
  expect(await footer(38, failing)).toBe("ctrl+p commands" + "✗ 1 failing · /verify".padStart(23))
  expect(await footer(37, failing)).toBe("ctrl+p commands" + "✗ 1 failing".padStart(22))
  expect(await footer(28, failing)).toBe("ctrl+p commands" + "✗ 1 failing".padStart(13))
  expect(await footer(27, failing)).toBe("ctrl+p commands".padEnd(27))
})

test("the landing gives up detail as its rows run out, and the banner needs its width", () => {
  expect(landingDetail(32, 120)).toBe("full")
  expect(landingDetail(42, 200)).toBe("full")
  expect(landingDetail(22, 100)).toBe("banner")
  expect(landingDetail(17, 80)).toBe("wordmark")
  expect(landingDetail(32, 60)).toBe("wordmark")
  expect(landingDetail(4, 80)).toBe("heading")
  expect(landingDetail(1, 80)).toBe("none")
})

/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test"
import { RGBA, type CapturedFrame } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { JSX } from "solid-js"
import type { Context } from "@opencode/plugin/tui/context"
import type { Rift } from "@opencode/schema/rift"
import { BAR_PAD, barLook, barOutset, barTone, ComposerBar, TEXT_INSET, type BarColours, type BarLook } from "../src/component/prompt/frame"
import { fitInfoRow, folderForms, type InfoParts } from "../src/component/prompt/info-row"
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

test("at rest the bar is three tinted rows: padding, the prompt row with the glyph two columns in, padding", async () => {
  const { rows, spans } = await draw(() => bar({}))
  expect(rows.slice(0, 4)).toEqual(["", "  › fix the flaky test", "", ""].map((row) => row.padEnd(40)))
  const fill = rgb(look().fill)
  for (const row of backgrounds(spans).slice(0, 3)) expect(row).toEqual(Array(40).fill(fill))
  expect(backgrounds(spans)[3]).not.toContainEqual(fill)
})

test("a longer draft makes the bar taller by whole rows and keeps a padding row above and below", async () => {
  const { rows, spans } = await draw(() => bar({ lines: ["one", "two", "three"] }))
  expect(rows.slice(0, 6).map((row) => row.trimEnd())).toEqual(["", "  › one", "    two", "    three", "", ""])
  const fill = rgb(look().fill)
  const column = backgrounds(spans).map((row) => row[20])
  expect(column.slice(0, 5)).toEqual(Array(5).fill(fill))
  expect(column[5]).not.toEqual(fill)
})

test("the glyph sits after two columns of padding and the draft two columns after it", async () => {
  const { rows } = await draw(() => bar({ lines: ["x"] }))
  expect(rows[1]!.indexOf("›")).toBe(2)
  expect(rows[1]!.indexOf("x")).toBe(4)
  expect({ BAR_PAD, TEXT_INSET }).toEqual({ BAR_PAD: 2, TEXT_INSET: 4 })
})

test("shell mode swaps the glyph for an amber $ and keeps the draft's column", async () => {
  const { rows, spans } = await draw(() => bar({ look: look({ shell: true, draft: true }), lines: ["git status"] }))
  expect(rows[1]!.startsWith("  $ git status")).toBe(true)
  const glyph = spans.lines[1]!.spans.find((span) => span.text.includes("$"))!
  expect(rgb(glyph.fg)).toEqual(rgb(colours.shell))
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
  expect(busy.rows[1]!.startsWith("  › fix")).toBe(true)
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

const base = RGBA.fromInts(237, 237, 237)
const muted = RGBA.fromInts(143, 143, 143)
const red = RGBA.fromInts(230, 80, 80)
const amber = RGBA.fromInts(229, 181, 103)
const green = RGBA.fromInts(107, 203, 139)
const fakeContext = (rift: Rift.State | null, permissions = 0) =>
  ({
    theme: {
      text: {
        base,
        muted,
        feedback: { success: { base: green }, error: { base: red }, warning: { base: amber } },
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

async function status(rift: Rift.State | null, permissions = 0) {
  const { rows, spans } = await draw(
    () => (
      <box flexDirection="row" width={40} height={1}>
        <ComposerStatus context={fakeContext(rift, permissions)} sessionID="session" />
      </box>
    ),
    { width: 40, height: 1, wait: 10 },
  )
  const ink = spans.lines[0]!.spans.find((span) => span.text.trim())
  return { text: rows[0]!.trimEnd(), colour: ink && rgb(ink.fg) }
}

test("the status reads whole at its natural width", async () => {
  expect((await status(state(done("failing", [stage("test", "failed")])))).text).toBe("✗ 1 failing · /verify")
  expect((await status(null, 1)).text).toBe("⚠ 1 permission waiting")
  expect((await status(null)).text).toBe("")
})

test("the status keeps its feedback colour only while it is a problem", async () => {
  expect((await status(state(done("failing", [stage("test", "failed")])))).colour).toEqual(rgb(red))
  expect((await status(null, 1)).colour).toEqual(rgb(amber))
  expect((await status(state(done("verified")))).colour).toEqual(rgb(muted))
  expect((await status(state(running))).colour).toEqual(rgb(muted))
})

/** Agent and model, the hint "ctrl+p commands", a version, a status and a folder whose last two segments read 33 wide. */
const parts = (row: number, more: Partial<InfoParts> = {}): InfoParts => ({
  row,
  lead: 18,
  key: 6,
  label: 8,
  version: 6,
  status: 11,
  folder: { directory: "~/work/clients/acme/payments/checkout", branch: "main" },
  ...more,
})

test("the folder folds its middle segments into an ellipsis, down to its last two, and keeps its branch", () => {
  expect(folderForms({ directory: "~/work/clients/acme/payments/checkout", branch: "main" })).toEqual([
    "~/work/clients/acme/payments/checkout:main",
    "~/…/clients/acme/payments/checkout:main",
    "~/…/acme/payments/checkout:main",
    "~/…/payments/checkout:main",
  ])
  expect(folderForms({ directory: "/srv/app" })).toEqual(["/srv/app"])
})

test("as the row shortens the folder folds first, then the version, the hint's label and the status go; what the status leaves goes back to the label", () => {
  // Agent and model 18, hint 15 (key 6), version 6, status 11, four gaps of 2: the folder gets the row less 58.
  const all = { version: true, label: true, status: true }
  const noVersion = { ...all, version: false }
  const noLabel = { ...noVersion, label: false }
  const noStatus = { ...noLabel, status: false }
  expect(fitInfoRow(parts(100))).toEqual({ ...all, folder: "~/work/clients/acme/payments/checkout:main" })
  expect(fitInfoRow(parts(89))).toEqual({ ...all, folder: "~/…/acme/payments/checkout:main" })
  expect(fitInfoRow(parts(84))).toEqual({ ...all, folder: "~/…/payments/checkout:main" })
  // Without the version (6 and a gap) the folder has room to unfold a segment again.
  expect(fitInfoRow(parts(83))).toEqual({ ...noVersion, folder: "~/…/acme/payments/checkout:main" })
  expect(fitInfoRow(parts(76))).toEqual({ ...noVersion, folder: "~/…/payments/checkout:main" })
  expect(fitInfoRow(parts(75))).toEqual({ ...noLabel, folder: "~/…/acme/payments/checkout:main" })
  expect(fitInfoRow(parts(67))).toEqual({ ...noLabel, folder: "~/…/payments/checkout:main" })
  // With the status gone the label fits again (key and label 15, agent and model 18, a gap: the folder gets the row less 37).
  expect(fitInfoRow(parts(66))).toEqual({ ...noStatus, label: true, folder: "~/…/payments/checkout:main" })
  expect(fitInfoRow(parts(63))).toEqual({ ...noStatus, label: true, folder: "~/…/payments/checkout:main" })
  expect(fitInfoRow(parts(62))).toEqual({ ...noStatus, folder: "~/…/acme/payments/checkout:main" })
  expect(fitInfoRow(parts(58))).toEqual({ ...noStatus, folder: "~/…/payments/checkout:main" })
  expect(fitInfoRow(parts(54))).toEqual({ ...noStatus, folder: "~/…/payments/checkout:main" })
  // Past its last two segments the folder is cut in the middle, and below 8 columns it goes.
  expect(fitInfoRow(parts(53))).toEqual({ ...noStatus, folder: "~/…/payments…heckout:main" })
  expect(fitInfoRow(parts(36)).folder).toHaveLength(8)
  expect(fitInfoRow(parts(35)).folder).toBeUndefined()
})

test("whatever the width, what the row shows fits it", () => {
  for (let row = 20; row <= 120; row++) {
    const fit = fitInfoRow(parts(row))
    const widths = [18, 6 + (fit.label ? 9 : 0), fit.version ? 6 : 0, fit.status ? 11 : 0, fit.folder?.length ?? 0].filter(Boolean)
    if (fit.folder) expect(widths.reduce((a, b) => a + b, 0) + 2 * (widths.length - 1)).toBeLessThanOrEqual(row)
  }
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

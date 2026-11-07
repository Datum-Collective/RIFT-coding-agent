/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { JSX } from "solid-js"
import { ComposerFrame, FieldList, fieldTone, ringColour } from "../src/component/prompt/frame"
import { landingDetail } from "../src/component/landing"

const accent = RGBA.fromInts(169, 174, 255)
const border = RGBA.fromInts(38, 38, 38)
const page = RGBA.fromInts(10, 10, 10)
const fill = RGBA.fromInts(18, 18, 18)
const listFill = RGBA.fromInts(30, 30, 30)
const rgb = (colour: RGBA) => colour.toInts().slice(0, 3)

afterEach(() => {
  delete process.env.RIFT_NO_ANIMATION
})

async function draw(view: () => JSX.Element, wait = 0) {
  const app = await testRender(view, { width: 40, height: 10 })
  try {
    await app.renderOnce()
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
    await app.renderOnce()
    return { rows: app.captureCharFrame().split("\n"), spans: app.captureSpans() }
  } finally {
    app.renderer.destroy()
  }
}

function field(props: { busy?: boolean; glyph?: string; lines?: string[]; ring?: RGBA; joined?: RGBA }) {
  return (
    <ComposerFrame
      ring={props.ring ?? accent}
      accent={accent}
      fill={fill}
      busy={props.busy ?? false}
      animations={true}
      joined={props.joined}
      glyph={props.glyph}
    >
      <text>{(props.lines ?? ["fix the flaky test"]).join("\n")}</text>
    </ComposerFrame>
  )
}

const render = async (props: Parameters<typeof field>[0], wait = 0) => (await draw(() => field(props), wait)).rows

/** The colours of the cells in `row` that hold one of `glyphs`. */
function inks(spans: { lines: { spans: { text: string; fg: RGBA }[] }[] }, row: number, glyphs: RegExp) {
  return spans.lines[row]!.spans.filter((span) => glyphs.test(span.text)).map((span) => rgb(span.fg))
}

test("the field is the draft's rows inside a hairline ring with open corners", async () => {
  const rows = await render({})
  expect(rows[0]).toBe(" " + "▁".repeat(38) + " ")
  expect(rows[1]).toBe("▕   fix the flaky test".padEnd(39) + "▏")
  expect(rows[2]).toBe(" " + "▔".repeat(38) + " ")
})

test("a longer draft makes the field taller, not wider", async () => {
  const rows = await render({ lines: ["one", "two", "three"] })
  expect(rows.slice(1, 4).map((row) => row.slice(0, 9))).toEqual(["▕   one  ", "▕   two  ", "▕   three"])
  expect(rows[4]).toBe(" " + "▔".repeat(38) + " ")
})

test("shell mode marks the gutter, and the draft keeps its column", async () => {
  const rows = await render({ glyph: "$", lines: ["git status"] })
  expect(rows[1].startsWith("▕ $ git status")).toBe(true)
})

test("a crest runs along the waterline while the session works", async () => {
  const still = await render({ busy: false }, 300)
  expect(still[0]).not.toMatch(/[▂▃▄]/)
  const busy = await render({ busy: true }, 300)
  expect(busy[0]).toMatch(/[▂▃▄]/)
  expect(busy[1].startsWith("▕   fix")).toBe(true)
})

test("RIFT_NO_ANIMATION keeps the waterline still while busy", async () => {
  process.env.RIFT_NO_ANIMATION = "1"
  const rows = await render({ busy: true }, 300)
  expect(rows[0]).toBe(" " + "▁".repeat(38) + " ")
})

test("each state of the composer gives the ring one colour", () => {
  const colours = { accent, border, page }
  const ring = (state: { quiet?: boolean; shell?: boolean; draft?: boolean }) =>
    rgb(ringColour(fieldTone({ quiet: false, shell: false, draft: false, ...state }), colours))
  const between = (a: RGBA, b: RGBA, at: number) => rgb(a).map((v, i) => Math.round(v + (rgb(b)[i]! - v) * at))

  expect(ring({})).toEqual(between(border, accent, 0.55))
  expect(ring({ draft: true })).toEqual(rgb(accent))
  expect(ring({ shell: true })).toEqual(rgb(accent))
  expect(ring({ shell: true, draft: true })).toEqual(rgb(accent))
  for (const state of [{}, { draft: true }, { shell: true }])
    expect(ring({ quiet: true, ...state })).toEqual(between(border, page, 0.5))
})

test("the ring's colour is drawn on all four edges, and the crest keeps the agent's", async () => {
  const ring = ringColour("empty", { accent, border, page })
  const { spans } = await draw(() => field({ ring, glyph: "$", busy: true }), 300)
  for (const [row, glyphs] of [[0, /▁/], [1, /[▕▏$]/], [2, /▔/]] as const)
    for (const ink of inks(spans, row, glyphs)) expect(ink).toEqual(rgb(ring))
  expect(inks(spans, 0, /[▂▃▄]/)).toContainEqual(rgb(accent))
})

test("the slash list grows out of the field: its own top line, the field's sides, the field's top edge between", async () => {
  const ring = ringColour("draft", { accent, border, page })
  const { rows, spans } = await draw(() => (
    <box width={40} height={10}>
      <box height={4} flexShrink={0} />
      {field({ ring, joined: listFill, lines: ["/re"] })}
      <FieldList visible={true} top={2} left={0} width={40} ring={ring} rowSides={false}>
        <box backgroundColor={listFill}>
          <text>/review</text>
          <text>/rename</text>
        </box>
      </FieldList>
    </box>
  ))
  expect(rows.slice(1, 7)).toEqual([
    " " + "▁".repeat(38) + " ",
    "▕/review".padEnd(39) + "▏",
    "▕/rename".padEnd(39) + "▏",
    "▕" + "▁".repeat(38) + "▏",
    "▕   /re".padEnd(39) + "▏",
    " " + "▔".repeat(38) + " ",
  ])
  for (const row of [1, 2, 3, 4]) for (const ink of inks(spans, row, /[▁▕▏]/)) expect(ink).toEqual(rgb(ring))
})

test("a list whose rows draw their own left side gets only the right one", async () => {
  const { rows } = await draw(() => (
    <box width={40} height={10}>
      <box height={4} flexShrink={0} />
      <FieldList visible={true} top={2} left={0} width={40} ring={accent} rowSides={true}>
        <text>x/review</text>
      </FieldList>
    </box>
  ))
  expect(rows[2]).toBe("x/review".padEnd(39) + "▏")
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

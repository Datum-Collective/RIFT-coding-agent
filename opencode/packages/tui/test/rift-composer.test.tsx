/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { ComposerFrame, ringColour } from "../src/component/prompt/frame"
import { landingDetail } from "../src/component/landing"

const accent = RGBA.fromInts(169, 174, 255)
const border = RGBA.fromInts(38, 38, 38)
const fill = RGBA.fromInts(18, 18, 18)

afterEach(() => {
  delete process.env.RIFT_NO_ANIMATION
})

async function render(props: { busy?: boolean; glyph?: string; lines?: string[] }, wait = 0) {
  const app = await testRender(
    () => (
      <ComposerFrame
        accent={accent}
        border={border}
        fill={fill}
        quiet={false}
        draft={false}
        busy={props.busy ?? false}
        animations={true}
        glyph={props.glyph}
      >
        <text>{(props.lines ?? ["fix the flaky test"]).join("\n")}</text>
      </ComposerFrame>
    ),
    { width: 40, height: 8 },
  )
  try {
    await app.renderOnce()
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
    await app.renderOnce()
    return app.captureCharFrame().split("\n")
  } finally {
    app.renderer.destroy()
  }
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

test("the ring is quiet without input, the agent's colour once there is a draft, and between when empty", () => {
  expect(ringColour({ accent, border, quiet: true, draft: true })).toBe(border)
  expect(ringColour({ accent, border, quiet: false, draft: true })).toBe(accent)
  const empty = ringColour({ accent, border, quiet: false, draft: false })
  expect(empty.r).toBeGreaterThan(border.r)
  expect(empty.r).toBeLessThan(accent.r)
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

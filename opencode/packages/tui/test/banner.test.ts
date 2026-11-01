import { expect, test } from "bun:test"
import { banner, BANNER_FILL, BANNER_INK, BANNER_WIDTH } from "../src/banner"

function cells(row: (typeof banner)[number]) {
  return row.flatMap((run) => [...run.text].map((ch) => ({ ch, bg: run.bg })))
}

function inked(cell: { ch: string; bg?: string }) {
  return cell.ch !== " " || cell.bg !== undefined
}

test("every banner row is exactly the declared width", () => {
  for (const row of banner) {
    const width = row.reduce((total, run) => total + [...run.text].length, 0)
    expect(width).toBe(BANNER_WIDTH)
  }
})

// The declared width has to be the width you can see. Blank columns baked into the data pushed
// the artwork out of line with the prompt that is sized to match it.
test("the artwork is cropped to its own ink, with no dead columns at either edge", () => {
  const rows = banner.map(cells)
  const left = Math.min(...rows.map((row) => row.findIndex(inked)))
  const right = Math.max(...rows.map((row) => row.findLastIndex(inked)))
  expect(left).toBe(0)
  expect(right).toBe(BANNER_WIDTH - 1)
})

test("the artwork keeps all five inks and both fills distinct", () => {
  const inks = new Set(banner.flatMap((row) => row.map((run) => run.fg)))
  const fills = new Set(banner.flatMap((row) => row.flatMap((run) => (run.bg ? [run.bg] : []))))
  // Two of the inks are greys that differ only in value. Collapsing any of them — which is what
  // mapping them onto theme colours did — turns the drawing into noise.
  expect([...inks].sort()).toEqual(["azure", "navy", "shadow", "silver", "white"])
  expect([...fills].sort()).toEqual(["navy", "silver"])
  const hexes = Object.values(BANNER_INK)
  expect(new Set(hexes).size).toBe(hexes.length)
})

test("the palette is the source artwork's own", () => {
  expect(BANNER_INK).toEqual({
    navy: "#0000AA",
    azure: "#5555FF",
    shadow: "#555555",
    silver: "#AAAAAA",
    white: "#FFFFFF",
  })
  expect(BANNER_FILL).toEqual({ navy: "#0000AA", silver: "#AAAAAA" })
})

test("uses only half-block and shade glyphs, so it renders in any monospace font", () => {
  const allowed = new Set([" ", "█", "▀", "▄", "▌", "▐", "░", "▒", "▓"])
  const used = new Set(banner.flatMap((row) => row.flatMap((run) => [...run.text])))
  expect([...used].filter((glyph) => !allowed.has(glyph))).toEqual([])
})

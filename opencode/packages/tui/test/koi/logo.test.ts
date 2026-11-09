import { describe, expect, test } from "bun:test"
import { BANNER_FILL, BANNER_INK, BANNER_WIDTH, banner, bannerColours } from "../../src/banner"
import { dither, ditherBanner, logoRows, type Logo } from "../../src/koi/logo"
import { lum, mix, type Rgb } from "../../src/koi/colour"

const hex = (value: string): Rgb => ({ r: parseInt(value.slice(1, 3), 16), g: parseInt(value.slice(3, 5), 16), b: parseInt(value.slice(5, 7), 16) })
const WHITE = hex(BANNER_INK.white)
const NAVY = hex(BANNER_INK.navy)
const SHADOW = hex(BANNER_INK.shadow)
const SILVER = hex(BANNER_FILL.silver)

/** The letters are the greys of the artwork; the blues behind them are its backdrop. */
const grey = (c: Rgb) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) <= 48 && lum(c) >= 0.12

/** How many dots a braille character shows. */
const dotCount = (char: string) => [...(char.codePointAt(0)! - 0x2800).toString(2)].filter((bit) => bit === "1").length
const text = (logo: Logo) => logoRows(logo).map((row) => row.map((run) => run.text).join(""))
const lit = (logo: Logo) => text(logo).join("").split("").reduce((n, char) => n + (char === " " ? 0 : dotCount(char)), 0)
/** A patch of one glyph, `cols` by `rows` cells, in one ink. */
const patch = (char: string, cols: number, rows: number, fg: Rgb = NAVY, bg?: Rgb) => dither(Array.from({ length: rows }, () => [{ text: char.repeat(cols), fg, bg }]))

describe("art as dots", () => {
  test("each cell is a braille character: a block is all eight dots, a half block the four on its side", () => {
    expect(text(patch("█▀▄▌▐ ", 1, 1))).toEqual(["⣿⠛⣤⡇⢸ "])
  })

  test("the same art always gives the same dots", () => {
    expect(ditherBanner(banner)).toEqual(ditherBanner(banner))
    expect(text(ditherBanner(banner))).toEqual(text(ditherBanner(banner)))
  })

  test("dot density follows the shading: all of them under a block, three in four under ▓, half under ▒, one in four under ░", () => {
    const total = 8 * 4 * 8
    expect(lit(patch("█", 8, 4)) / total).toBe(1)
    expect(lit(patch("▓", 8, 4)) / total).toBe(0.75)
    expect(lit(patch("▒", 8, 4)) / total).toBe(0.5)
    expect(lit(patch("░", 8, 4)) / total).toBe(0.25)
  })

  test("a shade is an even texture: every cell of it has dots, and no cell of a fainter shade has more than one of a denser shade", () => {
    const counts = (char: string) => text(patch(char, 8, 4)).join("").split("").map(dotCount)
    for (const char of ["░", "▒", "▓"]) expect(counts(char).every((n) => n > 0)).toBe(true)
    expect(Math.max(...counts("░"))).toBeLessThanOrEqual(Math.min(...counts("▒")))
    expect(Math.max(...counts("▒"))).toBeLessThanOrEqual(Math.min(...counts("▓")))
  })

  test("a cell is drawn in the ink under it, at full strength, however few of its dots are lit", () => {
    const faint = patch("░", 2, 1, NAVY)
    expect(faint.cells.every((cell) => cell!.colour.r === NAVY.r && cell!.colour.g === NAVY.g && cell!.colour.b === NAVY.b)).toBe(true)
  })

  test("a shade over a fill is the two inks mixed, with every dot lit", () => {
    const logo = patch("▓", 1, 1, SHADOW, SILVER)
    expect(text(logo)).toEqual(["⣿"])
    expect(logo.cells[0]!.colour).toEqual(mix(SILVER, SHADOW, 0.75))
  })

  test("a block over a fill lights the whole cell, in the mean of its two inks", () => {
    const logo = patch("▀", 1, 1, WHITE, SILVER)
    expect(text(logo)).toEqual(["⣿"])
    expect(logo.cells[0]!.colour).toEqual(mix(WHITE, SILVER, 0.5))
  })

  test("nothing is drawn where the art has nothing", () => {
    expect(patch(" ", 3, 2).cells.every((cell) => cell === undefined)).toBe(true)
    expect(text(patch(" ", 3, 1))).toEqual(["   "])
  })

  test("neighbouring cells of one colour are one run, so a row is drawn as few spans as its colours need", () => {
    const logo = dither([[{ text: "██", fg: NAVY }, { text: "█", fg: WHITE }, { text: "  ", fg: WHITE }, { text: "█", fg: WHITE }]])
    expect(logoRows(logo)).toEqual([
      [
        { text: "⣿⣿", fg: NAVY },
        { text: "⣿", fg: WHITE },
        { text: "  ", fg: undefined },
        { text: "⣿", fg: WHITE },
      ],
    ])
  })
})

describe("RIFT's banner as dots", () => {
  const logo = ditherBanner(banner)

  test("takes the same cells as the art: seventy-two across and as many rows, so nothing round it moves", () => {
    expect(logo.cols).toBe(BANNER_WIDTH)
    expect(logo.rows).toBe(banner.length)
    for (const row of text(logo)) expect([...row].length).toBe(BANNER_WIDTH)
  })

  test("reaches both edges, as the art does", () => {
    const rows = text(logo)
    expect(rows.some((row) => row[0] !== " ")).toBe(true)
    expect(rows.some((row) => [...row][BANNER_WIDTH - 1] !== " ")).toBe(true)
  })

  test("is drawn only in the banner's own colours and mixes of them", () => {
    const inks = [...Object.values(BANNER_INK), ...Object.values(BANNER_FILL)].map(hex)
    const within = (c: Rgb, channel: "r" | "g" | "b") =>
      c[channel] >= Math.min(...inks.map((ink) => ink[channel])) - 1e-9 && c[channel] <= Math.max(...inks.map((ink) => ink[channel])) + 1e-9
    const cells = logo.cells.filter((cell) => cell !== undefined)
    expect(cells.every((cell) => within(cell!.colour, "r") && within(cell!.colour, "g") && within(cell!.colour, "b"))).toBe(true)
    // The navy of the backdrop is reproduced exactly where it is alone.
    expect(cells.some((cell) => cell!.colour.r === NAVY.r && cell!.colour.g === NAVY.g && cell!.colour.b === NAVY.b)).toBe(true)
  })

  test("a theme's accent recolours the blues and leaves the letters' greys and every dot where it was", () => {
    const green = ditherBanner(banner, bannerColours({ r: 80, g: 200, b: 120 }))
    expect(text(green)).toEqual(text(logo))
    logo.cells.forEach((cell, i) => {
      if (!cell) return
      const other = green.cells[i]!
      if (grey(cell.colour)) expect(other.colour).toEqual(cell.colour)
      else expect(other.colour.g).toBeGreaterThan(other.colour.b)
    })
  })

  test("has plenty of dots in it, and the letters, the grey ones, are a good part of them", () => {
    const drawn = logo.cells.filter((cell) => cell !== undefined)
    const letters = drawn.filter((cell) => grey(cell!.colour))
    expect(drawn.length).toBeGreaterThan(600)
    expect(letters.length).toBeGreaterThan(250)
    expect(letters.length).toBeLessThan(drawn.length)
  })
})

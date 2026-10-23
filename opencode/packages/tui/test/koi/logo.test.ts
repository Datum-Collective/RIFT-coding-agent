import { describe, expect, test } from "bun:test"
import { BANNER_FILL, BANNER_INK, banner, type BannerRun } from "../../src/banner"
import { isInk, logoFromBanner, riftLogo } from "../../src/koi/logo"
import { lum, mix, type Rgb } from "../../src/koi/colour"

const hex = (value: string): Rgb => ({ r: parseInt(value.slice(1, 3), 16), g: parseInt(value.slice(3, 5), 16), b: parseInt(value.slice(5, 7), 16) })
const WHITE = hex(BANNER_INK.white)
const NAVY = hex(BANNER_INK.navy)
const SILVER = hex(BANNER_FILL.silver)
const BLACK: Rgb = { r: 0, g: 0, b: 0 }

const one = (runs: BannerRun[]) => logoFromBanner([runs])

describe("the logo as pixels", () => {
  test("every character cell is two pixels, one above the other", () => {
    const logo = one([{ text: "abc", fg: "white" }])
    expect(logo.cols).toBe(3)
    expect(logo.rows).toBe(1)
    expect(logo.w).toBe(3)
    expect(logo.h).toBe(2)
    expect(logo.pixels.length).toBe(6)
  })

  test("blocks give the top half, the bottom half, both, or neither", () => {
    const logo = one([{ text: "▀▄█ ", fg: "white" }])
    const at = (x: number, y: number) => logo.pixels[y * logo.w + x]
    expect(at(0, 0)).toEqual(WHITE)
    expect(at(0, 1)).toBeUndefined()
    expect(at(1, 0)).toBeUndefined()
    expect(at(1, 1)).toEqual(WHITE)
    expect(at(2, 0)).toEqual(WHITE)
    expect(at(2, 1)).toEqual(WHITE)
    expect(at(3, 0)).toBeUndefined()
    expect(at(3, 1)).toBeUndefined()
  })

  test("a fill colour shows where the block is not", () => {
    const logo = one([{ text: "▀", fg: "white", bg: "silver" }])
    expect(logo.pixels[0]).toEqual(WHITE)
    expect(logo.pixels[logo.w]).toEqual(SILVER)
  })

  test("the shades are the ink partway over what is under it", () => {
    const logo = one([{ text: "░▒▓", fg: "navy" }])
    const top = (x: number) => logo.pixels[x]!
    expect(top(0)).toEqual(mix(BLACK, NAVY, 0.25))
    expect(top(1)).toEqual(mix(BLACK, NAVY, 0.5))
    expect(top(2)).toEqual(mix(BLACK, NAVY, 0.75))
  })

  test("half blocks to the side are an even mix, in both halves", () => {
    const logo = one([{ text: "▌", fg: "white" }])
    const half = mix(BLACK, WHITE, 0.5)
    expect(logo.pixels[0]).toEqual(half)
    expect(logo.pixels[logo.w]).toEqual(half)
  })

  test("black is nothing: it is the canvas", () => {
    const logo = one([{ text: "░", fg: "navy" }])
    expect(logo.pixels.every((p) => p !== undefined)).toBe(true)
    const pure = logoFromBanner([[{ text: " ", fg: "white" }]])
    expect(pure.pixels).toEqual([undefined, undefined])
  })

  test("it keeps the characters, so the real banner can be told from anything laid over it", () => {
    const logo = logoFromBanner([
      [{ text: "ab", fg: "white" }, { text: "c", fg: "navy" }],
      [{ text: "def", fg: "white" }],
    ])
    expect(logo.glyphs).toEqual(["abc", "def"])
  })
})

describe("on a page that is not black", () => {
  const page: Rgb = { r: 40, g: 40, b: 44 }

  test("the shades are the ink partway over the page, which is what the terminal shows", () => {
    const logo = logoFromBanner([[{ text: "░▒▓", fg: "navy" }]], page)
    expect(logo.pixels[0]).toEqual(mix(page, NAVY, 0.25))
    expect(logo.pixels[1]).toEqual(mix(page, NAVY, 0.5))
    expect(logo.pixels[2]).toEqual(mix(page, NAVY, 0.75))
  })

  test("nothing is the page itself: blank cells and the empty half of a block draw nothing", () => {
    const logo = logoFromBanner([[{ text: " ▀", fg: "white" }]], page)
    expect(logo.pixels[0]).toBeUndefined()
    expect(logo.pixels[logo.w + 0]).toBeUndefined()
    expect(logo.pixels[1]).toEqual(WHITE)
    expect(logo.pixels[logo.w + 1]).toBeUndefined()
  })

  test("a fill colour is still the fill colour", () => {
    const logo = logoFromBanner([[{ text: "▀", fg: "white", bg: "silver" }]], page)
    expect(logo.pixels[logo.w]).toEqual(SILVER)
  })

  test("with no page named it is black, as it was", () => {
    expect(logoFromBanner(banner).pixels).toEqual(riftLogo.pixels)
  })
})

describe("RIFT's logo", () => {
  test("is the banner, seventy-two cells wide and twelve tall, so seventy-two pixels by twenty-four", () => {
    expect(riftLogo.cols).toBe(72)
    expect(riftLogo.rows).toBe(banner.length)
    expect(riftLogo.w).toBe(72)
    expect(riftLogo.h).toBe(banner.length * 2)
    expect(riftLogo.glyphs.every((row) => [...row].length === 72)).toBe(true)
  })

  test("has plenty of drawing in it, and the letters, the grey ones, are a good part of it", () => {
    const drawn = riftLogo.pixels.filter((p) => p !== undefined)
    const letters = drawn.filter((p) => isInk(p!))
    expect(drawn.length).toBeGreaterThan(800)
    expect(letters.length).toBeGreaterThan(250)
    expect(letters.length).toBeLessThan(drawn.length)
  })
})

describe("what is a letter", () => {
  test("the greys are, and the blues behind them are not", () => {
    expect(isInk(hex(BANNER_INK.white))).toBe(true)
    expect(isInk(hex(BANNER_INK.silver))).toBe(true)
    expect(isInk(hex(BANNER_INK.shadow))).toBe(true)
    expect(isInk(hex(BANNER_INK.navy))).toBe(false)
    expect(isInk(hex(BANNER_INK.azure))).toBe(false)
  })

  test("a grey too dark to see is not", () => {
    expect(isInk({ r: 10, g: 10, b: 10 })).toBe(false)
    expect(lum(hex(BANNER_INK.shadow))).toBeGreaterThan(0.12)
  })
})

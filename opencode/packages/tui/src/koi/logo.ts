/**
 * RIFT's banner as a bitmap, for the pond's intro: the logo breaks into pieces that become the
 * koi. The banner is drawn in half blocks, so each character cell is two pixels, one above the
 * other, and a pixel is a cell wide and half a cell tall.
 *
 * Adapted from koi-screensaver by Erik Johansson (MIT licence), whose intro reads Omarchy's
 * wordmark the same way. See THIRD_PARTY_NOTICES.md.
 */
import { BANNER_FILL, BANNER_INK, banner, type BannerRun } from "../banner"
import { lum, mix, type Rgb } from "./colour"

export type Logo = {
  /** Size in character cells. */
  cols: number
  rows: number
  /** Size in pixels: as wide as `cols`, twice as tall as `rows`. */
  w: number
  h: number
  /** Row by row, `w` across. `undefined` is the canvas: nothing is drawn there. */
  pixels: (Rgb | undefined)[]
  /** The characters of each row, for telling the real banner from anything laid over it. */
  glyphs: string[]
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 }

const hex = (value: string): Rgb => ({
  r: parseInt(value.slice(1, 3), 16),
  g: parseInt(value.slice(3, 5), 16),
  b: parseInt(value.slice(5, 7), 16),
})

const SHADE: Record<string, number> = { "░": 0.25, "▒": 0.5, "▓": 0.75 }

/** What a character cell shows in its top and bottom half, over `bg`. */
function halves(char: string, fg: Rgb, bg: Rgb): [Rgb, Rgb] {
  switch (char) {
    case "▀":
      return [fg, bg]
    case "▄":
      return [bg, fg]
    case "█":
      return [fg, fg]
    case "▌":
    case "▐": {
      const both = mix(bg, fg, 0.5)
      return [both, both]
    }
    case "░":
    case "▒":
    case "▓": {
      const both = mix(bg, fg, SHADE[char]!)
      return [both, both]
    }
    default:
      return [bg, bg]
  }
}

/**
 * The banner as pixels. `page` is the colour of the empty page it is drawn on (black unless said
 * otherwise): the shades are the ink partway over it, and a pixel that is the page itself is
 * nothing. A half block to the side is approximated, as an even mix across the whole cell.
 */
export function logoFromBanner(rows: BannerRun[][], page: Rgb = BLACK): Logo {
  const cells = rows.map((row) =>
    row.flatMap((run) => {
      const fg = hex(BANNER_INK[run.fg])
      const bg = run.bg ? hex(BANNER_FILL[run.bg]) : page
      return [...run.text].map((char) => ({ char, top: halves(char, fg, bg)[0], bottom: halves(char, fg, bg)[1] }))
    }),
  )
  const cols = Math.max(0, ...cells.map((row) => row.length))
  const h = cells.length * 2
  const pixels: (Rgb | undefined)[] = new Array(cols * h).fill(undefined)
  const canvas = (c: Rgb) => (c.r === page.r && c.g === page.g && c.b === page.b ? undefined : c)
  cells.forEach((row, y) => {
    row.forEach((cell, x) => {
      pixels[2 * y * cols + x] = canvas(cell.top)
      pixels[(2 * y + 1) * cols + x] = canvas(cell.bottom)
    })
  })
  return {
    cols,
    rows: cells.length,
    w: cols,
    h,
    pixels,
    glyphs: cells.map((row) => row.map((cell) => cell.char).join("")),
  }
}

/** The letters are the greys of the artwork; the blues behind them are its backdrop. */
export function isInk(c: Rgb) {
  const chroma = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)
  return chroma <= 48 && lum(c) >= 0.12
}

export const riftLogo: Logo = logoFromBanner(banner)

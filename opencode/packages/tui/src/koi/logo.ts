/**
 * RIFT's banner as dots, the way it is shown: on the home screen, and in the pond's intro, where
 * the dots break up into koi.
 *
 * The banner's art (`src/banner.ts`) is drawn in half blocks and shades. Each of its cells is shown
 * as a braille character instead, two dots across and four down, so half a cell is four dots and a
 * dot is as wide as it is tall. A dot is lit where the art has ink: every dot under a block, one in
 * four under ░, half under ▒, three in four under ▓. Which ones is set by a 4x4 ordered (Bayer)
 * matrix laid across the whole logo, so a shade is an even, still texture of dots. A cell's dots
 * are drawn in the colour of the art under them.
 */
import { BANNER_FILL, BANNER_INK, type BannerColours, type BannerRun } from "../banner"
import { lum, type Rgb } from "./colour"

/** The lit dots of one cell, as the braille character's bits, and the colour they are drawn in. */
export type DotCell = { bits: number; colour: Rgb }

export type Logo = {
  /** Size in character cells. */
  cols: number
  rows: number
  /** Row by row, `cols` across. Nothing is drawn in a cell that is `undefined`. */
  cells: (DotCell | undefined)[]
}

/** A run of the art: its characters, in an ink, over a fill or over nothing. */
export type ArtRun = { text: string; fg: Rgb; bg?: Rgb }

/** A run of the logo as it is drawn: braille in one colour, or blank. */
export type DotRun = { text: string; fg?: Rgb }

/** Thresholds a dot's ink has to beat to be lit, by where the dot is in the logo. */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((rank) => (rank + 0.5) / 16))

/** The bit of each dot of a braille character, by row (four) and column (two). */
export const DOT_BIT = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const

export const braille = (bits: number) => String.fromCharCode(0x2800 + bits)

const SHADE: Record<string, number> = { "░": 0.25, "▒": 0.5, "▓": 0.75 }

/** How much ink a character puts on one dot of its cell, and in what colour. */
function inkAt(char: string, fg: Rgb, bg: Rgb | undefined, x: number, y: number): { colour: Rgb; cover: number } | undefined {
  const solid = (on: boolean) => (on ? { colour: fg, cover: 1 } : bg ? { colour: bg, cover: 1 } : undefined)
  switch (char) {
    case "▀":
      return solid(y < 2)
    case "▄":
      return solid(y >= 2)
    case "█":
      return solid(true)
    case "▌":
      return solid(x === 0)
    case "▐":
      return solid(x === 1)
    case "░":
    case "▒":
    case "▓": {
      const shade = SHADE[char]!
      // Over a fill the shade is two inks mixed, all over; over nothing it is the ink, partly.
      if (!bg) return { colour: fg, cover: shade }
      return { colour: { r: bg.r + (fg.r - bg.r) * shade, g: bg.g + (fg.g - bg.g) * shade, b: bg.b + (fg.b - bg.b) * shade }, cover: 1 }
    }
    default:
      return solid(false)
  }
}

/** Art drawn in half blocks and shades, as dots. The same art always gives the same dots. */
export function dither(rows: ArtRun[][]): Logo {
  const chars = rows.map((row) => row.flatMap((run) => [...run.text].map((char) => ({ char, fg: run.fg, bg: run.bg }))))
  const cols = Math.max(0, ...chars.map((row) => row.length))
  const cells: (DotCell | undefined)[] = new Array(cols * chars.length).fill(undefined)
  chars.forEach((row, cy) =>
    row.forEach((cell, cx) => {
      let bits = 0
      let weight = 0
      const sum = { r: 0, g: 0, b: 0 }
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 2; x++) {
          const ink = inkAt(cell.char, cell.fg, cell.bg, x, y)
          if (!ink) continue
          weight += ink.cover
          sum.r += ink.colour.r * ink.cover
          sum.g += ink.colour.g * ink.cover
          sum.b += ink.colour.b * ink.cover
          if (ink.cover > BAYER[(cy * 4 + y) % 4]![(cx * 2 + x) % 4]!) bits |= DOT_BIT[y]![x]!
        }
      }
      if (bits) cells[cy * cols + cx] = { bits, colour: { r: sum.r / weight, g: sum.g / weight, b: sum.b / weight } }
    }),
  )
  return { cols, rows: chars.length, cells }
}

const hex = (value: string): Rgb => ({
  r: parseInt(value.slice(1, 3), 16),
  g: parseInt(value.slice(3, 5), 16),
  b: parseInt(value.slice(5, 7), 16),
})

/** The banner as dots, in its own colours or a theme's (see `bannerColours`). */
export function ditherBanner(rows: BannerRun[][], colours: BannerColours = { ink: BANNER_INK, fill: BANNER_FILL }): Logo {
  return dither(rows.map((row) => row.map((run) => ({ text: run.text, fg: hex(colours.ink[run.fg]), bg: run.bg ? hex(colours.fill[run.bg]) : undefined }))))
}

/** The logo as rows of text to draw: neighbouring cells of one colour share a run. */
export function logoRows(logo: Logo): DotRun[][] {
  return Array.from({ length: logo.rows }, (_, y) => {
    const runs: DotRun[] = []
    for (let x = 0; x < logo.cols; x++) {
      const cell = logo.cells[y * logo.cols + x]
      const text = cell ? braille(cell.bits) : " "
      const fg = cell ? { r: Math.round(cell.colour.r), g: Math.round(cell.colour.g), b: Math.round(cell.colour.b) } : undefined
      const last = runs[runs.length - 1]
      const same = last && (fg && last.fg ? fg.r === last.fg.r && fg.g === last.fg.g && fg.b === last.fg.b : !fg && !last.fg)
      if (same) last.text += text
      else runs.push({ text, fg })
    }
    return runs
  })
}

/** The letters are the greys of the artwork; the blues behind them are its backdrop. */
export function isInk(c: Rgb) {
  const chroma = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)
  return chroma <= 48 && lum(c) >= 0.12
}

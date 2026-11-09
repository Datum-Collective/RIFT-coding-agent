/**
 * Puts a scene's cells into a finished frame: the koi's, or the singularity's braille dots.
 *
 * It runs after the interface has drawn itself, and only touches cells the interface left empty:
 * no character in them, and the same background as the page. Text, the composer and any panel
 * therefore stay exactly as they were, and the scene reads as lying behind them.
 */
import { RGBA, type OptimizedBuffer } from "@opentui/core"
import { quadrant } from "./fit"
import type { Placed } from "./pond"

const filled = (code: number | undefined) => code !== undefined && code !== 32 && code !== 0

/** Colours already made, by their three channels. The fade-in alone makes thousands, so it is emptied before it grows too big. */
const colours = new Map<number, RGBA>()
const MAX_COLOURS = 4096

function colour([r, g, b]: readonly [number, number, number]) {
  const key = (r << 16) | (g << 8) | b
  let found = colours.get(key)
  if (!found) {
    if (colours.size >= MAX_COLOURS) colours.clear()
    found = RGBA.fromInts(r, g, b, 255)
    colours.set(key, found)
  }
  return found
}

const eligible: Placed[] = []

/**
 * Draws `cells` into `buffer`. Returns how many were drawn.
 *
 * `page` is the colour of the empty page. Given it, a cell is empty only if it shows exactly that,
 * so a panel, or a dimming scrim over everything, is never painted through. Left out (a theme with
 * a transparent background has no colour to name) the page is taken to be whatever the top left
 * cell shows.
 *
 * Every cell is judged against the frame as the interface drew it, before any of the pond goes in,
 * so one painted cell never counts as the interface for the cell beside it.
 */
export function paintCells(buffer: OptimizedBuffer, cells: readonly Placed[], page?: { r: number; g: number; b: number }) {
  const { width, height } = buffer
  buffer.withBuffers(({ char, bg }) => {
    const [r, g, b, a] = page ? [Math.round(page.r), Math.round(page.g), Math.round(page.b), 255] : [bg[0]!, bg[1]!, bg[2]!, bg[3]!]

    eligible.length = 0
    for (const cell of cells) {
      if (cell.col < 0 || cell.col >= width || cell.row < 0 || cell.row >= height) continue
      const at = cell.row * width + cell.col
      if (filled(char[at])) continue
      const own = at * 4
      if (bg[own] !== r || bg[own + 1] !== g || bg[own + 2] !== b || bg[own + 3] !== a) continue
      eligible.push(cell)
    }
  })
  for (const cell of eligible) buffer.setCell(cell.col, cell.row, cell.char ?? quadrant(cell.mask), colour(cell.fg), colour(cell.bg))
  const drawn = eligible.length
  eligible.length = 0
  return drawn
}

/** A screenful of braille: per cell its dots (0 for none) and the colour they are drawn in, three channels a cell. */
export type Dots = { cols: number; rows: number; bits: Uint8Array; rgb: Uint8Array }

/**
 * Draws `dots` into `buffer`, top left to top left, under the same rule as `paintCells`: only into
 * cells the interface left empty, and not into the space between two words either, which is part of
 * the line of text and would break it up. It writes the cells' planes directly, so a frame of
 * thousands of changing colours makes no objects. Returns how many cells were drawn.
 */
export function paintDots(buffer: OptimizedBuffer, dots: Dots, page?: { r: number; g: number; b: number }) {
  return buffer.withBuffers(({ width, height, char, fg, bg, attributes }) => {
    const r = page ? Math.round(page.r) : bg[0]
    const g = page ? Math.round(page.g) : bg[1]
    const b = page ? Math.round(page.b) : bg[2]
    const a = page ? 255 : bg[3]
    const cols = Math.min(width, dots.cols)
    const rows = Math.min(height, dots.rows)
    let drawn = 0
    for (let row = 0; row < rows; row++) {
      // What the interface drew in the cell to the left, before any dot went in.
      let left = 0
      for (let col = 0; col < cols; col++) {
        const at = row * width + col
        const ui = char[at]
        const before = left
        left = ui
        const bits = dots.bits[row * dots.cols + col]
        if (!bits || filled(ui)) continue
        if (col < width - 1 && filled(before) && filled(char[at + 1])) continue
        const own = at * 4
        if (bg[own] !== r || bg[own + 1] !== g || bg[own + 2] !== b || bg[own + 3] !== a) continue
        const from = (row * dots.cols + col) * 3
        char[at] = 0x2800 + bits
        fg[own] = dots.rgb[from]
        fg[own + 1] = dots.rgb[from + 1]
        fg[own + 2] = dots.rgb[from + 2]
        fg[own + 3] = 255
        attributes[at] = 0
        drawn++
      }
    }
    return drawn
  })
}

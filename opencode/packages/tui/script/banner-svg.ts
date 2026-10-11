#!/usr/bin/env bun
/**
 * Renders the banner the TUI draws into an SVG for the README.
 *
 * It reads the same `src/banner.ts` the app renders, so the image cannot drift from what you
 * see in the terminal. Each cell is drawn as rectangles rather than text, because the block
 * glyphs would otherwise depend on the reader having a font that has them — and GitHub readers
 * do not all have one.
 *
 *   bun run script/banner-svg.ts > ../../../assets/banner.svg
 */
import { banner, BANNER_FILL, BANNER_INK, BANNER_WIDTH } from "../src/banner"

const CELL_W = 8
const CELL_H = 16
const BACKGROUND = "#0d1117" // GitHub's dark canvas, so the art sits flush on the page

/** Fraction of the cell each glyph covers: [x, y, width, height], plus an opacity for shades. */
const GLYPHS: Record<string, { box: [number, number, number, number]; opacity?: number }> = {
  "█": { box: [0, 0, 1, 1] },
  "▀": { box: [0, 0, 1, 0.5] },
  "▄": { box: [0, 0.5, 1, 0.5] },
  "▌": { box: [0, 0, 0.5, 1] },
  "▐": { box: [0.5, 0, 0.5, 1] },
  "░": { box: [0, 0, 1, 1], opacity: 0.25 },
  "▒": { box: [0, 0, 1, 1], opacity: 0.5 },
  "▓": { box: [0, 0, 1, 1], opacity: 0.75 },
}

const parts: string[] = []
const width = BANNER_WIDTH * CELL_W
const height = banner.length * CELL_H

parts.push(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="RIFT">`,
)
parts.push(`<rect width="${width}" height="${height}" fill="${BACKGROUND}"/>`)

banner.forEach((row, y) => {
  let x = 0
  for (const run of row) {
    for (const char of run.text) {
      const left = x * CELL_W
      const top = y * CELL_H
      if (run.bg) {
        parts.push(`<rect x="${left}" y="${top}" width="${CELL_W}" height="${CELL_H}" fill="${BANNER_FILL[run.bg]}"/>`)
      }
      const glyph = GLYPHS[char]
      if (glyph) {
        const [gx, gy, gw, gh] = glyph.box
        const opacity = glyph.opacity === undefined ? "" : ` opacity="${glyph.opacity}"`
        parts.push(
          `<rect x="${left + gx * CELL_W}" y="${top + gy * CELL_H}" width="${gw * CELL_W}" height="${gh * CELL_H}" fill="${BANNER_INK[run.fg]}"${opacity}/>`,
        )
      }
      x++
    }
  }
})

parts.push("</svg>")
console.log(parts.join("\n"))

/**
 * Turns a 2x2 block of pixels into one terminal cell: a quadrant character, a foreground and a
 * background, chosen so the cell looks as much like the four pixels as two colours can.
 *
 * Adapted from koi-screensaver by Erik Johansson (MIT licence), which does the same with six
 * pixels to a cell. See THIRD_PARTY_NOTICES.md at the root of the repository.
 */
import { dist2, to8, type Rgb } from "./colour"

export type Pixels = readonly [Rgb, Rgb, Rgb, Rgb]

/** A cell: bit 0 is the top left pixel, 1 top right, 2 bottom left, 3 bottom right. */
export type Fitted = { mask: number; fg: [number, number, number]; bg: [number, number, number] }

const QUADRANTS = [" ", "▘", "▝", "▀", "▖", "▌", "▞", "▛", "▗", "▚", "▐", "▜", "▄", "▙", "▟", "█"]

export const quadrant = (mask: number) => QUADRANTS[mask]!

/** Below this squared distance, four pixels count as one colour. */
const FLAT = 12

/** Two halves closer than this would only show as stripes, so the cell is drawn flat. */
const STRIPE = 80

function average(px: Pixels): Rgb {
  return {
    r: (px[0].r + px[1].r + px[2].r + px[3].r) / 4,
    g: (px[0].g + px[1].g + px[2].g + px[3].g) / 4,
    b: (px[0].b + px[1].b + px[2].b + px[3].b) / 4,
  }
}

function flat(px: Pixels): Fitted {
  const colour = to8(average(px))
  return { mask: 0, fg: colour, bg: colour }
}

/** The pixel of one half of a split that is closest to the rest of that half. */
function medoid(px: Pixels, mask: number, set: boolean): Rgb {
  let best = px[0]
  let bestDistance = Infinity
  for (let index = 0; index < 4; index++) {
    if (Boolean(mask & (1 << index)) !== set) continue
    let total = 0
    for (let other = 0; other < 4; other++) {
      if (Boolean(mask & (1 << other)) === set) total += dist2(px[index]!, px[other]!)
    }
    if (total < bestDistance) {
      best = px[index]!
      bestDistance = total
    }
  }
  return best
}

export function fit(px: Pixels): Fitted {
  if (px.every((p) => dist2(p, px[0]) <= FLAT)) return flat(px)

  let best = 0
  let bestError = Infinity
  let bestA = px[0]
  let bestB = px[0]
  // The bottom right pixel always goes to the background, so each split is tried once.
  for (let mask = 1; mask < 8; mask++) {
    const a = { r: 0, g: 0, b: 0 }
    const b = { r: 0, g: 0, b: 0 }
    let na = 0
    let nb = 0
    for (let index = 0; index < 4; index++) {
      const side = mask & (1 << index) ? a : b
      side.r += px[index]!.r
      side.g += px[index]!.g
      side.b += px[index]!.b
      if (mask & (1 << index)) na++
      else nb++
    }
    const meanA = { r: a.r / na, g: a.g / na, b: a.b / na }
    const meanB = { r: b.r / nb, g: b.g / nb, b: b.b / nb }
    let error = 0
    for (let index = 0; index < 4; index++) error += dist2(px[index]!, mask & (1 << index) ? meanA : meanB)
    if (error < bestError) {
      best = mask
      bestError = error
      bestA = meanA
      bestB = meanB
    }
  }
  if (dist2(bestA, bestB) < STRIPE) return flat(px)
  return { mask: best, fg: to8(medoid(px, best, true)), bg: to8(medoid(px, best, false)) }
}

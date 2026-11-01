/**
 * Colours as floats, 0 to 255 a channel, so shading can blend freely before anything is rounded.
 *
 * Adapted from koi-screensaver by Erik Johansson (MIT licence). See THIRD_PARTY_NOTICES.md.
 */
export type Rgb = { r: number; g: number; b: number }

export const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value))

/** `a` at 0, `b` at 1. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }
}

/** How bright a colour looks, 0 to 1. */
export const lum = (c: Rgb) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255

/** The colour as three whole channels a terminal can take. */
export const to8 = (c: Rgb): [number, number, number] => [
  clamp(Math.round(c.r), 0, 255),
  clamp(Math.round(c.g), 0, 255),
  clamp(Math.round(c.b), 0, 255),
]

export function dist2(a: Rgb, b: Rgb) {
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return dr * dr + dg * dg + db * db
}

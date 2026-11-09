/**
 * The koi's colours, in RIFT's own: the canvas, neutral greys, and the azure accent, and nothing
 * else. Every part of a koi is one flat colour, a "tag", and the water is the canvas itself, only
 * ever lightened by ripples or darkened by shadows.
 *
 * Adapted from koi-screensaver by Erik Johansson (MIT licence), whose palette is built from the
 * desktop theme's red, yellow, green and magenta. See THIRD_PARTY_NOTICES.md.
 */
import { dist2, mix, lum, type Rgb } from "./colour"

export const Tag = {
  water: 0,
  /** Dark, on a light or azure head. */
  eye: 1,
  /** Pale, on a head as dark as the canvas. */
  eyePale: 2,
  // koi
  ink: 3,
  red: 4,
  orange: 5,
  gold: 6,
  /** The light down a metallic koi's back. */
  sheen: 7,
  count: 8,
} as const

export type Palette = {
  tags: Rgb[]
  /** What ripples lighten (or on a light theme, darken) the water towards. */
  ripple: Rgb
  trough: Rgb
  /** The water under a shadow. */
  shadow: Rgb
  /** The canvas, which is also the still water. */
  bg: Rgb
  /** What a shadow darkens a koi towards. */
  koiShadow: Rgb
  dark: boolean
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 }

/**
 * The koi's blue, RIFT's own rather than a theme token: v2 themes alias their action text to the
 * body text, which turned every blue scale white.
 */
export const AZURE: Rgb = { r: 47, g: 129, b: 247 }

/**
 * The koi's blue for a theme: its accent, unless that is close to the body text (a theme whose
 * accent is white), when the scales would go white, so RIFT's own azure.
 */
export function koiAccent(accent: Rgb, text: Rgb): Rgb {
  return Math.sqrt(dist2(accent, text)) < 70 ? AZURE : accent
}

export function riftPalette(input: { background: Rgb; text: Rgb; muted: Rgb; primary?: Rgb }): Palette {
  const { background: bg, text: fg, muted, primary = AZURE } = input
  const dark = lum(bg) < 0.5
  const lightest = dark ? fg : bg
  const darkest = dark ? BLACK : fg

  const deep = dark ? mix(bg, BLACK, 0.35) : bg
  const tags: Rgb[] = Array.from({ length: Tag.count }, () => bg)

  tags[Tag.eye] = dark ? mix(deep, darkest, 0.4) : mix(fg, BLACK, 0.2)
  tags[Tag.eyePale] = dark ? mix(bg, fg, 0.9) : mix(fg, bg, 0.9)

  // Greys for the body and the azure accent for what stands out, so a koi is a handful of
  // neutral and azure patches on black.
  tags[Tag.ink] = fg
  tags[Tag.red] = primary
  tags[Tag.orange] = mix(primary, fg, 0.45)
  tags[Tag.gold] = mix(muted, fg, 0.25)
  tags[Tag.sheen] = mix(tags[Tag.gold]!, lightest, dark ? 0.6 : 0.4)

  return {
    tags,
    ripple: dark ? mix(bg, fg, 0.7) : mix(bg, fg, 0.5),
    trough: mix(deep, darkest, 0.25),
    shadow: dark ? mix(bg, BLACK, 0.45) : mix(bg, fg, 0.12),
    bg,
    koiShadow: BLACK,
    dark,
  }
}

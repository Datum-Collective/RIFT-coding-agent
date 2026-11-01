/**
 * The pond's colours, in RIFT's own: the canvas, neutral greys, and the azure accent, and nothing
 * else. Everything in the pond is one flat colour, a "tag", except the water, which is the
 * canvas itself and is only ever lightened by ripples or darkened by shadows.
 *
 * Adapted from koi-screensaver by Erik Johansson (MIT licence), whose palette is built from the
 * desktop theme's red, yellow, green and magenta. See THIRD_PARTY_NOTICES.md.
 */
import { mix, lum, type Rgb } from "./colour"

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
  // on the surface
  pad: 8,
  padRim: 9,
  padVein: 10,
  petal: 11,
  petalInner: 12,
  stamen: 13,
  count: 14,
} as const

/** Tags from here up float on the surface, above every koi. */
export const FIRST_SURFACE = Tag.pad

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

export function riftPalette(input: { background: Rgb; text: Rgb; muted: Rgb; primary: Rgb }): Palette {
  const { background: bg, text: fg, muted, primary } = input
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

  // The pad is the canvas with a little grey and a little azure washed into it, a thin darker
  // edge and paler veins.
  const pad = mix(mix(bg, muted, dark ? 0.22 : 0.3), primary, 0.14)
  tags[Tag.pad] = pad
  tags[Tag.padRim] = mix(pad, darkest, 0.22)
  tags[Tag.padVein] = mix(pad, lightest, 0.2)

  tags[Tag.petal] = mix(primary, lightest, 0.55)
  tags[Tag.petalInner] = mix(primary, lightest, 0.82)
  tags[Tag.stamen] = fg

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

import { describe, expect, test } from "bun:test"
import { Tag, riftPalette } from "../../src/koi/palette"
import { dist2, lum, mix, type Rgb } from "../../src/koi/colour"

const AZURE: Rgb = { r: 47, g: 129, b: 247 }
const dark = riftPalette({
  background: { r: 0, g: 0, b: 0 },
  text: { r: 238, g: 238, b: 238 },
  muted: { r: 128, g: 128, b: 138 },
  primary: AZURE,
})
const light = riftPalette({
  background: { r: 250, g: 250, b: 250 },
  text: { r: 28, g: 28, b: 32 },
  muted: { r: 120, g: 120, b: 130 },
  primary: AZURE,
})

/** Hue in degrees, and how colourful (0 for any grey). */
function hsv({ r, g, b }: Rgb) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = max - min
  if (chroma === 0) return { hue: 0, chroma: 0 }
  const hue = max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4
  return { hue: (hue * 60 + 360) % 360, chroma }
}

const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

const colourful = [Tag.eye, Tag.eyePale, Tag.ink, Tag.red, Tag.orange, Tag.gold, Tag.sheen, Tag.pad, Tag.padRim, Tag.padVein, Tag.petal, Tag.petalInner, Tag.stamen]

describe("RIFT palette", () => {
  for (const [name, palette] of [["dark", dark], ["light", light]] as const) {
    test(`${name}: only neutral greys and the azure accent, nothing else`, () => {
      const accent = hsv(AZURE).hue
      for (const tag of colourful) {
        const { hue, chroma } = hsv(palette.tags[tag]!)
        // Greys have almost no chroma; anything with colour is the accent's hue.
        if (chroma > 12) expect(hueGap(hue, accent)).toBeLessThan(25)
      }
      for (const colour of [palette.ripple, palette.trough, palette.shadow, palette.koiShadow]) {
        const { hue, chroma } = hsv(colour)
        if (chroma > 12) expect(hueGap(hue, accent)).toBeLessThan(25)
      }
    })

    test(`${name}: every koi colour can be seen against the canvas`, () => {
      for (const tag of [Tag.ink, Tag.red, Tag.orange, Tag.gold]) {
        expect(Math.abs(lum(palette.tags[tag]!) - lum(palette.bg))).toBeGreaterThan(0.12)
      }
    })

    test(`${name}: the patches on a koi can be told from its body`, () => {
      const koi = [Tag.ink, Tag.red, Tag.orange, Tag.gold]
      for (const a of koi) for (const b of koi) if (a < b) expect(dist2(palette.tags[a]!, palette.tags[b]!)).toBeGreaterThan(2500)
    })

    test(`${name}: pads show against the canvas but stay quieter than the koi`, () => {
      const pad = palette.tags[Tag.pad]!
      expect(dist2(pad, palette.bg)).toBeGreaterThan(300)
      const padContrast = Math.abs(lum(pad) - lum(palette.bg))
      const koiContrast = Math.abs(lum(palette.tags[Tag.ink]!) - lum(palette.bg))
      expect(padContrast).toBeLessThan(koiContrast)
      expect(dist2(palette.tags[Tag.padRim]!, pad)).toBeGreaterThan(20)
      expect(dist2(palette.tags[Tag.padVein]!, pad)).toBeGreaterThan(20)
    })

    test(`${name}: the eye is dark on a light head and pale on a dark one`, () => {
      expect(lum(palette.tags[Tag.eye]!)).toBeLessThan(lum(palette.tags[Tag.eyePale]!))
    })
  }

  test("it knows a dark theme from a light one", () => {
    expect(dark.dark).toBe(true)
    expect(light.dark).toBe(false)
  })

  test("the koi's own shadow is black and the water's shadow is the canvas darkened", () => {
    expect(dark.koiShadow).toEqual({ r: 0, g: 0, b: 0 })
    expect(dark.shadow).toEqual(mix(dark.bg, { r: 0, g: 0, b: 0 }, 0.45))
  })

  test("ripples lighten the water on a dark canvas and darken it on a light one", () => {
    expect(lum(dark.ripple)).toBeGreaterThan(lum(dark.bg))
    expect(lum(light.ripple)).toBeLessThan(lum(light.bg))
  })

  test("every tag has a colour", () => {
    expect(dark.tags.length).toBe(Tag.count)
    for (const colour of dark.tags) expect(Number.isFinite(colour.r + colour.g + colour.b)).toBe(true)
  })
})

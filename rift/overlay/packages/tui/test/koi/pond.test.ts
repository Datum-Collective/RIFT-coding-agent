import { describe, expect, test } from "bun:test"
import { Pond, createPond } from "../../src/koi/pond"
import { Tag, riftPalette } from "../../src/koi/palette"
import { JOINTS, PATTERNS, SEG, newKoi } from "../../src/koi/koi"
import { lum } from "../../src/koi/colour"

export const palette = riftPalette({
  background: { r: 0, g: 0, b: 0 },
  text: { r: 238, g: 238, b: 238 },
  muted: { r: 128, g: 128, b: 138 },
  primary: { r: 47, g: 129, b: 247 },
})

export const make = (options: Partial<Parameters<typeof createPond>[0]> = {}) =>
  createPond({ cols: 120, rows: 36, aspect: 2, palette, seed: 1, ...options })

const count = (pond: Pond, tag: number) => pond.tag.reduce((n, t) => n + (t === tag ? 1 : 0), 0)
const pixelAt = (pond: Pond, x: number, y: number) => pond.tag[Math.floor(y / pond.aspect) * pond.pw + Math.floor(x)]!

/** Puts a koi in the water laid out straight along +x with its head at (x, y), big enough to show its eyes. */
function place(pond: Pond, index: number, x: number, y: number) {
  pond.size = 2.2
  while (pond.koi.length <= index) pond.koi.push(newKoi(pond, PATTERNS[pond.koi.length % PATTERNS.length]!))
  const koi = pond.koi[index]!
  koi.heading = 0
  koi.stroke = 0
  koi.phase = 0
  for (let n = 0; n < JOINTS; n++) koi.j[n] = { x: x - SEG * pond.size * n, y }
  return koi
}

describe("a new pond", () => {
  test("is a grid of two by two pixels a cell, each pixel `aspect` units tall", () => {
    const pond = make()
    expect(pond.pw).toBe(240)
    expect(pond.ph).toBe(72)
    expect(pond.w).toBe(240)
    expect(pond.h).toBe(144)
    expect(pond).toBeInstanceOf(Pond)
  })
})

describe("stepping the pond", () => {
  test("a ring spreads outwards, and is gone once its life is over", () => {
    const pond = make()
    pond.addRing(100, 60, 2, 10, 1, 3, 2)
    expect(pond.rings.length).toBe(1)
    for (let i = 0; i < 30; i++) pond.step(1 / 30)
    expect(pond.rings[0]!.r).toBeCloseTo(12, 0)
    for (let i = 0; i < 30 * 3; i++) pond.step(1 / 30)
    expect(pond.rings).toEqual([])
  })

  test("a ring with a delay waits, then starts", () => {
    const pond = make()
    pond.addRing(100, 60, 2, 10, 1, 5, 2)
    pond.rings[0]!.age = -1
    for (let i = 0; i < 15; i++) pond.step(1 / 30)
    expect(pond.rings[0]!.r).toBe(2)
    for (let i = 0; i < 30; i++) pond.step(1 / 30)
    expect(pond.rings[0]!.r).toBeGreaterThan(2)
  })
})

describe("drawing the pond", () => {
  test("a koi is drawn in its body colour, its patches, and eyes on the head", () => {
    const pond = make()
    const koi = place(pond, 0, 150, 70)
    koi.pat = PATTERNS[0]!
    pond.draw()
    expect(count(pond, Tag.ink)).toBeGreaterThan(30)
    expect(count(pond, Tag.red)).toBeGreaterThan(5)
    expect(count(pond, Tag.eye) + count(pond, Tag.eyePale)).toBeGreaterThan(0)
  })

  test("the eye is dark on a light head and pale on a dark one", () => {
    const pond = make()
    const koi = place(pond, 0, 150, 70)
    koi.pat = { body: Tag.ink, back: koi.pat.back.map(() => Tag.water) }
    pond.draw()
    expect(lum(pond.pal.tags[Tag.ink]!)).toBeGreaterThanOrEqual(0.35)
    expect(count(pond, Tag.eye)).toBeGreaterThan(0)
    expect(count(pond, Tag.eyePale)).toBe(0)

    const dim = make({ palette: { ...palette, tags: palette.tags.map((c, tag) => (tag === Tag.ink ? { r: 20, g: 20, b: 24 } : c)) } })
    const koi2 = place(dim, 0, 150, 70)
    koi2.pat = { body: Tag.ink, back: koi2.pat.back.map(() => Tag.water) }
    dim.draw()
    expect(count(dim, Tag.eyePale)).toBeGreaterThan(0)
  })

  test("of two koi on the same spot the shallower one is on top", () => {
    const pond = make()
    const deep = place(pond, 0, 150, 70)
    const shallow = place(pond, 1, 150, 70)
    deep.depth = 0.8
    shallow.depth = 0.2
    deep.pat = { body: Tag.gold, back: deep.pat.back.map(() => Tag.water) }
    shallow.pat = { body: Tag.red, back: shallow.pat.back.map(() => Tag.water) }
    pond.draw()
    const middle = pixelAt(pond, 150 - 6 * pond.size, 70)
    expect(middle).toBe(Tag.red)
  })

  test("nothing is left over from the last frame: a moved koi leaves no trail", () => {
    const pond = make()
    const koi = place(pond, 0, 100, 70)
    pond.draw()
    const first = Int8Array.from(pond.tag)
    place(pond, 0, 180, 70)
    pond.draw()
    expect(pixelAt(pond, 100 - 4, 70)).toBe(Tag.water)
    expect(pond.tag).not.toEqual(first)
    place(pond, 0, 100, 70)
    pond.draw()
    expect(Array.from(pond.tag)).toEqual(Array.from(first))
    void koi
  })

  test("a koi half off the edge is drawn as far as it goes without trouble", () => {
    const pond = make()
    place(pond, 0, 8, 70)
    expect(() => pond.draw()).not.toThrow()
    expect(count(pond, pond.koi[0]!.pat.body)).toBeGreaterThan(0)
  })
})

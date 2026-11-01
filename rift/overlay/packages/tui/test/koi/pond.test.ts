import { describe, expect, test } from "bun:test"
import { KOI_LENGTH, Pond, createPond } from "../../src/koi/pond"
import { Tag, riftPalette } from "../../src/koi/palette"
import { JOINTS, PATTERNS, SEG } from "../../src/koi/koi"
import { lum } from "../../src/koi/colour"

export const palette = riftPalette({
  background: { r: 0, g: 0, b: 0 },
  text: { r: 238, g: 238, b: 238 },
  muted: { r: 128, g: 128, b: 138 },
  primary: { r: 47, g: 129, b: 247 },
})

export const make = (options: Partial<Parameters<typeof createPond>[0]> = {}) =>
  createPond({ cols: 120, rows: 36, aspect: 2, palette, seed: 1, scene: "pond", ...options })

describe("a new pond", () => {
  test("is a grid of two by two pixels a cell, each pixel `aspect` units tall", () => {
    const pond = make()
    expect(pond.pw).toBe(240)
    expect(pond.ph).toBe(72)
    expect(pond.w).toBe(240)
    expect(pond.h).toBe(144)
    expect(pond).toBeInstanceOf(Pond)
  })

  test("holds three to five koi, each at its own depth, spread from just under the surface to near the bottom", () => {
    const pond = make()
    expect(pond.koi.length).toBeGreaterThanOrEqual(3)
    expect(pond.koi.length).toBeLessThanOrEqual(5)
    const depths = pond.koi.map((koi) => koi.depth)
    expect(new Set(depths).size).toBe(depths.length)
    expect(Math.min(...depths)).toBeGreaterThanOrEqual(0.1 - 1e-9)
    expect(Math.max(...depths)).toBeLessThanOrEqual(0.9 + 1e-9)
  })

  test("koi are sized to the pond, about a quarter of the short side long, never smaller than a pixel a unit", () => {
    const big = make()
    expect(18 * big.size).toBeCloseTo(KOI_LENGTH * Math.min(big.w, big.h), 0)
    const tiny = make({ cols: 40, rows: 12 })
    expect(tiny.size).toBeGreaterThanOrEqual(0.9)
  })

  test("has clusters of lily pads that do not overlap, mostly towards the edges", () => {
    const pond = make()
    expect(pond.pads.length).toBeGreaterThanOrEqual(6)
    expect(pond.pads.length).toBeLessThanOrEqual(15)
    for (const a of pond.pads) {
      expect(a.r).toBeGreaterThan(0)
      for (const b of pond.pads) {
        if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(0.82 * (a.r + b.r) - 1e-6)
      }
    }
    const middle = pond.pads.filter((pad) => Math.abs(pad.x / pond.w - 0.5) < 0.12 && Math.abs(pad.y / pond.h - 0.5) < 0.12)
    expect(middle).toEqual([])
  })

  test("a few petals float on the surface", () => {
    expect(make().petals.length).toBe(3)
  })

  test("it has already settled: every koi is in the water and its body is laid out, not in a heap", () => {
    const pond = make()
    for (const koi of pond.koi) {
      expect(koi.j[0]!.x).toBeGreaterThan(0)
      expect(koi.j[0]!.x).toBeLessThan(pond.w)
      expect(koi.j[0]!.y).toBeGreaterThan(0)
      expect(koi.j[0]!.y).toBeLessThan(pond.h)
      const tail = koi.j[koi.j.length - 1]!
      expect(Math.hypot(koi.j[0]!.x - tail.x, koi.j[0]!.y - tail.y)).toBeGreaterThan(8 * pond.size)
    }
  })

  test("the same seed makes the same pond, a different seed a different one", () => {
    const heads = (pond: Pond) => pond.koi.map((koi) => koi.j[0])
    expect(heads(make({ seed: 4 }))).toEqual(heads(make({ seed: 4 })))
    expect(heads(make({ seed: 4 }))).not.toEqual(heads(make({ seed: 5 })))
    expect(make({ seed: 4 }).pads.map((pad) => pad.x)).toEqual(make({ seed: 4 }).pads.map((pad) => pad.x))
  })
})

describe("stepping the pond", () => {
  test("time moves on and the koi move with it", () => {
    const pond = make()
    const before = pond.koi.map((koi) => ({ ...koi.j[0]! }))
    const t = pond.t
    for (let i = 0; i < 60; i++) pond.step(1 / 30)
    expect(pond.t).toBeCloseTo(t + 2, 6)
    expect(pond.koi.some((koi, i) => Math.hypot(koi.j[0]!.x - before[i]!.x, koi.j[0]!.y - before[i]!.y) > 1)).toBe(true)
  })

  test("a koi that has not started to swim, because its ease is zero, stays where it is", () => {
    const pond = make()
    const koi = pond.koi[0]!
    koi.ease = 0
    const head = { ...koi.j[0]! }
    for (let i = 0; i < 60; i++) pond.step(1 / 30)
    expect(koi.j[0]).toEqual(head)
  })

  test("petals drift across the surface and come back round the other side, never wandering off", () => {
    const pond = make()
    const margin = 4 * pond.petals[0]!.r
    let moved = false
    const start = pond.petals.map((petal) => ({ x: petal.x, y: petal.y }))
    for (let i = 0; i < 30 * 600; i++) {
      pond.step(1 / 30)
      for (const petal of pond.petals) {
        expect(petal.x).toBeGreaterThanOrEqual(-margin - 1)
        expect(petal.x).toBeLessThanOrEqual(pond.w + margin + 1)
        expect(petal.y).toBeGreaterThanOrEqual(-margin - 1)
        expect(petal.y).toBeLessThanOrEqual(pond.h + margin + 1)
      }
      if (i === 30 * 60) moved = pond.petals.some((petal, index) => Math.hypot(petal.x - start[index]!.x, petal.y - start[index]!.y) > 2)
    }
    expect(moved).toBe(true)
  })

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


const count = (pond: Pond, tag: number) => pond.tag.reduce((n, t) => n + (t === tag ? 1 : 0), 0)
const pixelAt = (pond: Pond, x: number, y: number) => pond.tag[Math.floor(y / pond.aspect) * pond.pw + Math.floor(x)]!

/** Lays a koi out straight along +x with its head at (x, y). */
function place(pond: Pond, index: number, x: number, y: number) {
  const koi = pond.koi[index]!
  koi.heading = 0
  koi.stroke = 0
  koi.phase = 0
  for (let n = 0; n < JOINTS; n++) koi.j[n] = { x: x - SEG * pond.size * n, y }
  return koi
}

/** Parks every koi far away so a test can look at one thing on its own. */
function clearWater(pond: Pond) {
  pond.koi.forEach((koi, index) => {
    koi.ease = 0
    place(pond, index, 2000 + index * 100, 2000)
  })
  pond.petals.length = 0
}

describe("drawing the pond", () => {
  test("it is mostly open water, with koi, pads and petals on it", () => {
    const pond = make()
    pond.draw()
    expect(count(pond, Tag.water) / pond.tag.length).toBeGreaterThan(0.6)
    expect(count(pond, Tag.pad)).toBeGreaterThan(100)
    for (const koi of pond.koi) expect(count(pond, koi.pat.body)).toBeGreaterThan(0)
  })

  test("a pad is round, about the area of its circle, with a thin edge and paler veins", () => {
    const pond = make()
    clearWater(pond)
    const pad = pond.pads.reduce((a, b) => (b.r > a.r ? b : a))
    pond.pads = [pad]
    pad.flower = 0
    pond.draw()
    const pixels = pond.tag.reduce((n, t) => n + (t === Tag.pad || t === Tag.padRim || t === Tag.padVein ? 1 : 0), 0)
    const area = (Math.PI * pad.r * pad.r) / pond.aspect
    expect(pixels).toBeGreaterThan(area * 0.8)
    expect(pixels).toBeLessThan(area * 1.1)
    expect(count(pond, Tag.padRim)).toBeGreaterThan(5)
    expect(count(pond, Tag.padVein)).toBeGreaterThan(5)
  })

  test("a pad has its notch cut out, so the water shows through where it opens", () => {
    const pond = make()
    clearWater(pond)
    const pad = pond.pads[0]!
    pond.pads = [pad]
    pond.draw()
    const inNotch = pixelAt(pond, pad.x + Math.cos(pad.rot) * pad.r * 0.7, pad.y + Math.sin(pad.rot) * pad.r * 0.7)
    const opposite = pixelAt(pond, pad.x - Math.cos(pad.rot) * pad.r * 0.7, pad.y - Math.sin(pad.rot) * pad.r * 0.7)
    expect(inNotch).toBe(Tag.water)
    expect(opposite).not.toBe(Tag.water)
  })

  test("a lily on a pad is drawn in pale petals with a heart", () => {
    const pond = make()
    clearWater(pond)
    const pad = pond.pads[0]!
    pond.pads = [pad]
    pad.flower = pad.r * 0.52
    pond.draw()
    expect(count(pond, Tag.petal)).toBeGreaterThan(5)
    expect(count(pond, Tag.petalInner)).toBeGreaterThan(2)
    expect(count(pond, Tag.stamen)).toBeGreaterThan(0)
  })

  test("a loose petal floats on the surface", () => {
    const pond = make()
    clearWater(pond)
    pond.pads = []
    pond.petals.push({ x: 120, y: 70, vx: 0, vy: 0, rot: 0.3, spin: 0, r: 3 })
    pond.draw()
    expect(count(pond, Tag.petal)).toBeGreaterThan(5)
  })

  test("a koi is drawn in its body colour, its patches, and eyes on the head", () => {
    const pond = make()
    clearWater(pond)
    pond.pads = []
    const koi = place(pond, 0, 150, 70)
    koi.pat = PATTERNS[0]!
    pond.draw()
    expect(count(pond, Tag.ink)).toBeGreaterThan(30)
    expect(count(pond, Tag.red)).toBeGreaterThan(5)
    expect(count(pond, Tag.eye) + count(pond, Tag.eyePale)).toBeGreaterThan(0)
  })

  test("the eye is dark on a light head and pale on a dark one", () => {
    const pond = make()
    clearWater(pond)
    pond.pads = []
    const koi = place(pond, 0, 150, 70)
    koi.pat = { body: Tag.ink, back: koi.pat.back.map(() => Tag.water) }
    pond.draw()
    expect(lum(pond.pal.tags[Tag.ink]!)).toBeGreaterThanOrEqual(0.35)
    expect(count(pond, Tag.eye)).toBeGreaterThan(0)
    expect(count(pond, Tag.eyePale)).toBe(0)

    const dim = make({ palette: { ...palette, tags: palette.tags.map((c, tag) => (tag === Tag.ink ? { r: 20, g: 20, b: 24 } : c)) } })
    clearWater(dim)
    dim.pads = []
    const koi2 = place(dim, 0, 150, 70)
    koi2.pat = { body: Tag.ink, back: koi2.pat.back.map(() => Tag.water) }
    dim.draw()
    expect(count(dim, Tag.eyePale)).toBeGreaterThan(0)
  })

  test("of two koi on the same spot the shallower one is on top", () => {
    const pond = make()
    clearWater(pond)
    pond.pads = []
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

  test("a pad passes over a koi that swims beneath it", () => {
    const pond = make()
    clearWater(pond)
    const pad = pond.pads[0]!
    pond.pads = [pad]
    const koi = place(pond, 0, pad.x, pad.y)
    koi.pat = { body: Tag.red, back: koi.pat.back.map(() => Tag.water) }
    pond.draw()
    const under = pixelAt(pond, pad.x - Math.cos(pad.rot) * pad.r * 0.5, pad.y - Math.sin(pad.rot) * pad.r * 0.5)
    expect(new Set<number>([Tag.pad, Tag.padRim, Tag.padVein]).has(under)).toBe(true)
  })

  test("nothing is left over from the last frame: a moved koi leaves no trail", () => {
    const pond = make()
    clearWater(pond)
    pond.pads = []
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
    clearWater(pond)
    pond.pads = []
    place(pond, 0, 8, 70)
    expect(() => pond.draw()).not.toThrow()
    expect(count(pond, pond.koi[0]!.pat.body)).toBeGreaterThan(0)
  })
})

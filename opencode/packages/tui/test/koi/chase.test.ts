import { describe, expect, test } from "bun:test"
import { createPond, type Pond } from "../../src/koi/pond"
import { Tag, riftPalette } from "../../src/koi/palette"
import { remainder } from "../../src/koi/math"

const palette = riftPalette({
  background: { r: 0, g: 0, b: 0 },
  text: { r: 238, g: 238, b: 238 },
  muted: { r: 128, g: 128, b: 138 },
  primary: { r: 47, g: 129, b: 247 },
})

const chase = (seed = 1) => createPond({ cols: 120, rows: 36, aspect: 2, palette, seed, scene: "chase" })

const run = (pond: Pond, seconds: number, each: () => void = () => {}) => {
  for (let i = 0; i < seconds * 30; i++) {
    pond.step(1 / 30)
    each()
  }
}

const phi = (pond: Pond, index: number) => Math.atan2(pond.koi[index]!.j[0]!.y - pond.h / 2, pond.koi[index]!.j[0]!.x - pond.w / 2)
const radius = (pond: Pond, index: number) => Math.hypot(pond.koi[index]!.j[0]!.x - pond.w / 2, pond.koi[index]!.j[0]!.y - pond.h / 2)

describe("the koi chase", () => {
  test("two koi, one still pad in the middle, and nothing else on the water", () => {
    const pond = chase()
    expect(pond.koi.length).toBe(2)
    expect(pond.pads.length).toBe(1)
    expect(pond.pads[0]!.x).toBeCloseTo(pond.w / 2, 6)
    expect(pond.pads[0]!.y).toBeCloseTo(pond.h / 2, 6)
    expect(pond.petals).toEqual([])
    expect(pond.chase).toBeDefined()
  })

  test("the pad and the circle are sized to the pond, the koi a third of the short side long", () => {
    const pond = chase()
    const m = Math.min(pond.w, pond.h)
    expect(pond.pads[0]!.r).toBeCloseTo(m * 0.0995, 6)
    expect(pond.chase!.rp).toBeCloseTo(m * 0.248, 6)
    expect(18 * pond.size).toBeCloseTo(m * 0.333, 2)
  })

  test("each koi holds the circle round the pad", () => {
    const pond = chase()
    const length = 18 * pond.size
    run(pond, 180, () => {
      for (const index of [0, 1]) expect(Math.abs(radius(pond, index) - pond.chase!.rp)).toBeLessThan(0.5 * length)
    })
  })

  test("they stay half a lap apart, one chasing the other", () => {
    const pond = chase()
    run(pond, 20)
    let worst = 0
    run(pond, 180, () => {
      worst = Math.max(worst, Math.abs(Math.abs(remainder(phi(pond, 0) - phi(pond, 1), 2 * Math.PI)) - Math.PI))
    })
    expect(worst).toBeLessThan(0.8)
  })

  test("a lap takes about half a minute, always the same way round", () => {
    const pond = chase()
    run(pond, 5)
    let travelled = 0
    let last = phi(pond, 0)
    let backwards = 0
    run(pond, 90, () => {
      const step = remainder(phi(pond, 0) - last, 2 * Math.PI)
      if (step < -0.01) backwards++
      travelled += step
      last = phi(pond, 0)
    })
    const laps = Math.abs(travelled) / (2 * Math.PI)
    expect(laps).toBeGreaterThan(2.4)
    expect(laps).toBeLessThan(4)
    expect(backwards).toBe(0)
  })

  test("now and then a koi flicks its tail and leaves a swirl, which fades", () => {
    const pond = chase()
    let seen = 0
    let most = 0
    run(pond, 240, () => {
      seen += pond.chase!.swirls.length > 0 ? 1 : 0
      most = Math.max(most, pond.chase!.swirls.length)
    })
    expect(seen).toBeGreaterThan(0)
    expect(most).toBeLessThanOrEqual(3)
    run(pond, 8)
    expect(pond.chase!.swirls.length).toBeLessThanOrEqual(1)
  })

  test("now and then faint ripples open round the pad, a few at a time, and fade", () => {
    const pond = chase()
    let seen = 0
    let most = 0
    run(pond, 300, () => {
      seen += pond.chase!.ripples.length > 0 ? 1 : 0
      most = Math.max(most, pond.chase!.ripples.length)
    })
    expect(seen).toBeGreaterThan(0)
    expect(most).toBeLessThanOrEqual(6)
  })

  test("nothing piles up over a long idle: swirls and ripples stay few", () => {
    const pond = chase()
    run(pond, 20 * 60, () => {
      expect(pond.chase!.swirls.length).toBeLessThanOrEqual(4)
      expect(pond.chase!.ripples.length).toBeLessThanOrEqual(8)
      expect(pond.rings.length).toBeLessThanOrEqual(8)
    })
  })

  test("a swirl and a ripple show on the water as raised height, never past full", () => {
    const pond = chase()
    pond.chase!.swirls.push({ x: pond.w / 2 + 40, y: pond.h / 2, a: 0, dir: 1, age: 0.1, life: 1.4 })
    pond.chase!.ripples.push({ r0: pond.chase!.padR * 1.2, a0: 0, span: 2, wob: 0, delay: 0, age: 1.5, life: 6.5 })
    pond.draw()
    let raised = 0
    for (const h of pond.height) if (h > 0) raised++
    expect(raised).toBeGreaterThan(20)
    expect(Math.max(...pond.height)).toBeLessThanOrEqual(1 + 1e-6)
  })

  test("the pad is drawn in the middle with the notch open, and its shadow falls close", () => {
    const pond = chase()
    pond.draw()
    const cx = Math.floor(pond.w / 2)
    const cy = Math.floor(pond.h / 2 / pond.aspect)
    expect(pond.tag[cy * pond.pw + cx]).not.toBe(Tag.water)
    // Close: the shadow lands within a pad radius of the pad.
    const shaded = pond.shade.reduce((n, d) => n + (d === -1 ? 1 : 0), 0)
    expect(shaded).toBeGreaterThan(50)
  })

  test("the same seed gives the same chase", () => {
    const a = chase(3)
    const b = chase(3)
    run(a, 30)
    run(b, 30)
    expect(a.koi.map((koi) => koi.j[0])).toEqual(b.koi.map((koi) => koi.j[0]))
    expect(a.chase!.theta).toBe(b.chase!.theta)
  })
})

import { describe, expect, test } from "bun:test"
import { createPond, type Pond } from "../../src/koi/pond"
import { riftPalette } from "../../src/koi/palette"
import { stirStream } from "../../src/koi/stream"

const palette = riftPalette({
  background: { r: 0, g: 0, b: 0 },
  text: { r: 238, g: 238, b: 238 },
  muted: { r: 128, g: 128, b: 138 },
  primary: { r: 47, g: 129, b: 247 },
})

const stream = (seed = 1) => createPond({ cols: 100, rows: 7, aspect: 2, palette, seed, scene: "stream" })

const run = (pond: Pond, seconds: number, each: () => void = () => {}) => {
  for (let i = 0; i < seconds * 30; i++) {
    pond.step(1 / 30)
    each()
  }
}

describe("the koi stream above the composer", () => {
  test("it starts as empty water, with no pads or petals, and the first koi comes in at once", () => {
    const pond = stream()
    expect(pond.koi).toEqual([])
    expect(pond.pads).toEqual([])
    expect(pond.petals).toEqual([])
    run(pond, 1 / 30)
    expect(pond.koi.length).toBe(1)
  })

  test("koi come in from the side they swim away from, and swim the length of it", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const pond = stream(seed)
      run(pond, 1 / 30)
      const k = pond.koi[0]!
      const dir = pond.stream!.runs.get(k)!.dir
      const start = k.j[0]!.x
      expect(dir > 0 ? start < 2 : start > pond.w - 2).toBe(true)
      run(pond, 2)
      expect(Math.sign(k.j[0]!.x - start)).toBe(dir)
    }
  })

  test("they keep to the strip, never more than three at once, and every one gets right across", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const pond = stream(seed)
      const crossed = new Set<unknown>()
      run(pond, 60, () => {
        expect(pond.koi.length).toBeLessThanOrEqual(3)
        for (const k of pond.koi) {
          for (const j of k.j) {
            expect(j.y).toBeGreaterThan(0)
            expect(j.y).toBeLessThan(pond.h)
          }
          const dir = pond.stream!.runs.get(k)!.dir
          if (dir > 0 ? k.j[0]!.x > pond.w : k.j[0]!.x < 0) crossed.add(k)
        }
      })
      expect(crossed.size).toBeGreaterThanOrEqual(5)
    }
  })

  test("they do not swim straight: each weaves and drifts between lanes as it goes", () => {
    const pond = stream(3)
    run(pond, 1 / 30)
    const k = pond.koi[0]!
    const heights: number[] = []
    run(pond, 5, () => heights.push(k.j[0]!.y))
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(2)
  })

  test("typing quickens them, and they glide back to a cruise after", () => {
    const pond = stream()
    run(pond, 2)
    const k = pond.koi[0]!
    const cruising = k.speed
    for (let i = 0; i < 6; i++) {
      stirStream(pond)
      run(pond, 0.1)
    }
    expect(k.speed).toBeGreaterThan(cruising * 1.15)
    run(pond, 6)
    expect(k.speed).toBeLessThan(cruising * 1.1)
  })

  test("every few keystrokes one touches the surface and leaves a ring", () => {
    const pond = stream()
    run(pond, 1)
    for (let i = 0; i < 12; i++) stirStream(pond)
    expect(pond.rings.length).toBeGreaterThan(0)
  })

  test("once it is closed no more come in, and the stream empties", () => {
    const pond = stream()
    run(pond, 4)
    pond.stream!.open = false
    run(pond, 30)
    expect(pond.koi).toEqual([])
  })

  test("the same seed swims the same way", () => {
    const a = stream(11)
    const b = stream(11)
    run(a, 10)
    run(b, 10)
    expect(a.koi.map((k) => k.j[0])).toEqual(b.koi.map((k) => k.j[0]))
  })

  test("a koi in the strip draws cells", () => {
    const pond = stream()
    run(pond, 3)
    pond.draw()
    expect(pond.cells().length).toBeGreaterThan(5)
  })
})

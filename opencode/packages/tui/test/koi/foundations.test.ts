import { describe, expect, test } from "bun:test"
import { random } from "../../src/koi/random"
import { clamp, dist2, lum, mix, to8 } from "../../src/koi/colour"

describe("random", () => {
  test("the same seed gives the same numbers, a different seed gives different ones", () => {
    const a = random(7)
    const b = random(7)
    const c = random(8)
    const first = Array.from({ length: 20 }, () => a.float())
    expect(Array.from({ length: 20 }, () => b.float())).toEqual(first)
    expect(Array.from({ length: 20 }, () => c.float())).not.toEqual(first)
  })

  test("floats are in [0, 1) and spread evenly", () => {
    const next = random(1)
    const values = Array.from({ length: 10_000 }, () => next.float())
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...values)).toBeLessThan(1)
    expect(values.reduce((sum, value) => sum + value, 0) / values.length).toBeCloseTo(0.5, 1)
  })

  test("ints are whole numbers below the limit and reach every value", () => {
    const next = random(3)
    const seen = new Set(Array.from({ length: 500 }, () => next.int(5)))
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4])
  })

  test("a permutation holds every number once", () => {
    const order = random(9).perm(8)
    expect([...order].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })
})

describe("colour", () => {
  const black = { r: 0, g: 0, b: 0 }
  const white = { r: 255, g: 255, b: 255 }

  test("mix runs from one colour to the other", () => {
    expect(mix(black, white, 0)).toEqual(black)
    expect(mix(black, white, 1)).toEqual(white)
    expect(mix(black, white, 0.5)).toEqual({ r: 127.5, g: 127.5, b: 127.5 })
  })

  test("luminance is 0 for black and 1 for white, and green weighs most", () => {
    expect(lum(black)).toBe(0)
    expect(lum(white)).toBeCloseTo(1, 6)
    expect(lum({ r: 0, g: 255, b: 0 })).toBeGreaterThan(lum({ r: 255, g: 0, b: 0 }))
    expect(lum({ r: 255, g: 0, b: 0 })).toBeGreaterThan(lum({ r: 0, g: 0, b: 255 }))
  })

  test("to8 rounds and keeps every channel within 0 to 255", () => {
    expect(to8({ r: 12.4, g: 12.6, b: -5 })).toEqual([12, 13, 0])
    expect(to8({ r: 300, g: 255.4, b: 0 })).toEqual([255, 255, 0])
  })

  test("distance is squared Euclidean and clamp pins a value", () => {
    expect(dist2(black, { r: 3, g: 4, b: 0 })).toBe(25)
    expect(clamp(5, 0, 1)).toBe(1)
    expect(clamp(-5, 0, 1)).toBe(0)
    expect(clamp(0.4, 0, 1)).toBe(0.4)
  })
})

import { describe, expect, test } from "bun:test"
import { JOINTS, PATTERNS, RADII, SEG, newKoi, type Habitat, type Koi } from "../../src/koi/koi"
import { shapeKoi, smin, type Grid } from "../../src/koi/shape"
import { random } from "../../src/koi/random"

const grid: Grid = { pw: 240, ph: 72, aspect: 2, size: 1.7 }

function straightKoi(pattern = PATTERNS[0]!, at = { x: 150, y: 70 }): Koi {
  const home: Habitat = { w: grid.pw, h: grid.ph * grid.aspect, size: grid.size, rng: random(3), koi: [] }
  const koi = newKoi(home, pattern)
  koi.heading = 0
  koi.phase = 0
  koi.stroke = 0
  for (let n = 0; n < JOINTS; n++) koi.j[n] = { x: at.x - SEG * grid.size * n, y: at.y }
  return koi
}

const inside = (values: Float32Array, count: number) => {
  let n = 0
  for (let i = 0; i < count; i++) if (values[i]! < 0) n++
  return n
}

describe("smin", () => {
  test("joins two distances with a soft fillet: never beyond the nearer, and exact once they are far apart", () => {
    expect(smin(1, 5, 2)).toBeLessThanOrEqual(1)
    expect(smin(0, 0, 2)).toBeLessThan(0)
    expect(smin(-3, 5, 2)).toBe(-3)
    expect(smin(5, -3, 2)).toBe(-3)
  })

  test("it is symmetric", () => {
    expect(smin(0.4, 1.1, 1.5)).toBeCloseTo(smin(1.1, 0.4, 1.5), 6)
  })
})

describe("a koi's shape", () => {
  test("covers about the area of its tapering body, with the fins and tail on top", () => {
    const koi = straightKoi()
    const shape = shapeKoi(grid, koi)
    const count = inside(shape.sil, shape.w * shape.h)
    // Body area in world units: the trapezoid of each stretch of spine, plus the rounded nose.
    let body = (Math.PI * (RADII[0]! * grid.size) ** 2) / 2
    for (let n = 0; n < JOINTS - 1; n++) body += (RADII[n]! + RADII[n + 1]!) * SEG * grid.size * grid.size
    // A pixel is one unit wide and `aspect` tall.
    const pixels = body / grid.aspect
    expect(count).toBeGreaterThan(pixels * 0.9)
    expect(count).toBeLessThan(pixels * 2.2)
  })

  test("the head is inside the shape and the pixel past the nose is not", () => {
    const koi = straightKoi()
    const shape = shapeKoi(grid, koi)
    const at = (x: number, y: number) => shape.sil[(Math.floor(y / grid.aspect) - shape.y0) * shape.w + (Math.floor(x) - shape.x0)]!
    expect(at(koi.j[0]!.x, koi.j[0]!.y)).toBeLessThan(0)
    expect(at(koi.j[0]!.x + 8 * grid.size, koi.j[0]!.y)).toBeGreaterThan(0)
  })

  test("the box it asks to draw is on the grid and has room for the whole koi", () => {
    const shape = shapeKoi(grid, straightKoi())
    expect(shape.x0).toBeGreaterThanOrEqual(0)
    expect(shape.y0).toBeGreaterThanOrEqual(0)
    expect(shape.x0 + shape.w).toBeLessThanOrEqual(grid.pw)
    expect(shape.y0 + shape.h).toBeLessThanOrEqual(grid.ph)
    // Pixels on the very edge of the box are water: nothing is cut off.
    for (let x = 0; x < shape.w; x++) {
      expect(shape.sil[x]!).toBeGreaterThan(0)
      expect(shape.sil[(shape.h - 1) * shape.w + x]!).toBeGreaterThan(0)
    }
  })

  test("a koi half off the grid is clipped, not broken, and one wholly off draws nothing", () => {
    const edge = shapeKoi(grid, straightKoi(PATTERNS[0]!, { x: 10, y: 70 }))
    expect(edge.x0).toBe(0)
    expect(edge.w).toBeGreaterThan(0)
    expect(inside(edge.sil, edge.w * edge.h)).toBeGreaterThan(0)

    const gone = shapeKoi(grid, straightKoi(PATTERNS[0]!, { x: -400, y: 70 }))
    expect(gone.w * gone.h).toBe(0)
  })

  test("it sways as it swims, and not at all when it holds still", () => {
    const a = straightKoi()
    a.stroke = 1
    a.phase = 0.5
    const b = straightKoi()
    b.stroke = 1
    b.phase = 2.5
    const first = shapeKoi(grid, a)
    const firstCopy = Float32Array.from(first.sil.subarray(0, first.w * first.h))
    const second = shapeKoi(grid, b)
    const differs = first.w !== second.w || firstCopy.some((value, index) => (value < 0) !== (second.sil[index]! < 0))
    expect(differs).toBe(true)

    const still1 = shapeKoi(grid, straightKoi())
    const still1Copy = Float32Array.from(still1.sil.subarray(0, still1.w * still1.h))
    const still2 = shapeKoi(grid, straightKoi())
    expect(still2.w).toBe(still1.w)
    expect(Array.from(still2.sil.subarray(0, still2.w * still2.h))).toEqual(Array.from(still1Copy))
  })

  test("drawing a koi never moves its real spine", () => {
    const koi = straightKoi()
    koi.stroke = 1
    koi.phase = 1.3
    const before = koi.j.map((joint) => ({ ...joint }))
    shapeKoi(grid, koi)
    expect(koi.j).toEqual(before)
  })

  test("eyes appear once the koi is grown, sit on the head, and are not there while it is small", () => {
    const grown = shapeKoi(grid, straightKoi())
    expect(grown.eyeR).toBeGreaterThan(0)
    const head = { x: 150, y: 70 }
    for (const eye of grown.eyes) expect(Math.hypot(eye.x - head.x, eye.y - head.y)).toBeLessThan(RADII[0]! * grid.size)

    const small = straightKoi()
    small.grow = 0.5
    expect(shapeKoi(grid, small).eyeR).toBe(0)
  })

  test("patches are drawn for a patterned koi and are absent for a plain one", () => {
    const patterned = shapeKoi(grid, straightKoi(PATTERNS[0]!))
    expect(inside(patterned.patch, patterned.w * patterned.h)).toBeGreaterThan(0)
    expect(patterned.patchTag).toBe(PATTERNS[0]!.back.find((tag) => tag !== 0)!)

    const plain = shapeKoi(grid, straightKoi(PATTERNS[2]!))
    expect(inside(plain.patch, plain.w * plain.h)).toBe(0)
  })

  test("a metallic koi has a stripe of sheen down its back and the others do not", () => {
    const metallic = shapeKoi(grid, straightKoi(PATTERNS[2]!))
    expect(metallic.hasSheen).toBe(true)
    expect(inside(metallic.sheen, metallic.w * metallic.h)).toBeGreaterThan(0)
    // The stripe sits inside the body.
    for (let i = 0; i < metallic.w * metallic.h; i++) if (metallic.sheen[i]! < 0) expect(metallic.sil[i]!).toBeLessThan(0)

    expect(shapeKoi(grid, straightKoi(PATTERNS[0]!)).hasSheen).toBe(false)
  })

  test("a koi that has not grown yet is smaller", () => {
    const whole = shapeKoi(grid, straightKoi())
    const young = straightKoi()
    young.grow = 0.6
    const smaller = shapeKoi(grid, young)
    expect(inside(smaller.sil, smaller.w * smaller.h)).toBeLessThan(inside(whole.sil, whole.w * whole.h))
  })
})

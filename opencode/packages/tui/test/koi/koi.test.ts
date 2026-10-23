import { describe, expect, test } from "bun:test"
import { JOINTS, PATTERNS, SEG, baseSpeed, newKoi, swim, type Habitat, type Koi } from "../../src/koi/koi"
import { Tag } from "../../src/koi/palette"
import { random } from "../../src/koi/random"
import { remainder } from "../../src/koi/math"

function habitat(count = 4, seed = 1, size = 1.7): Habitat {
  const home: Habitat = { w: 240, h: 140, size, rng: random(seed), koi: [] }
  for (let index = 0; index < count; index++) {
    const koi = newKoi(home, PATTERNS[index % PATTERNS.length]!)
    koi.depth = 0.1 + (0.8 * index) / Math.max(1, count - 1)
    home.koi.push(koi)
  }
  return home
}

/** Swims the pond on for `seconds` at 30 steps a second, calling `each` after every step. */
function run(home: Habitat, seconds: number, each: (step: number) => void = () => {}) {
  const dt = 1 / 30
  const steps = Math.round(seconds / dt)
  for (let step = 0; step < steps; step++) {
    for (const koi of home.koi) swim(home, koi, dt * koi.ease)
    each(step)
  }
}

const gaps = (koi: Koi) => koi.j.slice(1).map((joint, index) => Math.hypot(joint.x - koi.j[index]!.x, joint.y - koi.j[index]!.y))

describe("a new koi", () => {
  test("lies straight behind its head, a joint-spacing apart, inside the pond", () => {
    const home = habitat(1)
    const koi = home.koi[0]!
    expect(koi.j.length).toBe(JOINTS)
    for (const gap of gaps(koi)) expect(gap).toBeCloseTo(SEG * home.size, 6)
    expect(koi.j[0]!.x).toBeGreaterThan(0)
    expect(koi.j[0]!.x).toBeLessThan(home.w)
    expect(koi.j[0]!.y).toBeGreaterThan(0)
    expect(koi.j[0]!.y).toBeLessThan(home.h)
    // The tail is behind the head: the head moves along the heading, away from the tail.
    const tail = koi.j[JOINTS - 1]!
    const along = (koi.j[0]!.x - tail.x) * Math.cos(koi.heading) + (koi.j[0]!.y - tail.y) * Math.sin(koi.heading)
    expect(along).toBeGreaterThan(0)
  })

  test("there are patterns to choose from, each with a patch slot per joint", () => {
    expect(PATTERNS.length).toBeGreaterThanOrEqual(6)
    for (const pattern of PATTERNS) {
      expect(pattern.back.length).toBe(JOINTS)
      expect(pattern.body).not.toBe(Tag.water)
    }
  })

  test("a koi glides about a fifth of its length each second", () => {
    expect(baseSpeed(2)).toBeCloseTo(18 * 2 * 0.2, 9)
  })
})

describe("swimming", () => {
  test("the spine never stretches or shrinks", () => {
    const home = habitat()
    run(home, 120, () => {
      for (const koi of home.koi) for (const gap of gaps(koi)) expect(Math.abs(gap - SEG * home.size)).toBeLessThan(1e-6)
    })
  })

  test("the spine only bends so far at each joint", () => {
    const home = habitat()
    run(home, 120, () => {
      for (const koi of home.koi) {
        const angles = koi.j.slice(1).map((joint, index) => Math.atan2(joint.y - koi.j[index]!.y, joint.x - koi.j[index]!.x))
        for (let index = 1; index < angles.length; index++) {
          const bend = Math.abs(remainder(angles[index]! - angles[index - 1]!, 2 * Math.PI))
          expect(bend).toBeLessThanOrEqual(0.22 + 1e-9)
        }
      }
    })
  })

  test("a turn is never tighter than about half a body length", () => {
    const home = habitat(1)
    const koi = home.koi[0]!
    const length = 18 * home.size
    let before = koi.heading
    run(home, 180, () => {
      const turned = Math.abs(remainder(koi.heading - before, 2 * Math.PI)) * 30
      // The most it may turn per second: speed over that radius, with a little give for the stroke.
      expect(turned).toBeLessThanOrEqual((koi.speed / (0.5 * length)) * 1.35 + 1e-6)
      before = koi.heading
    })
  })

  test("koi keep to the water: the head never leaves the pond", () => {
    const home = habitat()
    run(home, 300, () => {
      for (const koi of home.koi) {
        expect(koi.j[0]!.x).toBeGreaterThan(-6)
        expect(koi.j[0]!.x).toBeLessThan(home.w + 6)
        expect(koi.j[0]!.y).toBeGreaterThan(-6)
        expect(koi.j[0]!.y).toBeLessThan(home.h + 6)
      }
    })
  })

  test("koi steer clear of one another: their heads are almost never close", () => {
    // They may cross, each at its own depth, so this is a steer and not a wall. Measured across
    // seeds, heads were within 0.3 lengths 1 to 7% of the time; the bound has room above that.
    for (const seed of [1, 2, 3, 4]) {
      const home = habitat(4, seed)
      const length = 18 * home.size
      let close = 0
      let total = 0
      run(home, 300, () => {
        let nearest = Infinity
        for (const a of home.koi) for (const b of home.koi) if (a !== b) nearest = Math.min(nearest, Math.hypot(a.j[0]!.x - b.j[0]!.x, a.j[0]!.y - b.j[0]!.y))
        total++
        if (nearest < length * 0.3) close++
      })
      expect(close / total).toBeLessThan(0.12)
    }
  })

  test("they do move, glide, and now and then put on a burst of speed", () => {
    const home = habitat(1)
    const koi = home.koi[0]!
    const speeds: number[] = []
    const start = { ...koi.j[0]! }
    run(home, 120, () => speeds.push(koi.speed))
    expect(Math.hypot(koi.j[0]!.x - start.x, koi.j[0]!.y - start.y)).toBeGreaterThan(5)
    expect(Math.min(...speeds)).toBeGreaterThan(0.4 * baseSpeed(home.size))
    expect(Math.max(...speeds)).toBeLessThan(2.5 * baseSpeed(home.size))
    expect(Math.max(...speeds)).toBeGreaterThan(Math.min(...speeds) * 1.05)
  })

  test("the same seed swims the same way, a different seed does not", () => {
    const a = habitat(3, 5)
    const b = habitat(3, 5)
    const c = habitat(3, 6)
    run(a, 30)
    run(b, 30)
    run(c, 30)
    expect(a.koi.map((koi) => koi.j[0])).toEqual(b.koi.map((koi) => koi.j[0]))
    expect(a.koi.map((koi) => koi.j[0])).not.toEqual(c.koi.map((koi) => koi.j[0]))
  })

  test("the stroke and the wave along the body keep time with the swimming", () => {
    const home = habitat(1)
    const koi = home.koi[0]!
    const phase = koi.phase
    run(home, 5)
    expect(koi.phase).toBeGreaterThan(phase)
    expect(koi.stroke).toBeGreaterThanOrEqual(0.35 - 1e-9)
    expect(koi.stroke).toBeLessThanOrEqual(1.2 + 1e-9)
  })
})

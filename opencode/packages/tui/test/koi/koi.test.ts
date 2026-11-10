import { describe, expect, test } from "bun:test"
import { JOINTS, PATTERNS, SEG, baseSpeed, newKoi, type Habitat, type Koi } from "../../src/koi/koi"
import { Tag } from "../../src/koi/palette"
import { random } from "../../src/koi/random"

const gaps = (koi: Koi) => koi.j.slice(1).map((joint, index) => Math.hypot(joint.x - koi.j[index]!.x, joint.y - koi.j[index]!.y))

describe("a new koi", () => {
  test("lies straight behind its head, a joint-spacing apart, inside the pond", () => {
    const home: Habitat = { w: 240, h: 140, size: 1.7, rng: random(1) }
    const koi = newKoi(home, PATTERNS[0]!)
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

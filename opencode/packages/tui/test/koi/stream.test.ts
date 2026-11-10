import { describe, expect, test } from "bun:test"
import { createPond, type Pond } from "../../src/koi/pond"
import { riftPalette } from "../../src/koi/palette"
import { stirStream } from "../../src/koi/stream"
import type { Koi } from "../../src/koi/koi"

const palette = riftPalette({
  background: { r: 0, g: 0, b: 0 },
  text: { r: 238, g: 238, b: 238 },
  muted: { r: 128, g: 128, b: 138 },
  primary: { r: 47, g: 129, b: 247 },
})

const stream = (seed = 1) => createPond({ cols: 100, rows: 7, aspect: 2, palette, seed })

const run = (pond: Pond, seconds: number, each: () => void = () => {}) => {
  for (let i = 0; i < seconds * 30; i++) {
    pond.step(1 / 30)
    each()
  }
}

/** Types at `rate` keys a second for `seconds`; `each` sees every frame and whether a key fell on it. */
const type = (pond: Pond, rate: number, seconds: number, each: (keyed: boolean) => void = () => {}) => {
  let next = 0
  for (let i = 0; i < seconds * 30; i++) {
    const keyed = i / 30 >= next
    if (keyed) {
      stirStream(pond)
      next += 1 / rate
    }
    pond.step(1 / 30)
    each(keyed)
  }
}

/** A koi's length in the stream, in world units. */
const length = (pond: Pond) => 18 * pond.size

/** Each koi's stroke, tail-beat phase and speed, frame by frame, while `go` runs the pond. */
const watch = (pond: Pond, go: (each: (keyed: boolean) => void) => void) => {
  const seen = new Map<Koi, { stroke: number; phase: number; speed: number; keyed: boolean }[]>()
  go((keyed = false) => {
    for (const k of pond.koi) {
      const frames = seen.get(k) ?? []
      frames.push({ stroke: k.stroke, phase: k.phase, speed: k.speed, keyed })
      seen.set(k, frames)
    }
  })
  return [...seen.values()]
}

/** The mean speed of every koi over every frame of `go`, in body lengths a second. */
const meanSpeed = (pond: Pond, go: (each: () => void) => void) => {
  let sum = 0
  let n = 0
  go(() => {
    for (const k of pond.koi) {
      sum += k.speed / length(pond)
      n++
    }
  })
  return sum / n
}

const SEEDS = [1, 2, 3, 4, 5, 6]

describe("the koi stream above the composer", () => {
  test("it starts as empty water, and the first koi comes in at once", () => {
    const pond = stream()
    expect(pond.koi).toEqual([])
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

  test("typing quickens them, and they coast back to a cruise after", () => {
    // A koi's speed rises and falls with every bout and glide, so it is read over a few seconds.
    let cruising = 0
    let typing = 0
    let after = 0
    for (const seed of SEEDS) {
      const pond = stream(seed)
      run(pond, 3)
      cruising += meanSpeed(pond, (each) => run(pond, 4, each))
      typing += meanSpeed(pond, (each) => type(pond, 6, 4, each))
      run(pond, 6)
      after += meanSpeed(pond, (each) => run(pond, 4, each))
    }
    expect(typing).toBeGreaterThan(cruising * 1.25)
    expect(after).toBeLessThan(cruising * 1.1)
  })

  test("they swim in bouts and glide between them: the body straightens and the tail stops beating", () => {
    for (const seed of SEEDS) {
      const pond = stream(seed)
      type(pond, 2, 3)
      for (const frames of watch(pond, (each) => type(pond, 2, 10, each))) {
        if (frames.length < 90) continue
        const straight = frames.slice(1).filter((f) => f.stroke < 0.15)
        expect(straight.length / frames.length).toBeGreaterThanOrEqual(0.25)
        // While straight the tail is not beating: under a sixth of a beat a second, where a bout
        // beats at least once a second.
        const turned = frames.slice(1).reduce((sum, f, i) => (f.stroke < 0.15 ? sum + f.phase - frames[i]!.phase : sum), 0)
        expect(turned / (2 * Math.PI) / (straight.length / 30)).toBeLessThan(1 / 6)
      }
    }
  })

  test("a keystroke does not jolt them: speed changes smoothly, and no faster on the frame a key lands", () => {
    // A bout pushes on average 1.6 times what holds a koi at its top pace of 2.1 body lengths a
    // second against drag that halves its speed in 1.2 s, and the push peaks at twice its average
    // as the tail sweeps: about 3.9 body lengths a second, each second, or 0.13 a frame at 30 fps.
    const bound = (2 * 1.6 * 2.1 * (Math.LN2 / 1.2)) / 30
    let keyed = 0
    let keyedN = 0
    let other = 0
    let otherN = 0
    let size = 0
    for (const seed of SEEDS) {
      const pond = stream(seed)
      type(pond, 8, 2)
      for (const frames of watch(pond, (each) => type(pond, 8, 3, each))) {
        for (let i = 1; i < frames.length; i++) {
          const change = (frames[i]!.speed - frames[i - 1]!.speed) / length(pond)
          expect(Math.abs(change)).toBeLessThan(bound)
          size += Math.abs(change)
          if (frames[i]!.keyed) {
            keyed += change
            keyedN++
          } else {
            other += change
            otherN++
          }
        }
      }
    }
    // On the frames a key lands, speed changes the way it does on the frames around them.
    expect(Math.abs(keyed / keyedN - other / otherN)).toBeLessThan((0.25 * size) / (keyedN + otherN))
  })

  test("faster typing beats the tail faster", () => {
    const beats = (rate: number) => {
      let turned = 0
      let seconds = 0
      for (const seed of SEEDS) {
        const pond = stream(seed)
        type(pond, rate, 3)
        for (const frames of watch(pond, (each) => type(pond, rate, 8, each))) {
          turned += frames[frames.length - 1]!.phase - frames[0]!.phase
          seconds += (frames.length - 1) / 30
        }
      }
      return turned / (2 * Math.PI) / seconds
    }
    const slow = beats(2)
    const fast = beats(8)
    expect(fast).toBeGreaterThan(slow * 1.2)
  })

  test("the koi in one stream do not swim in lockstep: each starts its bouts and glides at its own moments", () => {
    let shared = 0
    let switches = 0
    for (const seed of SEEDS) {
      const pond = stream(seed)
      type(pond, 5, 3)
      const start = pond.t
      const times = new Map<Koi, number[]>()
      const last = new Map<Koi, number>()
      type(pond, 5, 20, () => {
        for (const k of pond.koi) {
          // A glide starts as the stroke falls through 0.3, a bout as it rises through it.
          const before = last.get(k)
          if (before !== undefined && before >= 0.3 !== k.stroke >= 0.3) times.set(k, [...(times.get(k) ?? []), pond.t - start])
          last.set(k, k.stroke)
        }
      })
      const all = [...times.values()]
      all.forEach((mine, i) => {
        const others = all.filter((_, j) => j !== i).flat()
        switches += mine.length
        shared += mine.filter((t) => others.some((o) => Math.abs(o - t) < 0.1)).length
      })
    }
    expect(switches).toBeGreaterThan(100)
    expect(shared / switches).toBeLessThan(0.3)
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

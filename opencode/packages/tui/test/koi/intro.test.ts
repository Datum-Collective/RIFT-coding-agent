import { describe, expect, test } from "bun:test"
import { createPond, type Pond } from "../../src/koi/pond"
import { isInk, riftLogo } from "../../src/koi/logo"
import { riftPalette, Tag } from "../../src/koi/palette"
import { INTRO_HOLD, landing, moteAt, moteColour, revealMask } from "../../src/koi/intro"
import { JOINTS } from "../../src/koi/koi"
import type { Rgb } from "../../src/koi/colour"

const palette = riftPalette({
  background: { r: 0, g: 0, b: 0 },
  text: { r: 238, g: 238, b: 238 },
  muted: { r: 128, g: 128, b: 138 },
  primary: { r: 47, g: 129, b: 247 },
})

/** A pond with the logo in the middle, where the home screen has it. */
function withLogo(options: { cols?: number; rows?: number; scene?: "pond" | "chase"; seed?: number } = {}) {
  const cols = options.cols ?? 120
  const rows = options.rows ?? 40
  return createPond({
    cols,
    rows,
    aspect: 2,
    palette,
    seed: options.seed ?? 1,
    scene: options.scene ?? "pond",
    logo: { logo: riftLogo, col: Math.floor((cols - riftLogo.cols) / 2), row: Math.floor((rows - riftLogo.rows) / 2) - 3 },
  })
}

const run = (pond: Pond, seconds: number, each: () => void = () => {}) => {
  for (let i = 0; i < Math.round(seconds * 30); i++) {
    pond.step(1 / 30)
    each()
  }
}

const inkCount = riftLogo.pixels.filter((p) => p && isInk(p)).length
const backdropCount = riftLogo.pixels.filter((p) => p && !isInk(p)).length

describe("starting the intro", () => {
  test("every grey pixel of the logo becomes a mote, and the blue behind them is the backdrop", () => {
    const pond = withLogo()
    expect(pond.intro).toBeDefined()
    expect(pond.intro!.motes.length).toBe(inkCount)
    expect(pond.intro!.backdrop.length).toBe(backdropCount)
  })

  test("each koi is given part of the logo, and between them they have every mote once", () => {
    const pond = withLogo()
    const perKoi = pond.koi.map((_, i) => pond.intro!.motes.filter((m) => m.k === i).length)
    expect(perKoi.every((n) => n > 0)).toBe(true)
    expect(perKoi.reduce((a, b) => a + b, 0)).toBe(inkCount)
  })

  test("the koi are hidden to begin with, not yet swimming, and the water is clear of rings", () => {
    const pond = withLogo()
    for (const koi of pond.koi) {
      expect(koi.grow).toBe(0)
      expect(koi.ease).toBe(0)
    }
    expect(pond.rings).toEqual([])
  })

  test("each koi lies along its own part of the logo, the middle of its body over the middle of its letters", () => {
    const pond = withLogo()
    pond.koi.forEach((koi, i) => {
      const mine = pond.intro!.motes.filter((m) => m.k === i)
      const cx = mine.reduce((s, m) => s + m.hx, 0) / mine.length
      const cy = mine.reduce((s, m) => s + m.hy, 0) / mine.length
      expect(Math.hypot(koi.j[6]!.x - cx, koi.j[6]!.y - cy)).toBeLessThan(2 * pond.size)
    })
  })

  test("motes begin exactly where the logo's pixels are on the screen", () => {
    const pond = withLogo()
    const origin = pond.intro!.origin
    const first = pond.intro!.motes[0]!
    // A pixel is a cell wide, so two of the pond's pixels, and half a cell tall.
    const x = Math.round((first.hx - 1 - origin.x) / 2)
    expect(Number.isInteger((first.hx - 1 - origin.x) / 2)).toBe(true)
    expect(x).toBeGreaterThanOrEqual(0)
    expect(x).toBeLessThan(riftLogo.w)
  })

  test("no logo means no intro, and the pond is as it was", () => {
    const pond = createPond({ cols: 120, rows: 40, aspect: 2, palette, seed: 1, scene: "pond" })
    expect(pond.intro).toBeUndefined()
    for (const koi of pond.koi) expect(koi.grow).toBe(1)
  })

  test("the same seed makes the same intro, a different one a different intro", () => {
    const signature = (pond: Pond) => pond.intro!.motes.slice(0, 40).map((m) => [m.k, m.n, +m.f.toFixed(6), +m.start.toFixed(6)])
    expect(signature(withLogo({ seed: 5 }))).toEqual(signature(withLogo({ seed: 5 })))
    expect(signature(withLogo({ seed: 5 }))).not.toEqual(signature(withLogo({ seed: 6 })))
  })
})

describe("the logo on the water", () => {
  const colourOf = (pond: Pond, x: number, y: number) => pond.colourAt(y * pond.pw + x)
  const at = (pond: Pond, px: number, py: number) => {
    const origin = pond.intro!.origin
    return colourOf(pond, origin.x + px * 2, origin.y + py)
  }

  test("at the start it is the banner, pixel for pixel, in the banner's own colours", () => {
    const pond = withLogo()
    pond.draw()
    let checked = 0
    for (let y = 0; y < riftLogo.h; y++) {
      for (let x = 0; x < riftLogo.w; x++) {
        const want = riftLogo.pixels[y * riftLogo.w + x]
        const got = at(pond, x, y)
        if (!want) continue
        expect(got).toBeDefined()
        expect(Math.abs(got!.r - want.r) + Math.abs(got!.g - want.g) + Math.abs(got!.b - want.b)).toBeLessThan(1e-6)
        checked++
      }
    }
    expect(checked).toBe(inkCount + backdropCount)
  })

  test("the logo's pixels are two of the pond's across, and one down", () => {
    const pond = withLogo()
    pond.draw()
    const origin = pond.intro!.origin
    let y = 0
    let x = 0
    outer: for (y = 0; y < riftLogo.h; y++) {
      for (x = 0; x < riftLogo.w; x++) if (riftLogo.pixels[y * riftLogo.w + x]) break outer
    }
    const a = colourOf(pond, origin.x + x * 2, origin.y + y)!
    const b = colourOf(pond, origin.x + x * 2 + 1, origin.y + y)!
    expect(a).toEqual(b)
  })

  test("the blue backdrop fades away while the logo rests, and the letters stay until they break up", () => {
    const pond = withLogo()
    const i = (px: number, py: number) => Math.floor(py / pond.aspect) * pond.pw + Math.floor(px)
    pond.draw()
    // A bit of backdrop over open water, so only the logo's own drawing is being looked at.
    const backdrop = pond.intro!.backdrop.find((b) => pond.tag[i(b.hx, b.hy)] === Tag.water && pond.shade[i(b.hx, b.hy)] === Infinity)!
    expect(backdrop).toBeDefined()
    expect(pond.colourAt(i(backdrop.hx, backdrop.hy))).toBeDefined()
    run(pond, INTRO_HOLD - 0.3)
    pond.draw()
    const stillThere = pond.colourAt(i(backdrop.hx, backdrop.hy))
    // By now it is gone, or almost: nothing of the artwork's blue is left to see.
    expect(stillThere === undefined || stillThere.b - stillThere.r < 8).toBe(true)

    const letter = pond.intro!.motes[0]!
    expect(pond.colourAt(i(letter.hx, letter.hy))).toBeDefined()
  })
})

describe("the letters become koi", () => {
  test("until the letters break up, nothing moves from where it was", () => {
    const pond = withLogo()
    const home = pond.intro!.motes.map((m) => [m.hx, m.hy])
    run(pond, INTRO_HOLD - 0.1)
    expect(pond.intro!.motes.map((m) => [m.hx, m.hy])).toEqual(home)
    for (const koi of pond.koi) expect(koi.grow).toBe(0)
  })

  test("a mote flies on a curve from its place in the letter to a point on its koi, and arrives", () => {
    const pond = withLogo()
    const mote = pond.intro!.motes[40]!
    const start = moteAt(pond, mote)
    expect([start.x, start.y]).toEqual([mote.hx, mote.hy])
    expect(start.progress).toBe(0)
    run(pond, mote.start + mote.dur / 2 + 0.05)
    const middle = moteAt(pond, mote)
    expect(middle.progress).toBeGreaterThan(0.2)
    expect(middle.progress).toBeLessThan(0.9)
    expect(Math.hypot(middle.x - mote.hx, middle.y - mote.hy)).toBeGreaterThan(1)
    run(pond, mote.dur)
    const end = moteAt(pond, mote)
    expect(end.progress).toBe(1)
    const land = landing(pond, mote)
    expect(Math.hypot(end.x - land.x, end.y - land.y)).toBeLessThan(1e-6)
  })

  test("motes are small and square at first, and about as big as a koi's scales on landing", () => {
    const pond = withLogo()
    const mote = pond.intro!.motes[40]!
    const before = moteAt(pond, mote)
    run(pond, mote.start + mote.dur + 0.1)
    const after = moteAt(pond, mote)
    expect(before.hw).toBeCloseTo(pond.intro!.hw, 9)
    expect(after.hw).toBeGreaterThan(0.4)
    expect(after.hw).toBeLessThan(2 * pond.size + 1)
  })

  test("a koi shows only where its motes have landed, and more of it as more land", () => {
    const pond = withLogo()
    const tagged = (index: number) => {
      pond.draw()
      const body = pond.koi[index]!.pat.body
      return pond.tag.reduce((n, t) => n + (t === body ? 1 : 0), 0)
    }
    expect(tagged(0)).toBe(0)
    const seen: number[] = []
    for (let step = 0; step < 14; step++) {
      run(pond, 0.5)
      if (pond.intro) seen.push(tagged(0))
    }
    expect(Math.max(...seen)).toBeGreaterThan(20)
  })

  test("each koi is built up from its own motes: it is revealed round where they land", () => {
    const pond = withLogo()
    run(pond, INTRO_HOLD + 2.2)
    pond.draw()
    const shape = pond.koi[0]!.shape!
    const mask = revealMask(pond, 0, shape)
    expect(mask).toBeDefined()
    const lit = (m: Uint8Array) => m.reduce((n, v, i) => n + (i < shape.w * shape.h && v ? 1 : 0), 0)
    expect(lit(mask!)).toBeGreaterThan(0)
    // The motes have landed on the koi's own body, so what is lit is inside it.
    for (let i = 0; i < shape.w * shape.h; i++) if (mask![i]) expect(Number.isFinite(shape.sil[i]!)).toBe(true)
  })

  test("the water rings where a letter lifts off it", () => {
    const pond = withLogo()
    let most = 0
    run(pond, INTRO_HOLD + 3, () => (most = Math.max(most, pond.rings.length)))
    expect(most).toBeGreaterThanOrEqual(1)
  })

  test("it ends: every koi whole and free, nothing left of the logo, the intro gone", () => {
    const pond = withLogo()
    run(pond, 14)
    expect(pond.intro).toBeUndefined()
    for (const koi of pond.koi) {
      expect(koi.grow).toBe(1)
      expect(koi.ease).toBe(1)
    }
  })

  test("it takes a few seconds, not a few moments and not a minute", () => {
    const pond = withLogo()
    // The pond's own clock already holds the seconds it was given to settle.
    const began = pond.t
    let ended = 0
    run(pond, 30, () => {
      if (!pond.intro && ended === 0) ended = pond.t - began
    })
    expect(ended).toBeGreaterThan(INTRO_HOLD + 2)
    expect(ended).toBeLessThan(14)
  })

  test("while it is happening, the koi that are building do not swim off, and when they are released they do", () => {
    const pond = withLogo()
    const start = pond.koi.map((k) => ({ ...k.j[6]! }))
    run(pond, INTRO_HOLD - 0.2)
    pond.koi.forEach((k, i) => expect(k.j[6]).toEqual(start[i]))
    run(pond, 14)
    expect(pond.koi.some((k, i) => Math.hypot(k.j[6]!.x - start[i]!.x, k.j[6]!.y - start[i]!.y) > 4)).toBe(true)
  })

  test("once built, a koi has all of its parts and its colours, as in any pond", () => {
    const pond = withLogo()
    run(pond, 14)
    pond.draw()
    for (const koi of pond.koi) expect(pond.tag.some((t) => t === koi.pat.body)).toBe(true)
    expect(pond.tag.some((t) => t === Tag.eye || t === Tag.eyePale)).toBe(true)
  })

  test("the colour of a mote runs from the logo's own towards its koi's colour as it flies", () => {
    const pond = withLogo()
    const mote = pond.intro!.motes[40]!
    const own: Rgb = mote.color
    const target = pond.pal.tags[mote.tag]!
    const near = (a: Rgb, b: Rgb) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)
    expect(near(moteColour(pond, mote), own)).toBeLessThan(1e-6)
    run(pond, mote.start + mote.dur * 0.95)
    expect(near(moteColour(pond, mote), target)).toBeLessThan(near(own, target))
    expect(JOINTS).toBe(13)
  })
})

describe("a chase that starts with the logo", () => {
  test("begins on still water: the swirls and ripples of the seconds it was settled in are cleared", () => {
    let leftover = 0
    for (let seed = 1; seed <= 40; seed++) {
      const pond = withLogo({ scene: "chase", seed })
      if (pond.chase!.ripples.length > 0 || pond.chase!.swirls.length > 0) leftover++
      for (const koi of pond.koi) expect(koi.flick).toBe(0)
    }
    expect(leftover).toBe(0)
  })

  test("its pad waits shut while the logo rests, and opens out as the letters lift off the water", () => {
    const pond = withLogo({ scene: "chase", seed: 2 })
    expect(pond.pads[0]!.r).toBe(0)
    run(pond, INTRO_HOLD - 0.2)
    expect(pond.pads[0]!.r).toBe(0)
    run(pond, 4)
    expect(pond.pads[0]!.r).toBeGreaterThan(0)
    run(pond, 8)
    expect(pond.pads[0]!.r).toBeCloseTo(pond.chase!.padR, 6)
  })

  test("the pad opens in a few dozen steps at most, not a new size every frame, so its pixels are not worked out afresh each time", () => {
    const pond = withLogo({ scene: "chase", seed: 2 })
    const sizes = new Set<number>()
    run(pond, 14, () => sizes.add(pond.pads[0]!.r))
    expect(sizes.size).toBeGreaterThan(5)
    expect(sizes.size).toBeLessThanOrEqual(45)
  })

  test("the chase does not set off until the first koi is let go", () => {
    const pond = withLogo({ scene: "chase", seed: 2 })
    expect(pond.chase!.started).toBe(false)
    const theta = pond.chase!.theta
    run(pond, INTRO_HOLD - 0.1)
    expect(pond.chase!.theta).toBe(theta)
    run(pond, 3)
    expect(pond.chase!.started).toBe(true)
  })
})

describe("the pond and the logo it came from", () => {
  const make = (logo: { logo: typeof riftLogo; col: number; row: number; intro?: boolean }, cols = 120, rows = 40) =>
    createPond({ cols, rows, aspect: 2, palette, seed: 1, scene: "pond", logo })

  test("it remembers where the logo was, so the logo can be kept off the screen", () => {
    expect(make({ logo: riftLogo, col: 24, row: 11 }).logoAt).toEqual({ col: 24, row: 11 })
  })

  test("the logo stays taken over after the intro is over, since it has become the koi", () => {
    const pond = make({ logo: riftLogo, col: 24, row: 11 })
    run(pond, 14)
    expect(pond.intro).toBeUndefined()
    expect(pond.logoAt).toBeDefined()
  })

  test("a pond made for a logo that is not to be played again has taken it over but goes straight to swimming", () => {
    const pond = make({ logo: riftLogo, col: 24, row: 11, intro: false })
    expect(pond.intro).toBeUndefined()
    expect(pond.logoAt).toBeDefined()
    for (const koi of pond.koi) {
      expect(koi.grow).toBe(1)
      expect(koi.ease).toBe(1)
    }
  })

  test("a logo that does not fit on the pond is not taken over and there is no intro", () => {
    for (const at of [{ col: 60, row: 11 }, { col: -1, row: 11 }, { col: 24, row: 35 }, { col: 24, row: -2 }]) {
      const pond = make({ logo: riftLogo, ...at })
      expect(pond.intro).toBeUndefined()
      expect(pond.logoAt).toBeUndefined()
    }
  })

  test("with no logo, nothing is taken over", () => {
    expect(createPond({ cols: 120, rows: 40, aspect: 2, palette, seed: 1, scene: "pond" }).logoAt).toBeUndefined()
  })
})

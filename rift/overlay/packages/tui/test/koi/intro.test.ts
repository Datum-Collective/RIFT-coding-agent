import { describe, expect, test } from "bun:test"
import { createPond, type Pond } from "../../src/koi/pond"
import { braille, ditherBanner, DOT_BIT, isInk } from "../../src/koi/logo"
import { banner } from "../../src/banner"
import { riftPalette, Tag } from "../../src/koi/palette"
import { INTRO_HOLD, landing, moteAt, moteColour, revealMask } from "../../src/koi/intro"
import { JOINTS } from "../../src/koi/koi"
import { to8, type Rgb } from "../../src/koi/colour"

const riftLogo = ditherBanner(banner)

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

const dotsIn = (bits: number) => [...bits.toString(2)].filter((bit) => bit === "1").length
const inkCount = riftLogo.cells.reduce((n, cell) => n + (cell && isInk(cell.colour) ? dotsIn(cell.bits) : 0), 0)
const backdropCount = riftLogo.cells.filter((cell) => cell && !isInk(cell.colour)).length

/** What the pond draws now in the cell a logo cell is in. */
function drawnAt(pond: Pond, cell: number) {
  const { at, cols } = pond.intro!
  const col = at.col + (cell % cols)
  const row = at.row + Math.floor(cell / cols)
  pond.draw()
  return pond.cells().find((placed) => placed.col === col && placed.row === row)
}

describe("starting the intro", () => {
  test("every lit dot of the letters becomes a mote, and the blue cells behind them are the backdrop", () => {
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

  test("each mote begins on a dot of its own in the logo's letters, where the banner draws it", () => {
    const pond = withLogo()
    const { at, motes } = pond.intro!
    const seen = new Set<string>()
    for (const mote of motes) {
      // A dot is one of the pond's pixels across and half of one down.
      const x = mote.hx - 0.5 - at.col * 2
      const y = (mote.hy / pond.aspect - at.row * 2) * 2 - 0.5
      expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true)
      const cell = riftLogo.cells[Math.floor(y / 4) * riftLogo.cols + Math.floor(x / 2)]
      expect(cell !== undefined && isInk(cell.colour)).toBe(true)
      expect(cell!.bits & DOT_BIT[y % 4]![x % 2]!).not.toBe(0)
      seen.add(`${x},${y}`)
    }
    expect(seen.size).toBe(motes.length)
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
  test("at the start the pond draws the logo exactly as the banner does: the same dots, in the same colours", () => {
    const pond = withLogo()
    let checked = 0
    riftLogo.cells.forEach((cell, index) => {
      if (!cell) return
      const placed = drawnAt(pond, index)
      expect(placed?.char).toBe(braille(cell.bits))
      expect(placed?.fg).toEqual(to8(cell.colour))
      checked++
    })
    expect(checked).toBeGreaterThan(600)
  })

  test("a mote that sets off takes its dot with it, and is drawn in the water where it is now", () => {
    const pond = withLogo()
    const mote = pond.intro!.motes[40]!
    run(pond, mote.start + mote.dur * 0.3)
    const left = drawnAt(pond, mote.cell)
    const bits = left?.char ? left.char.codePointAt(0)! - 0x2800 : 0
    expect(bits & mote.bit).toBe(0)
    const now = moteAt(pond, mote)
    expect(pond.colourAt(Math.floor(now.y / pond.aspect) * pond.pw + Math.floor(now.x))).toBeDefined()
  })

  test("the blue backdrop fades away while the logo rests, and the letters stay until they break up", () => {
    const pond = withLogo()
    const backdrop = pond.intro!.backdrop[0]!
    expect(drawnAt(pond, backdrop.cell)?.char).toBe(braille(backdrop.bits))
    run(pond, INTRO_HOLD - 0.2)
    expect(drawnAt(pond, backdrop.cell)?.char).toBeUndefined()

    const letter = pond.intro!.motes[0]!
    expect(drawnAt(pond, letter.cell)?.char).toBeDefined()
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

  test("motes set off as one of the pond's pixels, the smallest thing it draws, and are about as big as a koi's scales on landing", () => {
    const pond = withLogo()
    const mote = pond.intro!.motes[40]!
    const before = moteAt(pond, mote)
    run(pond, mote.start + mote.dur + 0.1)
    const after = moteAt(pond, mote)
    expect([2 * before.hw, 2 * before.hh]).toEqual([1, pond.aspect])
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

  test("it takes about six seconds, in either scene, whatever the seed and the size of the terminal", () => {
    // Six seconds is long enough for the logo to be read and for the koi to be seen forming, and
    // short enough that nobody is waiting on it.
    for (const [cols, rows] of [[100, 30], [120, 40], [200, 60]] as const) {
      for (const scene of ["pond", "chase"] as const) {
        for (let seed = 1; seed <= 6; seed++) {
          const pond = withLogo({ cols, rows, scene, seed })
          const began = pond.t
          let ended = -1
          for (let step = 0; step < 30 * 60 && ended < 0; step++) {
            pond.step(1 / 60)
            if (!pond.intro) ended = pond.t - began
          }
          expect(ended).toBeGreaterThan(5.4)
          expect(ended).toBeLessThan(6.5)
        }
      }
    }
  })

  test("the logo still rests for long enough to be read before it breaks up", () => {
    expect(INTRO_HOLD).toBeGreaterThanOrEqual(2)
  })

  test("no mote is in the air for less time than it takes to follow it", () => {
    const pond = withLogo()
    for (const mote of pond.intro!.motes) expect(mote.dur).toBeGreaterThanOrEqual(1.1)
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

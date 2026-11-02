import { describe, expect, test } from "bun:test"
import { JOINTS, SEG } from "../../src/koi/koi"
import { Tag, riftPalette } from "../../src/koi/palette"
import { createPond, type Pond } from "../../src/koi/pond"
import { mix, to8, type Rgb } from "../../src/koi/colour"

const GREY: Rgb = { r: 40, g: 40, b: 44 }
const palette = riftPalette({
  background: GREY,
  text: { r: 238, g: 238, b: 238 },
  muted: { r: 128, g: 128, b: 138 },
  primary: { r: 47, g: 129, b: 247 },
})

function empty(options: { fade?: number } = {}) {
  const pond = createPond({ cols: 120, rows: 36, aspect: 2, palette, seed: 1, scene: "pond" })
  pond.koi.forEach((koi, index) => {
    koi.ease = 0
    for (let n = 0; n < JOINTS; n++) koi.j[n] = { x: 3000 + index * 100 - SEG * n, y: 3000 }
  })
  pond.pads = []
  pond.petals = []
  pond.rings = []
  pond.fade = options.fade ?? 1
  // A drawn, empty pond: nothing on any pixel, and no shadow anywhere.
  pond.draw()
  return pond
}

const at = (pond: Pond, x: number, y: number) => Math.floor(y / pond.aspect) * pond.pw + Math.floor(x)
const near = (a: Rgb, b: Rgb) => Math.abs(a.r - b.r) < 1e-3 && Math.abs(a.g - b.g) < 1e-3 && Math.abs(a.b - b.b) < 1e-3

describe("ripples", () => {
  test("a ring lifts the water into a crest at its radius, hollows it just inside, and leaves the rest still", () => {
    const pond = empty()
    pond.addRing(120, 70, 20, 0, 1, 10, 2)
    pond.draw()
    const crest = pond.height[at(pond, 120 + 20, 70)]!
    const trough = pond.height[at(pond, 120 + 16, 70)]!
    expect(crest).toBeGreaterThan(0.8)
    expect(trough).toBeLessThan(0)
    expect(pond.height[at(pond, 120, 70)]!).toBe(0)
    expect(pond.height[at(pond, 120 + 40, 70)]!).toBe(0)
    expect(Math.max(...pond.height)).toBeLessThanOrEqual(1 + 1e-6)
  })

  test("it fades away over its life", () => {
    const pond = empty()
    pond.addRing(120, 70, 20, 0, 1, 10, 2)
    pond.rings[0]!.age = 0
    pond.draw()
    const young = Math.max(...pond.height)
    pond.rings[0]!.age = 8
    pond.draw()
    expect(Math.max(...pond.height)).toBeLessThan(young * 0.5)
  })
})

describe("shading", () => {
  test("still water has nothing to say", () => {
    const pond = empty()
    pond.draw()
    expect(pond.colourAt(at(pond, 100, 60))).toBeUndefined()
  })

  test("water under a shadow is the shadow colour, partway", () => {
    const pond = empty()
    pond.shade[at(pond, 100, 60)] = -1
    expect(near(pond.colourAt(at(pond, 100, 60))!, mix(palette.bg, palette.shadow, 0.55))).toBe(true)
  })

  test("a ripple lightens water towards the ripple colour, and a trough darkens it", () => {
    const pond = empty()
    const i = at(pond, 100, 60)
    pond.height[i] = 1
    expect(near(pond.colourAt(i)!, mix(palette.bg, palette.ripple, 0.5))).toBe(true)
    pond.height[i] = -1
    expect(near(pond.colourAt(i)!, mix(palette.bg, palette.trough, 0.5))).toBe(true)
  })

  test("a koi keeps its colour, darkened a little where something shallower casts a shadow on it", () => {
    const pond = empty()
    const i = at(pond, 100, 60)
    pond.tag[i] = Tag.red
    pond.depth[i] = 0.6
    pond.shade[i] = Infinity
    expect(near(pond.colourAt(i)!, palette.tags[Tag.red]!)).toBe(true)
    pond.shade[i] = 0.2
    expect(near(pond.colourAt(i)!, mix(palette.tags[Tag.red]!, palette.koiShadow, 0.3))).toBe(true)
    pond.shade[i] = 0.6
    expect(near(pond.colourAt(i)!, palette.tags[Tag.red]!)).toBe(true)
  })

  test("a ripple passes over a koi too, more gently than over open water", () => {
    const pond = empty()
    const i = at(pond, 100, 60)
    pond.tag[i] = Tag.red
    pond.depth[i] = 0.6
    pond.shade[i] = Infinity
    pond.height[i] = 1
    expect(near(pond.colourAt(i)!, mix(palette.tags[Tag.red]!, palette.ripple, 0.42))).toBe(true)
  })

  test("things on the surface are their own flat colour, whatever is below", () => {
    const pond = empty()
    const i = at(pond, 100, 60)
    pond.tag[i] = Tag.pad
    pond.shade[i] = -1
    pond.height[i] = 1
    expect(near(pond.colourAt(i)!, palette.tags[Tag.pad]!)).toBe(true)
  })

  test("fading in mixes everything with the canvas, gently at first", () => {
    const pond = empty({ fade: 0.5 })
    const i = at(pond, 100, 60)
    pond.tag[i] = Tag.pad
    const smooth = 0.5 * 0.5 * (3 - 2 * 0.5)
    expect(near(pond.colourAt(i)!, mix(palette.bg, palette.tags[Tag.pad]!, smooth))).toBe(true)
    pond.fade = 0
    expect(near(pond.colourAt(i)!, palette.bg)).toBe(true)
  })
})

describe("cells", () => {
  const full = () => {
    const pond = createPond({ cols: 120, rows: 36, aspect: 2, palette: riftPalette({ background: { r: 0, g: 0, b: 0 }, text: { r: 238, g: 238, b: 238 }, muted: { r: 128, g: 128, b: 138 }, primary: { r: 47, g: 129, b: 247 } }), seed: 1, scene: "pond" })
    pond.draw()
    return pond
  }

  test("the koi, pads and petals come out as cells, and the open water does not", () => {
    const pond = full()
    const cells = pond.cells()
    expect(cells.length).toBeGreaterThan(200)
    expect(cells.length).toBeLessThan(pond.cols * pond.rows * 0.5)
  })

  test("every cell is on the screen, once", () => {
    const pond = full()
    const seen = new Set<number>()
    for (const cell of pond.cells()) {
      expect(cell.col).toBeGreaterThanOrEqual(0)
      expect(cell.col).toBeLessThan(pond.cols)
      expect(cell.row).toBeGreaterThanOrEqual(0)
      expect(cell.row).toBeLessThan(pond.rows)
      const key = cell.row * pond.cols + cell.col
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })

  test("a cell is a quadrant glyph with two whole-number colours", () => {
    for (const cell of full().cells()) {
      expect(cell.mask).toBeGreaterThanOrEqual(0)
      expect(cell.mask).toBeLessThanOrEqual(15)
      for (const channel of [...cell.fg, ...cell.bg]) {
        expect(Number.isInteger(channel)).toBe(true)
        expect(channel).toBeGreaterThanOrEqual(0)
        expect(channel).toBeLessThanOrEqual(255)
      }
    }
  })

  test("at the start of the fade the pond is not there, and it gets stronger as it goes", () => {
    const pond = full()
    pond.fade = 0
    pond.draw()
    expect(pond.cells()).toEqual([])
    const brightest = (fade: number) => {
      pond.fade = fade
      pond.draw()
      return Math.max(0, ...pond.cells().map((cell) => Math.max(...cell.fg, ...cell.bg)))
    }
    expect(brightest(0.3)).toBeLessThan(brightest(0.7))
    expect(brightest(0.7)).toBeLessThan(brightest(1))
  })

  test("the same pond gives the same cells twice", () => {
    const pond = full()
    expect(pond.cells()).toEqual(pond.cells())
  })

  test("only the canvas, neutral greys and azure ever reach the screen", () => {
    const accent = 217
    for (const cell of full().cells()) {
      for (const channels of [cell.fg, cell.bg]) {
        const [r, g, b] = channels
        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        const chroma = max - min
        if (chroma <= 24) continue
        // Hue of the accent is about 217 degrees; shading towards black or grey keeps it.
        const hue = max === r ? (((g - b) / chroma) % 6) * 60 : max === g ? ((b - r) / chroma + 2) * 60 : ((r - g) / chroma + 4) * 60
        const wrapped = (hue + 360) % 360
        expect(Math.min(Math.abs(wrapped - accent), 360 - Math.abs(wrapped - accent))).toBeLessThan(32)
      }
    }
  })

  test("a koi's cells show its colours: body and patches both come through", () => {
    const pond = full()
    const wanted = new Set(pond.koi.flatMap((koi) => [to8(pond.pal.tags[koi.pat.body]!).join(",")]))
    const shown = new Set(pond.cells().flatMap((cell) => [cell.fg.join(","), cell.bg.join(",")]))
    expect([...wanted].some((colour) => shown.has(colour))).toBe(true)
  })
})

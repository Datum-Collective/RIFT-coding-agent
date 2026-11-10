/**
 * The water the koi swim in while the user types: a strip above the composer (see `stream`), with
 * the koi's shadows and the rings they leave on the surface.
 *
 * It is drawn on a grid of pixels, two across and two down each terminal cell. World units are one
 * pixel wide; a pixel is `aspect` units tall, so circles stay round.
 *
 * Adapted from koi-screensaver by Erik Johansson (MIT licence). See THIRD_PARTY_NOTICES.md.
 */
import { lum, mix, to8, type Rgb } from "./colour"
import { fit, type Fitted } from "./fit"
import { type Habitat, type Koi } from "./koi"
import { smooth } from "./math"
import { Tag, type Palette } from "./palette"
import { random, type Random } from "./random"
import { shapeKoi, type KoiShape } from "./shape"
import { setupStream, stepStream, streamSwim, type StreamState } from "./stream"

/** A cell of the finished picture, and where it goes. */
export type Placed = Fitted & { col: number; row: number }

/** How finely a ripple's height is tabled, in world units. */
const RING_STEP = 0.05

export type Ring = {
  x: number
  y: number
  r: number
  speed: number
  amp: number
  age: number
  life: number
  width: number
}

export type Options = {
  cols: number
  rows: number
  /** How many units tall a pixel is, to its one unit wide. A terminal cell is about twice as tall as wide. */
  aspect: number
  palette: Palette
  seed: number
}

export class Pond implements Habitat {
  readonly cols: number
  readonly rows: number
  readonly pw: number
  readonly ph: number
  readonly aspect: number
  readonly w: number
  readonly h: number
  /** Koi scale; a koi is 18*size long. */
  size = 1
  /** 0 to 1 as the koi fade in from the canvas, or out into it. */
  fade = 1
  readonly rng: Random
  readonly pal: Palette
  t = 0

  koi: Koi[] = []
  rings: Ring[] = []
  stream!: StreamState

  /** What is at each pixel: a tag, or `Tag.water`. */
  readonly tag: Int8Array
  /** The depth of the shallowest thing shading each pixel, or Infinity. */
  readonly shade: Float32Array
  /** The depth of the koi drawn at each pixel. */
  readonly depth: Float32Array
  /** Ripple height: above zero lifts the water, below zero hollows it. */
  readonly height: Float32Array

  constructor(options: Options) {
    this.cols = options.cols
    this.rows = options.rows
    this.aspect = options.aspect
    this.pal = options.palette
    this.rng = random(options.seed)
    this.pw = options.cols * 2
    this.ph = options.rows * 2
    this.w = this.pw
    this.h = this.ph * options.aspect
    const n = this.pw * this.ph
    this.tag = new Int8Array(n)
    this.shade = new Float32Array(n)
    this.depth = new Float32Array(n)
    this.height = new Float32Array(n)
    // The stream starts empty: its koi swim in from the sides.
    setupStream(this)
  }

  addRing(x: number, y: number, r0: number, speed: number, amp: number, life: number, width: number) {
    this.rings.push({ x, y, r: r0, speed, amp, age: 0, life, width })
  }

  /** Moves the water on by `dt` seconds. */
  step(dt: number) {
    this.t += dt
    stepStream(this, dt)
    for (const k of this.koi) streamSwim(this, k, dt)

    const kept: Ring[] = []
    for (const ring of this.rings) {
      ring.age += dt
      if (ring.age > 0) ring.r += ring.speed * dt
      if (ring.age < ring.life) kept.push(ring)
    }
    this.rings = kept
  }

  // --- drawing -------------------------------------------------------------

  /** Calls `set` for every pixel whose centre lies within `r` of (cx, cy), with its offset from the centre. */
  fill(cx: number, cy: number, r: number, set: (i: number, dx: number, dy: number) => void) {
    if (r <= 0) return
    const x0 = Math.max(0, Math.floor(cx - r))
    const x1 = Math.min(this.pw - 1, Math.ceil(cx + r))
    const y0 = Math.max(0, Math.floor((cy - r) / this.aspect))
    const y1 = Math.min(this.ph - 1, Math.ceil((cy + r) / this.aspect))
    const r2 = r * r
    for (let py = y0; py <= y1; py++) {
      const dy = (py + 0.5) * this.aspect - cy
      if (dy * dy > r2) continue
      const row = py * this.pw
      for (let px = x0; px <= x1; px++) {
        const dx = px + 0.5 - cx
        if (dx * dx + dy * dy <= r2) set(row + px, dx, dy)
      }
    }
  }

  /** Works the scene out into the pixel grid: tags, shadows and ripple heights. */
  draw() {
    this.tag.fill(Tag.water)
    this.shade.fill(Infinity)
    this.height.fill(0)

    this.drawRings()

    // The deepest koi first, so shallower ones pass over them.
    const order = [...this.koi].sort((a, b) => b.depth - a.depth)

    // Shadows fall down and to the right, further the higher the koi swims above the floor. They
    // darken the floor and any koi swimming beneath.
    const sx = 0.7 * this.size
    const sy = 1.2 * this.size
    for (const k of order) {
      const off = 0.5 + 1.0 * (1 - k.depth)
      this.castKoiShadow(shapeKoi(this, k), sx * off, sy * off, k.depth)
    }
    for (const k of order) this.fillKoi(k.shape!, k.pat.body, k.depth)
  }

  /** Lays a koi's shadow, its silhouette moved by (ox, oy) world units, on everything below depth `d`. */
  private castKoiShadow(s: KoiShape, ox: number, oy: number, d: number) {
    const sx = Math.round(ox)
    const sy = Math.round(oy / this.aspect)
    for (let y = 0; y < s.h; y++) {
      const ty = s.y0 + y + sy
      if (ty < 0 || ty >= this.ph) continue
      for (let x = 0; x < s.w; x++) {
        if (s.sil[y * s.w + x]! >= 0) continue
        const tx = s.x0 + x + sx
        if (tx < 0 || tx >= this.pw) continue
        const i = ty * this.pw + tx
        if (d < this.shade[i]!) this.shade[i] = d
      }
    }
  }

  /** Paints a koi's pixels: body, patches, sheen and eyes. */
  private fillKoi(s: KoiShape, body: number, d: number) {
    for (let y = 0; y < s.h; y++) {
      const row = (s.y0 + y) * this.pw + s.x0
      for (let x = 0; x < s.w; x++) {
        const l = y * s.w + x
        if (s.sil[l]! >= 0) continue
        let t = body
        if (s.patch[l]! < 0) t = s.patchTag
        if (s.hasSheen && s.sheen[l]! < 0) t = Tag.sheen
        this.tag[row + x] = t
        this.depth[row + x] = d
      }
    }
    for (const eye of s.eyes) {
      this.fill(eye.x, eye.y, s.eyeR, (i) => {
        this.tag[i] = lum(this.pal.tags[this.tag[i]!]!) < 0.35 ? Tag.eyePale : Tag.eye
      })
    }
  }

  private ringTable = new Float32Array(0)

  /**
   * Ripples on the surface. A ring's height depends only on the distance from its middle: a crest,
   * and a shallow trough inside it. Tabled once per ring, read at each pixel.
   */
  private drawRings() {
    for (const ring of this.rings) {
      if (ring.age < 0) continue
      const fade = 1 - ring.age / ring.life
      const amp = ring.amp * Math.pow(fade, 1.3)
      const w = ring.width
      const outer = ring.r + w
      const inner = Math.max(0, ring.r - 3 * w)
      const n = Math.trunc((outer - inner) / RING_STEP) + 2
      if (this.ringTable.length < n) this.ringTable = new Float32Array(n)
      const table = this.ringTable
      for (let k = 0; k < n; k++) {
        const u = inner + k * RING_STEP - ring.r
        let v: number
        if (u >= -w) {
          const c = Math.cos(((u / w) * Math.PI) / 2)
          v = c * c
        } else {
          v = -0.4 * Math.sin((Math.PI * (-u - w)) / (2 * w))
        }
        table[k] = amp * v
      }
      this.fill(ring.x, ring.y, outer, (i, dx, dy) => {
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d < inner) return
        const f = (d - inner) / RING_STEP
        const k = Math.min(Math.trunc(f), n - 2)
        this.height[i] = this.height[i]! + table[k]! + (table[k + 1]! - table[k]!) * (f - k)
      })
    }
  }

  /**
   * The colour of pixel `i` as it should be shown, or undefined when it is still water, which is
   * the canvas itself and needs nothing drawn.
   */
  colourAt(i: number): Rgb | undefined {
    const pal = this.pal
    const t = this.tag[i]!
    const h = this.height[i]!
    const shade = this.shade[i]!
    if (t === Tag.water && h === 0 && shade === Infinity) return undefined
    let c: Rgb
    if (t === Tag.water) {
      c = pal.bg
      if (shade !== Infinity) c = mix(c, pal.shadow, 0.55)
      if (h > 0) c = mix(c, pal.ripple, Math.min(h, 1) * 0.5)
      else if (h < 0) c = mix(c, pal.trough, Math.min(-h, 1) * 0.5)
    } else {
      // Shaded by a shallower koi passing above, and crossed by the ripples on the surface, which lie
      // over the koi much as they do over the open water.
      c = pal.tags[t]!
      if (shade < this.depth[i]! - 0.01) c = mix(c, pal.koiShadow, 0.3)
      if (h > 0) c = mix(c, pal.ripple, Math.min(h, 1) * 0.42)
    }
    if (this.fade < 1) c = mix(pal.bg, c, smooth(this.fade))
    return c
  }

  /**
   * The terminal cells the drawn scene comes to: each a quadrant glyph with a foreground and a
   * background. Cells with nothing in them, which is most of the water, are left out.
   */
  cells(): Placed[] {
    const out: Placed[] = []
    const bg = this.pal.bg
    const canvas = to8(bg)
    const px: [Rgb, Rgb, Rgb, Rgb] = [bg, bg, bg, bg]
    const { pw, cols, rows } = this
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i0 = row * 2 * pw + col * 2
        const c0 = this.colourAt(i0)
        const c1 = this.colourAt(i0 + 1)
        const c2 = this.colourAt(i0 + pw)
        const c3 = this.colourAt(i0 + pw + 1)
        if (!c0 && !c1 && !c2 && !c3) continue
        px[0] = c0 ?? bg
        px[1] = c1 ?? bg
        px[2] = c2 ?? bg
        px[3] = c3 ?? bg
        const cell = fit(px)
        if (cell.mask === 0 && cell.bg[0] === canvas[0] && cell.bg[1] === canvas[1] && cell.bg[2] === canvas[2]) continue
        out.push({ col, row, mask: cell.mask, fg: cell.fg, bg: cell.bg })
      }
    }
    return out
  }
}

export function createPond(options: Options): Pond {
  return new Pond(options)
}

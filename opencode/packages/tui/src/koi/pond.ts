/**
 * The pond: koi swimming between lily pads, with loose petals and ripples on the surface.
 *
 * It is drawn on a grid of pixels, two across and two down each terminal cell. World units are one
 * pixel wide; a pixel is `aspect` units tall, so circles stay round.
 *
 * Adapted from koi-screensaver by Erik Johansson (MIT licence). See THIRD_PARTY_NOTICES.md.
 */
import { clamp, lum, mix, to8, type Rgb } from "./colour"
import { fit, type Fitted } from "./fit"
import { drawIntro, logoFits, revealMask, startIntro, stepIntro, type Intro } from "./intro"
import type { Logo } from "./logo"
import { PATTERNS, newKoi, swim, type Habitat, type Koi } from "./koi"
import { remainder, smooth } from "./math"
import { FIRST_SURFACE, Tag, type Palette } from "./palette"
import { chaseSwim, drawRipples, drawSwirls, setupChase, stepChase, type ChaseState } from "./chase"
import { random, type Random } from "./random"
import { shapeKoi, type KoiShape } from "./shape"

/** A cell of the finished picture, and where it goes. */
export type Placed = Fitted & { col: number; row: number }

/** How finely a ripple's height is tabled, in world units. */
const RING_STEP = 0.05

export type Scene = "pond" | "chase"

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

export type Pad = {
  x: number
  y: number
  r: number
  /** Which way the notch opens, and half its angle. */
  rot: number
  notch: number
  /** Phase of the rim's unevenness. */
  wobble: number
  /** Flower radius, 0 for none. */
  flower: number
  /** Flower offset from the pad's centre, in pad radii. */
  fx: number
  fy: number
}

export type Petal = { x: number; y: number; vx: number; vy: number; rot: number; spin: number; r: number }

export type Options = {
  cols: number
  rows: number
  /** How many units tall a pixel is, to its one unit wide. A terminal cell is about twice as tall as wide. */
  aspect: number
  palette: Palette
  seed: number
  scene: Scene
  /**
   * The logo that is on the screen, and the cell its top left corner is in. The koi are made from
   * its letters, and the pond records `logoAt` so the logo can be kept off the screen for as long
   * as the pond is out. `intro: false`
   * makes the pond without playing that again, as when it is remade at a new size.
   */
  logo?: { logo: Logo; col: number; row: number; intro?: boolean }
}

/**
 * A koi's length as a fraction of the pond's short side. The reference uses 0.21 on a finer pixel
 * grid; a terminal's cells are coarser, and koi that size read as slivers.
 */
export const KOI_LENGTH = 0.27

/** Seconds the koi are given to straighten out and spread over the pond before the first frame. */
const SETTLE_SECONDS = 20
const SETTLE_STEP = 1 / 30

export class Pond implements Habitat {
  readonly cols: number
  readonly rows: number
  readonly pw: number
  readonly ph: number
  readonly aspect: number
  readonly w: number
  readonly h: number
  /** Koi scale; a koi is 18*size long. */
  size: number
  /** 0 to 1 as the pond fades in from the canvas. */
  fade = 1
  readonly rng: Random
  readonly pal: Palette
  t = 0

  koi: Koi[] = []
  pads: Pad[] = []
  petals: Petal[] = []
  rings: Ring[] = []
  /** Set for the chase scene only. */
  chase?: ChaseState
  /** Set while the logo is breaking up into koi. */
  intro?: Intro
  /** The cell the logo that has been turned into koi was in with its top left corner: while this is set, the logo is kept off the screen. */
  logoAt?: { col: number; row: number }

  /** What is at each pixel: a tag, or `Tag.water`. */
  readonly tag: Int8Array
  /** The depth of the shallowest thing shading each pixel, or Infinity. Pads are -1. */
  readonly shade: Float32Array
  /** The depth of the koi drawn at each pixel. */
  readonly depth: Float32Array
  /** Ripple height: above zero lifts the water, below zero hollows it. */
  readonly height: Float32Array
  /** What the intro draws over the pond, as colour already multiplied by its opacity. Made when the intro starts. */
  private overlay?: { r: Float32Array; g: Float32Array; b: Float32Array; a: Float32Array }
  private readonly padPixels = new Map<Pad, { key: number[]; index: number[]; tags: number[] }>()

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

    const m = Math.min(this.w, this.h)
    this.size = Math.max(0.9, (m * KOI_LENGTH) / 18)

    if (options.scene === "chase") {
      setupChase(this)
    } else {
      this.placePads()
      // Four or five on a wide screen, three on a small one.
      const unit = 18 * this.size
      const count = Math.trunc(clamp(Math.round(this.w * this.h / unit / unit / 9), 3, 5))
      // Each koi keeps to its own depth, spread from just under the surface to near the bottom, so
      // one that swims under another always does.
      const depths = this.rng.perm(count)
      for (let i = 0; i < count; i++) {
        const koi = newKoi(this, PATTERNS[i % PATTERNS.length]!)
        koi.depth = 0.1 + (0.8 * depths[i]!) / Math.max(1, count - 1)
        this.koi.push(koi)
      }
      for (let i = 0; i < 3; i++) {
        this.petals.push({
          x: this.rng.float() * this.w,
          y: this.rng.float() * this.h,
          vx: (this.rng.float() - 0.5) * 1.2 * this.size,
          vy: (this.rng.float() - 0.5) * 0.8 * this.size,
          rot: this.rng.float() * 6.28,
          spin: (this.rng.float() - 0.5) * 0.15,
          r: 1.6 * this.size,
        })
      }
    }
    for (let i = 0; i < SETTLE_SECONDS / SETTLE_STEP; i++) this.step(SETTLE_STEP)
  }

  /**
   * Scatters a few clusters of lily pads, mostly towards the edges so the koi keep open water in
   * the middle.
   */
  private placePads() {
    const rng = this.rng
    // Two opposite corners and the middle of one of the other edges.
    let spots = [
      { x: 0.1, y: 0.18 },
      { x: 0.88, y: 0.8 },
      { x: 0.5, y: 0.06 },
    ]
    if (rng.int(2) === 0) {
      spots = [
        { x: 0.9, y: 0.14 },
        { x: 0.14, y: 0.86 },
        { x: 0.5, y: 0.94 },
      ]
    }
    if (rng.int(2) === 0) spots[2]!.y = 1 - spots[2]!.y
    const unit = 18 * this.size
    for (const spot of spots) {
      const cx = spot.x * this.w + (rng.float() - 0.5) * 0.08 * this.w
      const cy = spot.y * this.h + (rng.float() - 0.5) * 0.08 * this.h
      const n = 2 + rng.int(4)
      const placed: Pad[] = []
      for (let attempt = 0; placed.length < n && attempt < 200; attempt++) {
        let r = unit * (0.26 + 0.2 * rng.float())
        if (placed.length === 0) r = unit * 0.48
        const a = rng.float() * 2 * Math.PI
        let d = 0
        if (placed.length > 0) d = unit * (0.45 + 0.5 * rng.float())
        const x = cx + Math.cos(a) * d
        const y = cy + Math.sin(a) * d
        if (placed.some((q) => Math.hypot(q.x - x, q.y - y) < 0.82 * (q.r + r))) continue
        placed.push({
          x,
          y,
          r,
          rot: rng.float() * 2 * Math.PI,
          notch: 0.08 + 0.04 * rng.float(),
          wobble: rng.float() * 6.28,
          flower: 0,
          fx: 0,
          fy: 0,
        })
      }
      // A water lily on the largest pad, a little off its centre, and now and then a second one on
      // a smaller pad.
      if (placed.length > 0 && rng.float() < 0.75) {
        const first = placed[0]!
        first.flower = first.r * 0.52
        first.fx = (rng.float() - 0.5) * 0.3
        first.fy = (rng.float() - 0.5) * 0.3
        if (placed.length > 2 && rng.float() < 0.3) placed[2]!.flower = placed[2]!.r * 0.6
      }
      this.pads.push(...placed)
    }
  }

  addRing(x: number, y: number, r0: number, speed: number, amp: number, life: number, width: number) {
    this.rings.push({ x, y, r: r0, speed, amp, age: 0, life, width })
  }

  /** Moves the pond on by `dt` seconds. */
  step(dt: number) {
    this.t += dt
    if (this.intro) stepIntro(this, dt)
    if (this.chase) stepChase(this, dt)
    for (const k of this.koi) {
      if (k.ease <= 0) continue
      if (this.chase) chaseSwim(this, k, dt * k.ease)
      else swim(this, k, dt * k.ease)
    }

    for (const petal of this.petals) {
      petal.x += petal.vx * dt
      petal.y += petal.vy * dt
      petal.rot += petal.spin * dt
      const m = 4 * petal.r
      if (petal.x < -m) petal.x = this.w + m
      else if (petal.x > this.w + m) petal.x = -m
      if (petal.y < -m) petal.y = this.h + m
      else if (petal.y > this.h + m) petal.y = -m
    }

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

  /** Casts a shadow from something at depth `d` (0 is the surface, 1 the bottom, the pads -1) onto everything below it. */
  castShadow(cx: number, cy: number, r: number, d: number) {
    this.fill(cx, cy, r, (i) => {
      if (d < this.shade[i]!) this.shade[i] = d
    })
  }

  /** Works the scene out into the pixel grid: tags, shadows and ripple heights. */
  draw() {
    this.tag.fill(Tag.water)
    this.shade.fill(Infinity)
    this.height.fill(0)
    if (this.intro) this.clearOverlay()

    this.drawRings()
    if (this.chase) {
      drawSwirls(this)
      drawRipples(this)
    }

    // The deepest koi first, so shallower ones pass over them.
    const order = [...this.koi].sort((a, b) => b.depth - a.depth)

    // Shadows fall down and to the right, further the higher their caster is above the pond floor:
    // the pads and loose petals float on the surface, the koi swim in between. They darken the
    // floor and any koi swimming beneath.
    const sx = 0.7 * this.size
    const sy = 1.2 * this.size
    for (const pad of this.pads) {
      const [ox, oy] = this.padShadow(pad)
      this.castShadow(pad.x + ox, pad.y + oy, pad.r * 0.97, -1)
    }
    for (const petal of this.petals) this.petalPixels(petal, sx * 2.2, sy * 2.2, (i) => (this.shade[i] = -1))
    for (const k of order) {
      if (k.grow < MIN_GROW) continue
      const off = 0.5 + 1.0 * (1 - k.depth)
      const shape = shapeKoi(this, k)
      // In the intro a koi shows only where the letters' motes have landed on it.
      shape.masked = this.intro !== undefined && revealMask(this, this.koi.indexOf(k), shape) !== undefined
      this.castKoiShadow(shape, sx * off, sy * off, k.depth)
    }
    for (const k of order) {
      if (k.grow >= MIN_GROW) this.fillKoi(k.shape!, k.pat.body, k.depth)
    }
    for (const petal of this.petals) this.petalPixels(petal, 0, 0, (i) => (this.tag[i] = Tag.petal))
    for (const pad of this.pads) this.drawPadAndLily(pad)
    if (this.intro) drawIntro(this)
  }

  /**
   * Where a pad's shadow falls. In the pond the pads float high over the koi, and their shadows
   * fall well off; the chase's pad casts a small, close one.
   */
  private padShadow(pad: Pad): [number, number] {
    if (this.chase) return [0.065 * pad.r, 0.1 * pad.r]
    return [0.7 * this.size * 2.2, 1.2 * this.size * 2.2]
  }

  /** Lays a koi's shadow, its silhouette moved by (ox, oy) world units, on everything below depth `d`. */
  private castKoiShadow(s: KoiShape, ox: number, oy: number, d: number) {
    const sx = Math.round(ox)
    const sy = Math.round(oy / this.aspect)
    for (let y = 0; y < s.h; y++) {
      const ty = s.y0 + y + sy
      if (ty < 0 || ty >= this.ph) continue
      for (let x = 0; x < s.w; x++) {
        if (s.sil[y * s.w + x]! >= 0 || (s.masked && !s.mask[y * s.w + x])) continue
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
        if (s.sil[l]! >= 0 || (s.masked && !s.mask[l])) continue
        let t = body
        if (s.patch[l]! < 0) t = s.patchTag
        if (s.hasSheen && s.sheen[l]! < 0) t = Tag.sheen
        this.tag[row + x] = t
        this.depth[row + x] = d
      }
    }
    if (s.eyeR <= 0) return
    for (const eye of s.eyes) {
      this.fill(eye.x, eye.y, s.eyeR, (i) => {
        if (s.masked) {
          const local = (Math.floor(i / this.pw) - s.y0) * s.w + (i % this.pw) - s.x0
          if (local < 0 || local >= s.w * s.h || !s.mask[local]) return
        }
        this.tag[i] = lum(this.pal.tags[this.tag[i]!]!) < 0.35 ? Tag.eyePale : Tag.eye
      })
    }
  }

  /** Draws a pad and the water lily on it, if any. The pads lie still, so their pixels are worked out once and copied after that. */
  private drawPadAndLily(pad: Pad) {
    const key = [pad.x, pad.y, pad.r, pad.rot, pad.flower, pad.fx, pad.fy, pad.notch, pad.wobble]
    let cached = this.padPixels.get(pad)
    if (!cached || cached.key.some((value, index) => value !== key[index])) {
      cached = { key, index: [], tags: [] }
      const keep = (i: number, t: number) => {
        cached!.index.push(i)
        cached!.tags.push(t)
      }
      this.drawPad(pad, keep)
      if (pad.flower > 0) this.drawFlower(pad, keep)
      this.padPixels.set(pad, cached)
    }
    for (let n = 0; n < cached.index.length; n++) this.tag[cached.index[n]!] = cached.tags[n]!
  }

  /**
   * A lily pad: a gently uneven rim with a thin darker edge, a straight notch cut from the very
   * centre, and fine veins running out from there.
   */
  private drawPad(pad: Pad, set: (i: number, t: number) => void) {
    const veins = clamp(Math.round(pad.r / 4.5), 9, 19)
    const rim = Math.max(1.2, 0.05 * pad.r)
    this.fill(pad.x, pad.y, pad.r * PAD_REACH, (i, dx, dy) => {
      const d = Math.sqrt(dx * dx + dy * dy)
      const a = Math.atan2(dy, dx)
      const edge = pad.r * (1 + 0.018 * Math.sin(3 * a + pad.wobble) + 0.012 * Math.sin(7 * a + 2 * pad.wobble) + 0.006 * Math.sin(13 * a))
      if (d > edge) return
      const rel = remainder(a - pad.rot, 2 * Math.PI)
      if (Math.abs(rel) < pad.notch && d > 0.6) return
      let t: number = Tag.pad
      if (d > edge - rim) {
        t = Tag.padRim
      } else if (d > 0.12 * pad.r && d < 0.93 * pad.r) {
        // One vein runs down the middle of the notch, hidden by it, so the rest fall evenly
        // either side.
        const va = remainder(rel, (2 * Math.PI) / veins)
        if (Math.abs(va) * d < 0.55) t = Tag.padVein
      }
      set(i, t)
    })
  }

  private drawFlower(pad: Pad, set: (i: number, t: number) => void) {
    const cx = pad.x + pad.fx * pad.r
    const cy = pad.y + pad.fy * pad.r
    const rings = [
      { reach: pad.flower * 0.975, turn: pad.rot, n: 10, t: Tag.petal },
      { reach: pad.flower * 0.69, turn: pad.rot + Math.PI / 8, n: 8, t: Tag.petalInner },
    ]
    for (const ring of rings) {
      this.fill(cx, cy, ring.reach, (i, dx, dy) => {
        const a = remainder(Math.atan2(dy, dx) - ring.turn, (2 * Math.PI) / ring.n)
        const r = Math.hypot(dx, dy) / ring.reach
        const along = r * Math.cos(a)
        const across = r * Math.sin(a)
        if (along > 0 && along < 1 && Math.abs(across) <= petalWidth(along) * 1.15) set(i, ring.t)
      })
    }
    this.fill(cx, cy, Math.max(0.9, pad.flower * 0.2), (i) => set(i, Tag.stamen))
  }

  /** Calls `set` for every pixel of a loose petal, pointed at both ends. */
  private petalPixels(petal: Petal, ox: number, oy: number, set: (i: number) => void) {
    const length = petal.r * 3
    const width = petal.r
    const ca = Math.cos(petal.rot)
    const sa = Math.sin(petal.rot)
    this.fill(petal.x + ox, petal.y + oy, length / 2, (i, dx, dy) => {
      const along = (dx * ca + dy * sa) / length + 0.5
      const across = (-dx * sa + dy * ca) / width
      if (along > 0 && along < 1 && Math.abs(across) <= petalWidth(along) * 2.2) set(i)
    })
  }

  /** Calls `set` for every pixel whose centre lies in the box `hw` either side of `cx` and `hh` above and below `cy`. */
  rect(cx: number, cy: number, hw: number, hh: number, set: (i: number) => void) {
    const x0 = Math.max(0, Math.ceil(cx - hw - 0.5))
    const x1 = Math.min(this.pw - 1, Math.ceil(cx + hw - 0.5) - 1)
    const y0 = Math.max(0, Math.ceil((cy - hh) / this.aspect - 0.5))
    const y1 = Math.min(this.ph - 1, Math.ceil((cy + hh) / this.aspect - 0.5) - 1)
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) set(py * this.pw + px)
  }

  /** Lays `c` over pixel `i` at `alpha`, over whatever the intro has already laid there. */
  composite(i: number, c: Rgb, alpha: number) {
    const o = this.overlay!
    o.r[i] = c.r * alpha + o.r[i]! * (1 - alpha)
    o.g[i] = c.g * alpha + o.g[i]! * (1 - alpha)
    o.b[i] = c.b * alpha + o.b[i]! * (1 - alpha)
    o.a[i] = alpha + o.a[i]! * (1 - alpha)
  }

  private clearOverlay() {
    const n = this.pw * this.ph
    const o = (this.overlay ??= { r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), a: new Float32Array(n) })
    o.r.fill(0)
    o.g.fill(0)
    o.b.fill(0)
    o.a.fill(0)
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
    const base = this.baseColourAt(i)
    const overlay = this.intro ? this.overlay : undefined
    if (!overlay) return base
    const a = overlay.a[i]!
    if (a <= 0) return base
    const under = base ?? this.pal.bg
    return { r: under.r * (1 - a) + overlay.r[i]!, g: under.g * (1 - a) + overlay.g[i]!, b: under.b * (1 - a) + overlay.b[i]! }
  }

  private baseColourAt(i: number): Rgb | undefined {
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
    } else if (t < FIRST_SURFACE) {
      // Shaded by whatever passes above, a pad or a shallower koi, and crossed by the ripples on
      // the surface, which lie over the koi much as they do over the open water.
      c = pal.tags[t]!
      if (shade < this.depth[i]! - 0.01) c = mix(c, pal.koiShadow, 0.3)
      if (h > 0) c = mix(c, pal.ripple, Math.min(h, 1) * 0.42)
    } else {
      c = pal.tags[t]!
    }
    if (this.fade < 1) c = mix(pal.bg, c, smooth(this.fade))
    return c
  }

  /**
   * The terminal cells the drawn scene comes to: each a quadrant glyph with a foreground and a
   * background. Cells with nothing in them, which is most of the pond, are left out.
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


/** How far grown a koi has to be before it is drawn. */
const MIN_GROW = 0.4

/** How far past its radius a pad's uneven rim can reach. */
const PAD_REACH = 1.04

const PETAL_STEPS = 1024

/**
 * A petal's half-width along it, broad near its base and pointed at its tip. Worked out once into
 * a table, since it is asked for at every pixel of every petal.
 */
const PETAL_TABLE = Array.from({ length: PETAL_STEPS + 1 }, (_, i) => {
  const along = i / PETAL_STEPS
  return 0.36 * Math.pow(Math.sin(Math.PI * Math.pow(along, 0.8)), 0.6)
})

function petalWidth(along: number) {
  const f = clamp(along, 0, 1) * PETAL_STEPS
  const i = Math.min(Math.trunc(f), PETAL_STEPS - 1)
  return PETAL_TABLE[i]! + (PETAL_TABLE[i + 1]! - PETAL_TABLE[i]!) * (f - i)
}

/** Of every ten times a pond appears, this many are the quiet pond and the rest the chase. */
const POND_IN_TEN = 6

/**
 * Which scene a seed gets. It is drawn from a seed of its own: the pond starts from the same seed,
 * and two generators that start alike give the same first number, which would tie the scene to
 * the pond's layout.
 */
export function sceneFor(seed: number): Scene {
  return random(Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0).float() < POND_IN_TEN / 10 ? "pond" : "chase"
}

export function createPond(options: Options): Pond {
  const pond = new Pond(options)
  const { logo, col, row, intro = true } = options.logo ?? {}
  if (logo && col !== undefined && row !== undefined && logoFits(pond, logo, { col, row })) {
    pond.logoAt = { col, row }
    if (intro) startIntro(pond, logo, { col, row })
  }
  return pond
}

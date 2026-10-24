import { hash, smoothstep } from "./math"
import { touch } from "./touched"

// One wind for the whole scene, so everything that sways moves together. Now and then a gust rolls across the screen
// from left to right and dies away; between gusts the air is calm. x is in screen heights from the left edge and t in
// scene seconds, so a scene passes its own time and every scene shares the same weather.

// Scene seconds between chances of a gust, how fast one crosses the screen (screen heights per scene second), and how
// long it takes to build and to die away at any one spot.
const SLOT = 14
const SPEED = 0.45
const RISE = 1.1
const FALL = 3.2
// Lines the gusts up so one crosses in the first few seconds of a scene and another about 45 seconds in, inside the
// frames dev/check.ts measures and the README's GIFs.
const PHASE = 15.5

// How hard a gust is blowing at x: 0 in calm air, up to 1 at its height.
export function gust(x: number, t: number) {
  const s = t - x / SPEED + PHASE
  const n = Math.floor(s / SLOT)
  // About a third of the chances pass without a gust, so they don't come like clockwork.
  const strength = hash(n * 7.31 + 2.1)
  if (strength < 0.3) return 0
  const u = s - n * SLOT - hash(n * 3.17 + 0.5) * (SLOT - RISE - FALL)
  if (u <= 0 || u >= RISE + FALL) return 0
  return (u < RISE ? smoothstep(0, RISE, u) : 1 - smoothstep(RISE, RISE + FALL, u)) * (0.6 + 0.4 * (strength - 0.3) / 0.7)
}

// How far a plant leans, in units of its own sway: the same gentle rocking as ever in calm air, then a lean downwind
// (positive x) with livelier rocking as a gust passes. phase keeps neighbors out of step and rate is how fast it rocks.
export function sway(x: number, t: number, phase = 0, rate = 0.7) {
  const g = gust(x, t)
  return Math.sin(t * rate + phase) * (1 + 0.4 * g) + g * (1.65 + 0.22 * Math.sin(t * rate * 2.7 + phase * 1.7))
}

// Plants painted once into a static background that still bend in the gusts: the pixels they cover shift downwind
// row by row, more toward the tips, over what was painted behind them. Call begin() in layout() before painting them,
// end() once they're painted, seal() at the end of layout() if anything was painted over them since, and draw() right
// after copying the background each frame.
export class SwayLayer {
  private before = new Float32Array(0)
  private x0 = 0
  private y0 = 0
  private w = 0
  private h = 0
  private reach = 0
  private bare = new Float32Array(0)
  private layer = new Float32Array(0)
  // 1 where the plants are, 2 where something since painted over them hides them, 0 elsewhere.
  private cover = new Uint8Array(0)
  private weight = new Float32Array(0)
  private shift = new Float32Array(0)
  private top = new Int32Array(0)
  private bottom = new Int32Array(0)

  // dir -1 sends the gusts the other way, right to left, for a scene whose breeze already blows that way.
  constructor(private readonly dir = 1) {}

  begin(hdr: Float32Array) {
    this.before = hdr.slice()
  }

  // reach is about how far the tips move in the strongest gust, in pixels; weight(x, y) in pixels is how much of that a pixel
  // moves, from 0 at the roots to 1 at the tips.
  end(hdr: Float32Array, W: number, H: number, reach: number, weight: (x: number, y: number) => number) {
    const before = this.before
    this.before = new Float32Array(0)
    let x0 = W
    let y0 = H
    let x1 = -1
    let y1 = -1
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 3
        if (hdr[o] === before[o] && hdr[o + 1] === before[o + 1] && hdr[o + 2] === before[o + 2]) continue
        if (weight(x, y) <= 0) continue
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
    this.w = 0
    if (x1 < 0) return
    const pad = Math.ceil(reach) + 1
    this.x0 = Math.max(0, x0 - pad)
    this.y0 = y0
    this.w = Math.min(W - 1, x1 + pad) - this.x0 + 1
    this.h = y1 - y0 + 1
    this.reach = reach
    const n = this.w * this.h
    this.bare = new Float32Array(n * 3)
    this.layer = new Float32Array(n * 3)
    this.cover = new Uint8Array(n)
    this.weight = new Float32Array(n)
    this.shift = new Float32Array(this.w)
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x
        const o = ((this.y0 + y) * W + this.x0 + x) * 3
        for (let c = 0; c < 3; c++) {
          this.bare[i * 3 + c] = before[o + c]
          this.layer[i * 3 + c] = hdr[o + c]
        }
        this.cover[i] = hdr[o] !== before[o] || hdr[o + 1] !== before[o + 1] || hdr[o + 2] !== before[o + 2] ? 1 : 0
        this.weight[i] = Math.max(0, weight(this.x0 + x, this.y0 + y))
      }
  }

  // Pixels painted since end() stay put over the plants.
  seal(hdr: Float32Array, W: number) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x
        const o = ((this.y0 + y) * W + this.x0 + x) * 3
        if (hdr[o] !== this.layer[i * 3] || hdr[o + 1] !== this.layer[i * 3 + 1] || hdr[o + 2] !== this.layer[i * 3 + 2]) this.cover[i] = 2
      }
  }

  // How far the pixel at (x, y) was carried downwind in the last draw(), for things hung on the plants.
  offset(x: number, y: number) {
    const i = Math.round(x) - this.x0
    const j = Math.round(y) - this.y0
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return 0
    return this.shift[i] * this.weight[j * this.w + i]
  }

  draw(hdr: Float32Array, W: number, H: number, t: number) {
    if (!this.w) return
    let any = false
    for (let x = 0; x < this.w; x++) {
      const u = (this.dir > 0 ? this.x0 + x : W - this.x0 - x) / H
      const g = gust(u, t)
      // A little flutter on top of the lean, so the tips don't move as one stiff sheet.
      this.shift[x] = this.dir * g * this.reach * (0.64 + 0.19 * Math.sin(t * 2.3 + u * 9))
      if (g > 0) any = true
    }
    if (!any) return
    if (this.top.length !== this.w) {
      this.top = new Int32Array(this.w)
      this.bottom = new Int32Array(this.w)
    }
    shear(hdr, W, this.x0, this.y0, this.w, this.h, this.bare, this.layer, this.cover, this.weight, this.shift, this.top, this.bottom)
    // One touched box per run of columns that moved, so plants at both edges don't mark the whole width.
    let run = -1
    let y0 = 0
    let y1 = 0
    for (let x = 0; x <= this.w; x++) {
      const moved = x < this.w && this.top[x] <= this.bottom[x]
      if (moved && run < 0) ((run = x), (y0 = this.top[x]), (y1 = this.bottom[x]))
      if (moved) ((y0 = Math.min(y0, this.top[x])), (y1 = Math.max(y1, this.bottom[x])))
      if (moved || run < 0) continue
      touch(hdr, this.x0 + run, this.y0 + y0, this.x0 + x - 1, this.y0 + y1)
      run = -1
    }
  }
}

// Redraws the layer's region with each pixel taken from `shift * weight` pixels upwind, over what lies behind it, and
// records the rows each column changed between, in top and bottom.
function shear(hdr: Float32Array, W: number, x0: number, y0: number, w: number, h: number, bare: Float32Array, layer: Float32Array, cover: Uint8Array, weight: Float32Array, shift: Float32Array, top: Int32Array, bottom: Int32Array) {
  top.fill(h)
  bottom.fill(-1)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      const i = row + x
      if (cover[i] === 2) continue
      const d = shift[x] * weight[i]
      if (d < 0.02 && d > -0.02) continue
      const sx = x - d
      const xa = Math.floor(sx)
      const f = sx - xa
      const a = xa >= 0 && cover[row + xa] ? 1 - f : 0
      const b = xa + 1 < w && xa + 1 >= 0 && cover[row + xa + 1] ? f : 0
      if (a + b === 0 && cover[i] === 0) continue
      const o = ((y0 + y) * W + x0 + x) * 3
      const k = 1 - a - b
      const ia = (row + xa) * 3
      for (let c = 0; c < 3; c++) hdr[o + c] = bare[i * 3 + c] * k + (a ? layer[ia + c] * a : 0) + (b ? layer[ia + 3 + c] * b : 0)
      if (y < top[x]) top[x] = y
      bottom[x] = y
    }
  }
}

import { noise1, smoothstep, type RGB } from "./math"
import { touch } from "./touched"

// A coarse grid of light, one node every H/30 pixels, that moving and flickering lights write into each frame;
// apply() then spreads it over the scene in one pass, bilinearly between nodes. Like lightPool(), lift lights what is
// already there in proportion to its brightest channel, so lit ground keeps its texture, and glow adds a faint haze.
// Columns behind the middle of the screen, where text usually sits, get less of it.
export class LightMap {
  cell = 1
  cols = 0
  rows = 0
  private W = 0
  private H = 0
  private lift = new Float32Array(0)
  private glow = new Float32Array(0)
  private lit = new Uint8Array(0)
  private dim = new Float32Array(0)
  // Bounding box of the nodes written this frame.
  private box = [0, 0, -1, -1]

  // Empties the map, first resizing it if the canvas changed size.
  clear(W: number, H: number) {
    if (W !== this.W || H !== this.H) {
      this.W = W
      this.H = H
      this.cell = Math.max(4, Math.round(H / 30))
      this.cols = Math.floor((W - 0.5) / this.cell) + 2
      this.rows = Math.floor((H - 0.5) / this.cell) + 2
      this.lift = new Float32Array(this.cols * this.rows * 3)
      this.glow = new Float32Array(this.cols * this.rows * 3)
      this.lit = new Uint8Array(this.cols * this.rows)
      this.dim = Float32Array.from({ length: this.cols }, (_, i) => 1 - 0.45 * smoothstep(0.4, 0.15, Math.abs((i * this.cell) / W - 0.5)))
      this.box = [0, 0, -1, -1]
    }
    const [i0, j0, i1, j1] = this.box
    for (let j = j0; j <= j1; j++) {
      this.lift.fill(0, (j * this.cols + i0) * 3, (j * this.cols + i1 + 1) * 3)
      this.glow.fill(0, (j * this.cols + i0) * 3, (j * this.cols + i1 + 1) * 3)
      this.lit.fill(0, j * this.cols + i0, j * this.cols + i1 + 1)
    }
    this.box = [this.cols, this.rows, -1, -1]
  }

  // Adds light at node (i, j): color times lift and times glow.
  node(i: number, j: number, color: RGB, lift: number, glow: number) {
    const n = j * this.cols + i
    const o = n * 3
    this.lift[o] += color[0] * lift
    this.lift[o + 1] += color[1] * lift
    this.lift[o + 2] += color[2] * lift
    this.glow[o] += color[0] * glow
    this.glow[o + 1] += color[1] * glow
    this.glow[o + 2] += color[2] * glow
    this.lit[n] = 1
    const b = this.box
    if (i < b[0]) b[0] = i
    if (j < b[1]) b[1] = j
    if (i > b[2]) b[2] = i
    if (j > b[3]) b[3] = j
  }

  // A pool of light falling off over an ellipse (pixels) around (cx, cy), as lightPool() draws.
  pool(cx: number, cy: number, rx: number, ry: number, color: RGB, lift: number, glow: number) {
    const c = this.cell
    for (let j = Math.max(0, Math.ceil((cy - ry) / c)); j <= Math.min(this.rows - 1, Math.floor((cy + ry) / c)); j++) {
      const dy = (j * c - cy) / ry
      for (let i = Math.max(0, Math.ceil((cx - rx) / c)); i <= Math.min(this.cols - 1, Math.floor((cx + rx) / c)); i++) {
        const dx = (i * c - cx) / rx
        const d = 1 - dx * dx - dy * dy
        if (d > 0) this.node(i, j, color, lift * d * d, glow * d * d)
      }
    }
  }

  apply(hdr: Float32Array) {
    const [i0, j0, i1, j1] = this.box
    if (i1 < i0) return
    applyLight(hdr, this.W, this.H, this.cell, this.cols, this.lift, this.glow, this.lit, this.dim, Math.max(0, i0 - 1), Math.max(0, j0 - 1), Math.min(this.cols - 2, i1), Math.min(this.rows - 2, j1))
  }
}

// Firelight: a slow, uneven flicker between about 0.8 and 1, different for each seed. t is scene time.
export function firelight(t: number, seed: number) {
  return 0.8 + 0.13 * noise1(t * 1.1, seed) + 0.07 * noise1(t * 2.4, seed + 3)
}

// Spreads the map over hdr block by block (a block lies between four nodes), skipping blocks with no light at their
// corners: each pixel gains its capped brightness times the interpolated lift, plus the interpolated glow. Each row's
// runs of lit blocks are touched (see Canvas.touched).
function applyLight(hdr: Float32Array, W: number, H: number, cell: number, cols: number, lift: Float32Array, glow: Float32Array, lit: Uint8Array, dim: Float32Array, bi0: number, bj0: number, bi1: number, bj1: number) {
  for (let bj = bj0; bj <= bj1; bj++) {
    let run = -1
    for (let bi = bi0; bi <= bi1 + 1; bi++) {
      const a = bj * cols + bi
      const c = a + cols
      const on = bi <= bi1 && (lit[a] || lit[a + 1] || lit[c] || lit[c + 1])
      if (!on && run >= 0) touch(hdr, run * cell, bj * cell, bi * cell - 1, (bj + 1) * cell - 1)
      if (!on) {
        run = -1
        continue
      }
      if (run < 0) run = bi
      const dl = dim[bi]
      const dr = dim[bi + 1]
      const x0 = bi * cell
      const x1 = Math.min(W, x0 + cell)
      for (let y = bj * cell; y < Math.min(H, (bj + 1) * cell); y++) {
        const fy = (y + 0.5) / cell - bj
        const gy = 1 - fy
        // The block's left and right edges at this row.
        const lr = (lift[a * 3] * gy + lift[c * 3] * fy) * dl
        const lg = (lift[a * 3 + 1] * gy + lift[c * 3 + 1] * fy) * dl
        const lb = (lift[a * 3 + 2] * gy + lift[c * 3 + 2] * fy) * dl
        const rr = (lift[a * 3 + 3] * gy + lift[c * 3 + 3] * fy) * dr
        const rg = (lift[a * 3 + 4] * gy + lift[c * 3 + 4] * fy) * dr
        const rb = (lift[a * 3 + 5] * gy + lift[c * 3 + 5] * fy) * dr
        const gl = (glow[a * 3] * gy + glow[c * 3] * fy) * dl
        const gg = (glow[a * 3 + 1] * gy + glow[c * 3 + 1] * fy) * dl
        const gb = (glow[a * 3 + 2] * gy + glow[c * 3 + 2] * fy) * dl
        const hr = (glow[a * 3 + 3] * gy + glow[c * 3 + 3] * fy) * dr
        const hg = (glow[a * 3 + 4] * gy + glow[c * 3 + 4] * fy) * dr
        const hb = (glow[a * 3 + 5] * gy + glow[c * 3 + 5] * fy) * dr
        for (let x = x0; x < x1; x++) {
          const fx = (x + 0.5) / cell - bi
          const o = (y * W + x) * 3
          // Capped, so things already glowing don't wash out to white.
          const m = Math.min(0.2, Math.max(hdr[o], hdr[o + 1], hdr[o + 2]))
          hdr[o] += m * (lr + (rr - lr) * fx) + gl + (hr - gl) * fx
          hdr[o + 1] += m * (lg + (rg - lg) * fx) + gg + (hg - gg) * fx
          hdr[o + 2] += m * (lb + (rb - lb) * fx) + gb + (hb - gb) * fx
        }
      }
    }
  }
}

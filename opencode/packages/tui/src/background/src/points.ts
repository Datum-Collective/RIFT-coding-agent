// Small points of light. On terminal cells a lone bright pixel becomes a hard square block, so still points (stars,
// distant lamps) are also registered with the frame: unless something is drawn over one before finish(), finish()
// takes it back out of the frame and the engine draws it as a round dot glyph where its cell is otherwise flat. Moving
// specks use splat() instead, which shares their light between the pixels around them, so they glide rather than hop
// a whole pixel at a time.
import { touch } from "./touched"

// Values per point: x and y in pixels, size (1 small, 2 medium, 3 large), glide (1 when it drifts sideways), its light
// (r, g, b), which resolve() turns into what it adds on screen in display units (0-255), and the pixel's value just
// after it was painted, to tell whether anything was drawn over it since.
export const POINT_STRIDE = 10

export class Points {
  // Set on terminal cells; elsewhere points are only painted.
  on = false
  // The last finished frame's visible points.
  count = 0
  data = new Float32Array(POINT_STRIDE * 64)
  private next = new Float32Array(POINT_STRIDE * 64)
  private pending = 0

  // Adds a point of light at (x, y) in pixels. glide marks a point that drifts sideways, which the engine fades from
  // cell to cell as it crosses them.
  add(hdr: Float32Array, W: number, H: number, x: number, y: number, r: number, g: number, b: number, size = 1, glide = false) {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const o = ((y | 0) * W + (x | 0)) * 3
    hdr[o] += r
    hdr[o + 1] += g
    hdr[o + 2] += b
    touch(hdr, x | 0, y | 0, x | 0, y | 0)
    if (!this.on) return
    if ((this.pending + 1) * POINT_STRIDE > this.next.length) {
      const grown = new Float32Array(this.next.length * 2)
      grown.set(this.next)
      this.next = grown
    }
    const p = this.pending++ * POINT_STRIDE
    const d = this.next
    d[p] = x
    d[p + 1] = y
    d[p + 2] = size
    d[p + 3] = glide ? 1 : 0
    d[p + 4] = r
    d[p + 5] = g
    d[p + 6] = b
    d[p + 7] = hdr[o]
    d[p + 8] = hdr[o + 1]
    d[p + 9] = hdr[o + 2]
  }

  // Publishes this frame's points, before bloom: each one nothing was drawn over is taken back out of hdr, and its light
  // becomes the brightness it adds over the tone-mapped pixel beneath (bloom aside); the rest stay painted. scale is
  // each pixel's exposure (the vignette) times exposure.
  resolve(hdr: Float32Array, W: number, scale: Float32Array, exposure: number) {
    const done = this.data
    this.data = this.next
    this.next = done
    this.count = resolvePoints(this.data, this.pending, hdr, W, scale, exposure)
    this.pending = 0
  }
}

function resolvePoints(d: Float32Array, pending: number, hdr: Float32Array, W: number, scale: Float32Array, exposure: number) {
  let count = 0
  for (let p = 0; p < pending * POINT_STRIDE; p += POINT_STRIDE) {
    const i = (d[p + 1] | 0) * W + (d[p] | 0)
    if (hdr[i * 3] !== d[p + 7] || hdr[i * 3 + 1] !== d[p + 8] || hdr[i * 3 + 2] !== d[p + 9]) continue
    const k = scale[i] * exposure
    const q = count++ * POINT_STRIDE
    for (let c = 0; c < 4; c++) d[q + c] = d[p + c]
    for (let c = 0; c < 3; c++) {
      hdr[i * 3 + c] -= d[p + 4 + c]
      const under = hdr[i * 3 + c] * k
      d[q + 4 + c] = (aces(under + d[p + 4 + c] * k) - aces(under)) * 255
    }
  }
  return count
}

// The ACES curve finish() tone-maps with.
function aces(v: number) {
  const mapped = (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14)
  return mapped < 0 ? 0 : mapped > 1 ? 1 : mapped
}

// Adds light at (x, y) in pixels, shared between the four pixels around it by how close it is to each, so a moving
// speck glides smoothly and a faint one tints its cell instead of flipping its pattern. The total stays the same.
export function splat(hdr: Float32Array, W: number, H: number, x: number, y: number, r: number, g: number, b: number) {
  const px = x - 0.5
  const py = y - 0.5
  const x0 = Math.floor(px)
  const y0 = Math.floor(py)
  const fx = px - x0
  const fy = py - y0
  touch(hdr, x0, y0, x0 + 1, y0 + 1)
  for (let j = 0; j < 2; j++) {
    const yi = y0 + j
    if (yi < 0 || yi >= H) continue
    for (let i = 0; i < 2; i++) {
      const xi = x0 + i
      if (xi < 0 || xi >= W) continue
      const k = (i ? fx : 1 - fx) * (j ? fy : 1 - fy)
      const o = (yi * W + xi) * 3
      hdr[o] += r * k
      hdr[o + 1] += g * k
      hdr[o + 2] += b * k
    }
  }
}

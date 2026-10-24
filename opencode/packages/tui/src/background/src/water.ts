import type { RGB } from "./math"
import { touch } from "./touched"

let wave = new Float32Array(0)

// Mirrors the scene into water rows y0 to y1. Row y shows row rows[y - y0] of the same buffer (outside those rows),
// tinted, wobbled by ripples of up to amp[y - y0] pixels that drift with time, and mixed in by weight (one value per
// pixel of those rows; 0 leaves a pixel alone). With still (those rows as the water was drawn), pixels painted over
// since are left alone, so whatever swims or stands in front of the water stays in front of its reflection.
export function reflect(hdr: Float32Array, W: number, H: number, y0: number, y1: number, rows: Float32Array, amp: Float32Array, weight: Float32Array, tint: RGB, time: number, still?: Float32Array) {
  if (wave.length !== W) wave = new Float32Array(W)
  touch(hdr, 0, y0, W - 1, y1 - 1)
  for (let x = 0; x < W; x++) wave[x] = 2.4 * Math.sin((x / H) * 9 + time * 0.35) + 1.2 * Math.sin((x / H) * 23 - time * 0.6)
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
    const r = y - y0
    const a = amp[r]
    const phase = (y / H) * 150 + time * 1.2
    for (let x = 0; x < W; x++) {
      const w = weight[r * W + x]
      if (w <= 0) continue
      const o = (y * W + x) * 3
      const s = (r * W + x) * 3
      if (still && (hdr[o] !== still[s] || hdr[o + 1] !== still[s + 1] || hdr[o + 2] !== still[s + 2])) continue
      const p = phase + wave[x]
      const sx = Math.min(W - 1.001, Math.max(0, x + a * Math.sin(p)))
      const sy = Math.min(H - 1, Math.max(0, Math.round(rows[r] + a * 0.6 * Math.cos(p))))
      const x0 = sx | 0
      const f = sx - x0
      const m = (sy * W + x0) * 3
      hdr[o] += ((hdr[m] + (hdr[m + 3] - hdr[m]) * f) * tint[0] - hdr[o]) * w
      hdr[o + 1] += ((hdr[m + 1] + (hdr[m + 4] - hdr[m + 1]) * f) * tint[1] - hdr[o + 1]) * w
      hdr[o + 2] += ((hdr[m + 2] + (hdr[m + 5] - hdr[m + 2]) * f) * tint[2] - hdr[o + 2]) * w
    }
  }
}

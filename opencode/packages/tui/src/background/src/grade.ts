// Daytime depth for static backgrounds, applied once in layout(): aerial haze and broad ground patches. Rows are
// fractions of the height.
import { fbm2, lerp, smoothstep, type RGB } from "./math"

// Aerial perspective: whatever was painted between rows `top` and y1 fades toward the sky behind it, by `far` down to
// row y0 (the horizon), easing to `near` at y1. `sky` is a copy of hdr taken right after the sky was
// painted, so open sky is unchanged and distant shapes melt into the exact color around them. Below the horizon the
// sky copy holds the horizon color, which is what distant ground fades to. Call it after each layer to haze the
// farther ones more.
export function haze(hdr: Float32Array, sky: Float32Array, W: number, H: number, y0: number, y1: number, far: number, near = 0, top = 0) {
  for (let y = Math.max(0, Math.floor(top * H)); y < Math.min(H, Math.ceil(y1 * H)); y++) {
    const k = lerp(far, near, smoothstep(y0, y1, (y + 0.5) / H))
    if (k <= 0) continue
    for (let o = y * W * 3; o < (y + 1) * W * 3; o++) hdr[o] += (sky[o] - hdr[o]) * k
  }
}

// Gentle, broad tone patches on the ground from the horizon at y0 down to y1: low-frequency noise laid out in
// perspective (patches flatten and shrink toward the horizon, where they fade out), tinting toward `warm` on one side
// and `cool` on the other. Both are multipliers near 1; `size` is a patch's width at the bottom, in screen heights.
export function mottle(hdr: Float32Array, W: number, H: number, y0: number, y1: number, size: number, warm: RGB, cool: RGB) {
  const span = 1 - y0 + 0.04
  for (let y = Math.max(0, Math.ceil(y0 * H)); y < Math.min(H, Math.ceil(y1 * H)); y++) {
    const v = (y + 0.5) / H
    const z = Math.min(6, span / (v - y0 + 0.04))
    const fade = smoothstep(y0, y0 + 0.08, v)
    for (let x = 0; x < W; x++) {
      const n = Math.max(-1, Math.min(1, (fbm2(((x / H) * z) / size, (z * span) / size, 3) - 0.5) * 3.2)) * fade
      const t = n > 0 ? warm : cool
      const a = Math.abs(n)
      const o = (y * W + x) * 3
      hdr[o] *= 1 + (t[0] - 1) * a
      hdr[o + 1] *= 1 + (t[1] - 1) * a
      hdr[o + 2] *= 1 + (t[2] - 1) * a
    }
  }
}

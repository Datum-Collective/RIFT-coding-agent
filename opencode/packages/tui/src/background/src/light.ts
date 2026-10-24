import { cap, type Part } from "./canvas"
import type { RGB } from "./math"
import { touch } from "./touched"

// A pool of light from a lantern, lava, a window or glowing plankton, falling off over an ellipse (pixels) around
// (cx, cy). lift lights what is already there in the light's own color, in proportion to its brightest channel, so lit
// ground and creatures keep their shapes and take on the light's hue; glow adds a little haze of the color itself.
export function lightPool(hdr: Float32Array, W: number, H: number, cx: number, cy: number, rx: number, ry: number, color: RGB, lift: number, glow: number) {
  const x0 = Math.max(0, Math.floor(cx - rx))
  const x1 = Math.min(W - 1, Math.ceil(cx + rx))
  const y0 = Math.max(0, Math.floor(cy - ry))
  const y1 = Math.min(H - 1, Math.ceil(cy + ry))
  touch(hdr, x0, y0, x1, y1)
  const lr = color[0] * lift
  const lg = color[1] * lift
  const lb = color[2] * lift
  const gr = color[0] * glow
  const gg = color[1] * glow
  const gb = color[2] * glow
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - cy) / ry
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rx
      const d = 1 - dx * dx - dy * dy
      if (d <= 0) continue
      const f = d * d
      const o = (y * W + x) * 3
      // Capped, so foam, lamps and other things already glowing don't wash out to white.
      const m = Math.min(0.2, Math.max(hdr[o], hdr[o + 1], hdr[o + 2]))
      hdr[o] += (m * lr + gr) * f
      hdr[o + 1] += (m * lg + gg) * f
      hdr[o + 2] += (m * lb + gb) * f
    }
  }
}

// The little pool of yellow-green light a firefly at (x, y) throws on the leaves and grass around it, k its blink.
export function fireflyLight(hdr: Float32Array, W: number, H: number, x: number, y: number, k: number) {
  lightPool(hdr, W, H, x, y, 0.045 * H, 0.045 * H, [0.75, 1, 0.25], 4 * k, 0.012 * k)
}

// A small campfire standing at (x, gy) in pixels, H pixels to a screen height: crossed logs and tongues of flame, each
// tongue its own part list so the hot core draws over the outer flames (flat, with shape light 0). flicker, about 0.8
// to 1, scales the light the fire throws.
export function campfire(x: number, gy: number, H: number, t: number) {
  const flicker = 0.85 + 0.1 * Math.sin(t * 7.1) + 0.05 * Math.sin(t * 13.3 + 1)
  const log: RGB = [0.05, 0.025, 0.02]
  const logs = [cap(x - 0.03 * H, gy, x + 0.025 * H, gy - 0.008 * H, 0.006 * H, 0.005 * H, log), cap(x + 0.03 * H, gy, x - 0.02 * H, gy - 0.01 * H, 0.006 * H, 0.005 * H, log)]
  const flames: Part[][] = (
    [
      [-0.008, 0.036, 0.009, false],
      [0.008, 0.03, 0.008, false],
      [0, 0.046, 0.011, false],
      [0, 0.026, 0.006, true],
    ] as const
  ).map(([dx, h, r, core]) => {
    const sway = Math.sin(t * 3 + dx * 400) * 0.003 * H
    const height = h * H * (0.8 + 0.2 * Math.sin(t * 5.3 + dx * 900 + h * 100)) * flicker
    return [cap(x + dx * H, gy - 0.004 * H, x + dx * H + sway, gy - height, r * H, 0.0015 * H, core ? [2.6, 1.5, 0.3] : [2, 0.6, 0.08])]
  })
  return { flicker, logs, flames }
}

// Shadows on the ground: a soft contact shadow right under a thing, and the shadow it casts away from the light.
// Scenes make one Shade per layout with sunShade() and call groundShadow() under each thing that stands on the ground,
// before drawing it: static things in layout(), moving things each frame.
import { clamp, type RGB } from "./math"
import { touch } from "./touched"
import type { Time } from "./wallpaper"

// The ground is seen at a low angle, so a round footprint looks this much shallower than it is wide.
const SQUASH = 0.38

// How a scene's light throws shadows. Shadows multiply the ground toward tint, a dark color tinted by the sky that
// fills them, so they deepen the ground's own hue rather than graying it.
export interface Shade {
  tint: RGB
  // Strength of the soft patch right under a thing, and of the shadow it casts.
  contact: number
  cast: number
  // Cast length per unit of height.
  length: number
  // A low sun throws shadows away from (x, y), in fractions of the width and height; a high sun or moon throws them
  // all along (x, y).
  x: number
  y: number
  radiate: boolean
}

// Short, soft shadows by day; long ones at sunset, spreading away from the low sun; at night faint contact shadows and
// a hint of moon shadow. Under cloud the light is diffuse, so only contact shadows remain. orb is the sun or moon, in
// fractions of the width and height.
export function sunShade(time: Time, orb: { x: number; y: number }, covered = false): Shade {
  const away = orb.x < 0.5 ? 1 : -1
  const looks: Record<Time, Shade> = {
    day: { tint: [0.36, 0.44, 0.64], contact: 0.75, cast: 0.6, length: 0.6, x: away, y: 0.45, radiate: false },
    sunset: { tint: [0.32, 0.22, 0.42], contact: 0.7, cast: 0.75, length: 2.4, x: orb.x, y: orb.y, radiate: true },
    night: { tint: [0.35, 0.45, 0.85], contact: 0.45, cast: 0.2, length: 0.6, x: away, y: 0.45, radiate: false },
  }
  const shade = looks[time]
  return { ...shade, contact: covered ? shade.contact * 0.8 : shade.contact, cast: covered ? 0 : shade.cast }
}

// The shadows of a thing w pixels wide and h tall standing at (x, y), the ground under its middle. tip is the width
// of the far end of its cast shadow relative to the near end: under 1 for things that narrow upward, over 1 for a tree
// with a wide crown. lift is how far it is off the ground in pixels: the contact shadow spreads and fades, and the cast
// shadow slides away.
export function groundShadow(hdr: Float32Array, W: number, H: number, shade: Shade, x: number, y: number, w: number, h: number, tip = 0.7, lift = 0) {
  const [tr, tg, tb] = shade.tint
  const up = clamp(lift / Math.max(1, h * 0.5), 0, 1)
  // Centered a little in front of the feet: the half behind them is mostly hidden by the thing itself.
  const r = w * 0.6 * (1 + up * 0.6)
  const cy = y + r * SQUASH * 0.3
  if (shade.contact > 0 && up < 1) fillShadow(hdr, W, H, x, cy, x, cy, r, r, tr, tg, tb, shade.contact * (1 - up) ** 2, 1, 0.6)
  if (shade.cast <= 0) return
  const dx = shade.radiate ? x - shade.x * W : shade.x
  const dy = shade.radiate ? Math.max(0, y - shade.y * H) : shade.y
  const d = Math.hypot(dx, dy) || 1
  // Toward the viewer the ground is foreshortened, so the down-screen part of a shadow is shorter.
  const ux = dx / d
  const uy = (dy / d) * 0.5
  const near = lift * shade.length
  const far = near + h * shade.length
  fillShadow(hdr, W, H, x + ux * near, y + uy * near, x + ux * far, y + uy * far, w * 0.4, w * 0.4 * tip, tr, tg, tb, shade.cast * (1 - up * 0.5), 0.3, 0.55)
}

// How deep the shadow on each pixel of a frame already is, per hdr buffer, so overlapping shadows deepen only to the
// strongest of them instead of stacking into dark patches. fixed holds the shadows painted in layout(), which every
// frame starts from; Canvas calls keepShadows() after layout() and clearShadows() in finish().
const depth = new WeakMap<Float32Array, { amount: Float32Array; fixed: Float32Array; dirty: boolean }>()

export function keepShadows(hdr: Float32Array) {
  const d = depth.get(hdr)
  if (!d) return
  d.fixed = d.amount.slice()
  d.dirty = false
}

export function clearShadows(hdr: Float32Array) {
  const d = depth.get(hdr)
  if (!d?.dirty) return
  d.amount.set(d.fixed)
  d.dirty = false
}

// Darkens a soft tapered capsule lying on the ground toward (tr, tg, tb): from (ax, ay) radius r0 to (bx, by) radius
// r1, in pixels, measured with y stretched by 1/SQUASH. Strength a at the near end fades to a * fade at the far end.
// soft is the share of the radius that is penumbra at the near end (1 fades from the middle); it widens to 1 at the far
// end.
export function fillShadow(hdr: Float32Array, W: number, H: number, ax: number, ay: number, bx: number, by: number, r0: number, r1: number, tr: number, tg: number, tb: number, a: number, fade: number, soft: number) {
  if (a <= 0) return
  let d = depth.get(hdr)
  if (!d || d.amount.length !== W * H) {
    d = { amount: new Float32Array(W * H), fixed: new Float32Array(W * H), dirty: false }
    depth.set(hdr, d)
  }
  d.dirty = true
  const amount = d.amount
  const R = Math.max(r0, r1)
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - R))
  const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + R))
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - R * SQUASH))
  const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + R * SQUASH))
  touch(hdr, x0, y0, x1, y1)
  const dx = bx - ax
  const dy = (by - ay) / SQUASH
  const len2 = dx * dx + dy * dy
  for (let y = y0; y <= y1; y++) {
    const oy = (y + 0.5 - ay) / SQUASH
    for (let x = x0; x <= x1; x++) {
      const ox = x + 0.5 - ax
      const t = len2 > 0 ? clamp((ox * dx + oy * dy) / len2, 0, 1) : 0
      const r = r0 + (r1 - r0) * t
      const e = Math.hypot(ox - dx * t, oy - dy * t) / r
      if (e >= 1) continue
      // The penumbra widens along the shadow, away from what casts it.
      const k = clamp((1 - e) / (soft + (1 - soft) * t), 0, 1)
      const s = a * k * k * (3 - 2 * k) * (1 + (fade - 1) * t)
      const p = y * W + x
      const m = amount[p]
      if (s <= m) continue
      amount[p] = s
      // Takes the pixel from the shadow it already has to this deeper one.
      const i = p * 3
      hdr[i] *= (1 - s * (1 - tr)) / (1 - m * (1 - tr))
      hdr[i + 1] *= (1 - s * (1 - tg)) / (1 - m * (1 - tg))
      hdr[i + 2] *= (1 - s * (1 - tb)) / (1 - m * (1 - tb))
    }
  }
}

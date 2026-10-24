// Draws the still points of light scenes register (see src/points.ts) on terminal cells: as a round dot glyph in the
// point's color over the cell's own color where the cell is otherwise flat, and elsewhere (an edge, a creature, the
// text scrim) painted into the cell's sub-pixels before they are fitted, as a plain pixel would be.
import { POINT_STRIDE } from "./points"

// · ∙ • by point size.
const GLYPHS = [0xb7, 0x2219, 0x2022]
// Squared error (0-255 channel units, summed over a cell's eight sub-pixels) under which a cell counts as flat. A cell
// already showing a dot keeps it up to twice that, so a point at the limit doesn't flip between dot and block.
const FLAT = 400
// Scrim strength past which a point is painted rather than dotted, keeping dots out of the scrim's strongest part.
const SCRIM = 0.5
// A gliding point fades into the next cell over the outer twelfth of its cell on either side: a quick crossfade
// instead of a hop, and seldom long enough to show as two dots.
const GLIDE = 0.08
// A dot covers less of its cell than the block a lone sub-pixel turns into, so smaller dots are drawn brighter.
const GAINS = [2, 1.5, 1.1]
// The unsharp mask lifts a lone bright sub-pixel by about this much; painted points get the same lift.
const SHARPENED = 1.5
// previousMask value for a cell showing a dot.
export const DOT = -2

export class Dots {
  // Per cell: the dot's size (0 for none), the sub-pixel it lies in (0-7, row-major) and the light it adds (display
  // units, after desaturation and shade).
  size = new Uint8Array(0)
  sub = new Uint8Array(0)
  light = new Float32Array(0)

  clear(cells: number) {
    if (this.size.length !== cells) {
      this.size = new Uint8Array(cells)
      this.sub = new Uint8Array(cells)
      this.light = new Float32Array(cells * 3)
      return
    }
    this.size.fill(0)
    this.light.fill(0)
  }

  // Adds a scene's points, faded by alpha (during a crossfade), for a W x H grid of cells over a PW x PH scene.
  gather(points: { readonly count: number; readonly data: Float32Array } | undefined, alpha: number, PW: number, PH: number, W: number, H: number, desaturate: number, shade: number) {
    if (!points?.count || alpha <= 0) return
    gatherPoints(this.size, this.sub, this.light, points.data, points.count, alpha, W / PW, H / PH, W, H, desaturate, shade)
  }
}

function gatherPoints(size: Uint8Array, sub: Uint8Array, light: Float32Array, d: Float32Array, count: number, alpha: number, sx: number, sy: number, W: number, H: number, desaturate: number, shade: number) {
  for (let p = 0; p < count * POINT_STRIDE; p += POINT_STRIDE) {
    const gx = d[p] * sx
    const gy = d[p + 1] * sy
    const cx = Math.floor(gx)
    const cy = Math.floor(gy)
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue
    const s = Math.min(3, Math.floor((gy - cy) * 4)) * 2 + ((gx - cx) * 2 >= 1 ? 1 : 0)
    const l = d[p + 4] * 0.2126 + d[p + 5] * 0.7152 + d[p + 6] * 0.0722
    const r = (d[p + 4] + (l - d[p + 4]) * desaturate) * shade * alpha
    const g = (d[p + 5] + (l - d[p + 5]) * desaturate) * shade * alpha
    const b = (d[p + 6] + (l - d[p + 6]) * desaturate) * shade * alpha
    const u = gx - cx - 0.5
    const share = d[p + 3] && Math.abs(u) > 0.5 - GLIDE ? (Math.abs(u) - (0.5 - GLIDE)) / (GLIDE * 2) : 0
    const row = cy * W
    addDot(size, sub, light, row + cx, d[p + 2], s, r * (1 - share), g * (1 - share), b * (1 - share))
    const nx = cx + (u > 0 ? 1 : -1)
    // The neighbour's sub-pixel is the one on the shared edge.
    if (share > 0 && nx >= 0 && nx < W) addDot(size, sub, light, row + nx, d[p + 2], (s & 6) | (u > 0 ? 0 : 1), r * share, g * share, b * share)
  }
}

function addDot(size: Uint8Array, sub: Uint8Array, light: Float32Array, i: number, s: number, at: number, r: number, g: number, b: number) {
  if (!size[i] || r + g + b > light[i * 3] + light[i * 3 + 1] + light[i * 3 + 2]) sub[i] = at
  size[i] = Math.max(size[i], Math.min(3, Math.max(1, Math.round(s))))
  light[i * 3] += r
  light[i * 3 + 1] += g
  light[i * 3 + 2] += b
}

// Writes cell i as a dot if it is flat enough and clear of the scrim's strongest part: the cell's mean color behind,
// the point's color in front. q holds the cell's eight sub-pixels as displayed (curve and scrim applied), grid the
// scene before the curve, scrim the text scrim's strength per sub-pixel. held says it showed a dot last frame.
export function placeDot(dots: Dots, i: number, x: number, y: number, q: Float32Array, grid: Float32Array, scrim: Float32Array, GW: number, curve: Uint8Array, held: boolean, char: Uint32Array, fg: Uint16Array, bg: Uint16Array, o: number) {
  let cover = 0
  for (let s = 0; s < 8; s++) {
    const k = scrim[(y * 4 + (s >> 1)) * GW + x * 2 + (s & 1)]
    if (k > SCRIM) return false
    cover += k / 8
  }
  let r = 0
  let g = 0
  let b = 0
  for (let s = 0; s < 8; s++) {
    r += q[s * 3]
    g += q[s * 3 + 1]
    b += q[s * 3 + 2]
  }
  r /= 8
  g /= 8
  b /= 8
  let err = 0
  for (let s = 0; s < 8; s++) err += (q[s * 3] - r) ** 2 + (q[s * 3 + 1] - g) ** 2 + (q[s * 3 + 2] - b) ** 2
  if (err > (held ? FLAT * 2 : FLAT)) return false
  const k = (1 - cover) * GAINS[dots.size[i] - 1]
  char[i] = GLYPHS[dots.size[i] - 1]
  bg[o] = r
  bg[o + 1] = g
  bg[o + 2] = b
  bg[o + 3] = 255
  for (let c = 0; c < 3; c++) {
    let under = 0
    for (let s = 0; s < 8; s++) under += grid[((y * 4 + (s >> 1)) * GW + x * 2 + (s & 1)) * 3 + c]
    under /= 8
    lift[c] = (curve[Math.min(255, under + dots.light[i * 3 + c]) | 0] - curve[under | 0]) * k
  }
  // Scaled back as a whole if a channel would clip, so the dot keeps its tint instead of washing toward white.
  const fit = Math.min(1, (255 - r) / Math.max(1e-3, lift[0]), (255 - g) / Math.max(1e-3, lift[1]), (255 - b) / Math.max(1e-3, lift[2]))
  fg[o] = r + lift[0] * fit
  fg[o + 1] = g + lift[1] * fit
  fg[o + 2] = b + lift[2] * fit
  fg[o + 3] = 255
  return true
}
const lift = new Float32Array(3)

// Paints cell i's point into its sub-pixel q, as it would look drawn into the scene.
export function lightDot(dots: Dots, i: number, x: number, y: number, q: Float32Array, grid: Float32Array, scrim: Float32Array, GW: number, curve: Uint8Array) {
  const s = dots.sub[i]
  const g = (y * 4 + (s >> 1)) * GW + x * 2 + (s & 1)
  const a = g * 3
  const k = 1 - scrim[g]
  for (let c = 0; c < 3; c++) {
    const under = grid[a + c]
    q[s * 3 + c] += (curve[Math.min(255, under + dots.light[i * 3 + c] * SHARPENED) | 0] - curve[under | 0]) * k
  }
}

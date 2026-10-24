import type { Context } from "../host"
import { MouseButton, Renderable, type MouseEvent, type OptimizedBuffer, type RenderContext } from "@opentui/core"
import { appendFileSync } from "node:fs"

// RIFT: pixel mode (the scene as a real image behind the text) needs an OpenTUI newer than the one RIFT ships, so it
// stays off and pixelMode() is always false. These stand in for the types it would import.
type KittyImageTransport = "file" | "direct" | "shm"
interface PublishedImage {
  readonly width: number
  readonly height: number
  dispose(): void
}
interface NativeImagePool {
  readonly width: number
  readonly height: number
  dispose(): void
  publishRgba(rgba: Uint8Array): PublishedImage | null
}
declare const NativeImagePool: new (options: { width: number; height: number; capacity: number }) => NativeImagePool
import { DOT, Dots, lightDot, placeDot } from "./dots"
import { watchEgg } from "./egg"
import { lerp, smoothstep, type RGB } from "./math"
import { OCTANTS } from "./octants"
import { FIRST, prepareEdges, refineEdge } from "./smooth"
import { AGENT_EVENTS, settingsFor, type AgentEvent, type Brightness, type Power, type Scene, type Scrim, type Settings, type TextMap, type Wallpaper } from "./wallpaper"

export {
  ACTIVITIES,
  AGENT_EVENTS,
  BRIGHTNESSES,
  POWERS,
  TIMES,
  settingsFor,
  type Activity,
  type AgentEvent,
  type Brightness,
  type Power,
  type Scene,
  type Scrim,
  type Settings,
  type TextMap,
  type Time,
  type Wallpaper,
} from "./wallpaper"

// Parses WALLPAPER_EVENTS ("busy@2,done@12,error@40"): agent events to play at those seconds, for testing reactions.
export function parseEvents(spec = "") {
  return spec.split(",").flatMap((part) => {
    const [name, at] = part.trim().split("@")
    const event = AGENT_EVENTS.find((e) => e === name)
    return event && at && Number.isFinite(Number(at)) ? [{ event, at: Number(at) }] : []
  })
}


const UPPER_HALF = 0x2580
const LOWER_HALF = 0x2584
const BLOCKS_START = 0x2580
const BLOCKS_END = 0x259f
const SPACE = 32
// Share of the distance to white that light-theme scrims keep, so dark text sits on a pale tint of the scene.
const LIGHT_SCRIM = 0.15
// A click pokes the scene only where it shows through clearly: a blank surface cell away from text (see buildNearText).
const OPEN = 0.5
// How near text the panels OpenCode draws with their own surface (dialogs, the sidebar, the prompt) count, at least.
const PANEL = 0.5
// How far past text, in sub-pixels (half a cell wide, a quarter cell tall), the scene counts as near it.
const REACH = 7

// Each brightness compresses the scene into a range that keeps text readable on top of it, after scaling it by gain,
// and sets how far the whole scene fades toward the scrim color (scrim): brighter scenes need a firmer scrim. In a
// light theme the scene is instead lifted toward white, with black at wash.
function level(gain: number, wash: number, scrim: number) {
  const dark = new Uint8Array(256)
  const light = new Uint8Array(256)
  for (let v = 0; v < 256; v++) {
    const x = (v / 255) * gain
    const soft = x / (1 + x * 0.9)
    dark[v] = Math.round(soft * 255)
    light[v] = Math.round((wash + (1 - wash) * Math.min(1, soft * 1.9)) * 255)
  }
  return { dark, light, scrim }
}
const LEVELS: Record<Brightness, ReturnType<typeof level>> = {
  subtle: level(0.6, 0.65, 0.53),
  normal: level(1, 0.5, 0.58),
  vivid: level(1.6, 0.35, 0.63),
}
// Night scenes keep their color: it is what separates them from light text.
const DESATURATE = { day: 0.22, sunset: 0.22, night: 0.04 }
// Seconds a change of wallpaper, activity or time of day crossfades over by default.
export const FADE = 1.2
// The map of where text sits that scenes get (see Scene.textMap): its grid, and how many frames apart it is rebuilt.
const MAP_COLS = 16
const MAP_ROWS = 9
const MAP_EVERY = 15

// Crossfades two equally sized RGBA frames into out.
function mix(a: Uint8Array, b: Uint8Array, out: Uint8Array, t: number) {
  for (let p = 0; p < out.length; p++) out[p] = a[p] + (b[p] - a[p]) * t
}

// Writes how near text each octant sub-pixel is from the cells' shapes (1 text, 2 panel): 1 under text, falling off
// smoothly to 0 REACH sub-pixels away, and at least PANEL across panels. Clicks and the text map use it.
function buildNearText(shapes: Uint8Array, out: Float32Array, W: number, H: number) {
  const GW = W * 2
  const GH = H * 4
  for (let gy = 0; gy < GH; gy++) {
    const row = (gy >> 2) * W
    for (let gx = 0; gx < GW; gx++) out[gy * GW + gx] = shapes[row + (gx >> 1)] === 1 ? 0 : 1e9
  }
  distanceField(out, GW, GH)
  const span = REACH - 0.5
  for (let gy = 0; gy < GH; gy++) {
    const row = (gy >> 2) * W
    for (let gx = 0; gx < GW; gx++) {
      const g = gy * GW + gx
      const t = Math.min(1, Math.max(0, (out[g] - 0.5) / span))
      const near = 1 - t * t * (3 - 2 * t)
      out[g] = shapes[row + (gx >> 1)] === 2 && near < PANEL ? PANEL : near
    }
  }
}

// Turns a field of 0 (text) and large values into each sample's approximate distance to the nearest 0, in two
// chamfer passes (steps of 1 straight and √2 diagonally).
function distanceField(d: Float32Array, w: number, h: number) {
  const D = Math.SQRT2
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      let v = d[i]
      if (x > 0 && d[i - 1] + 1 < v) v = d[i - 1] + 1
      if (y > 0) {
        if (d[i - w] + 1 < v) v = d[i - w] + 1
        if (x > 0 && d[i - w - 1] + D < v) v = d[i - w - 1] + D
        if (x < w - 1 && d[i - w + 1] + D < v) v = d[i - w + 1] + D
      }
      d[i] = v
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      let v = d[i]
      if (x < w - 1 && d[i + 1] + 1 < v) v = d[i + 1] + 1
      if (y < h - 1) {
        if (d[i + w] + 1 < v) v = d[i + w] + 1
        if (x < w - 1 && d[i + w + 1] + D < v) v = d[i + w + 1] + D
        if (x > 0 && d[i + w - 1] + D < v) v = d[i + w - 1] + D
      }
      d[i] = v
    }
}

// Terminals that draw octant glyphs themselves; elsewhere fall back to quadrants, which every font has.
const OCTANT_TERMINALS = /ghostty|kitty/i
const quad4 = new Float32Array(12)

function mean8(q: Float32Array, c: number) {
  return (q[c] + q[3 + c] + q[6 + c] + q[9 + c] + q[12 + c] + q[15 + c] + q[18 + c] + q[21 + c]) / 8
}

// Means and squared error of splitting a cell's eight sub-pixels by mask (set bits are foreground).
const split = { fr: 0, fg: 0, fb: 0, br: 0, bg: 0, bb: 0, err: 0 }
function evalMask(q: Float32Array, mask: number) {
  let fr = 0
  let fg = 0
  let fb = 0
  let fn = 0
  let br = 0
  let bg = 0
  let bb = 0
  let bn = 0
  for (let s = 0; s < 8; s++) {
    if (mask & (1 << s)) {
      fr += q[s * 3]
      fg += q[s * 3 + 1]
      fb += q[s * 3 + 2]
      fn++
    } else {
      br += q[s * 3]
      bg += q[s * 3 + 1]
      bb += q[s * 3 + 2]
      bn++
    }
  }
  if (fn) ((fr /= fn), (fg /= fn), (fb /= fn))
  if (bn) ((br /= bn), (bg /= bn), (bb /= bn))
  let err = 0
  for (let s = 0; s < 8; s++) {
    const on = mask & (1 << s)
    const dr = q[s * 3] - (on ? fr : br)
    const dg = q[s * 3 + 1] - (on ? fg : bg)
    const db = q[s * 3 + 2] - (on ? fb : bb)
    err += dr * dr + dg * dg + db * db
  }
  split.fr = fr
  split.fg = fg
  split.fb = fb
  split.br = br
  split.bg = bg
  split.bb = bb
  split.err = err
}

// Splits a cell's eight sub-pixels into two colours by brightness threshold, choosing the split with the least
// squared error. A cell keeps last frame's split unless the new one is clearly better (see tolerance), so slow
// motion doesn't make the glyph pattern flicker between near-equal choices. Returns the mask used.
function writeOctant(q: Float32Array, order: Uint8Array, previous: number, older: number, moving: number, char: Uint32Array, fg: Uint16Array, bg: Uint16Array, i: number, o: number) {
  for (let s = 0; s < 8; s++) {
    const l = q[s * 3] * 0.2126 + q[s * 3 + 1] * 0.7152 + q[s * 3 + 2] * 0.0722
    let j = s
    while (j > 0 && luma8[order[j - 1]] > l) {
      order[j] = order[j - 1]
      j--
    }
    order[j] = s
    luma8[s] = l
  }
  let bestMask = 0
  let bestErr = Infinity
  let mask = 255
  let flatErr = 0
  for (let k = 0; k < 8; k++) {
    if (k > 0) mask &= ~(1 << order[k - 1])
    evalMask(q, k === 0 ? 0 : mask)
    if (k === 0) flatErr = split.err
    if (split.err < bestErr - 0.5) {
      bestErr = split.err
      bestMask = k === 0 ? 0 : mask
    }
  }
  // One refinement pass: reassign each sub-pixel to the nearer of the two colors. This beats a pure brightness
  // split wherever hue matters more than lightness, such as a warm highlight against cool water.
  if (bestMask !== 0) {
    evalMask(q, bestMask)
    const { fr, fg: fgg, fb, br, bg: bgg, bb } = split
    let refined = 0
    for (let s = 0; s < 8; s++) {
      const r = q[s * 3]
      const g = q[s * 3 + 1]
      const b = q[s * 3 + 2]
      const df = (r - fr) ** 2 + (g - fgg) ** 2 + (b - fb) ** 2
      const db = (r - br) ** 2 + (g - bgg) ** 2 + (b - bb) ** 2
      if (df < db) refined |= 1 << s
    }
    if (refined !== bestMask && refined !== 0 && refined !== 255) {
      evalMask(q, refined)
      if (split.err < bestErr) {
        bestErr = split.err
        bestMask = refined
      }
    }
  }
  const band = bandSplit(q, 4, previous, flatErr, bestErr)
  softFit = band >= 0
  let chosen = band < 0 ? bestMask : band
  if (band < 0 && previous >= 0 && previous !== bestMask) {
    evalMask(q, previous)
    if (split.err <= tolerance(bestErr, bestMask, previous, older, moving, HYSTERESIS)) chosen = previous
  }
  evalMask(q, chosen)
  if (chosen === 0 || chosen === 255) {
    char[i] = 0x20
    const n = chosen === 0 ? split : { br: split.fr, bg: split.fg, bb: split.fb }
    bg[o] = n.br
    bg[o + 1] = n.bg
    bg[o + 2] = n.bb
    bg[o + 3] = 255
    return chosen
  }
  char[i] = OCTANTS[chosen]
  bg[o] = split.br
  bg[o + 1] = split.bg
  bg[o + 2] = split.bb
  bg[o + 3] = 255
  fg[o] = split.fr
  fg[o + 1] = split.fg
  fg[o + 2] = split.fb
  fg[o + 3] = 255
  return chosen
}
const luma8 = new Float32Array(8)
// Whether writeOctant's last cell was soft light it drew as a gradient band.
let softFit = false
// Extra squared error (in 0-255 channel units) a cell tolerates before abandoning last frame's split.
const HYSTERESIS = 150
// Pixels around a touched box that still count as moving: anti-aliased edges and the trail PERSISTENCE leaves. Bloom
// reaches further, but it only shifts colors smoothly, so those cells keep the steady fit.
const MOVING_REACH = 4
// Touched boxes under this many pixels (stars, snowflakes, motes) are points rather than edges and keep the steady fit.
const MOVING_MIN = 30
// Boxes over this share of the screen are layers redrawn every frame (water, an aurora, light shafts, fog), not
// something moving across a still background, so they keep the steady fit too.
const MOVING_MAX = 0.1
// Share of the previous frame blended into each new one, which smooths sub-pixel motion.
const PERSISTENCE = 0.45
// How often the scene advances and redraws; wallpapers move slowly, so this stays low to save CPU and output.
const FPS = 15
// While the agent works the scene runs a little faster, least of all when calm; after an error it dims slightly.
const BUSY_PACE = { calm: 1.12, lively: 1.25, teeming: 1.4 }
const ERROR_SHADE = 0.85
// An error's gloom lifts on its own after this long, if the agent hasn't started working again first.
const GLOOM_MS = 120_000
// Saver mode's rate after IDLE_MS without keyboard, mouse or agent activity.
const IDLE_FPS = 5
const IDLE_MS = 30_000
// Scenes clamp each step to 0.1 s, so longer gaps (the idle rate) are split into steps no longer than that.
const MAX_STEP = 0.1
// Real-pixel mode: scene pixels per character cell. Cells are about twice as tall as wide, so 3x6 keeps pixels square.
const PX_W = 3
const PX_H = 6
// Character-cell mode can render the scene at SUPERSAMPLE x the octant grid and box-filter it down, so thin features
// anti-alias instead of snapping on and off. It costs about 2.5x the CPU, so it's opt-in (WALLPAPER_SUPERSAMPLE=2).
// SHARPEN restores small-scale contrast (eyes, stripes, fin edges) that the octant grid otherwise flattens.
const SUPERSAMPLE = process.env.WALLPAPER_SUPERSAMPLE === "2" ? 2 : 1
const SHARPEN = 0.55

// Quadrant block for each 4-bit mask of foreground sub-pixels: bit 0 TL, 1 TR, 2 BL, 3 BR.
const QUADRANTS = [
  0x20, 0x2598, 0x259d, 0x2580, 0x2596, 0x258c, 0x259e, 0x259b, 0x2597, 0x259a, 0x2590, 0x259c, 0x2584, 0x2599, 0x259f, 0x2588,
]

// Picks the two-colour split of a cell's four sub-pixels with the least error and writes it as a quadrant block. Like
// writeOctant it keeps last frame's split unless the new one is clearly better. Returns the mask used.
function writeQuadrant(q8: Float32Array, previous: number, older: number, moving: number, char: Uint32Array, fg: Uint16Array, bg: Uint16Array, i: number, o: number) {
  const q = quad4
  for (let s = 0; s < 4; s++) {
    const top = ((s >> 1) * 4 + (s & 1)) * 3
    for (let c = 0; c < 3; c++) q[s * 3 + c] = (q8[top + c] + q8[top + 6 + c]) / 2
  }
  let bestMask = 0
  let bestErr = Infinity
  let flatErr = 0
  for (let m = 0; m < 8; m++) {
    evalQuad(q, m)
    if (m === 0) flatErr = split.err
    if (split.err < bestErr - 0.5) {
      bestErr = split.err
      bestMask = m
    }
  }
  const band = bandSplit(q, 2, previous, flatErr, bestErr)
  let chosen = band < 0 ? bestMask : band
  if (band < 0 && previous >= 0 && previous !== bestMask) {
    evalQuad(q, previous)
    if (split.err <= tolerance(bestErr, bestMask, previous, older, moving, HYSTERESIS / 2)) chosen = previous
  }
  evalQuad(q, chosen)
  bg[o] = split.br
  bg[o + 1] = split.bg
  bg[o + 2] = split.bb
  bg[o + 3] = 255
  if (chosen === 0) {
    char[i] = 0x20
    return chosen
  }
  char[i] = QUADRANTS[chosen]
  fg[o] = split.fr
  fg[o + 1] = split.fg
  fg[o + 2] = split.fb
  fg[o + 3] = 255
  return chosen
}

// Like evalMask, for a cell's four quadrant sub-pixels.
function evalQuad(q: Float32Array, mask: number) {
  let fr = 0
  let fg = 0
  let fb = 0
  let fn = 0
  let br = 0
  let bg = 0
  let bb = 0
  let bn = 0
  for (let s = 0; s < 4; s++) {
    if (mask & (1 << s)) {
      fr += q[s * 3]
      fg += q[s * 3 + 1]
      fb += q[s * 3 + 2]
      fn++
    } else {
      br += q[s * 3]
      bg += q[s * 3 + 1]
      bb += q[s * 3 + 2]
      bn++
    }
  }
  if (fn) ((fr /= fn), (fg /= fn), (fb /= fn))
  if (bn) ((br /= bn), (bg /= bn), (bb /= bn))
  let err = 0
  for (let s = 0; s < 4; s++) {
    const on = mask & (1 << s)
    const dr = q[s * 3] - (on ? fr : br)
    const dg = q[s * 3 + 1] - (on ? fg : bg)
    const db = q[s * 3 + 2] - (on ? fb : bb)
    err += dr * dr + dg * dg + db * db
  }
  split.fr = fr
  split.fg = fg
  split.fb = fb
  split.br = br
  split.bg = bg
  split.bb = bb
  split.err = err
}

// Marks the cells under the scene's touched boxes (see Canvas.touched), widened by MOVING_REACH pixels.
function markMoving(moving: Uint8Array, touched: readonly number[] | undefined, PW: number, PH: number, W: number, H: number) {
  moving.fill(0)
  if (!touched) return
  const sx = W / PW
  const sy = H / PH
  for (let b = 0; b < touched.length; b += 4) {
    const area = (touched[b + 2] - touched[b] + 1) * (touched[b + 3] - touched[b + 1] + 1)
    if (area < MOVING_MIN || area > PW * PH * MOVING_MAX) continue
    const x0 = Math.max(0, Math.floor((touched[b] - MOVING_REACH) * sx))
    const x1 = Math.min(W, Math.ceil((touched[b + 2] + 1 + MOVING_REACH) * sx))
    const y0 = Math.max(0, Math.floor((touched[b + 1] - MOVING_REACH) * sy))
    const y1 = Math.min(H, Math.ceil((touched[b + 3] + 1 + MOVING_REACH) * sy))
    for (let y = y0; y < y1; y++) if (x0 < x1) moving.fill(1, y * W + x0, y * W + x1)
  }
}

// Marks the cells the sun or moon discs (see Scene.orbs) reach into.
function markOrbs(round: Uint8Array, orbs: readonly number[] | undefined, PW: number, PH: number, W: number, H: number) {
  round.fill(0)
  if (!orbs) return
  for (let b = 0; b < orbs.length; b += 3) {
    const r = orbs[b + 2] + 2
    const x0 = Math.max(0, Math.floor(((orbs[b] - r) * W) / PW))
    const x1 = Math.min(W - 1, Math.floor(((orbs[b] + r) * W) / PW))
    const y0 = Math.max(0, Math.floor(((orbs[b + 1] - r) * H) / PH))
    const y1 = Math.min(H - 1, Math.floor(((orbs[b + 1] + r) * H) / PH))
    for (let y = y0; y <= y1; y++) if (x0 <= x1) round.fill(1, y * W + x0, y * W + x1 + 1)
  }
}

// The most error a cell's previous split may have and still be kept, given the best split's. Where something moves,
// a step of one sub-pixel (not back to the split before) is taken as soon as it fits a little better, so slow motion
// glides a sub-pixel at a time instead of jumping several at once. Bigger changes, steps back, and every static cell
// keep the full margin, so noise and swaying stay steady.
function tolerance(bestErr: number, best: number, previous: number, older: number, moving: number, margin: number) {
  const d = best ^ previous
  return moving && (d & (d - 1)) === 0 && best !== older ? bestErr * 1.1 + margin * 0.6 : bestErr * 1.35 + margin
}

// The terminal is sent every cell whose character or colors differ from the last frame, and slow light (aurora, twinkle,
// bloom around moving things) nudges hundreds of cells by a level or two of 255 each frame. A color the engine drew
// that is within QUIET levels in every channel of what the cell showed last frame keeps last frame's value, so drift
// builds up unseen and is sent once it adds up; a new glyph always sends its true colors.
const QUIET = 3

function quieten(char: Uint32Array, fg: Uint16Array, bg: Uint16Array, inputFg: Uint16Array, inputBg: Uint16Array, shownChar: Uint32Array, shownFg: Uint16Array, shownBg: Uint16Array, cells: number) {
  for (let i = 0; i < cells; i++) {
    if (char[i] !== shownChar[i]) {
      shownChar[i] = char[i]
      continue
    }
    const o = i * 4
    holdColor(fg, inputFg, shownFg, o)
    holdColor(bg, inputBg, shownBg, o)
  }
  shownFg.set(fg)
  shownBg.set(bg)
}

// Colors OpenCode drew (unchanged from its input) are left exactly as they are.
function holdColor(colors: Uint16Array, input: Uint16Array, shown: Uint16Array, o: number) {
  if (colors[o] === input[o] && colors[o + 1] === input[o + 1] && colors[o + 2] === input[o + 2] && colors[o + 3] === input[o + 3]) return
  for (let c = o; c < o + 4; c++) if (Math.abs(colors[c] - shown[c]) >= QUIET) return
  for (let c = o; c < o + 4; c++) colors[c] = shown[c]
}

// Soft light (glows, haze, sky gradients) reads best as bands across its gradient: a cell's left and right halves, or
// a run of its rows against the rest (with octants, the top quarter, half or three quarters, or a stripe across the
// middle where a glow peaks). That gives a gradient two steps per cell instead of a flat block or a speckle of
// near-equal colors.
// Cells with more flat error than this (squared, summed over eight sub-pixels' channels) are edges, not soft light.
const SOFT = 1500
// How much more squared error than the free split a band may have and still be preferred: enough to absorb the
// speckle of a level or so that soft light picks up, not enough to flatten real texture such as sand ripples.
const BAND_TOLERANCE = 8
// A flat cell takes a band once that band's two colors would differ by about two levels (as squared error saved),
// so a gentle gradient doesn't stay a flat block; band cells never go flat again while they stay soft. Any other
// split, a band or say a snowflake that has since moved on, is kept while it fits nearly as well as the best band,
// so slow motion doesn't flip glyphs between near-equal bands or change them twice as a snowflake passes.
const FLAT_HYSTERESIS = 8
const BAND_HYSTERESIS = 100
// Channel sums of the rows above each row of the cell, and of the whole cell at the end.
const above = new Float64Array(15)

// The band a soft cell should use, or last frame's split while it still fits; -1 leaves the cell to the free split.
// q holds rows of two sub-pixels; error thresholds scale with the cell's share of eight sub-pixels.
function bandSplit(q: Float32Array, rows: number, previous: number, flatErr: number, freeErr: number) {
  const scale = rows / 4
  if (flatErr > SOFT * scale) return -1
  const n = rows * 2
  const full = (1 << n) - 1
  // Sums over the cell's left column and last frame's foreground, and the sum of squares.
  let lr = 0
  let lg = 0
  let lb = 0
  let pr = 0
  let pg = 0
  let pb = 0
  let pn = 0
  let sq = 0
  above.fill(0)
  for (let s = 0; s < n; s++) {
    const o = ((s >> 1) + 1) * 3
    const r = q[s * 3]
    const g = q[s * 3 + 1]
    const b = q[s * 3 + 2]
    sq += r * r + g * g + b * b
    above[o] += r
    above[o + 1] += g
    above[o + 2] += b
    if (!(s & 1)) ((lr += r), (lg += g), (lb += b))
    if (previous > 0 && previous & (1 << s)) ((pr += r), (pg += g), (pb += b), pn++)
  }
  for (let o = 3; o < (rows + 1) * 3; o++) above[o] += above[o - 3]
  const t = rows * 3
  cell.sq = sq
  cell.r = above[t]
  cell.g = above[t + 1]
  cell.b = above[t + 2]
  cell.n = n
  cell.flat = flatErr
  let best = full & 0x55
  let bestErr = splitErr(lr, lg, lb, rows)
  // Rows a to b - 1; runs that reach the bottom row are the complements of those from the top.
  for (let a = 0; a < rows - 1; a++)
    for (let b = a + 1; b < rows; b++) {
      const err = splitErr(above[b * 3] - above[a * 3], above[b * 3 + 1] - above[a * 3 + 1], above[b * 3 + 2] - above[a * 3 + 2], (b - a) * 2)
      if (err < bestErr) ((bestErr = err), (best = ((1 << (b * 2)) - 1) ^ ((1 << (a * 2)) - 1)))
    }
  if (bestErr > freeErr + BAND_TOLERANCE * scale) return -1
  const kept = Math.max(0, previous)
  if (kept === 0 || kept === full) return flatErr <= bestErr + FLAT_HYSTERESIS * scale ? kept : best
  return splitErr(pr, pg, pb, pn) <= bestErr * 1.35 + BAND_HYSTERESIS * scale ? kept : best
}

// A split's error from its foreground's channel sums and size: the cell's sum of squares less what each side's mean explains.
const cell = { sq: 0, r: 0, g: 0, b: 0, n: 0, flat: 0 }
function splitErr(r: number, g: number, b: number, n: number) {
  if (n === 0 || n === cell.n) return cell.flat
  return cell.sq - (r * r + g * g + b * b) / n - ((cell.r - r) ** 2 + (cell.g - g) ** 2 + (cell.b - b) ** 2) / (cell.n - n)
}

function isBlock(char: number) {
  return char >= BLOCKS_START && char <= BLOCKS_END
}

function applyTint(colors: Uint16Array | Uint8Array, o: number, tint: number) {
  if (tint === NO_TINT || tint === TINT_ZERO) return
  const dr = ((tint >> 20) & 1023) - 256
  const dg = ((tint >> 10) & 1023) - 256
  const db = (tint & 1023) - 256
  colors[o] = Math.max(0, Math.min(255, (colors[o] & 255) + dr))
  colors[o + 1] = Math.max(0, Math.min(255, (colors[o + 1] & 255) + dg))
  colors[o + 2] = Math.max(0, Math.min(255, (colors[o + 2] & 255) + db))
}

function fgKey(fg: Uint16Array, o: number) {
  return ((fg[o] & 255) << 16) | ((fg[o + 1] & 255) << 8) | (fg[o + 2] & 255)
}

const NO_TINT = 0x7fffffff
// Colors this close to a surface (summed channel difference) are drawn as the scene plus the difference, so animated
// highlights such as the tab loading sweep glow over the scene instead of leaving solid patches.
const TINT_RANGE = 110
const TINT_ZERO = ((256 << 20) | (256 << 10) | 256)

function packTint(dr: number, dg: number, db: number) {
  return ((dr + 256) << 20) | ((dg + 256) << 10) | (db + 256)
}

function key(bg: Uint16Array, o: number) {
  if (((bg[o + 1] >> 8) & 3) === 2) return -1
  return ((bg[o] & 255) << 16) | ((bg[o + 1] & 255) << 8) | (bg[o + 2] & 255)
}

// OpenCode theme surfaces are near-neutral grays, dark or (in a light theme) light; colored backgrounds (diffs,
// selections, badges) are left alone.
function isSurface(k: number, light: boolean) {
  if (k < 0) return true
  const r = (k >> 16) & 255
  const g = (k >> 8) & 255
  const b = k & 255
  const luma = r * 0.2126 + g * 0.7152 + b * 0.0722
  return (light ? luma > 170 : luma < 70) && Math.max(r, g, b) - Math.min(r, g, b) < 24
}

// Marks the cells under any of the boxes (scene pixels, inclusive).
function markCells(stale: Uint8Array, boxes: readonly number[], cellX: Int32Array, cellY: Int32Array, W: number, PW: number, PH: number) {
  for (let b = 0; b < boxes.length; b += 4) {
    const x0 = Math.max(0, Math.floor(boxes[b]))
    const y0 = Math.max(0, Math.floor(boxes[b + 1]))
    const x1 = Math.min(PW - 1, Math.ceil(boxes[b + 2]))
    const y1 = Math.min(PH - 1, Math.ceil(boxes[b + 3]))
    if (x0 > x1 || y0 > y1) continue
    for (let y = cellY[y0]; y <= cellY[y1]; y++) stale.fill(1, y * W + cellX[x0], y * W + cellX[x1] + 1)
  }
}

// Blends the scene into the history, desaturated and shaded, and writes the result to blended, for the cells marked in
// stale. A cell whose blended pixels changed is marked in moved; stale is left marking the cells whose history is still
// settling toward the scene, which need blending again next frame even if the scene doesn't change there. Cells not
// marked keep their history and blended pixels exactly, since blending them again would change nothing.
function settle(px: Uint8Array, blended: Uint8Array, history: Float32Array, PW: number, W: number, H: number, colStart: Int32Array, rowStart: Int32Array, stale: Uint8Array, moved: Uint8Array, desaturate: number, shade: number, persistence: number, fresh: boolean) {
  for (let cy = 0; cy < H; cy++)
    for (let cx = 0; cx < W; cx++) {
      const cell = cy * W + cx
      moved[cell] = 0
      if (!stale[cell]) continue
      let settled = true
      let same = true
      for (let y = rowStart[cy]; y < rowStart[cy + 1]; y++)
        for (let x = colStart[cx]; x < colStart[cx + 1]; x++) {
          const p = (y * PW + x) * 4
          const l = px[p] * 0.2126 + px[p + 1] * 0.7152 + px[p + 2] * 0.0722
          for (let c = p; c < p + 3; c++) {
            const v = (px[c] + (l - px[c]) * desaturate) * shade
            const h = fresh ? v : history[c] * persistence + v * (1 - persistence)
            const before = history[c]
            history[c] = h
            if (history[c] !== before) settled = false
            const was = blended[c]
            blended[c] = h
            if (blended[c] !== was) same = false
          }
        }
      stale[cell] = settled ? 0 : 1
      moved[cell] = same ? 0 : 1
    }
}

// Box-filters the moved cells' pixels down to the 2x4-per-cell octant grid (raw), then applies a four-neighbor unsharp
// mask into grid for them and their neighbors, marking in refit the cells whose sharpened grid changed.
function regrid(px: Uint8Array, PW: number, PH: number, GW: number, GH: number, W: number, H: number, raw: Float32Array, grid: Float32Array, moved: Uint8Array, refit: Uint8Array) {
  for (let cell = 0; cell < W * H; cell++) {
    if (!moved[cell]) continue
    const cx = cell % W
    const cy = (cell / W) | 0
    for (let gy = cy * 4; gy < cy * 4 + 4; gy++) {
      const y0 = Math.floor((gy * PH) / GH)
      const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * PH) / GH))
      for (let gx = cx * 2; gx < cx * 2 + 2; gx++) {
        const x0 = Math.floor((gx * PW) / GW)
        const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * PW) / GW))
        let r = 0
        let g = 0
        let b = 0
        for (let yy = y0; yy < y1; yy++)
          for (let xx = x0; xx < x1; xx++) {
            const p = (yy * PW + xx) * 4
            r += px[p]
            g += px[p + 1]
            b += px[p + 2]
          }
        const n = (y1 - y0) * (x1 - x0)
        const o = (gy * GW + gx) * 3
        raw[o] = r / n
        raw[o + 1] = g / n
        raw[o + 2] = b / n
      }
    }
  }
  const row = GW * 3
  for (let cell = 0; cell < W * H; cell++) {
    refit[cell] = 0
    const cx = cell % W
    const cy = (cell / W) | 0
    if (!moved[cell] && !(cx > 0 && moved[cell - 1]) && !(cx < W - 1 && moved[cell + 1]) && !(cy > 0 && moved[cell - W]) && !(cy < H - 1 && moved[cell + W])) continue
    for (let gy = cy * 4; gy < cy * 4 + 4; gy++) {
      const up = gy > 0 ? -row : 0
      const down = gy < GH - 1 ? row : 0
      for (let gx = cx * 2; gx < cx * 2 + 2; gx++) {
        const left = gx > 0 ? -3 : 0
        const right = gx < GW - 1 ? 3 : 0
        const o = (gy * GW + gx) * 3
        for (let c = o; c < o + 3; c++) {
          const v = raw[c]
          const out = v + (v * 4 - raw[c + up] - raw[c + down] - raw[c + left] - raw[c + right]) * (SHARPEN / 4)
          const before = grid[c]
          grid[c] = out < 0 ? 0 : out > 255 ? 255 : out
          if (grid[c] !== before) refit[cell] = 1
        }
      }
    }
  }
}

// Writes a cell's last fit back: its glyph, background, and foreground unless it is blank.
function reuseFit(i: number, o: number, char: Uint32Array, fg: Uint16Array, bg: Uint16Array, fitChar: Uint32Array, fitFg: Uint16Array, fitBg: Uint16Array) {
  char[i] = fitChar[i]
  for (let c = 0; c < 3; c++) bg[o + c] = fitBg[i * 3 + c]
  bg[o + 3] = 255
  if (char[i] === SPACE) return
  for (let c = 0; c < 3; c++) fg[o + c] = fitFg[i * 3 + c]
  fg[o + 3] = 255
}

function rememberFit(i: number, o: number, char: Uint32Array, fg: Uint16Array, bg: Uint16Array, fitChar: Uint32Array, fitFg: Uint16Array, fitBg: Uint16Array) {
  fitChar[i] = char[i]
  for (let c = 0; c < 3; c++) fitBg[i * 3 + c] = bg[o + c]
  if (char[i] !== SPACE) for (let c = 0; c < 3; c++) fitFg[i * 3 + c] = fg[o + c]
}

// A full-screen renderable at the very back of the tree, so its image placement is drawn before any UI.
class SceneLayer extends Renderable {
  constructor(
    ctx: RenderContext,
    private readonly draw: (buffer: OptimizedBuffer) => void,
  ) {
    super(ctx, { id: "wallpaper-layer", position: "absolute", left: 0, top: 0, width: "100%", height: "100%", zIndex: -100000 })
  }

  protected override renderSelf(buffer: OptimizedBuffer) {
    this.draw(buffer)
  }
}

function createLayer(renderer: Context["renderer"], draw: (buffer: OptimizedBuffer) => void) {
  const layer = new SceneLayer(renderer, draw)
  renderer.root.add(layer)
  return {
    dispose() {
      renderer.root.remove(layer)
      layer.destroy()
    },
  }
}

export interface Engine {
  readonly wallpaper: Wallpaper | undefined
  // While running, the old scene crossfades into the new one over `fade` seconds. A wallpaper with a fixed time gets
  // it in place of settings' time (see settingsFor).
  start(wallpaper: Wallpaper, settings: Settings, fade?: number): void
  stop(): void
  react(event: AgentEvent): void
  power(mode: Power): void
}

// Post-processes OpenCode's final frame: cells painted with neutral OpenCode theme surfaces are replaced by the scene, drawn
// as octant or quadrant blocks (or, opt-in, a real kitty image behind the text), dimmed evenly toward a scrim color so
// text reads on top.
export function createEngine(
  context: Context,
  options: {
    // Writes one frame's cells as JSON to this path, for dev/cells.ts.
    dump?: string
    // Writes the first frame past the middle of a crossfade, likewise.
    dumpFade?: string
    layer?: (renderer: Context["renderer"], draw: (buffer: OptimizedBuffer) => void) => { dispose(): void }
  } = {},
): Engine {
  const renderer = context.renderer
  const counts = new Map<number, number>()
  const surfaces = new Set<number>()
  const tints = new Map<number, number>()
  let wallpaper: Wallpaper | undefined
  let settings: Settings | undefined
  let scene: Scene | undefined
  // The agent's state, kept across wallpaper switches; pace and shade ease toward it.
  let busy = false
  let failed = false
  let lifting: ReturnType<typeof setTimeout> | undefined
  let pace = 1
  let shade = 1
  // The outgoing scene while a crossfade runs, and how far the incoming one has faded in (0 to 1) over fadeLength seconds.
  let from: { scene: Scene; wallpaper: Wallpaper; settings: Settings } | undefined
  let fade = 1
  let fadeLength = FADE
  let mixed = new Uint8Array(0)
  let frames = 0
  let dumped = false
  let fadeDumped = false
  let base = -2
  let mask = new Float32Array(0)
  const quad = new Float32Array(24)
  const order = new Uint8Array(8)
  const octants = process.env.WALLPAPER_OCTANTS !== "0" && (process.env.WALLPAPER_OCTANTS === "1" || OCTANT_TERMINALS.test(`${process.env.TERM_PROGRAM ?? ""} ${process.env.TERM ?? ""}`))
  // Octant terminals also draw the smooth mosaics and eighth blocks themselves, for smoother edges.
  const smooth = octants && process.env.WALLPAPER_SMOOTH !== "0"
  let shapes = new Uint8Array(0)
  let surface = new Uint8Array(0)
  let cellTint = new Int32Array(0)
  let previousMask = new Int16Array(0)
  // The split each cell showed before its current one, and the cells where something moves this frame (see tolerance).
  let olderMask = new Int16Array(0)
  let moving = new Uint8Array(0)
  // Each cell's sub-pixels when src/smooth.ts last chose its glyph, and the cells over the sun or moon, which keep
  // their octants: wedges would turn the disc into a polygon.
  let edgeSeen = new Float32Array(0)
  let round = new Uint8Array(0)
  let history = new Float32Array(0)
  // What each cell showed last frame, and the colors OpenCode drew this frame before the scene went in, for quieten.
  let shownChar = new Uint32Array(0)
  let shownFg = new Uint16Array(0)
  let shownBg = new Uint16Array(0)
  let inputFg = new Uint16Array(0)
  let inputBg = new Uint16Array(0)
  let lastStep = 0
  let lastTarget = ""
  let imageCell = new Uint8Array(0)
  let open = new Uint8Array(0)
  let openW = 0
  let pressed = -1
  let grid = new Float32Array(0)
  let raw = new Float32Array(0)
  let light = false
  const textMap: TextMap = { cols: MAP_COLS, rows: MAP_ROWS, cover: new Float32Array(MAP_COLS * MAP_ROWS) }
  const mapCount = new Float32Array(MAP_COLS * MAP_ROWS)
  let mapped = false
  let mapFresh = false
  // Refitting only what changed (see settle and regrid). blended is the history-blended scene the grid is built from;
  // per cell, stale marks pixels to blend again, moved the cells whose blended pixels changed and refit those whose grid
  // did. fitted marks cells whose last fit (fitChar, fitFg, fitBg) still holds.
  let dirty = true
  let blended = new Uint8Array(0)
  let stale = new Uint8Array(0)
  let moved = new Uint8Array(0)
  let refit = new Uint8Array(0)
  let fitted = new Uint8Array(0)
  let fitChar = new Uint32Array(0)
  let fitFg = new Uint16Array(0)
  let fitBg = new Uint16Array(0)
  let colStart = new Int32Array(0)
  let rowStart = new Int32Array(0)
  let cellX = new Int32Array(0)
  let cellY = new Int32Array(0)
  let lastSize = ""
  let lastSource: Uint8Array | undefined
  let lastBlend = ""
  let lastScrim: Scrim | undefined
  let lastCurve: Uint8Array | undefined
  const dots = new Dots()

  let imagePixels = new Uint8Array(0)
  let pool: NativeImagePool | undefined
  let savedTransport: KittyImageTransport | undefined
  let nextImage: PublishedImage | undefined
  let layerPlaced = false
  let reservation = 0
  let layer: { dispose(): void } | undefined

  // Called while OpenCode renders, before anything else draws: one full-screen placement of the latest image.
  const layerStats = { calls: 0, placed: 0, noImage: 0 }
  const drawLayer = (_buffer: OptimizedBuffer) => {
    layerStats.calls++
    if (!nextImage) layerStats.noImage++
  }

  const pixelMode = () => false

  // Builds the scene image with the scrim (k of the way toward it) and tints baked in, for the cells marked in imageCell.
  const publishImage = (px: Uint8Array, PW: number, PH: number, W: number, H: number, scrim: Scrim, curve: Uint8Array, k: number) => {
    if (imagePixels.length !== PW * PH * 4) imagePixels = new Uint8Array(PW * PH * 4)
    const img = imagePixels
    const cw = PW / W
    const chh = PH / H
    for (let iy = 0; iy < PH; iy++) {
      const row = Math.min(H - 1, Math.floor(iy / chh))
      const depth = row / Math.max(1, H - 1)
      const [deepR, deepG, deepB] = scrimAt(scrim, depth, light)
      for (let ix = 0; ix < PW; ix++) {
        const ci = row * W + Math.min(W - 1, Math.floor(ix / cw))
        const p = (iy * PW + ix) * 4
        img[p] = curve[px[p]] * (1 - k) + deepR * k
        img[p + 1] = curve[px[p + 1]] * (1 - k) + deepG * k
        img[p + 2] = curve[px[p + 2]] * (1 - k) + deepB * k
        img[p + 3] = 255
        applyTint(img, p, cellTint[ci])
      }
    }
    if (!pool || pool.width !== PW || pool.height !== PH) {
      pool?.dispose()
      pool = new NativeImagePool({ width: PW, height: PH, capacity: 3 })
    }
    if (savedTransport === undefined) {
      savedTransport = renderer.kittyImageTransport
      renderer.kittyImageTransport = (process.env.WALLPAPER_TRANSPORT as KittyImageTransport | undefined) ?? "file"
    }
    return pool.publishRgba(img) ?? undefined
  }

  let timer: ReturnType<typeof setInterval> | undefined
  // The timer's period in ms; 0 while paused.
  let interval = 0
  let power: Power = "saver"
  let focused = true
  let lastActivity = 0
  let unlisten: (() => void) | undefined

  // Full rate, the idle rate, or stopped, for the current power mode, focus and activity.
  const schedule = () => {
    const saver = power === "saver"
    const next = !scene || (saver && !focused) ? 0 : saver && Date.now() - lastActivity > IDLE_MS ? 1000 / IDLE_FPS : 1000 / FPS
    if (next === interval) return
    clearInterval(timer)
    timer = next
      ? setInterval(() => {
          schedule()
          renderer.requestRender()
        }, next)
      : undefined
    interval = next
  }
  const wake = () => {
    lastActivity = Date.now()
    schedule()
  }
  const onInput = (data: Buffer | string) => {
    // Kitty graphics replies are the terminal answering us, not the user.
    if (!data.toString().startsWith("\x1b_G")) wake()
  }
  const onFocus = () => {
    focused = true
    // Resume where the scene paused rather than stepping over the time spent in the background.
    if (!interval) lastStep = 0
    wake()
    renderer.requestRender()
  }
  const onBlur = () => {
    focused = false
    schedule()
  }

  const tintOf = (k: number) => {
    const cached = tints.get(k)
    if (cached !== undefined) return cached
    let result = NO_TINT
    if (surfaces.has(k)) result = packTint(0, 0, 0)
    else if (k >= 0) {
      const r = (k >> 16) & 255
      const g = (k >> 8) & 255
      const b = k & 255
      let nearest = NO_TINT
      let best = TINT_RANGE + 1
      for (const c of surfaces.has(base) ? surfaces : [...surfaces, base]) {
        if (c < 0) continue
        const d = Math.abs(r - ((c >> 16) & 255)) + Math.abs(g - ((c >> 8) & 255)) + Math.abs(b - (c & 255))
        if (d < best) ((best = d), (nearest = c))
      }
      if (nearest !== NO_TINT && surfaces.has(nearest))
        result = packTint(r - ((nearest >> 16) & 255), g - ((nearest >> 8) & 255), b - (nearest & 255))
    }
    tints.set(k, result)
    return result
  }

  const debug = process.env.WALLPAPER_DEBUG
  const log = (line: string) => {
    if (debug) appendFileSync(debug, `${line}\n`)
  }
  log(`host renderable: ${renderer.root instanceof Renderable}`)
  const postProcess = (buf: OptimizedBuffer) => {
    try {
      render(buf)
    } catch (error) {
      // A frame cut short leaves the cached fits out of step with the scene, so the next one starts over.
      lastSize = ""
      log(`error: ${error instanceof Error ? error.stack : String(error)}`)
    }
  }
  const render = (buf: OptimizedBuffer) => {
    if (!scene) return
    const W = buf.width
    const H = buf.height
    if (W < 4 || H < 2) return
    const pixels = pixelMode()
    const targetW = pixels ? W * PX_W : W * 2 * SUPERSAMPLE
    const targetH = pixels ? H * PX_H : H * 4 * SUPERSAMPLE
    const target = `${targetW}x${targetH}`
    const resized = target !== lastTarget
    lastTarget = target
    scene.resize(targetW, targetH, !pixels)
    from?.scene.resize(targetW, targetH, !pixels)
    // The scene advances at most once per timer interval, and not at all while paused; redraws in between (typing, UI
    // updates) reuse the last frame.
    const now = performance.now()
    const advanced = resized || (interval > 0 && now - lastStep >= interval - 2)
    if (advanced) {
      const dt = !interval ? 0 : lastStep ? Math.min(0.5, (now - lastStep) / 1000) : 1 / FPS
      if (interval) lastStep = now
      watchEgg(dt)
      const ease = 1 - Math.exp(-dt / 2.5)
      pace += ((busy ? BUSY_PACE[settings!.activity] : 1) - pace) * ease
      shade += ((failed ? ERROR_SHADE : 1) - shade) * ease
      const steps = Math.ceil((dt * pace) / MAX_STEP)
      for (let s = 0; s < steps; s++) scene.step((dt * pace) / steps)
      scene.render()
      fade = Math.min(1, fade + dt / fadeLength)
      if (fade === 1) from = undefined
      if (from) {
        for (let s = 0; s < steps; s++) from.scene.step((dt * pace) / steps)
        from.scene.render()
        if (mixed.length !== scene.pixels.length) mixed = new Uint8Array(scene.pixels.length)
        mix(from.scene.pixels, scene.pixels, mixed, smoothstep(0, 1, fade))
      }
    }
    // Mid-fade the scrim and desaturation blend from the old look to the new one along with the scene.
    const t = from ? smoothstep(0, 1, fade) : 1
    const was = from ?? { wallpaper: wallpaper!, settings: settings! }
    const scrim = blendScrim(was.wallpaper.scrim[was.settings.time], wallpaper!.scrim[settings!.time], t)
    const desaturate = lerp(DESATURATE[was.settings.time], DESATURATE[settings!.time], t)
    // Blending in the previous frame fades at the same speed per second whatever the frame rate.
    const persistence = interval > 1000 / FPS ? PERSISTENCE ** (interval / (1000 / FPS)) : PERSISTENCE
    if (advanced) {
      dots.clear(W * H)
      dots.gather(scene.points, t, scene.W, scene.H, W, H, desaturate, shade)
      dots.gather(from?.scene.points, 1 - t, scene.W, scene.H, W, H, desaturate, shade)
    }
    paint(buf, from ? mixed : scene.pixels, scene.W, scene.H, advanced, pixels, desaturate, shade, persistence, scrim, from ? undefined : scene.changed, from ? undefined : scene.touched, scene.orbs)
    if (mapFresh) {
      mapFresh = false
      scene.textMap?.(textMap)
      from?.scene.textMap?.(textMap)
    }
    if (options.dump && !dumped && frames > 120) {
      dumped = true
      write(buf, options.dump)
    }
    if (options.dumpFade && !fadeDumped && from && fade >= 0.5) {
      fadeDumped = true
      write(buf, options.dumpFade)
    }
  }

  const write = (buf: OptimizedBuffer, path: string) => {
    void Bun.write(
      path,
      // Characters beyond ASCII live in a grapheme pool, so the frame's text comes along to recover them.
      JSON.stringify({ W: buf.width, H: buf.height, char: Array.from(buf.buffers.char), text: new TextDecoder().decode(buf.getRealCharBytes(true)), fg: Array.from(buf.buffers.fg, (v) => v & 255), bg: Array.from(buf.buffers.bg, (v) => v & 255) }),
    )
  }

  // Everything after the scene has drawn its frame. It never touches the scene object: each wallpaper's scene is a
  // different class, and the optimizer would otherwise fall back to slow code for this whole function after a switch.
  const paint = (buf: OptimizedBuffer, px: Uint8Array, PW: number, PH: number, advanced: boolean, pixels: boolean, desaturate: number, shade: number, persistence: number, scrim: Scrim, changed: readonly number[] | undefined, touched: readonly number[] | undefined, orbs: readonly number[] | undefined) => {
    const W = buf.width
    const H = buf.height
    const GW = W * 2
    const GH = H * 4
    const cells = W * H
    const size = `${W}x${H} ${PW}x${PH}`
    const reset = size !== lastSize || history.length !== px.length || grid.length !== GW * GH * 3
    if (reset) {
      lastSize = size
      history = new Float32Array(px.length)
      blended = new Uint8Array(px.length)
      grid = new Float32Array(GW * GH * 3)
      raw = new Float32Array(GW * GH * 3)
      stale = new Uint8Array(cells)
      moved = new Uint8Array(cells)
      refit = new Uint8Array(cells)
      fitted = new Uint8Array(cells)
      fitChar = new Uint32Array(cells)
      fitFg = new Uint16Array(cells * 3)
      fitBg = new Uint16Array(cells * 3)
      // Pixel columns and rows of each cell, and the cell of each pixel column and row.
      colStart = Int32Array.from({ length: W + 1 }, (_, x) => Math.floor((x * PW) / W))
      rowStart = Int32Array.from({ length: H + 1 }, (_, y) => Math.floor((y * PH) / H))
      cellX = new Int32Array(PW)
      cellY = new Int32Array(PH)
      for (let x = 0; x < W; x++) cellX.fill(x, colStart[x], colStart[x + 1])
      for (let y = 0; y < H; y++) cellY.fill(y, rowStart[y], rowStart[y + 1])
      moving = new Uint8Array(cells)
      round = new Uint8Array(cells)
      edgeSeen = new Float32Array(cells * 24).fill(-1)
    }
    if (advanced) {
      markMoving(moving, touched, PW, PH, W, H)
      markOrbs(round, orbs, PW, PH, W, H)
      // Anything that changes every pixel's blend, or a frame without a list of what changed, blends every cell again.
      const blend = `${desaturate} ${shade} ${persistence}`
      const everything = reset || !dirty || !changed || px !== lastSource || blend !== lastBlend
      lastSource = px
      lastBlend = blend
      if (everything) stale.fill(1)
      else markCells(stale, changed, cellX, cellY, W, PW, PH)
      settle(px, blended, history, PW, W, H, colStart, rowStart, stale, moved, desaturate, shade, persistence, reset)
      if (reset || !dirty) moved.fill(1)
      regrid(blended, PW, PH, GW, GH, W, H, raw, grid, moved, refit)
    } else refit.fill(0)
    const { char, fg, bg } = buf.buffers

    if (frames++ % 10 === 0) {
      light = context.themeMode === "light"
      counts.clear()
      for (let i = 0; i < cells; i++) {
        const k = key(bg, i * 4)
        counts.set(k, (counts.get(k) ?? 0) + 1)
      }
      base = -2
      let best = 0
      for (const [k, n] of counts) if (n > best) ((best = n), (base = k))
      surfaces.clear()
      tints.clear()
      surfaces.add(base)
      for (const [k, n] of counts) if (k !== base && n > cells * 0.002 && isSurface(k, light)) surfaces.add(k)
    }
    const look = LEVELS[settings!.brightness ?? "normal"]
    const curve = light ? look.light : look.dark
    const refitAll = reset || !dirty || scrim !== lastScrim || curve !== lastCurve
    lastScrim = scrim
    lastCurve = curve

    // How near text each sub-pixel is, rebuilt only when the set of text cells changes.
    let reshaped = surface.length !== cells
    if (reshaped) {
      surface = new Uint8Array(cells)
      cellTint = new Int32Array(cells)
      shapes = new Uint8Array(cells)
      mask = new Float32Array(GW * GH)
    }
    if (previousMask.length !== cells) previousMask = new Int16Array(cells).fill(-1)
    if (olderMask.length !== cells) olderMask = new Int16Array(cells).fill(-1)
    for (let i = 0; i < cells; i++) {
      const k = key(bg, i * 4)
      const tint = tintOf(k)
      const on = tint !== NO_TINT
      surface[i] = on ? 1 : 0
      cellTint[i] = tint
      // 1 for text, 2 for a blank cell of a panel (a surface other than the base, such as a dialog), else 0.
      const shape = !on ? 0 : char[i] !== SPACE && !(isBlock(char[i]) && tintOf(fgKey(fg, i * 4)) !== NO_TINT) ? 1 : k !== base && tint === TINT_ZERO ? 2 : 0
      if (shapes[i] !== shape) ((shapes[i] = shape), (reshaped = true))
    }
    if (reshaped) buildNearText(shapes, mask, W, H)
    if (open.length !== cells) open = new Uint8Array(cells)
    openW = W
    for (let i = 0; i < cells; i++) open[i] = surface[i] && char[i] === SPACE && mask[((i / W) | 0) * 4 * GW + (i % W) * 2] < OPEN ? 1 : 0
    if (frames % MAP_EVERY === 1) {
      const cover = textMap.cover
      cover.fill(0)
      mapCount.fill(0)
      for (let i = 0; i < cells; i++) {
        const g = Math.floor((((i / W) | 0) * MAP_ROWS) / H) * MAP_COLS + Math.floor(((i % W) * MAP_COLS) / W)
        cover[g] += surface[i] ? mask[((i / W) | 0) * 4 * GW + (i % W) * 2] : 1
        mapCount[g]++
      }
      for (let g = 0; g < cover.length; g++) cover[g] /= Math.max(1, mapCount[g])
      mapped = true
      mapFresh = true
    }

    const cursor = renderer.getCursorState()
    const cursorX = cursor.visible ? cursor.x - 1 : -1
    const cursorY = cursor.visible ? cursor.y - 1 : -1
    const atCursor = (x: number, y: number) => cursor.visible && (x === cursorX || x === cursorX + 1) && (y === cursorY || y === cursorY + 1)

    // Real-pixel mode: empty surface cells show an actual image of the scene; everything else stays character cells.
    if (imageCell.length !== cells) imageCell = new Uint8Array(cells)
    imageCell.fill(0)
    if (pixels && layerPlaced && reservation !== 0) {
      // Only plain space cells are re-reserved: writing a marker over a space never touches shared glyph state.
      for (let i = 0; i < cells; i++) {
        if (!surface[i] || char[i] !== SPACE || atCursor(i % W, (i / W) | 0)) continue
        imageCell[i] = 1
        char[i] = reservation
      }
    }
    layerPlaced = false

    if (shownChar.length !== cells) {
      shownChar = new Uint32Array(cells)
      shownFg = new Uint16Array(cells * 4)
      shownBg = new Uint16Array(cells * 4)
      inputFg = new Uint16Array(cells * 4)
      inputBg = new Uint16Array(cells * 4)
    }
    inputFg.set(fg)
    inputBg.set(bg)
    const q = quad
    if (smooth) prepareEdges(grid, GW, GH, curve, edgeSeen, mask)
    for (let y = 0; y < H; y++) {
      const [deepR, deepG, deepB] = scrimAt(scrim, y / Math.max(1, H - 1), light)
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        // Cells where something moves fit differently (see tolerance), so they are never reused.
        const reusable = fitted[i] === 1 && !refitAll && refit[i] === 0 && moving[i] === 0 && dots.size[i] === 0
        fitted[i] = 0
        if (imageCell[i]) continue
        const o = i * 4
        const ch = char[i]
        const edgeTint = isBlock(ch) ? tintOf(fgKey(fg, o)) : NO_TINT
        const edge = edgeTint !== NO_TINT
        if (!surface[i] && !edge) continue
        const fits = !edge && ch === SPACE && !atCursor(x, y)
        // Same grid as when this cell was last fitted, and fitting is idempotent under hysteresis: reuse it.
        if (fits && reusable) {
          reuseFit(i, o, char, fg, bg, fitChar, fitFg, fitBg)
          fitted[i] = 1
          applyTint(bg, o, cellTint[i])
          if (char[i] !== SPACE) applyTint(fg, o, cellTint[i])
          continue
        }
        // Eight square sub-pixels per cell, 2 wide by 4 tall, in row-major order. The scrim darkens the whole scene
        // evenly, so text needs no backing of its own.
        const k = look.scrim
        for (let s = 0; s < 8; s++) {
          const g = (y * 4 + (s >> 1)) * GW + x * 2 + (s & 1)
          const a = g * 3
          q[s * 3] = curve[grid[a] | 0] * (1 - k) + deepR * k
          q[s * 3 + 1] = curve[grid[a + 1] | 0] * (1 - k) + deepG * k
          q[s * 3 + 2] = curve[grid[a + 2] | 0] * (1 - k) + deepB * k
        }
        if (edge && (ch === UPPER_HALF || ch === LOWER_HALF)) {
          const f = ch === UPPER_HALF ? 0 : 12
          const g = ch === UPPER_HALF ? 12 : 0
          for (let c = 0; c < 3; c++) fg[o + c] = (q[f + c] + q[f + 3 + c] + q[f + 6 + c] + q[f + 9 + c]) / 4
          fg[o + 3] = 255
          applyTint(fg, o, edgeTint)
          if (surface[i]) {
            for (let c = 0; c < 3; c++) bg[o + c] = (q[g + c] + q[g + 3 + c] + q[g + 6 + c] + q[g + 9 + c]) / 4
            bg[o + 3] = 255
            applyTint(bg, o, cellTint[i])
          }
          continue
        }
        if (edge) {
          for (let c = 0; c < 3; c++) fg[o + c] = mean8(q, c)
          fg[o + 3] = 255
          applyTint(fg, o, edgeTint)
          if (!surface[i]) continue
        }
        if (fits) {
          const was = previousMask[i]
          // A dot glyph where a still point of light falls on an otherwise flat cell; a cell with a point is fitted
          // afresh every frame, and once more after, since the point isn't part of the grid.
          if (dots.size[i] && placeDot(dots, i, x, y, q, grid, mask, GW, curve, was === DOT, char, fg, bg, o)) {
            previousMask[i] = DOT
            applyTint(bg, o, cellTint[i])
            applyTint(fg, o, cellTint[i])
            continue
          }
          if (dots.size[i]) lightDot(dots, i, x, y, q, grid, mask, GW, curve)
          if (octants) {
            const octant = writeOctant(q, order, was >= 0 && was < FIRST ? was : -1, olderMask[i], moving[i], char, fg, bg, i, o)
            // Soft cells keep their gradient band; still edges may take a smooth glyph instead of the octant, but not
            // where something moves (it would flip between wedge and octant as it glides) or over the sun and moon.
            previousMask[i] = smooth && !softFit && !round[i] && !moving[i] ? refineEdge(q, was, octant, char, fg, bg, i, o, x, y, deepR, deepG, deepB) : octant
          } else previousMask[i] = writeQuadrant(q, was, olderMask[i], moving[i], char, fg, bg, i, o)
          if (previousMask[i] !== was) olderMask[i] = was
          rememberFit(i, o, char, fg, bg, fitChar, fitFg, fitBg)
          // A fit made with a point lit in, or while something moved (see tolerance), isn't reused next frame.
          fitted[i] = dots.size[i] || moving[i] ? 0 : 1
          applyTint(bg, o, cellTint[i])
          if (char[i] !== SPACE) applyTint(fg, o, cellTint[i])
          continue
        }
        for (let c = 0; c < 3; c++) bg[o + c] = mean8(q, c)
        bg[o + 3] = 255
        applyTint(bg, o, cellTint[i])
      }
    }
    quieten(char, fg, bg, inputFg, inputBg, shownChar, shownFg, shownBg, cells)

    // Build next frame's image now; the back layer places it before OpenCode draws, so text lands on top.
    if (pixels && (advanced || !nextImage)) {
      const image = publishImage(blended, PW, PH, W, H, scrim, curve, look.scrim)
      if (image) {
        nextImage?.dispose()
        nextImage = image
      }
    }
    if (debug && frames % 30 === 0)
      log(`frame ${frames} pixels=${pixels} imageCells=${imageCell.reduce((n, v) => n + v, 0)} layer=${JSON.stringify(layerStats)} reservation=${reservation.toString(16)} resolution=${JSON.stringify(renderer.resolution)} kitty=${renderer.capabilities?.kitty_graphics}`)
  }

  // A new scene picks up what the agent is doing.
  const create = (next: Wallpaper, chosen: Settings) => {
    const created = next.create(chosen)
    if (busy) created.react?.("busy")
    if (failed) created.react?.("error")
    if (mapped) created.textMap?.(textMap)
    return created
  }

  // Clicks bubble up to the root after OpenCode's own handlers have run. This only watches them, so it never takes
  // one away: a plain left click that presses and lifts on the same open cell, outside overlays such as dialogs,
  // pokes the scene.
  const onMouse = (event: MouseEvent) => {
    if (event.button !== MouseButton.LEFT || event.modifiers.shift || event.modifiers.ctrl || event.modifiers.alt) return
    if (event.type !== "down" && event.type !== "up") return
    const cell = event.y * openW + event.x
    const clear = event.x >= 0 && event.x < openW && open[cell] === 1 && !event.isDragging && !inOverlay(event.target)
    if (event.type === "down") {
      pressed = clear ? cell : -1
      return
    }
    const hit = clear && pressed === cell
    pressed = -1
    log(`click ${event.x},${event.y} ${hit ? "pokes" : "ignored"}`)
    if (!hit || !scene?.poke) return
    scene.poke(((event.x + 0.5) / openW) * (scene.W / scene.H), (event.y + 0.5) / (open.length / openW))
    renderer.requestRender()
  }

  const engine: Engine = {
    get wallpaper() {
      return wallpaper
    },
    start(next, requested, seconds = FADE) {
      const chosen = settingsFor(next, requested)
      const shows = (w?: Wallpaper, s?: Settings) => w === next && s?.activity === chosen.activity && s.time === chosen.time
      // Only brightness changed: restyle the running scene.
      if (shows(wallpaper, settings)) {
        settings = chosen
        renderer.requestRender()
        return
      }
      if (scene) {
        // Going back to the outgoing scene reverses the fade. Otherwise the more visible of the two fades out.
        const back = shows(from?.wallpaper, from?.settings) ? from : undefined
        // Created first, so a scene that throws leaves the current one running.
        const incoming = back ? back.scene : create(next, chosen)
        if (back || !from || fade >= 0.5) from = { scene, wallpaper: wallpaper!, settings: settings! }
        scene = incoming
        fade = back ? 1 - fade : 0
        wallpaper = next
        settings = chosen
        fadeLength = seconds
        // Draws the first faded frame at once instead of waiting for the next step.
        lastTarget = ""
        return
      }
      const created = create(next, chosen)
      engine.stop()
      wallpaper = next
      settings = chosen
      scene = created
      renderer.addPostProcessFn(postProcess)
      lastStep = 0
      lastTarget = ""
      history = new Float32Array(0)
      previousMask = new Int16Array(0)
      olderMask = new Int16Array(0)
      shownChar = new Uint32Array(0)
      dirty = process.env.WALLPAPER_DIRTY !== "0"
      lastActivity = Date.now()
      focused = true
      schedule()
      renderer.on("focus", onFocus)
      renderer.on("blur", onBlur)
      renderer.stdin.on("data", onInput)
      unlisten = context.data.listen(wake)
      layer = (options.layer ?? createLayer)(renderer, drawLayer)
      // root.onMouse is a single slot: another plugin or OpenCode itself could replace it, which would end pokes.
      renderer.root.onMouse = onMouse
    },
    stop() {
      if (!scene) return
      wallpaper = undefined
      settings = undefined
      scene = undefined
      from = undefined
      renderer.removePostProcessFn(postProcess)
      schedule()
      renderer.off("focus", onFocus)
      renderer.off("blur", onBlur)
      renderer.stdin.off("data", onInput)
      unlisten?.()
      unlisten = undefined
      layer?.dispose()
      layer = undefined
      renderer.root.onMouse = undefined
      pressed = -1
      nextImage?.dispose()
      nextImage = undefined
      pool?.dispose()
      pool = undefined
      if (savedTransport !== undefined) renderer.kittyImageTransport = savedTransport
      savedTransport = undefined
      renderer.requestRender()
    },
    react(event) {
      log(`agent ${event}`)
      busy = event === "busy"
      failed = event === "error"
      clearTimeout(lifting)
      if (failed) lifting = setTimeout(() => engine.react("idle"), GLOOM_MS)
      scene?.react?.(event)
      from?.scene.react?.(event)
    },
    power(mode) {
      power = mode
      wake()
    },
  }
  return engine
}

// Dialogs, toasts and popups float above the UI with a positive zIndex; clicks on them are never pokes.
function inOverlay(target: Renderable | null) {
  for (let r = target; r; r = r.parent) if (r.zIndex > 0) return true
  return false
}

// The scrim color at a depth (0 top, 1 bottom), blending top to middle to bottom; in a light theme, a pale tint of it.
function scrimAt(scrim: Scrim, depth: number, light: boolean): RGB {
  const upper = depth < 0.5
  const from = upper ? scrim[0] : scrim[1]
  const to = upper ? scrim[1] : scrim[2]
  const t = upper ? depth * 2 : depth * 2 - 1
  const color: RGB = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t]
  if (!light) return color
  return [255 - (255 - color[0]) * LIGHT_SCRIM, 255 - (255 - color[1]) * LIGHT_SCRIM, 255 - (255 - color[2]) * LIGHT_SCRIM]
}

function blendScrim(a: Scrim, b: Scrim, t: number): Scrim {
  if (t === 1) return b
  const at = (i: number): RGB => [lerp(a[i][0], b[i][0], t), lerp(a[i][1], b[i][1], t), lerp(a[i][2], b[i][2], t)]
  return [at(0), at(1), at(2)]
}

// Smooth glyphs for octant terminals, which draw Symbols for Legacy Computing themselves (Ghostty, kitty): diagonal
// wedges and eighth blocks follow slanted and nearly straight edges where octants can only draw a 2x4 staircase.

// Whether a point of the cell (x right, y down, both 0 to 1) is foreground.
type Inside = (x: number, y: number) => boolean

// Below the line through (ax, ay) and (bx, by), extended across the cell: how Ghostty and kitty draw the smooth mosaics.
const below =
  (ax: number, ay: number, bx: number, by: number): Inside =>
  (x, y) =>
    y >= ay + ((by - ay) * (x - ax)) / (bx - ax)

const T1 = 1 / 3
const T2 = 2 / 3

// One glyph of each complementary pair: a two-color fit gets the other by swapping colors, so the upper mosaics
// (U+1FB52 to U+1FB67), upper and right eighths, and the inverted triangles are left out. Lower and left halves and
// quarters are octants already.
const GLYPHS: [number, Inside][] = [
  [0x1fb3c, below(0, T2, 0.5, 1)],
  [0x1fb3d, below(0, T2, 1, 1)],
  [0x1fb3e, below(0, T1, 0.5, 1)],
  [0x1fb3f, below(0, T1, 1, 1)],
  [0x1fb40, below(0, 0, 0.5, 1)],
  [0x1fb41, below(0, T1, 0.5, 0)],
  [0x1fb42, below(0, T1, 1, 0)],
  [0x1fb43, below(0, T2, 0.5, 0)],
  [0x1fb44, below(0, T2, 1, 0)],
  [0x1fb45, below(0, 1, 0.5, 0)],
  [0x1fb46, below(0, T2, 1, T1)],
  [0x1fb47, below(0.5, 1, 1, T2)],
  [0x1fb48, below(0, 1, 1, T2)],
  [0x1fb49, below(0.5, 1, 1, T1)],
  [0x1fb4a, below(0, 1, 1, T1)],
  [0x1fb4b, below(0.5, 1, 1, 0)],
  [0x1fb4c, below(0.5, 0, 1, T1)],
  [0x1fb4d, below(0, 0, 1, T1)],
  [0x1fb4e, below(0.5, 0, 1, T2)],
  [0x1fb4f, below(0, 0, 1, T2)],
  [0x1fb50, below(0.5, 0, 1, 1)],
  [0x1fb51, below(0, T1, 1, T2)],
  // ◣ ◢: the corner-to-corner diagonals.
  [0x25e3, below(0, 0, 1, 1)],
  [0x25e2, below(0, 1, 1, 0)],
  // 🭬 🭭 🭮 🭯: triangles from one edge to the center.
  [0x1fb6c, (x, y) => x <= 0.5 - Math.abs(y - 0.5)],
  [0x1fb6d, (x, y) => y <= 0.5 - Math.abs(x - 0.5)],
  [0x1fb6e, (x, y) => x >= 0.5 + Math.abs(y - 0.5)],
  [0x1fb6f, (x, y) => y >= 0.5 + Math.abs(x - 0.5)],
  // ▁ ▃ ▅ ▇ and ▏ ▎ ▍ ▋ ▊ ▉: eighths that octants can't draw.
  ...[1, 3, 5, 7].map((n): [number, Inside] => [0x2580 + n, (_x, y) => y >= 1 - n / 8]),
  ...[1, 2, 3, 5, 6, 7].map((n): [number, Inside] => [0x2590 - n, (x) => x < n / 8]),
]

// The shape of a smooth glyph, for drawing it (dev/cells.ts).
export const SHAPES = new Map(GLYPHS)

// How much of each sub-pixel a shape covers, on a grid of cols x rows sub-pixels per cell (row-major).
function measure(inside: Inside, cols: number, rows: number) {
  const steps = 16
  return Float32Array.from({ length: cols * rows }, (_, s) => {
    let n = 0
    for (let a = 0; a < steps; a++)
      for (let b = 0; b < steps; b++) if (inside(((s % cols) + (a + 0.5) / steps) / cols, (Math.floor(s / cols) + (b + 0.5) / steps) / rows)) n++
    return n / (steps * steps)
  })
}

// Each glyph's coverage of the cell's eight 2x4 sub-pixels, for its colors, and of a finer 4x8 grid for choosing it:
// there, minus its mean, and one over its sum of squares.
const N = GLYPHS.length
const COVER = new Float32Array(N * 8)
const FINE = new Float32Array(N * 32)
const CENTERED = new Float32Array(N * 32)
const INVERSE = new Float32Array(N)
GLYPHS.forEach(([, inside], k) => {
  COVER.set(measure(inside, 2, 4), k * 8)
  const fine = measure(inside, 4, 8)
  FINE.set(fine, k * 32)
  const mean = fine.reduce((a, b) => a + b) / 32
  fine.forEach((v, s) => (CENTERED[k * 32 + s] = v - mean))
  INVERSE[k] = 1 / fine.reduce((a, v) => a + (v - mean) ** 2, 0)
})

// Glyph ids at or above this are smooth glyphs (FIRST + index); below it they are octant masks.
export const FIRST = 256
// Cells whose sub-pixels span less than this in every channel keep their octant: only edges gain from smooth glyphs.
const EDGE = 24
// A smooth glyph must leave less than this share of the cell's variance unexplained, so that cells holding more than
// a two-color edge (a thin line, a corner, texture) keep their octant.
const CLEAN = 0.15
// How much of the octant's error a smooth glyph may leave.
const GAIN = 0.85
// Like writeOctant's hysteresis, on the finer grid: a cell keeps last frame's glyph while its error is within this of
// the best.
const RATIO = 1.35
const HYSTERESIS = 600

const bits = new Float32Array(32)
const near = new Float32Array(24 * 3)
const fine = new Float32Array(32 * 3)
const along = new Float32Array(32)
const low = new Float32Array(3)
const high = new Float32Array(3)
const fit = { fr: 0, fg: 0, fb: 0, br: 0, bg: 0, bb: 0, err: 0, worst: 0 }
const sampleErr = new Float32Array(32)
let grid: Float32Array = new Float32Array(0)
let GW = 0
let GH = 0
let curve: Uint8Array = new Uint8Array(256)
let seen: Float32Array = new Float32Array(0)
let scrim: Float32Array = new Float32Array(0)

// The frame's sub-pixel grid (2x4 per cell, RGB), tone curve and text scrim (one strength per sub-pixel), which
// refineEdge reads around each cell, and the engine's record of each cell's sub-pixels when its glyph was last chosen
// here (24 values per cell, -1 to start): most edges hold still, and keep their glyph cheaply.
export function prepareEdges(frame: Float32Array, width: number, height: number, tone: Uint8Array, record: Float32Array, cover: Float32Array) {
  grid = frame
  GW = width
  GH = height
  curve = tone
  seen = record
  scrim = cover
}

// Given the octant writeOctant chose for cell (x, y) from its sub-pixels q, looks for a smooth glyph that fits the
// cell better and writes it instead. Glyphs are compared on a 4x8 grid interpolated from the sub-pixels and their
// neighbors (toned and scrimmed like q), where a slanted edge is a slanted line rather than
// octants' staircase. Keeps last frame's glyph unless the new one is clearly better. Returns the glyph id used;
// writeOctant must have been given previous only if it was an octant.
export function refineEdge(q: Float32Array, previous: number, octant: number, char: Uint32Array, fg: Uint16Array, bg: Uint16Array, i: number, o: number, x: number, y: number, deepR: number, deepG: number, deepB: number) {
  if (octant === 0 || octant === 255) return octant
  let range = 0
  for (let c = 0; c < 3; c++) {
    low[c] = 255
    high[c] = 0
    for (let s = 0; s < 8; s++) {
      const v = q[s * 3 + c]
      if (v < low[c]) low[c] = v
      if (v > high[c]) high[c] = v
    }
    range = Math.max(range, high[c] - low[c])
  }
  if (range < EDGE) return octant
  let same = previous >= 0
  for (let s = 0; s < 24 && same; s++) same = Math.abs(q[s] - seen[i * 24 + s]) < 3
  if (same) return previous >= FIRST ? write(q, previous, char, fg, bg, i, o) : octant
  seen.set(q, i * 24)
  for (let ny = 0; ny < 6; ny++) {
    const row = Math.min(GH - 1, Math.max(0, y * 4 - 1 + ny)) * GW
    for (let nx = 0; nx < 4; nx++) {
      const g = row + Math.min(GW - 1, Math.max(0, x * 2 - 1 + nx))
      const a = g * 3
      const k = scrim[g]
      const n = (ny * 4 + nx) * 3
      near[n] = curve[grid[a] | 0] * (1 - k) + deepR * k
      near[n + 1] = curve[grid[a + 1] | 0] * (1 - k) + deepG * k
      near[n + 2] = curve[grid[a + 2] | 0] * (1 - k) + deepB * k
    }
  }
  // Bilinear: each fine sample mixes its sub-pixel with the nearer neighbors across, down and diagonally.
  for (let f = 0; f < 32; f++) {
    const sx = ((f & 3) >> 1) + 1
    const sy = (f >> 3) + 1
    const hx = sx + (f & 1 ? 1 : -1)
    const vy = sy + ((f >> 2) & 1 ? 1 : -1)
    for (let c = 0; c < 3; c++)
      fine[f * 3 + c] = near[(sy * 4 + sx) * 3 + c] * 0.5625 + (near[(sy * 4 + hx) * 3 + c] + near[(vy * 4 + sx) * 3 + c]) * 0.1875 + near[(vy * 4 + hx) * 3 + c] * 0.0625
    bits[f] = (octant >> ((f >> 3) * 2 + ((f & 3) >> 1))) & 1
  }
  fitCover(fine, 32, bits, 0)
  const octantErr = fit.err
  const octantWorst = fit.worst
  // Rank glyphs along the axis between the octant's two colors; for colors on that axis this is the least squares fit.
  for (let f = 0; f < 32; f++) along[f] = fine[f * 3] * (fit.fr - fit.br) + fine[f * 3 + 1] * (fit.fg - fit.bg) + fine[f * 3 + 2] * (fit.fb - fit.bb)
  let best = 0
  let score = -1
  for (let k = 0; k < N; k++) {
    let dot = 0
    for (let f = 0; f < 32; f++) dot += CENTERED[k * 32 + f] * along[f]
    const v = dot * dot * INVERSE[k]
    if (v > score) ((score = v), (best = k))
  }
  fitCover(fine, 32, FINE, best * 32)
  const smoothErr = fit.err
  const smoothWorst = fit.worst
  if (previous >= FIRST) {
    fitCover(fine, 32, FINE, (previous - FIRST) * 32)
    if (fit.err <= Math.min(octantErr, smoothErr) * RATIO + HYSTERESIS && fit.worst <= octantWorst * RATIO + HYSTERESIS) return write(q, previous, char, fg, bg, i, o)
  } else if (previous === octant && octantErr <= smoothErr * RATIO + HYSTERESIS) return octant
  // A wedge must fit the edge clearly better overall and nowhere worse than the octant: on thin or spiky shapes it
  // would cut a notch through a sub-pixel the octant gets right.
  if (smoothErr >= octantErr * GAIN || smoothErr > total(fine) * CLEAN || smoothWorst > octantWorst) return octant
  return write(q, FIRST + best, char, fg, bg, i, o)
}

// The squared error of drawing the 32 fine samples as their mean color.
function total(samples: Float32Array) {
  let err = 0
  for (let c = 0; c < 3; c++) {
    let avg = 0
    for (let s = 0; s < 32; s++) avg += samples[s * 3 + c] / 32
    for (let s = 0; s < 32; s++) err += (samples[s * 3 + c] - avg) ** 2
  }
  return err
}

// Writes a smooth glyph with the colors that best fit the cell's own sub-pixels.
function write(q: Float32Array, id: number, char: Uint32Array, fg: Uint16Array, bg: Uint16Array, i: number, o: number) {
  fitCover(q, 8, COVER, (id - FIRST) * 8)
  char[i] = GLYPHS[id - FIRST][0]
  fg[o] = fit.fr
  fg[o + 1] = fit.fg
  fg[o + 2] = fit.fb
  fg[o + 3] = 255
  bg[o] = fit.br
  bg[o + 1] = fit.bg
  bg[o + 2] = fit.bb
  bg[o + 3] = 255
  return id
}

// Least squares foreground and background for n samples covered cover[at..at+n] by the glyph, kept within the cell's
// own color range, and the squared error left.
function fitCover(samples: Float32Array, n: number, cover: Float32Array, at: number) {
  let mean = 0
  for (let s = 0; s < n; s++) mean += cover[at + s] / n
  let spread = 0
  for (let s = 0; s < n; s++) spread += (cover[at + s] - mean) ** 2
  let err = 0
  sampleErr.fill(0, 0, n)
  for (let c = 0; c < 3; c++) {
    let avg = 0
    let dot = 0
    for (let s = 0; s < n; s++) {
      avg += samples[s * 3 + c] / n
      dot += (cover[at + s] - mean) * samples[s * 3 + c]
    }
    const slope = spread > 0 ? dot / spread : 0
    const b = Math.min(high[c], Math.max(low[c], avg - slope * mean))
    const f = Math.min(high[c], Math.max(low[c], avg - slope * mean + slope))
    for (let s = 0; s < n; s++) sampleErr[s] += (samples[s * 3 + c] - b - cover[at + s] * (f - b)) ** 2
    if (c === 0) ((fit.fr = f), (fit.br = b))
    if (c === 1) ((fit.fg = f), (fit.bg = b))
    if (c === 2) ((fit.fb = f), (fit.bb = b))
  }
  let worst = 0
  for (let s = 0; s < n; s++) {
    err += sampleErr[s]
    if (sampleErr[s] > worst) worst = sampleErr[s]
  }
  fit.err = err
  fit.worst = worst
}

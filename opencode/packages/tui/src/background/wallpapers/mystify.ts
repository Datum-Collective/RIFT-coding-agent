import { Canvas } from "../src/canvas"
import { eggWait } from "../src/egg"
import { TAU, clamp, hsv, lerp, rand, smoothstep, type RGB } from "../src/math"
import { touch } from "../src/touched"
import type { Activity, Settings, Time, Wallpaper } from "../src/wallpaper"

// The scene runs slower than real time, which keeps it calm behind text.
const TIME_SCALE = 0.35
// Corners per polygon: each moves on its own and bounces off the screen's edges.
const CORNERS = 4
// The egg, the old Bezier screensaver: the edges bow into curves for this many scene seconds.
const BEZIER = 14
// Segments per corner while the edges are curved.
const CURVE = 8

// Everything that changes with the time of day. Hues are fractions of the color wheel; day drifts all the way round,
// sunset and night swing back and forth between `from` and `to`. Never white or gray: the text on top is white.
interface Look {
  sky: [number, RGB][]
  from: number
  to: number
  cycle: boolean
  saturation: number
  value: number
}

const LOOKS: Record<Time, Look> = {
  // The classic black desktop with bright, saturated lines.
  day: {
    sky: [
      [0, [0.003, 0.003, 0.004]],
      [1, [0.001, 0.001, 0.002]],
    ],
    from: 0,
    to: 1,
    cycle: true,
    saturation: 0.95,
    value: 1,
  },
  // Deep plum, the lines amber, rose and gold.
  sunset: {
    sky: [
      [0, [0.04, 0.008, 0.034]],
      [0.6, [0.02, 0.004, 0.018]],
      [1, [0.006, 0.001, 0.006]],
    ],
    from: -0.08,
    to: 0.12,
    cycle: false,
    saturation: 1,
    value: 0.95,
  },
  // Navy-black, the lines teal, cobalt and violet.
  night: {
    sky: [
      [0, [0.003, 0.006, 0.022]],
      [1, [0.0005, 0.001, 0.005]],
    ],
    from: 0.47,
    to: 0.77,
    cycle: false,
    saturation: 0.95,
    value: 1,
  },
}

// Per activity: polygons, their corners' speed in screen heights per scene second, echoes in each stack, and the
// distance between echoes at a corner's usual speed. Every line moves a little each frame and the terminal redraws
// the cells it crosses; the lines reach across the screen, so the corners move slowly and the echoes stack closely.
const CAST: Record<Activity, { count: number; speed: number; echoes: number; spacing: number }> = {
  calm: { count: 1, speed: 0.012, echoes: 6, spacing: 0.026 },
  lively: { count: 2, speed: 0.014, echoes: 6, spacing: 0.026 },
  teeming: { count: 3, speed: 0.016, echoes: 7, spacing: 0.026 },
}
// History samples per echo gap; echoes read between samples, so the stack glides.
const SAMPLES = 4

// A polygon: its corners unfolded (x, y per corner; the screen position folds them back between the screen's edges,
// so bouncing is exact), their velocities and the decaying push of a click, a ring of past corner positions for the
// echoes, its place on the color wheel, and a life for the copies a finished task brings.
interface Poly {
  u: Float64Array
  v: Float64Array
  kick: Float64Array
  ring: Float64Array
  head: number
  hue: number
  life: number
  age: number
}

const VALUES = CORNERS * 2

class Mystify extends Canvas {
  private readonly look: Look
  private readonly cast: (typeof CAST)[Activity]
  // Scene seconds between echoes and between history samples, the scene clock and the next sample's time.
  private readonly gap: number
  private readonly sample: number
  private time = 0
  private next = 0
  private polys: Poly[] = []
  private flash = 0
  private placed = false
  private bezier = { wait: eggWait() * TIME_SCALE, t: -1 }
  private readonly prev = new Float64Array(VALUES)
  private readonly at = new Float64Array(CORNERS * 2)
  private readonly mids = new Float64Array(CORNERS * 2)

  constructor(settings: Settings) {
    super()
    this.supersample = 1
    this.look = LOOKS[settings.time]
    this.cast = CAST[settings.activity]
    this.gap = this.cast.spacing / this.cast.speed
    this.sample = this.gap / SAMPLES
    this.polys = Array.from({ length: this.cast.count }, (_, i) => this.poly(i))
  }

  private poly(i: number, life = Infinity): Poly {
    const f: Poly = {
      u: new Float64Array(VALUES),
      v: new Float64Array(VALUES),
      kick: new Float64Array(VALUES),
      ring: new Float64Array((this.cast.echoes * SAMPLES + 2) * CORNERS * 2),
      head: 0,
      hue: [0.2, 0.7, 0.45][i % 3] + rand(-0.03, 0.03),
      life,
      age: 0,
    }
    // One corner in each quarter of the screen, so every polygon starts out spanning it (x is a fraction of the width
    // until layout() knows it).
    const turn = Math.floor(rand(0, CORNERS))
    for (let c = 0; c < CORNERS; c++) {
      const heading = rand(0, TAU)
      const speed = this.cast.speed * rand(0.7, 1.3)
      const q = (c + turn) % CORNERS
      f.u[c * 2] = (q === 1 || q === 2 ? 0.5 : 0) + rand(0.04, 0.46)
      f.u[c * 2 + 1] = (q >= 2 ? 0.5 : 0) + rand(0.04, 0.46)
      f.v[c * 2] = Math.cos(heading) * speed
      f.v[c * 2 + 1] = Math.sin(heading) * speed
    }
    return f
  }

  // Fills a polygon's history as if it had always moved at its present velocity.
  private rewind(f: Poly) {
    const n = f.ring.length / (CORNERS * 2)
    f.head = 0
    for (let s = 0; s < n; s++) {
      const back = s * this.sample + (this.time - this.next + this.sample)
      for (let k = 0; k < VALUES; k++) this.prev[k] = f.u[k] - f.v[k] * back
      this.corners(this.prev, f.ring, s * CORNERS * 2)
    }
  }

  // Screen positions (in screen heights) of the corners for the unfolded values u, into out at o.
  private corners(u: Float64Array, out: Float64Array, o: number) {
    for (let k = 0; k < VALUES; k++) out[o + k] = fold(u[k], k & 1 ? 1 : this.A)
  }

  step(dt: number) {
    dt = clamp(dt, 0, 0.1) * TIME_SCALE
    const start = this.time
    this.time += dt
    this.stepGloom(dt)
    this.flash = Math.max(0, this.flash - dt)
    // After an error the lines slow.
    const pace = 1 - 0.6 * this.gloom
    const decay = Math.exp(-dt / 2)
    for (const f of this.polys) {
      f.age += dt
      f.hue += (dt / 60) * (1 + 6 * smoothstep(0, 1, this.flash))
      for (let k = 0; k < VALUES; k++) {
        f.u[k] += (f.v[k] + f.kick[k]) * dt * pace
        f.kick[k] *= decay
      }
    }
    // Samples at exact intervals, worked out between the positions before and after this step.
    for (; this.next <= this.time; this.next += this.sample) {
      const back = this.time - this.next
      for (const f of this.polys) {
        const n = f.ring.length / (CORNERS * 2)
        f.head = (f.head + n - 1) % n
        for (let k = 0; k < VALUES; k++) this.prev[k] = f.u[k] - (f.v[k] + f.kick[k]) * back * pace
        this.corners(this.prev, f.ring, f.head * CORNERS * 2)
      }
    }
    this.polys = this.polys.filter((f) => f.age < f.life)
    this.stepBezier(dt)
  }

  render() {
    this.restore()
    const { H, look } = this
    // On terminal cells the lines are wider and soft-edged: a crisp line gliding across a cell's sub-pixels keeps
    // flipping its glyph, while a soft one mostly shifts colors.
    const width = this.cells ? 0.8 : Math.max(0.5, 0.0024 * H)
    const soft = this.cells ? 3.5 : 1
    const curve = this.bezier.t < 0 ? 0 : smoothstep(0, 2, this.bezier.t) * smoothstep(BEZIER, BEZIER - 2, this.bezier.t)
    const flash = smoothstep(0, 1, this.flash)
    const dim = 1 - 0.5 * this.gloom
    const echoes = this.cast.echoes
    // How far the newest sample is behind the present, in samples.
    const lag = clamp(1 - (this.next - this.time) / this.sample, 0, 1)
    for (const f of this.polys) {
      const grow = f.life === Infinity ? 1 : smoothstep(0, 1, f.age) * smoothstep(f.life, f.life - 2, f.age)
      if (grow <= 0.01) continue
      const n = f.ring.length / (CORNERS * 2)
      // Oldest first, so newer echoes draw over older ones; echo e is e gaps behind the present.
      for (let e = echoes - 1; e >= 0; e--) {
        if (e === 0) this.corners(f.u, this.at, 0)
        if (e > 0) {
          const s = e * SAMPLES - lag
          const i = Math.floor(s)
          const t = s - i
          const a = ((f.head + i) % n) * CORNERS * 2
          const b = ((f.head + i + 1) % n) * CORNERS * 2
          for (let k = 0; k < CORNERS * 2; k++) this.at[k] = lerp(f.ring[a + k], f.ring[b + k], t)
        }
        for (let k = 0; k < CORNERS * 2; k++) this.at[k] *= H
        const hue = f.hue - e * 0.01
        const base = look.cycle ? hsv(hue, look.saturation, look.value) : hsv(lerp(look.from, look.to, 0.5 - 0.5 * Math.cos(hue * TAU)), look.saturation, look.value)
        const rainbow = hsv(f.hue * 3 + e * 0.09, 0.9, look.value * 1.1)
        const a = grow * dim * (1 - (0.6 * e) / echoes)
        const color: RGB = [lerp(base[0], rainbow[0], flash) * a, lerp(base[1], rainbow[1], flash) * a, lerp(base[2], rainbow[2], flash) * a]
        this.outline(width, soft, color, curve)
      }
    }
    this.finish()
  }

  // Draws the polygon in this.at, its edges bowed toward a closed curve by `curve` (0 straight).
  private outline(width: number, soft: number, color: RGB, curve: number) {
    const { hdr, W, H, mids } = this
    const points = this.at
    if (curve <= 0.01) {
      for (let c = 0; c < CORNERS; c++) {
        const d = ((c + 1) % CORNERS) * 2
        stroke(hdr, W, H, points[c * 2], points[c * 2 + 1], points[d], points[d + 1], width, soft, color[0], color[1], color[2])
      }
      return
    }
    for (let c = 0; c < CORNERS; c++) {
      const d = ((c + 1) % CORNERS) * 2
      mids[c * 2] = (points[c * 2] + points[d]) / 2
      mids[c * 2 + 1] = (points[c * 2 + 1] + points[d + 1]) / 2
    }
    // Around each corner, from the middle of the edge before to the middle of the edge after: straight through the
    // corner, or a quadratic curve that only bends toward it.
    for (let c = 0; c < CORNERS; c++) {
      const m0 = ((c + CORNERS - 1) % CORNERS) * 2
      const m1 = c * 2
      let x0 = mids[m0]
      let y0 = mids[m0 + 1]
      for (let s = 1; s <= CURVE; s++) {
        const t = s / CURVE
        const sx = t < 0.5 ? lerp(mids[m0], points[c * 2], t * 2) : lerp(points[c * 2], mids[m1], t * 2 - 1)
        const sy = t < 0.5 ? lerp(mids[m0 + 1], points[c * 2 + 1], t * 2) : lerp(points[c * 2 + 1], mids[m1 + 1], t * 2 - 1)
        const bx = (1 - t) * (1 - t) * mids[m0] + 2 * t * (1 - t) * points[c * 2] + t * t * mids[m1]
        const by = (1 - t) * (1 - t) * mids[m0 + 1] + 2 * t * (1 - t) * points[c * 2 + 1] + t * t * mids[m1 + 1]
        const x1 = lerp(sx, bx, curve)
        const y1 = lerp(sy, by, curve)
        stroke(hdr, W, H, x0, y0, x1, y1, width, soft, color[0], color[1], color[2])
        x0 = x1
        y0 = y1
      }
    }
  }

  // A finished task: the colors race through the rainbow and each polygon splits off a copy for a while.
  protected override visit() {
    this.flash = 3
    if (this.polys.length > this.cast.count * 2) return
    for (const parent of this.polys.slice(0, this.cast.count)) {
      const f = this.poly(this.polys.length, 7)
      f.u.set(parent.u)
      for (let k = 0; k < VALUES; k++) f.v[k] = k & 1 ? parent.v[k] : -parent.v[k]
      f.hue = parent.hue + 0.5
      this.rewind(f)
      this.polys.push(f)
    }
  }

  // A click flings the nearest corner away from it.
  poke(x: number, y: number) {
    let best: Poly | undefined
    let corner = 0
    let least = Infinity
    for (const f of this.polys) {
      this.corners(f.u, this.at, 0)
      for (let c = 0; c < CORNERS; c++) {
        const d = Math.hypot(this.at[c * 2] - x, this.at[c * 2 + 1] - y)
        if (d >= least) continue
        least = d
        best = f
        corner = c
      }
    }
    if (!best) return
    this.corners(best.u, this.at, 0)
    const dx = this.at[corner * 2] - x
    const dy = this.at[corner * 2 + 1] - y
    const l = Math.hypot(dx, dy) || 1
    // Screen directions map to unfolded ones through the fold's slope where the corner is.
    const k = corner * 2
    const sx = slope(best.u[k], this.A)
    const sy = slope(best.u[k + 1], 1)
    const speed = Math.hypot(best.v[k], best.v[k + 1])
    best.v[k] = (sx * dx * speed) / l
    best.v[k + 1] = (sy * dy * speed) / l
    best.kick[k] = (sx * dx * speed * 5) / l
    best.kick[k + 1] = (sy * dy * speed * 5) / l
  }

  protected override layout() {
    const { W, H, hdr } = this
    // Corners start spread across the width once the screen's shape is known.
    if (!this.placed)
      for (const f of this.polys) {
        for (let c = 0; c < CORNERS; c++) f.u[c * 2] *= this.A
        this.rewind(f)
      }
    this.placed = true
    const stops = this.look.sky
    for (let y = 0; y < H; y++) {
      const v = (y + 0.5) / H
      const i = stops.findIndex(([at]) => at >= v)
      const [a, from] = stops[Math.max(0, i - 1)]
      const [b, to] = stops[i < 0 ? stops.length - 1 : i]
      const k = b > a ? smoothstep(a, b, v) : 1
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 3
        hdr[o] = lerp(from[0], to[0], k)
        hdr[o + 1] = lerp(from[1], to[1], k)
        hdr[o + 2] = lerp(from[2], to[2], k)
      }
    }
  }

  private stepBezier(dt: number) {
    const b = this.bezier
    if (b.t < 0) {
      b.wait -= dt
      if (b.wait <= 0) b.t = 0
      return
    }
    b.t += dt
    if (b.t < BEZIER) return
    b.t = -1
    b.wait = eggWait(true) * TIME_SCALE
  }
}

// Folds an unfolded coordinate back between 0 and span, as if it had bounced off both ends.
function fold(u: number, span: number) {
  const m = (((u % (2 * span)) + 2 * span) % (2 * span))
  return m < span ? m : 2 * span - m
}

// Which way the folded coordinate moves as u grows: 1 or -1.
function slope(u: number, span: number) {
  return (((u % (2 * span)) + 2 * span) % (2 * span)) < span ? 1 : -1
}

// An anti-aliased straight line from (ax, ay) to (bx, by) in pixels, `width` pixels from its middle to the middle of
// an edge that fades over `soft` pixels, mixed over the scene. Marks what it draws in short runs along the line, so only the blocks it crosses
// are worked out again.
function stroke(hdr: Float32Array, W: number, H: number, ax: number, ay: number, bx: number, by: number, width: number, soft: number, r: number, g: number, b: number) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-6) return
  const reach = width + soft
  const steep = Math.abs(dy) > Math.abs(dx)
  // Walk the longer axis; across it, cover the band where the line is within reach.
  const m0 = steep ? ay : ax
  const m1 = steep ? by : bx
  const n0 = steep ? ax : ay
  const n1 = steep ? bx : by
  const across = reach * Math.sqrt(len2) / Math.abs(m1 - m0)
  const lo = Math.max(0, Math.floor(Math.min(m0, m1) - reach))
  const hi = Math.min((steep ? H : W) - 1, Math.ceil(Math.max(m0, m1) + reach))
  const limit = (steep ? W : H) - 1
  const inv = 1 / len2
  let run = lo
  let runLo = Infinity
  let runHi = -Infinity
  for (let m = lo; m <= hi; m++) {
    const t = clamp((m + 0.5 - m0) / (m1 - m0), 0, 1)
    const c = n0 + (n1 - n0) * t - 0.5
    const a0 = Math.max(0, Math.floor(c - across))
    const a1 = Math.min(limit, Math.ceil(c + across))
    for (let n = a0; n <= a1; n++) {
      const px = (steep ? n : m) + 0.5
      const py = (steep ? m : n) + 0.5
      const s = clamp(((px - ax) * dx + (py - ay) * dy) * inv, 0, 1)
      const ex = ax + dx * s - px
      const ey = ay + dy * s - py
      const cover = clamp((width + soft / 2 - Math.sqrt(ex * ex + ey * ey)) / soft, 0, 1)
      if (cover <= 0) continue
      const o = ((steep ? m : n) * W + (steep ? n : m)) * 3
      hdr[o] += (r - hdr[o]) * cover
      hdr[o + 1] += (g - hdr[o + 1]) * cover
      hdr[o + 2] += (b - hdr[o + 2]) * cover
    }
    runLo = Math.min(runLo, a0)
    runHi = Math.max(runHi, a1)
    if (m - run < 7 && m < hi) continue
    if (runHi >= runLo) touch(hdr, steep ? runLo : run, steep ? run : runLo, steep ? runHi : m, steep ? m : runHi)
    run = m + 1
    runLo = Infinity
    runHi = -Infinity
  }
}

export const mystify: Wallpaper = {
  id: "mystify",
  name: "Mystify",
  description: "The old screensaver: bright polygons whose corners glide and bounce off the edges, trailing stacks of echoes",
  fixedTime: "day",
  activity: {
    calm: "One polygon drifting slowly",
    lively: "The classic pair, in two colors",
    teeming: "Three polygons, a little quicker, with longer trails",
  },
  scrim: {
    day: [
      [4, 4, 6],
      [3, 3, 5],
      [2, 2, 4],
    ],
    sunset: [
      [30, 8, 26],
      [20, 5, 18],
      [8, 2, 8],
    ],
    night: [
      [2, 4, 16],
      [1, 3, 12],
      [0, 1, 5],
    ],
  },
  create: (settings) => new Mystify(settings),
}

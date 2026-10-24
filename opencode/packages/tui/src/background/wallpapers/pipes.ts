import { Canvas } from "../src/canvas"
import { eggWait } from "../src/egg"
import { clamp, lerp, rand, smoothstep, type RGB } from "../src/math"
import type { Activity, Settings, Time, Wallpaper } from "../src/wallpaper"

// The scene runs slower than real time, which keeps it calm behind text.
const TIME_SCALE = 0.35
// The grid the pipes grow through, in cells: GY tall, GZ deep, and as wide as the screen's shape asks, up to GXM. The
// camera sits at the origin looking down +z at the grid's near face, Z0 cells away, which just overfills the screen.
const GY = 8
const GZ = 12
const GXM = 40
const Z0 = 5
const FOCAL = (0.5 * Z0) / (GY * 0.45)
// Pipe, ball joint and bend radii in cells.
const PIPE = 0.15
const BALL = 0.23
const BEND = 0.5
// Subsamples per pixel along each axis in the pipe buffer, for anti-aliased edges.
const SS = 2
// Pending pipe pixels are tracked in blocks this many pixels square, and folded into the background now and then.
const BLOCK = 8
const BAKE_FRAMES = 45
// The share of the grid filled, and the scene seconds, after which the pipes fade out and start again.
const FULL = 0.45
const FADE = 1
// Direction vectors for +x, -x, +y, -y, +z, -z (y down, z away from the camera).
const DX = [1, -1, 0, 0, 0, 0]
const DY = [0, 0, 1, -1, 0, 0]
const DZ = [0, 0, 0, 0, 1, -1]
const CYL = 0
const BALLS = 1
const ARC = 2

// The classic colors: teal, green, orange, yellow, gray, red, blue and violet.
const COLORS: RGB[] = [
  [0.2, 0.75, 0.75],
  [0.12, 0.58, 0.08],
  [0.95, 0.34, 0.04],
  [1, 0.7, 0.04],
  [0.52, 0.52, 0.55],
  [0.85, 0.06, 0.05],
  [0.09, 0.25, 0.95],
  [0.5, 0.1, 0.8],
]
// The teal and green come up most often, as in the original.
const PICKS = [0, 0, 0, 1, 1, 1, 2, 3, 4, 5, 6, 7]

interface Look {
  // The background, top to bottom.
  sky: [RGB, RGB]
  // The key light's color, the ambient share, the glint's color and how much of the pipe's color it takes, a soft
  // fill on the rims, how far the far end fades toward the background, and a tint for the pipe colors.
  key: RGB
  ambient: number
  glint: RGB
  glintTint: number
  fill: RGB
  fog: number
  tint: RGB
}

const LOOKS: Record<Time, Look> = {
  // The classic black screen with bright pipes under a strong white light.
  day: {
    sky: [
      [0.002, 0.002, 0.003],
      [0.001, 0.001, 0.0015],
    ],
    key: [1.1, 1.08, 1.02],
    ambient: 0.14,
    glint: [1, 0.98, 0.94],
    glintTint: 0.15,
    fill: [0.02, 0.03, 0.04],
    fog: 0.4,
    tint: [1, 1, 1],
  },
  // A deep plum glowing to embers at the bottom, under a low, warm light.
  sunset: {
    sky: [
      [0.06, 0.012, 0.05],
      [0.085, 0.022, 0.006],
    ],
    key: [1.15, 0.82, 0.58],
    ambient: 0.14,
    glint: [1, 0.62, 0.3],
    glintTint: 0.45,
    fill: [0.3, 0.05, 0.18],
    fog: 0.45,
    tint: [1.05, 0.95, 0.88],
  },
  // Navy to black, each pipe's glint its own color edged with cobalt: never white.
  night: {
    sky: [
      [0.003, 0.006, 0.024],
      [0.0006, 0.0012, 0.005],
    ],
    key: [0.62, 0.72, 1],
    ambient: 0.09,
    glint: [0.16, 0.36, 1.05],
    glintTint: 0.65,
    fill: [0.02, 0.1, 0.3],
    fog: 0.5,
    tint: [0.78, 0.84, 1],
  },
}

// A piece of pipe as it grows: a cylinder from (x, y, z) along direction d, ext cells long; a ball (or one of the
// teapot's ellipsoids) at (x, y, z), squashed by ky; or a bend through a cell from the face it entered by (dir e2) to
// the one it leaves by (opposite e1), around (x, y, z), ext radians along. drawn is how much is in the pipe buffer.
interface Prim {
  kind: number
  x: number
  y: number
  z: number
  d: number
  e1: number
  e2: number
  r: number
  ky: number
  ext: number
  full: number
  drawn: number
  color: RGB
}

// A pipe working through its current cell (i, j, k): entered heading dIn (-1 where it starts), leaving heading dOut
// (-1 where it ends), u of the way through. pieces are that cell's prims.
interface Pipe {
  i: number
  j: number
  k: number
  dIn: number
  dOut: number
  u: number
  bend: boolean
  length: number
  max: number
  color: RGB
  pieces: Prim[]
  done: boolean
}

class Pipes extends Canvas {
  private time = 0
  private readonly activity: Activity
  private readonly look: Look
  private readonly speed: number
  private readonly count: number
  private readonly bends: number
  private readonly limit: number
  private pipes: Pipe[] = []
  private waits: number[] = []
  private prims: Prim[] = []
  private fresh: Prim[] = []
  private readonly grid = new Uint8Array(GXM * GY * GZ)
  private filled = 0
  private gx = GY * 2
  private cycle = 0
  private fade = -1
  private burst = 0
  private egg = eggWait() * TIME_SCALE
  private teapot = false
  private grown = false
  // The pipe buffer: subsample colors and depths, the background per subsample row, and pending blocks.
  private samples = new Float32Array(0)
  private depth = new Float32Array(0)
  private rows = new Float32Array(0)
  private base = new Float32Array(0)
  private pending = new Uint8Array(0)
  private pendingCount = 0
  private sinceBake = 0
  private readonly shade = new Float32Array(16)
  private readonly box = new Float32Array(4)
  private readonly spine = new Float32Array(9)

  constructor(settings: Settings) {
    super()
    this.supersample = 1
    this.activity = settings.activity
    this.look = LOOKS[settings.time]
    this.speed = { calm: 0.2, lively: 0.375, teeming: 0.7 }[this.activity]
    this.count = { calm: 1, lively: 3, teeming: 6 }[this.activity]
    this.bends = { calm: 0, lively: 0.1, teeming: 0.35 }[this.activity]
    this.limit = { calm: 1200, lively: 800, teeming: 520 }[this.activity]
    this.waits = Array.from({ length: this.count }, (_, i) => (i === 0 ? 0 : rand(1, 4) * i))
  }

  step(dt: number) {
    dt = clamp(dt, 0, 0.1) * TIME_SCALE
    this.time += dt
    this.stepGloom(dt)
    if (!this.grown) return
    this.egg -= dt
    if (this.egg <= 0 && !this.teapot) this.teapot = true
    if (this.fade >= 0) {
      this.fade += dt / FADE
      if (this.fade >= 1) this.clear()
      return
    }
    this.cycle += dt
    this.burst = Math.max(0, this.burst - dt)
    this.grow(dt * (1 - 0.9 * this.gloom) * (1 + 4 * smoothstep(0, 1, this.burst)))
    if (this.filled > FULL * this.gx * GY * GZ || this.cycle > this.limit) this.fade = 0
  }

  render() {
    this.restore()
    const { W, H } = this
    for (const p of this.fresh) this.draw(p)
    this.fresh = this.fresh.filter((p) => p.drawn < p.full)
    this.sinceBake++
    if (this.pendingCount && (this.sinceBake >= BAKE_FRAMES || this.fade >= 0)) {
      resolve(this.samples, this.background, W, H, 0, 0, W - 1, H - 1)
      this.pending.fill(0)
      this.pendingCount = 0
      this.sinceBake = 0
      this.hdr.set(this.background)
      this.rebake()
    }
    const bw = Math.ceil(W / BLOCK)
    const bh = Math.ceil(H / BLOCK)
    for (let by = 0; by < bh; by++)
      for (let bx = 0; bx < bw; bx++) {
        if (!this.pending[by * bw + bx]) continue
        let end = bx
        while (end + 1 < bw && this.pending[by * bw + end + 1]) end++
        const x0 = bx * BLOCK
        const y0 = by * BLOCK
        const x1 = Math.min(W, (end + 1) * BLOCK) - 1
        const y1 = Math.min(H, (by + 1) * BLOCK) - 1
        resolve(this.samples, this.hdr, W, H, x0, y0, x1, y1)
        this.touch(x0, y0, x1, y1)
        bx = end
      }
    if (this.fade >= 0) {
      dim(this.hdr, this.base, smoothstep(0, 1, this.fade))
      this.touch(0, 0, W - 1, H - 1)
    }
    this.finish()
  }

  // A finished task: every growing pipe races ahead for a moment, and a couple more join in.
  protected override visit() {
    if (this.fade >= 0) return
    this.burst = 3
    for (let n = 0; n < 2 && this.pipes.length < this.count + 3; n++) this.sprout()
  }

  // A click sprouts a new pipe at the nearest free cell under the pointer.
  poke(x: number, y: number) {
    if (this.fade >= 0 || this.pipes.length >= this.count + 4) return
    const rx = (x - this.A / 2) / FOCAL
    const ry = (y - 0.5) / FOCAL
    for (let k = 1; k < GZ; k++) {
      const z = Z0 + k
      const i = Math.round(rx * z + (GXM - 1) / 2)
      const j = Math.round(ry * z + (GY - 1) / 2)
      if (!this.inside(i, j, k) || this.grid[this.cell(i, j, k)]) continue
      this.start(i, j, k)
      return
    }
  }

  protected override layout() {
    const { W, H, look } = this
    this.gx = Math.min(GXM, Math.max(4, Math.round(this.A * GY)))
    // Grow the scene a while before the first frame, so it never opens on an empty screen.
    if (!this.grown) {
      this.grown = true
      for (let t = { calm: 400, lively: 120, teeming: 56 }[this.activity]; t > 0; t -= 0.05) this.grow(0.05)
    }
    for (let y = 0; y < H; y++) {
      const k = smoothstep(0, 1, (y + 0.5) / H)
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 3
        this.hdr[o] = lerp(look.sky[0][0], look.sky[1][0], k)
        this.hdr[o + 1] = lerp(look.sky[0][1], look.sky[1][1], k)
        this.hdr[o + 2] = lerp(look.sky[0][2], look.sky[1][2], k)
      }
    }
    this.base = this.hdr.slice()
    this.rows = new Float32Array(H * SS * 3)
    for (let y = 0; y < H * SS; y++) {
      const k = smoothstep(0, 1, (y + 0.5) / (H * SS))
      for (let c = 0; c < 3; c++) this.rows[y * 3 + c] = lerp(look.sky[0][c], look.sky[1][c], k)
    }
    this.samples = new Float32Array(W * SS * H * SS * 3)
    this.depth = new Float32Array(W * SS * H * SS)
    this.pending = new Uint8Array(Math.ceil(W / BLOCK) * Math.ceil(H / BLOCK))
    this.pendingCount = 0
    this.wipe()
    for (const p of this.prims) {
      p.drawn = 0
      this.draw(p)
    }
    this.pending.fill(0)
    this.pendingCount = 0
    resolve(this.samples, this.hdr, W, H, 0, 0, W - 1, H - 1)
  }

  // Empties the pipe buffer to the background.
  private wipe() {
    const n = this.depth.length
    const SW = this.W * SS
    this.depth.fill(Infinity)
    for (let s = 0; s < n; s++) {
      const r = Math.floor(s / SW) * 3
      this.samples[s * 3] = this.rows[r]
      this.samples[s * 3 + 1] = this.rows[r + 1]
      this.samples[s * 3 + 2] = this.rows[r + 2]
    }
  }

  // The fade is over: empty the grid and start again.
  private clear() {
    this.fade = -1
    this.cycle = 0
    this.pipes = []
    this.prims = []
    this.fresh = []
    this.grid.fill(0)
    this.filled = 0
    this.waits = Array.from({ length: this.count }, (_, i) => rand(0.2, 0.6) + i * rand(1, 3))
    this.wipe()
    this.pending.fill(0)
    this.pendingCount = 0
    this.background.set(this.base)
    this.rebake()
  }

  private grow(dt: number) {
    for (const p of this.pipes) this.advance(p, dt * this.speed)
    const live = this.pipes.filter((p) => !p.done)
    for (let n = this.pipes.length - live.length; n > 0; n--) this.waits.push(rand(0.5, 3))
    this.pipes = live
    this.waits = this.waits.map((w) => w - dt).sort((a, b) => a - b)
    while (this.waits.length && this.waits[0] <= 0) {
      this.waits.shift()
      if (this.pipes.length < this.count) this.sprout()
    }
  }

  private advance(p: Pipe, du: number) {
    p.u += du
    for (;;) {
      this.extend(p)
      if (p.dOut < 0 && p.u >= 0.5) {
        p.done = true
        return
      }
      if (p.u < 1) return
      p.u -= 1
      p.i += DX[p.dOut]
      p.j += DY[p.dOut]
      p.k += DZ[p.dOut]
      p.dIn = p.dOut
      this.enter(p)
    }
  }

  // Sets the extents of the pieces in the pipe's cell from how far through it the pipe is.
  private extend(p: Pipe) {
    const u = Math.min(p.u, 1)
    if (p.bend) {
      p.pieces[0].ext = u * (Math.PI / 2)
      return
    }
    for (const piece of p.pieces) {
      if (piece.kind === BALLS) piece.ext = u >= 0.5 ? 1 : 0
      if (piece.kind !== CYL) continue
      // The half leading in from the face, then the half leading out from the middle.
      piece.ext = piece.full === 1 ? u : piece === p.pieces[0] && p.dIn >= 0 ? Math.min(u, 0.5) : Math.max(0, u - 0.5)
    }
  }

  // The pipe has reached a new cell: choose where it leaves by and lay out the pieces through it.
  private enter(p: Pipe) {
    p.length++
    p.dOut = p.length >= p.max ? -1 : this.choose(p)
    if (p.dOut >= 0) this.claim(p.i + DX[p.dOut], p.j + DY[p.dOut], p.k + DZ[p.dOut])
    const [x, y, z] = this.center(p.i, p.j, p.k)
    p.pieces = []
    p.bend = false
    if (p.dIn >= 0 && p.dOut === p.dIn) {
      p.pieces.push(this.prim(CYL, x - DX[p.dIn] * 0.5, y - DY[p.dIn] * 0.5, z - DZ[p.dIn] * 0.5, p.dIn, PIPE, 1, p.color))
      return
    }
    if (p.dIn >= 0 && p.dOut >= 0 && Math.random() < this.bends) {
      p.bend = true
      // The bend's axis sits on the corner between the two faces.
      const a = this.prim(ARC, x - DX[p.dIn] * BEND + DX[p.dOut] * BEND, y - DY[p.dIn] * BEND + DY[p.dOut] * BEND, z - DZ[p.dIn] * BEND + DZ[p.dOut] * BEND, 0, PIPE, Math.PI / 2, p.color)
      a.e1 = p.dOut ^ 1
      a.e2 = p.dIn
      p.pieces.push(a)
      return
    }
    if (p.dIn >= 0) p.pieces.push(this.prim(CYL, x - DX[p.dIn] * 0.5, y - DY[p.dIn] * 0.5, z - DZ[p.dIn] * 0.5, p.dIn, PIPE, 0.5, p.color))
    // Only at a near joint, where it's big enough to see.
    const teapot = this.teapot && p.dIn >= 0 && p.dOut >= 0 && p.k < GZ / 2
    if (teapot) {
      this.teapot = false
      this.egg = eggWait(true) * TIME_SCALE
      for (const t of TEAPOT) p.pieces.push(this.prim(BALLS, x + t[0] * 1.4, y + t[1] * 1.4, z + t[2] * 1.4, 0, t[3] * 1.4, 1, p.color, t[4]))
    }
    if (!teapot) p.pieces.push(this.prim(BALLS, x, y, z, 0, BALL, 1, p.color))
    if (p.dOut >= 0) p.pieces.push(this.prim(CYL, x, y, z, p.dOut, PIPE, 0.5, p.color))
  }

  private prim(kind: number, x: number, y: number, z: number, d: number, r: number, full: number, color: RGB, ky = 1): Prim {
    const prim = { kind, x, y, z, d, e1: 0, e2: 0, r, ky, ext: 0, full, drawn: 0, color }
    this.prims.push(prim)
    this.fresh.push(prim)
    return prim
  }

  // Mostly straight on; otherwise any free way but back.
  private choose(p: Pipe) {
    const free = [0, 1, 2, 3, 4, 5].filter((d) => {
      const i = p.i + DX[d]
      const j = p.j + DY[d]
      const k = p.k + DZ[d]
      return this.inside(i, j, k) && !this.grid[this.cell(i, j, k)]
    })
    if (!free.length) return -1
    if (p.dIn >= 0 && free.includes(p.dIn) && Math.random() < 0.6) return p.dIn
    const turns = free.filter((d) => d !== p.dIn)
    const pick = turns.length ? turns : free
    return pick[Math.floor(Math.random() * pick.length)]
  }

  // A new pipe at a random free cell.
  private sprout() {
    for (let n = 0; n < 60; n++) {
      const lo = Math.floor((GXM - this.gx) / 2)
      const i = lo + Math.floor(Math.random() * this.gx)
      const j = Math.floor(Math.random() * GY)
      // Nearer cells more often, so the screen's edges get the big pipes and its middle stays quieter.
      const k = Math.floor(Math.random() ** 1.6 * GZ)
      if (this.grid[this.cell(i, j, k)]) continue
      this.start(i, j, k)
      return
    }
  }

  private start(i: number, j: number, k: number) {
    const color = this.paint(COLORS[PICKS[Math.floor(Math.random() * PICKS.length)]])
    const p: Pipe = { i, j, k, dIn: -1, dOut: -1, u: 0.5, bend: false, length: 0, max: Math.floor(rand(18, 50)), color, pieces: [], done: false }
    this.claim(i, j, k)
    this.enter(p)
    this.pipes.push(p)
  }

  private paint(c: RGB): RGB {
    const t = this.look.tint
    // Night has no gray: that pipe turns slate blue.
    const g = this.look === LOOKS.night && c === COLORS[4] ? ([0.16, 0.24, 0.55] as RGB) : c
    return [g[0] * t[0], g[1] * t[1], g[2] * t[2]]
  }

  private claim(i: number, j: number, k: number) {
    this.grid[this.cell(i, j, k)] = 1
    this.filled++
  }

  private inside(i: number, j: number, k: number) {
    const lo = Math.floor((GXM - this.gx) / 2)
    return i >= lo && i < lo + this.gx && j >= 0 && j < GY && k >= 0 && k < GZ
  }

  private cell(i: number, j: number, k: number) {
    return (k * GY + j) * GXM + i
  }

  private center(i: number, j: number, k: number) {
    return [i - (GXM - 1) / 2, j - (GY - 1) / 2, Z0 + k]
  }

  // Draws what a piece has grown since it was last drawn into the pipe buffer, and marks the blocks it changed.
  private draw(p: Prim) {
    if (p.ext <= p.drawn) return
    const look = this.look
    const gloom = 1 - 0.4 * this.gloom
    const s = this.shade
    s.set([look.key[0] * gloom, look.key[1] * gloom, look.key[2] * gloom, look.ambient, look.glint[0] * gloom, look.glint[1] * gloom, look.glint[2] * gloom, look.glintTint, look.fill[0], look.fill[1], look.fill[2], look.fog])
    const SW = this.W * SS
    const SH = this.H * SS
    const f = FOCAL * SH
    const box = this.box
    box[0] = Infinity
    box[1] = Infinity
    box[2] = -Infinity
    box[3] = -Infinity
    if (p.kind === BALLS) ellipsoid(this.samples, this.depth, this.rows, SW, SH, f, s, p.x, p.y, p.z, p.r, p.ky, p.color, box, undefined)
    if (p.kind === CYL) {
      const a = p.drawn
      const b = p.ext
      const axis = p.d >> 1
      const sign = p.d & 1 ? -1 : 1
      const at = axis === 0 ? p.x : axis === 1 ? p.y : p.z
      // Back over the last bit drawn, so the joint between frames is seamless.
      const s0 = at + sign * Math.max(0, a - 0.02)
      const s1 = at + sign * b
      cylinder(this.samples, this.depth, this.rows, SW, SH, f, s, axis, p.x, p.y, p.z, Math.min(s0, s1), Math.max(s0, s1), p.r, p.color, box)
    }
    if (p.kind === ARC) {
      const step = 0.06
      // The spine the balls are strung along, so they shade as one smooth tube.
      const spine = this.spine
      spine.set([p.x, p.y, p.z, DX[p.e1], DY[p.e1], DZ[p.e1], DX[p.e2], DY[p.e2], DZ[p.e2]])
      for (let t = Math.floor(p.drawn / step) * step; t < p.ext + step; t += step) {
        const th = Math.min(t, p.ext)
        const c = Math.cos(th) * BEND
        const n = Math.sin(th) * BEND
        ellipsoid(this.samples, this.depth, this.rows, SW, SH, f, s, p.x + DX[p.e1] * c + DX[p.e2] * n, p.y + DY[p.e1] * c + DY[p.e2] * n, p.z + DZ[p.e1] * c + DZ[p.e2] * n, p.r, 1, p.color, box, spine)
        if (th >= p.ext) break
      }
    }
    p.drawn = p.kind === BALLS ? 1 : p.ext
    if (box[2] < box[0]) return
    const bw = Math.ceil(this.W / BLOCK)
    const x0 = Math.max(0, Math.floor(box[0] / SS / BLOCK))
    const y0 = Math.max(0, Math.floor(box[1] / SS / BLOCK))
    const x1 = Math.min(bw - 1, Math.floor(box[2] / SS / BLOCK))
    const y1 = Math.min(Math.ceil(this.H / BLOCK) - 1, Math.floor(box[3] / SS / BLOCK))
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (this.pending[y * bw + x]) continue
        this.pending[y * bw + x] = 1
        this.pendingCount++
      }
  }
}

// The easter egg's teapot, as ellipsoids around the joint [x, y, z, radius, squash]: body, lid, knob, a spout curving
// up to the right and a handle on the left.
const TEAPOT: number[][] = [
  [0, 0.02, 0, 0.3, 0.7],
  [0, -0.17, 0, 0.17, 0.4],
  [0, -0.25, 0, 0.05, 1],
  ...Array.from({ length: 16 }, (_, n) => {
    const t = n / 15
    return [0.22 + 0.24 * t, 0.06 - 0.26 * t * t - 0.04 * t, 0, 0.075 - 0.035 * t, 1]
  }),
  ...Array.from({ length: 24 }, (_, n) => {
    const a = -Math.PI / 2 + (Math.PI * n) / 23
    return [-0.28 - 0.13 * Math.cos(a), 0.12 * Math.sin(a), 0, 0.042, 1]
  }),
]

// Shades one subsample of a pipe hit at depth z with normal n, seen along d: the key light from the upper left and
// front, a glint, a soft rim fill, and the far end fading toward the background.
function light(samples: Float32Array, rows: Float32Array, s: number, row: number, nx: number, ny: number, nz: number, dx: number, dy: number, z: number, color: RGB, shade: Float32Array) {
  const lx = -0.48
  const ly = -0.66
  const lz = -0.58
  const vl = 1 / Math.hypot(dx, dy, 1)
  const vx = -dx * vl
  const vy = -dy * vl
  const vz = -vl
  const diffuse = Math.max(0, nx * lx + ny * ly + nz * lz)
  const hx = lx + vx
  const hy = ly + vy
  const hz = lz + vz
  const hl = 1 / Math.hypot(hx, hy, hz)
  const sp = Math.max(0, (nx * hx + ny * hy + nz * hz) * hl)
  const sp2 = sp * sp
  const sp8 = sp2 * sp2 * sp2 * sp2
  const spec = sp8 * sp8 * sp8 * sp8 * 1.1 + sp8 * 0.12
  const facing = nx * vx + ny * vy + nz * vz
  const rim = (1 - Math.max(0, facing)) ** 3
  const fog = shade[11] * smoothstep(Z0, Z0 + GZ, z)
  const o = s * 3
  for (let c = 0; c < 3; c++) {
    const glint = lerp(shade[4 + c], shade[4 + c] * color[c] * 1.6, shade[7])
    const lit = color[c] * (shade[3] + shade[c] * diffuse) + glint * spec + shade[8 + c] * rim
    samples[o + c] = lerp(lit, rows[row * 3 + c], fog)
  }
}

// Ray-casts an ellipsoid (radius r, its height squashed by ky) centered at (cx, cy, cz) into the pipe buffer with a
// depth test, growing box to the subsamples it covers. A ball strung along a bend's spine (its center and the two
// directions spanning its quarter circle) takes its normal from the spine instead, so the bend shades smoothly.
function ellipsoid(samples: Float32Array, depth: Float32Array, rows: Float32Array, SW: number, SH: number, f: number, shade: Float32Array, cx: number, cy: number, cz: number, r: number, ky: number, color: RGB, box: Float32Array, spine: Float32Array | undefined) {
  const ry = r * ky
  const near = cz - r
  if (near <= 0.1) return
  const x0 = Math.max(0, Math.floor(SW / 2 + (f * (cx - r)) / (cx - r < 0 ? near : cz + r)))
  const x1 = Math.min(SW - 1, Math.ceil(SW / 2 + (f * (cx + r)) / (cx + r > 0 ? near : cz + r)))
  const y0 = Math.max(0, Math.floor(SH / 2 + (f * (cy - ry)) / (cy - ry < 0 ? near : cz + r)))
  const y1 = Math.min(SH - 1, Math.ceil(SH / 2 + (f * (cy + ry)) / (cy + ry > 0 ? near : cz + r)))
  if (x1 < x0 || y1 < y0) return
  const iy = 1 / ky
  const ccy = cy * iy
  const cc = cx * cx + ccy * ccy + cz * cz - r * r
  let hit = false
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - SH / 2) / f
    const dys = dy * iy
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - SW / 2) / f
      const a = dx * dx + dys * dys + 1
      const b = dx * cx + dys * ccy + cz
      const disc = b * b - a * cc
      if (disc < 0) continue
      const t = (b - Math.sqrt(disc)) / a
      const s = y * SW + x
      if (t >= depth[s]) continue
      depth[s] = t
      hit = true
      let nx = t * dx - cx
      let ny = (t * dy - cy) * iy * iy
      let nz = t - cz
      if (spine) {
        const px = t * dx - spine[0]
        const py = t * dy - spine[1]
        const pz = t - spine[2]
        const phi = clamp(Math.atan2(px * spine[6] + py * spine[7] + pz * spine[8], px * spine[3] + py * spine[4] + pz * spine[5]), 0, Math.PI / 2)
        const c = Math.cos(phi) * BEND
        const n = Math.sin(phi) * BEND
        nx = px - spine[3] * c - spine[6] * n
        ny = py - spine[4] * c - spine[7] * n
        nz = pz - spine[5] * c - spine[8] * n
      }
      const nl = 1 / Math.hypot(nx, ny, nz)
      light(samples, rows, s, y, nx * nl, ny * nl, nz * nl, dx, dy, t, color, shade)
    }
  }
  if (!hit) return
  box[0] = Math.min(box[0], x0)
  box[1] = Math.min(box[1], y0)
  box[2] = Math.max(box[2], x1)
  box[3] = Math.max(box[3], y1)
}

// Ray-casts a capped cylinder of radius r along axis (0 x, 1 y, 2 z) from a to b, its center line through (cx, cy, cz).
function cylinder(samples: Float32Array, depth: Float32Array, rows: Float32Array, SW: number, SH: number, f: number, shade: Float32Array, axis: number, cx: number, cy: number, cz: number, a: number, b: number, r: number, color: RGB, box: Float32Array) {
  const lx0 = axis === 0 ? a : cx - r
  const lx1 = axis === 0 ? b : cx + r
  const ly0 = axis === 1 ? a : cy - r
  const ly1 = axis === 1 ? b : cy + r
  const lz0 = axis === 2 ? a : cz - r
  const lz1 = axis === 2 ? b : cz + r
  if (lz0 <= 0.1) return
  const x0 = Math.max(0, Math.floor(SW / 2 + (f * lx0) / (lx0 < 0 ? lz0 : lz1)))
  const x1 = Math.min(SW - 1, Math.ceil(SW / 2 + (f * lx1) / (lx1 > 0 ? lz0 : lz1)))
  const y0 = Math.max(0, Math.floor(SH / 2 + (f * ly0) / (ly0 < 0 ? lz0 : lz1)))
  const y1 = Math.min(SH - 1, Math.ceil(SH / 2 + (f * ly1) / (ly1 > 0 ? lz0 : lz1)))
  if (x1 < x0 || y1 < y0) return
  // The two axes across the cylinder, p and q, and its center line on them.
  const cp = axis === 0 ? cy : cx
  const cq = axis === 2 ? cy : cz
  let hit = false
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - SH / 2) / f
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - SW / 2) / f
      const dp = axis === 0 ? dy : dx
      const dq = axis === 2 ? dy : 1
      const dk = axis === 0 ? dx : axis === 1 ? dy : 1
      const qa = dp * dp + dq * dq
      const qb = dp * cp + dq * cq
      const disc = qb * qb - qa * (cp * cp + cq * cq - r * r)
      if (disc < 0 || qa < 1e-9) continue
      const root = Math.sqrt(disc)
      const t0 = (qb - root) / qa
      const t1 = (qb + root) / qa
      // Where the ray is between the caps.
      const ta = dk === 0 ? (a <= 0 && b >= 0 ? -Infinity : Infinity) : Math.min(a / dk, b / dk)
      const tb = dk === 0 ? (a <= 0 && b >= 0 ? Infinity : -Infinity) : Math.max(a / dk, b / dk)
      const t = Math.max(t0, ta)
      if (t > Math.min(t1, tb) || t <= 0) continue
      const s = y * SW + x
      if (t >= depth[s]) continue
      depth[s] = t
      hit = true
      const side = t0 >= ta
      const np = side ? (t * dp - cp) / r : 0
      const nq = side ? (t * dq - cq) / r : 0
      const nk = side ? 0 : dk > 0 ? -1 : 1
      const nx = axis === 0 ? nk : np
      const ny = axis === 0 ? np : axis === 1 ? nk : nq
      const nz = axis === 2 ? nk : nq
      light(samples, rows, s, y, nx, ny, nz, dx, dy, t, color, shade)
    }
  }
  if (!hit) return
  box[0] = Math.min(box[0], x0)
  box[1] = Math.min(box[1], y0)
  box[2] = Math.max(box[2], x1)
  box[3] = Math.max(box[3], y1)
}

// Averages the pipe buffer's subsamples into pixels x0..x1, y0..y1 of out.
function resolve(samples: Float32Array, out: Float32Array, W: number, H: number, x0: number, y0: number, x1: number, y1: number) {
  const SW = W * SS
  const k = 1 / (SS * SS)
  for (let y = y0; y <= Math.min(y1, H - 1); y++)
    for (let x = x0; x <= Math.min(x1, W - 1); x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let j = 0; j < SS; j++)
        for (let i = 0; i < SS; i++) {
          const s = ((y * SS + j) * SW + x * SS + i) * 3
          r += samples[s]
          g += samples[s + 1]
          b += samples[s + 2]
        }
      const o = (y * W + x) * 3
      out[o] = r * k
      out[o + 1] = g * k
      out[o + 2] = b * k
    }
}

// Fades the whole frame toward the empty background by k.
function dim(hdr: Float32Array, base: Float32Array, k: number) {
  for (let i = 0; i < hdr.length; i++) hdr[i] += (base[i] - hdr[i]) * k
}

export const pipes: Wallpaper = {
  id: "pipes",
  name: "3D Pipes",
  description: "The old 3D screensaver: glossy pipes growing through the dark one length at a time, turning at ball joints",
  fixedTime: "day",
  activity: {
    calm: "One pipe growing slowly through the grid, over a long fill",
    lively: "Two or three pipes growing at once",
    teeming: "Five pipes, quicker, some sweeping round in smooth bends",
  },
  scrim: {
    day: [
      [6, 6, 8],
      [4, 4, 6],
      [3, 3, 4],
    ],
    sunset: [
      [30, 6, 24],
      [20, 5, 14],
      [24, 8, 3],
    ],
    night: [
      [2, 4, 16],
      [1, 3, 11],
      [0, 1, 5],
    ],
  },
  create: (settings) => new Pipes(settings),
}

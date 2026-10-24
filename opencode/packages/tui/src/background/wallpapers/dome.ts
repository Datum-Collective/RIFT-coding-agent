import { Canvas, cap, ell, type Lighting } from "../src/canvas"
import { eggWait } from "../src/egg"
import { lightPool } from "../src/light"
import { TAU, clamp, fbm1, fbm2, hash, hash2, lerp, rand, smoothstep, type RGB } from "../src/math"
import { driftClouds, makeClouds, makeStorm, paintClouds, paintStorm, type Cloud } from "../src/sky"
import { touch } from "../src/touched"
import type { Activity, Settings, Time, Wallpaper } from "../src/wallpaper"

// The scene runs slower than real time, which keeps it calm behind text.
const TIME_SCALE = 0.35
// The visiting aircraft and the egg's bike move at a quarter of scene speed.
const CREATURE_SPEED = 0.25
// The horizon and the dome's foot, in screen heights from the top, and the dome's radius.
const HORIZON = 0.47
const BASE = 0.64
const RADIUS = 0.27
// The near half of the dome's foot, seen from above: a flat half-ellipse this fraction of the radius deep.
const FOOT = 0.26
// The ground's projection: a ground unit across is (v - HORIZON) * LATERAL screen heights wide at height v, and the
// depth into the scene is 1 / (v - HORIZON). Rays from the dome's foot stay straight lines on screen.
const LATERAL = 0.8
// The cloud layer the ripples spread through: their middle, how flat its rings look, and how many rings per unit.
const RIPPLE_Y = 0.21
const RIPPLE_FLAT = 0.2
const RINGS = 26
// The rays of light from the dome's foot, as a table over the angle around it.
const RAY_N = 2048
// Teeming: the dome swells and recedes over this many scene seconds, rolling a shockwave out at each peak.
const SWELL = 55
// The egg: a red motorbike tears across the bottom of the city in this many creature seconds.
const BIKE = 5.5

// Everything that changes with the time of day. Night keeps the base light a vivid green and every highlight a
// saturated blue or green: the text on top is white.
interface Look {
  sky: [number, RGB][]
  // Light the ripples and streaks of the cloud layer add to the sky.
  ripple: RGB
  clouds: [top: RGB, bottom: RGB]
  bank: [top: RGB, bottom: RGB]
  // The ruined city: streets, rooftops, and the haze it fades into at the horizon.
  street: RGB
  roof: RGB
  haze: RGB
  // The light blazing from the dome's foot, and how strongly it lights the city.
  glow: RGB
  reach: number
  dome: RGB
  rim: RGB
  bolt: RGB
  tint: RGB
}

const LOOKS: Record<Time, Look> = {
  // A smoky pale sky over a gray-green ruin; the dome stays black and its light dims.
  day: {
    sky: [
      [0, [0.28, 0.31, 0.33]],
      [0.3, [0.45, 0.47, 0.46]],
      [0.47, [0.66, 0.65, 0.58]],
    ],
    ripple: [0.14, 0.14, 0.12],
    clouds: [
      [0.86, 0.86, 0.82],
      [0.42, 0.45, 0.45],
    ],
    bank: [
      [0.84, 0.84, 0.79],
      [0.36, 0.39, 0.39],
    ],
    street: [0.08, 0.1, 0.08],
    roof: [0.25, 0.31, 0.23],
    haze: [0.48, 0.5, 0.45],
    glow: [0.12, 0.6, 0.25],
    reach: 0.6,
    dome: [0.012, 0.014, 0.016],
    rim: [0.1, 0.11, 0.12],
    bolt: [0.7, 0.75, 0.9],
    tint: [1, 1, 1],
  },
  // An orange-red sky with warm-lit clouds, the dome black and its light green-gold.
  sunset: {
    sky: [
      [0, [0.06, 0.02, 0.04]],
      [0.22, [0.3, 0.07, 0.05]],
      [0.47, [0.95, 0.36, 0.1]],
    ],
    ripple: [0.42, 0.14, 0.06],
    clouds: [
      [0.95, 0.42, 0.15],
      [0.16, 0.05, 0.06],
    ],
    bank: [
      [0.7, 0.28, 0.1],
      [0.14, 0.05, 0.05],
    ],
    street: [0.03, 0.015, 0.015],
    roof: [0.16, 0.08, 0.06],
    haze: [0.42, 0.16, 0.07],
    glow: [0.7, 0.95, 0.1],
    reach: 0.9,
    dome: [0.006, 0.003, 0.004],
    rim: [0.3, 0.1, 0.04],
    bolt: [1, 0.45, 0.6],
    tint: [0.4, 0.22, 0.18],
  },
  // As the cover: a near-black sky, a ring of deep blue clouds, and a green-teal blaze across a dark green city.
  night: {
    sky: [
      [0, [0.002, 0.003, 0.01]],
      [0.28, [0.006, 0.011, 0.034]],
      [0.47, [0.018, 0.036, 0.1]],
    ],
    ripple: [0.04, 0.09, 0.3],
    clouds: [
      [0.07, 0.16, 0.46],
      [0.008, 0.016, 0.05],
    ],
    bank: [
      [0.05, 0.11, 0.32],
      [0.006, 0.012, 0.035],
    ],
    street: [0.003, 0.009, 0.008],
    roof: [0.02, 0.06, 0.045],
    haze: [0.02, 0.045, 0.1],
    glow: [0.03, 1, 0.4],
    reach: 1,
    dome: [0.002, 0.003, 0.006],
    rim: [0.025, 0.06, 0.2],
    bolt: [0.3, 0.45, 1.3],
    tint: [0.12, 0.16, 0.2],
  },
}

// A chunk of rubble floating up around the dome: its angle around the foot, how far out (in radii), height above the
// ground in screen heights, rise speed, size and spin.
interface Chunk {
  a: number
  r: number
  lift: number
  speed: number
  size: number
  spin: number
}

// Rubble a click kicks up, flying and falling back, in screen heights.
interface Thrown {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  size: number
  spin: number
}

// A ring rolling out through the cloud layer from (x, y) in screen heights, r in flattened units.
interface Ring {
  x: number
  y: number
  r: number
  strength: number
}

class Dome extends Canvas {
  private time = 0
  private creatureTime = 0
  private readonly activity: Activity
  private readonly look: Look
  private lighting: Lighting = { style: "rim", color: [0, 1, 0], x: 0, y: 0 }
  private cx = 1
  private R = RADIUS
  private clouds: Cloud[] = []
  private cloudsA = 0
  private storm = makeStorm()
  private readonly rays = new Float32Array(RAY_N)
  private readonly rayPhases = new Float32Array(RAY_N)
  // Per pixel of the real-size canvas, from layout: the light the base adds to the still frame (3 per pixel), how much
  // of it is a ray, the ground distance from the foot and the ray's pulse phase; and the pixels that have any.
  private glowAdd = new Float32Array(0)
  private rayAdd = new Float32Array(0)
  private rho = new Float32Array(0)
  private phases = new Float32Array(0)
  private lit = new Int32Array(0)
  private litBox = [0, 0, -1, -1]
  // The cloud layer's texture and each pixel's flattened distance from the ripples' middle, over the sky's rows.
  private tex = new Float32Array(0)
  private dist = new Float32Array(0)
  private skyRows = 0
  private rings: Ring[] = []
  private ringData = new Float32Array(0)
  private chunks: Chunk[] = []
  private thrown: Thrown[] = []
  private puffs: { x: number; y: number; age: number }[] = []
  private swells = 0
  private flash = { t: -1, wait: 0, x: 0 }
  private visitor: { x: number; y: number; dir: number } | undefined
  private bike = { wait: eggWait() * TIME_SCALE, t: -1, trail: [] as { x: number; y: number; age: number }[] }

  constructor(settings: Settings) {
    super()
    this.activity = settings.activity
    this.look = LOOKS[settings.time]
    this.flash.wait = rand(6, 14)
    // A broad shaft straight toward the viewer, a few beside it, and thinner rays fanning out all round, fewer and
    // fainter toward the back.
    const rays: [number, number, number][] = [
      [0, 0.03, 1.2],
      [-0.12, 0.012, 0.7],
      [0.17, 0.015, 0.8],
    ]
    for (let i = 0; i < 46; i++) {
      const at = (Math.random() < 0.5 ? -1 : 1) * Math.random() ** 1.3 * Math.PI
      rays.push([at, rand(0.005, 0.018), rand(0.25, 0.9) * (1 - 0.65 * Math.abs(at / Math.PI))])
    }
    for (const [i, [at, width, strength]] of rays.entries()) {
      const phase = hash(i * 7.31) * TAU
      for (let k = Math.floor(((at - 4 * width) / TAU + 0.5) * RAY_N); k <= Math.ceil(((at + 4 * width) / TAU + 0.5) * RAY_N); k++) {
        const n = ((k % RAY_N) + RAY_N) % RAY_N
        const d = ((k + 0.5) / RAY_N - 0.5) * TAU - at
        const v = strength * Math.exp(-((d / width) ** 2))
        if (v <= this.rays[n]) continue
        this.rays[n] = v
        this.rayPhases[n] = phase
      }
    }
    if (settings.activity === "calm") return
    const count = settings.activity === "teeming" ? 16 : 7
    const top = settings.activity === "teeming" ? 0.42 : 0.34
    this.chunks = Array.from({ length: count }, () => ({ a: rand(0, TAU), r: rand(1.02, 1.35), lift: rand(0, top), speed: rand(0.6, 1.2), size: rand(0.008, 0.016), spin: rand(0, TAU) }))
  }

  step(dt: number) {
    dt = clamp(dt, 0, 0.1) * TIME_SCALE
    this.time += dt
    const cdt = dt * CREATURE_SPEED
    this.creatureTime += cdt
    this.stepGloom(dt)
    driftClouds(this.clouds, this.A, dt * 0.5)
    if (this.gloom > 0) driftClouds(this.storm, this.A, dt)
    for (const r of this.rings) r.r += 0.055 * dt
    this.rings = this.rings.filter((r) => r.r < 1.4)
    const teeming = this.activity === "teeming"
    const top = teeming ? 0.42 : 0.34
    for (const c of this.chunks) {
      c.lift += (teeming ? 0.008 : 0.005) * c.speed * dt
      c.spin += 0.15 * c.speed * dt
      if (teeming) c.a += (0.05 / c.r) * dt
      if (c.lift < top) continue
      c.lift = 0
      c.a = rand(0, TAU)
    }
    for (const t of this.thrown) {
      t.age += dt
      t.vy += 0.07 * dt
      t.x += t.vx * dt
      t.y += t.vy * dt
      t.spin += 0.8 * dt
    }
    this.thrown = this.thrown.filter((t) => t.age < 5)
    for (const p of this.puffs) p.age += dt
    this.puffs = this.puffs.filter((p) => p.age < 3)
    if (teeming) {
      const n = Math.floor(this.time / SWELL + 0.5)
      if (n > this.swells) this.rings.push({ x: this.cx, y: RIPPLE_Y, r: 0, strength: 1.3 })
      this.swells = n
      this.stepFlash(dt)
    }
    this.stepVisitor(cdt)
    this.stepBike(dt, cdt)
  }

  render() {
    this.restore()
    const { W, H, look, hdr } = this
    const swell = this.activity === "teeming" ? 0.5 - 0.5 * Math.cos((this.time / SWELL) * TAU) : 0
    const breath = Math.sin((this.time / 14) * TAU) * (this.activity === "calm" ? 0.1 : 0.14)
    const level = (1 + breath + 0.3 * swell) * (1 - 0.5 * this.gloom)
    const pulse = this.activity === "calm" ? 0 : look.reach
    shine(hdr, this.lit, this.glowAdd, this.rayAdd, this.rho, this.phases, look.glow, level - 1, pulse, this.time)
    const [bx0, by0, bx1, by1] = this.litBox
    if (bx1 >= bx0) touch(hdr, bx0, by0, bx1, by1)
    this.drawRipples()
    const dark = look.bank[1]
    if (this.gloom > 0) paintStorm(hdr, W, H, this.storm, [dark[0] * 1.6, dark[1] * 1.6, dark[2] * 1.6], dark, this.gloom)
    paintClouds(hdr, W, H, this.clouds, ...look.clouds, 0.55)
    if (this.flash.t >= 0) this.drawFlash()
    if (this.visitor) this.drawVisitor()
    for (const c of this.chunks) if (Math.sin(c.a) < 0) this.drawChunk(c)
    for (const p of this.puffs) this.drawPuff(p)
    const g = look.glow
    for (const t of this.thrown) this.drawRubble(t.x, t.y, t.size * clamp((5 - t.age) / 1.5, 0, 1), t.spin, { style: "rim", color: g, x: t.x * H, y: (t.y + 0.05) * H })
    if (this.bike.t >= 0) this.drawBike()
    fillDome(hdr, W, H, this.cx * H, BASE * H, this.R * (1 + 0.05 * swell) * H, FOOT, look.dome, look.rim, look.glow, level, this.px)
    for (const c of this.chunks) if (Math.sin(c.a) >= 0) this.drawChunk(c)
    this.finish()
  }

  protected override visit() {
    if (this.visitor) return
    const dir = Math.random() < 0.5 ? 1 : -1
    this.visitor = { x: dir > 0 ? -0.15 : this.A + 0.15, y: this.openRow(0.08, 0.28), dir }
  }

  // A click in the sky sends a ripple through the clouds, and one on the dome a shockwave from above it; on the city
  // it kicks up a spray of rubble.
  poke(x: number, y: number) {
    const dome = insideDome(x * this.H, y * this.H, this.cx * this.H, BASE * this.H, this.R * this.H, FOOT) > 0
    if (y < HORIZON || dome) {
      if (this.rings.length < 6) this.rings.push(dome ? { x: this.cx, y: RIPPLE_Y, r: 0, strength: 1.3 } : { x, y, r: 0, strength: 1.6 })
      return
    }
    if (this.puffs.length > 3) return
    this.puffs.push({ x, y, age: 0 })
    for (let i = 0; i < 6; i++) this.thrown.push({ x: x + rand(-0.01, 0.01), y, vx: rand(-0.04, 0.04), vy: -rand(0.07, 0.13), age: 0, size: rand(0.005, 0.01), spin: rand(0, TAU) })
  }

  protected override layout() {
    const { W, H, A, look, hdr, px } = this
    this.cx = A / 2
    this.R = Math.min(RADIUS, 0.36 * A)
    this.lighting = { style: "rim", color: [look.glow[0] * 0.35, look.glow[1] * 0.35, look.glow[2] * 0.35], x: this.cx * H, y: BASE * H }
    if (this.cloudsA !== A) {
      const n = Math.ceil(A * 3.5) + 1
      this.clouds = makeClouds(n, "cumulus", HORIZON - 0.06, HORIZON - 0.035)
      for (const [i, c] of this.clouds.entries()) c.x = ((i + Math.random() * 0.7) / n) * (A + 0.3) - 0.15
      this.cloudsA = A
    }
    this.glowAdd = new Float32Array(W * H * 3)
    this.rayAdd = new Float32Array(W * H)
    this.rho = new Float32Array(W * H)
    this.phases = new Float32Array(W * H)
    this.paintSky()
    this.skyRows = Math.ceil(HORIZON * H)
    this.tex = new Float32Array(W * this.skyRows)
    this.dist = new Float32Array(W * this.skyRows)
    for (let y = 0; y < this.skyRows; y++)
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / H
        const v = (y + 0.5) / H
        const p = y * W + x
        this.tex[p] = (0.3 + 0.7 * smoothstep(0.35, 0.75, fbm2(u * 3.5 + fbm1(v * 14, 4) * 0.5, v * 24, 4))) * smoothstep(0.02, 0.2, v)
        this.dist[p] = Math.hypot(u - this.cx, (v - RIPPLE_Y) / RIPPLE_FLAT)
      }
    // Calm keeps its ripples still, so they are painted once.
    if (this.activity === "calm") ripples(hdr, W, H, this.skyRows, this.tex, this.dist, look.ripple, 1, 0, this.ringData, 0, this.cx * H)
    this.paintBank()
    this.paintCity()
    fillDome(hdr, W, H, this.cx * H, BASE * H, this.R * H, FOOT, look.dome, look.rim, look.glow, 1, px)
    // The pixels the base lights, outside the dome, for render() to breathe and pulse.
    const list: number[] = []
    const box = [W, H, -1, -1]
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = y * W + x
        const o = p * 3
        if (Math.max(this.glowAdd[o], this.glowAdd[o + 1], this.glowAdd[o + 2]) < 0.004 && this.rayAdd[p] < 0.004) continue
        if (insideDome(x + 0.5, y + 0.5, this.cx * H, BASE * H, this.R * H, FOOT) > 1) continue
        list.push(p)
        box[0] = Math.min(box[0], x)
        box[1] = Math.min(box[1], y)
        box[2] = Math.max(box[2], x)
        box[3] = Math.max(box[3], y)
      }
    this.lit = Int32Array.from(list)
    this.litBox = box
  }

  private paint(c: RGB): RGB {
    const t = this.look.tint
    return [c[0] * t[0], c[1] * t[1], c[2] * t[2]]
  }

  // The sky's gradient, the streaky cloud layer, and a haze of the base's light rising around the dome.
  private paintSky() {
    const { W, H, look, hdr } = this
    const stops = look.sky
    const cx = this.cx
    const R = this.R
    const g = look.glow
    for (let y = 0; y < H; y++) {
      const v = (y + 0.5) / H
      const i = stops.findIndex(([at]) => at >= v)
      const [a, from] = stops[Math.max(0, i - 1)]
      const [b, to] = stops[i < 0 ? stops.length - 1 : i]
      const k = b > a ? smoothstep(a, b, v) : 1
      const streak = smoothstep(0.08, 0.44, v) * 0.35
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / H
        const tex = smoothstep(0.35, 0.75, fbm2(u * 3.5 + fbm1(v * 14, 4) * 0.5, v * 24, 4))
        const d = Math.max(0, Math.hypot(u - cx, (v - BASE) * 1.3) - R)
        const halo = 0.09 * look.reach * Math.exp(-d / 0.09) * smoothstep(BASE - R * 1.3, BASE, v)
        const o = (y * W + x) * 3
        hdr[o] = lerp(from[0], to[0], k) + look.ripple[0] * tex * streak
        hdr[o + 1] = lerp(from[1], to[1], k) + look.ripple[1] * tex * streak
        hdr[o + 2] = lerp(from[2], to[2], k) + look.ripple[2] * tex * streak
        if (halo < 0.002) continue
        hdr[o] += g[0] * halo
        hdr[o + 1] += g[1] * halo
        hdr[o + 2] += g[2] * halo
        this.glowAdd[o] = g[0] * halo
        this.glowAdd[o + 1] = g[1] * halo
        this.glowAdd[o + 2] = g[2] * halo
      }
    }
  }

  // A continuous bank of heaped cloud ringing the horizon, taller away from the dome: rounded billows heaped in
  // clusters, nearer ones lower and in front, each shaded as a ball lit from above and darkening down into the haze.
  private paintBank() {
    const { W, H, A, look, hdr, px } = this
    const [lit, shade] = look.bank
    const balls: [number, number, number][] = []
    for (let x = -0.15, k = 0; x < A + 0.15; k++) {
      const big = 0.6 + 0.8 * smoothstep(this.R * 0.6, Math.max(this.R + 0.2, A / 2), Math.abs(x - this.cx))
      const r = (0.036 + 0.036 * hash(k * 3.7)) * big
      const near = hash(k * 5.3)
      const y = HORIZON + 0.004 - r * 0.2 - (1 - near) * 0.02
      balls.push([x, y, r])
      // Smaller billows heaped on its shoulders.
      for (let n = 0; n < 3; n++) {
        const a = -Math.PI / 2 + (hash(k * 7.1 + n) - 0.5) * 2.2
        const br = r * (0.4 + 0.3 * hash(k * 2.9 + n * 4.1))
        balls.push([x + Math.cos(a) * r * 0.75, y + Math.sin(a) * r * 0.75, br])
      }
      x += r * (1 + 0.8 * hash(k * 9.1))
    }
    // Nearer (lower) billows draw in front.
    balls.sort((a, b) => a[1] - b[1])
    const bottom = (HORIZON + 0.008) * H
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / H
      const column = balls.filter(([bx, , r]) => Math.abs(u - bx) < r + 2 * px / H)
      if (!column.length) continue
      const top = Math.max(0, Math.floor(Math.min(...column.map(([, by, r]) => (by - r) * H)) - 1))
      for (let y = top; y < Math.min(H, Math.ceil(bottom)); y++) {
        const v = (y + 0.5) / H
        let cov = clamp((bottom - y - 0.5) / px, 0, 1) * (v > HORIZON - 0.01 ? 1 : 0)
        let front: [number, number, number] | undefined
        for (const ball of column) {
          const e = (ball[2] - Math.hypot(u - ball[0], v - ball[1])) * H
          if (e <= -px) continue
          cov = Math.max(cov, clamp(e / px + 0.5, 0, 1))
          front = ball
        }
        if (cov <= 0) continue
        const [bx, by, r] = front ?? [u, v - 0.02, 0.02]
        const ny = clamp((v - by) / r, -1, 1)
        const nz = Math.sqrt(Math.max(0, 1 - ny * ny - ((u - bx) / r) ** 2))
        const k = clamp(0.5 - 0.55 * ny + 0.15 * nz, 0, 1) * (0.55 + 0.45 * smoothstep(HORIZON + 0.008, HORIZON - 0.05, v))
        const lump = 0.85 + 0.3 * fbm2(u * 14, v * 30, 3)
        const o = (y * W + x) * 3
        for (let c = 0; c < 3; c++) hdr[o + c] += (lerp(shade[c], lit[c], k * k) * lump - hdr[o + c]) * cov
      }
    }
  }

  // The ruined city seen from high above, in columns fanning out from the dome's foot. Each column holds a run of
  // buildings drawn in streaky perspective, stretched away from the dome: the end facing it catches its light and the
  // rest falls into shadow. The gaps between are streets, lit where a ray runs down them. Buildings too small to show
  // blur into an even tone, then into the horizon haze.
  private paintCity() {
    const { W, H, look, hdr, px } = this
    const p0 = BASE - HORIZON
    const Zb = 1 / p0
    const Rg = this.R / (p0 * LATERAL)
    const NA = this.cells ? 150 : 210
    const NQ = 6
    const g = look.glow
    for (let y = Math.floor(HORIZON * H); y < H; y++) {
      const t = Math.max(0.002, (y + 0.5) / H - HORIZON)
      const dZ = 1 / t - Zb
      const haze = smoothstep(0.004, 0.1, t)
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / H
        const X = (u - this.cx) / (t * LATERAL)
        const rho = Math.hypot(X, dZ)
        const psi = Math.atan2(X, -dZ)
        const a = (psi / TAU + 0.5) * NA
        const i = Math.floor(a)
        const fa = a - i
        const q = Math.log(Math.max(rho, 0.05)) * NQ + hash(i * 1.37) * 5
        const j = Math.floor(q)
        const fq = q - j
        const hb = hash2(i, j)
        // Each building fills part of its cell across, starts a little out from its inner end in steps, and runs
        // most of the way along; some cells are empty lots.
        const margin = 0.08 + 0.3 * hash(i * 5.1 + j * 2.3)
        const sub = hash(i * 31.7 + j * 7.3 + Math.floor(fa * 3))
        const start = 0.04 + 0.16 * sub
        const len = 0.45 + 0.5 * hash(i * 3.1 + j * 5.7)
        const solid = hb > 0.12 && fa > margin * 0.5 && fa < 1 - margin * 0.5 && fq > start && fq < start + len
        const along = solid ? (fq - start) / len : 0
        // How many real pixels a cell spans, across and along: under a few, its buildings blur into an even tone.
        const across = ((rho * TAU) / NA) * Math.hypot(Math.cos(psi) * t * LATERAL, Math.sin(psi) * t * t)
        const length = rho * 0.18 * Math.hypot(Math.sin(psi) * t * LATERAL, Math.cos(psi) * t * t)
        const span = (Math.min(across, length * 0.6) * H) / px
        const detail = smoothstep(1.2, 3.5, span)
        const out = Math.max(0, rho - Rg) / Rg
        const forward = 0.4 + 0.6 * Math.max(0, Math.cos(psi))
        const district = 0.4 + 1.2 * fbm2(u * 3, (y / H) * 6, 3)
        // Shade of the roof color, how much of the base's light lands, and how much of a ray.
        const tone = solid ? (0.55 + 0.45 * hb) * (1 - 0.5 * along) : 0.25
        const light = solid ? Math.exp(-along / 0.18) * 1.2 + 0.08 : 0.3
        const ray = solid ? 0.35 * Math.exp(-along / 0.3) : 1
        const kTone = lerp(0.45, tone, detail) * district
        const kLight = lerp(0.35, light, detail)
        const kRay = lerp(0.5, ray, detail)
        // The blaze at the foot, broken by the buildings standing in it; the spill across the city, strongest toward
        // the viewer; and the rays.
        const blaze = 1.6 * Math.exp(-out / 0.06) * lerp(0.6, solid ? 0.35 + 0.65 * Math.exp(-along / 0.25) : 1, detail)
        const L = blaze + look.reach * forward * (0.55 * Math.exp(-out / 0.3) + 0.2 * Math.exp(-out / 1.6)) * kLight * district
        const r = clamp(Math.floor((psi / TAU + 0.5) * RAY_N), 0, RAY_N - 1)
        const rayLight = this.rays[r] * Math.exp(-out / 2.5) * kRay * look.reach
        const p = y * W + x
        const o = p * 3
        for (let c = 0; c < 3; c++) {
          const amb = lerp(look.street[c], look.roof[c], kTone)
          const add = g[c] * (L + rayLight * 0.5) * haze
          hdr[o + c] = lerp(look.haze[c], amb, haze) + add
          this.glowAdd[o + c] = add
        }
        this.rayAdd[p] = rayLight * haze
        this.rho[p] = rho
        this.phases[p] = this.rayPhases[r]
      }
    }
  }

  private drawRipples() {
    const rings = this.rings
    if (this.activity === "calm" && !rings.length) return
    const H = this.H
    if (this.ringData.length < rings.length * 4) this.ringData = new Float32Array(rings.length * 4 + 8)
    for (const [i, r] of rings.entries()) this.ringData.set([r.x * H, r.y * H, r.r, r.strength * (1 - r.r / 1.4)], i * 4)
    const amp = this.activity === "calm" ? 0 : 1
    ripples(this.hdr, this.W, H, this.skyRows, this.tex, this.dist, this.look.ripple, amp, this.time * 0.3, this.ringData, rings.length, this.cx * H)
  }

  private stepFlash(dt: number) {
    const f = this.flash
    if (f.t >= 0) {
      f.t += dt
      if (f.t > 0.9) f.t = -1
      return
    }
    f.wait -= dt
    if (f.wait > 0) return
    f.wait = rand(8, 20)
    f.t = 0
    const side = Math.random() < 0.5 ? -1 : 1
    f.x = this.cx + side * rand(this.R + 0.12, Math.max(this.R + 0.16, this.A / 2 - 0.06))
  }

  // Lightning flickering inside the cloud ring: two quick pulses of light from within.
  private drawFlash() {
    const f = this.flash
    const H = this.H
    const k = Math.exp(-(((f.t - 0.1) / 0.06) ** 2)) + 0.6 * Math.exp(-(((f.t - 0.4) / 0.1) ** 2))
    if (k < 0.02) return
    lightPool(this.hdr, this.W, H, f.x * H, (HORIZON - 0.04) * H, 0.2 * H, 0.06 * H, this.look.bolt, 2.4 * k, 0.025 * k)
  }

  // A chunk of rubble floating up around the dome, lit from below by its foot; it grows out of the ground and shrinks
  // away as it rises. Those behind the dome are hidden by it.
  private drawChunk(c: Chunk) {
    const top = this.activity === "teeming" ? 0.42 : 0.34
    const s = c.size * smoothstep(0, 0.025, c.lift) * smoothstep(top, top * 0.6, c.lift)
    const x = this.cx + Math.cos(c.a) * c.r * this.R
    const y = BASE + Math.sin(c.a) * c.r * this.R * FOOT - c.lift
    this.drawRubble(x, y, s, c.spin)
  }

  // A puff of dust where a click kicked up rubble, lit by the base and settling.
  private drawPuff(p: { x: number; y: number; age: number }) {
    const k = 1 - p.age / 3
    const H = this.H
    lightPool(this.hdr, this.W, H, p.x * H, (p.y - 0.02 * p.age) * H, (0.03 + 0.012 * p.age) * H, (0.02 + 0.008 * p.age) * H, this.look.glow, 3 * k, 0.35 * k * k * this.look.reach)
  }

  private drawRubble(x: number, y: number, size: number, spin: number, lighting = this.lighting) {
    if (size <= 0.001) return
    const H = this.H
    const s = Math.max(size * H, this.cells ? 1.4 : 0.7)
    const color = this.paint([0.1, 0.12, 0.11])
    this.shape([ell(x * H, y * H, s, s * 0.65, spin, color), ell(x * H + Math.cos(spin + 1.2) * s * 0.6, y * H + Math.sin(spin + 1.2) * s * 0.4, s * 0.55, s * 0.4, spin + 0.8, color)], lighting, 0.6)
  }

  private stepVisitor(cdt: number) {
    const v = this.visitor
    if (!v) return
    v.x += v.dir * 0.3 * cdt
    if (v.x < -0.3 || v.x > this.A + 0.3) this.visitor = undefined
  }

  // A military gunship crossing over the cloud ring, its belly lit by the dome, its lamps blinking and a short
  // searchlight cone under it.
  private drawVisitor() {
    const v = this.visitor
    if (!v) return
    const H = this.H
    const x = v.x * H
    const y = v.y * H
    const s = 0.036 * H
    const d = v.dir
    const beam = this.look.bolt
    for (let i = 1; i <= 3; i++) this.polygon([[x - s * 0.15, y + s * 0.3], [x + s * 0.15, y + s * 0.3], [x + s * (0.15 + 0.3 * i), y + s * (0.3 + 1.2 * i)], [x - s * (0.15 + 0.3 * i), y + s * (0.3 + 1.2 * i)]], [beam[0] * 0.4, beam[1] * 0.4, beam[2] * 0.4], 0.07)
    const body = this.paint([0.32, 0.34, 0.33])
    this.shape([ell(x, y, s, s * 0.34, 0, body), cap(x - d * s * 0.7, y - s * 0.06, x - d * s * 2, y - s * 0.16, s * 0.15, s * 0.06, body), ell(x - d * s * 2, y - s * 0.3, s * 0.06, s * 0.2, 0, body), cap(x - s * 0.5, y + s * 0.3, x + s * 0.5, y + s * 0.3, s * 0.05, s * 0.05, body)], this.lighting, 0.8)
    const r = this.paint([0.4, 0.4, 0.42])
    this.ellipse(x, y - s * 0.44, s * 1.5, Math.max(s * 0.05, this.cells ? 1 : 0.5), r[0], r[1], r[2], 0.5)
    const t = this.creatureTime * 8
    if (Math.sin(t) > 0.4) this.disc(x - d * s * 2, y - s * 0.45, Math.max(s * 0.09, 1), 1.8, 0.08, 0.05, 1)
    if (Math.sin(t + 2.1) > 0.6) this.disc(x + d * s * 0.6, y + s * 0.25, Math.max(s * 0.08, 1), 1.6, 0.8, 0.1, 1)
  }

  private stepBike(dt: number, cdt: number) {
    const b = this.bike
    for (const p of b.trail) p.age += dt
    b.trail = b.trail.filter((p) => p.age < 5)
    if (b.t < 0) {
      b.wait -= dt
      if (b.wait > 0) return
      b.t = 0
      return
    }
    b.t += cdt
    const [x, y] = this.bikeAt(b.t)
    const last = b.trail.at(-1)
    if (b.t < BIKE && (!last || Math.hypot(x - last.x, y - last.y) > 0.006)) b.trail.push({ x, y, age: 0 })
    if (b.t < BIKE || b.trail.length) return
    b.t = -1
    b.wait = eggWait(true) * TIME_SCALE
  }

  // The bike's path: in from the left along the bottom, swinging up and across.
  private bikeAt(t: number): [number, number] {
    const s = t / BIKE
    return [-0.1 + (this.A + 0.2) * s, 0.92 - 0.06 * Math.sin(s * Math.PI)]
  }

  // The red tail light's streak across the city and the light at its head.
  private drawBike() {
    const b = this.bike
    const H = this.H
    const r = Math.max(0.004 * H, this.cells ? 1.2 : 0.6)
    for (const p of b.trail) this.ellipse(p.x * H, p.y * H, r * 1.6, r, 1.8, 0.06, 0.04, 0.6 * (1 - p.age / 5))
    if (b.t >= BIKE) return
    const [x, y] = this.bikeAt(b.t)
    lightPool(this.hdr, this.W, H, x * H, y * H, 0.05 * H, 0.03 * H, [1, 0.08, 0.05], 3, 0.15)
    this.disc(x * H, y * H, r * 1.2, 2.4, 0.15, 0.08, 1)
  }
}

// How far inside the dome (x, y) is, in pixels; negative outside. The dome is the upper half of a sphere of radius R
// over (cx, by) and, below that line, its foot: a half-ellipse foot * R deep.
function insideDome(x: number, y: number, cx: number, by: number, R: number, foot: number) {
  const dx = x - cx
  const dy = y - by
  if (dy <= 0) return R - Math.hypot(dx, dy)
  const ry = R * foot
  const r = Math.hypot(dx / R, dy / ry)
  const grad = Math.hypot(dx / (R * R), dy / (ry * ry))
  return r > 0 ? ((1 - r) * r) / Math.max(grad, 1e-6) : ry
}

// The dome: pure black, its top catching a faint rim of sky and its lower half blazing up from the foot in the base's
// light, scaled by glow.
function fillDome(hdr: Float32Array, W: number, H: number, cx: number, by: number, R: number, foot: number, body: RGB, rim: RGB, light: RGB, glow: number, unit: number) {
  const x0 = Math.max(0, Math.floor(cx - R - 1))
  const x1 = Math.min(W - 1, Math.ceil(cx + R + 1))
  const y0 = Math.max(0, Math.floor(by - R - 1))
  const y1 = Math.min(H - 1, Math.ceil(by + R * foot + 1))
  touch(hdr, x0, y0, x1, y1)
  const rimW = Math.max(0.03 * R, 1.2 * unit)
  const footW = 0.035 * R
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const sd = insideDome(x + 0.5, y + 0.5, cx, by, R, foot)
      const cov = clamp(sd + 0.5, 0, 1)
      if (cov <= 0) continue
      const dy = y + 0.5 - by
      const inner = Math.max(0, sd)
      const sky = Math.exp(-inner / rimW) * Math.sqrt(Math.max(0, -dy / R))
      const low = smoothstep(-0.45 * R, R * foot, dy)
      const g = glow * low * (Math.exp(-inner / footW) * 1.2 + 0.05 * low * low)
      const o = (y * W + x) * 3
      for (let c = 0; c < 3; c++) hdr[o + c] += (body[c] + rim[c] * sky + light[c] * g - hdr[o + c]) * cov
    }
}

// Breathes the base's light by k (the change from the still frame's level) and runs pulses outward along its rays,
// over the pixels in list.
function shine(hdr: Float32Array, list: Int32Array, glowAdd: Float32Array, rayAdd: Float32Array, rho: Float32Array, phases: Float32Array, glow: RGB, k: number, pulse: number, time: number) {
  for (let n = 0; n < list.length; n++) {
    const p = list[n]
    const o = p * 3
    const ray = rayAdd[p]
    let extra = 0
    if (pulse > 0 && ray > 0.01) {
      const w = 0.5 + 0.5 * Math.sin(rho[p] * 1.3 - time * 0.9 + phases[p])
      extra = pulse * ray * w * w * w * w
    }
    hdr[o] += glowAdd[o] * k + glow[0] * extra
    hdr[o + 1] += glowAdd[o + 1] * k + glow[1] * extra
    hdr[o + 2] += glowAdd[o + 2] * k + glow[2] * extra
  }
}

// Adds the ripples in the cloud layer over the sky's rows: rings around the middle spreading with phase, scaled by
// amp (0 leaves them to the still frame), and shock rings rolling out ([x, y in pixels, radius, strength, ...]), all
// showing through the layer's texture. dist is each pixel's flattened distance from the middle.
function ripples(hdr: Float32Array, W: number, H: number, rows: number, tex: Float32Array, dist: Float32Array, color: RGB, amp: number, phase: number, rings: Float32Array, count: number, cx: number) {
  const x0 = count === 0 ? Math.max(0, Math.floor(cx - 1.2 * H)) : 0
  const x1 = count === 0 ? Math.min(W - 1, Math.ceil(cx + 1.2 * H)) : W - 1
  touch(hdr, x0, 0, x1, rows - 1)
  for (let y = 0; y < rows; y++)
    for (let x = x0; x <= x1; x++) {
      const p = y * W + x
      const t = tex[p]
      if (t <= 0.01) continue
      let k = 0
      const d = dist[p]
      if (amp > 0 && d < 1.2) {
        const w = 0.5 + 0.5 * Math.cos(d * RINGS - phase)
        k += amp * w * w * w * smoothstep(1.2, 0.1, d) * (0.6 + 0.6 * smoothstep(0.5, 0, d))
      }
      for (let i = 0; i < count; i++) {
        const dx = (x + 0.5 - rings[i * 4]) / H
        const dy = (y + 0.5 - rings[i * 4 + 1]) / H / RIPPLE_FLAT
        const e = (Math.hypot(dx, dy) - rings[i * 4 + 2]) / 0.035
        if (e > -3 && e < 3) k += rings[i * 4 + 3] * Math.exp(-e * e)
      }
      if (k <= 0) continue
      const o = p * 3
      hdr[o] += color[0] * t * k
      hdr[o + 1] += color[1] * t * k
      hdr[o + 2] += color[2] * t * k
    }
}

export const dome: Wallpaper = {
  id: "dome",
  name: "Dome",
  description: "A vast black energy dome over a ruined city, its foot blazing with light under a ring of clouds, with a gunship crossing now and then",
  fixedTime: "night",
  activity: {
    calm: "The dome, its slowly breathing light and the creeping cloud ring",
    lively: "Light pulses out along the streets, rubble floats up and the sky's ripples spread",
    teeming: "The dome swells and recedes, shockwaves roll through the clouds, rubble swirls up and lightning flickers",
  },
  scrim: {
    day: [
      [52, 56, 58],
      [44, 48, 46],
      [34, 40, 34],
    ],
    sunset: [
      [26, 8, 10],
      [44, 16, 10],
      [14, 8, 6],
    ],
    night: [
      [2, 4, 12],
      [2, 6, 10],
      [1, 7, 5],
    ],
  },
  create: (settings) => new Dome(settings),
}

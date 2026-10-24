import { Canvas, cap, ell, type Lighting, type Part } from "../src/canvas"
import { eggWait } from "../src/egg"
import { lightPool } from "../src/light"
import { TAU, clamp, fbm1, fbm2, hash, hash2, lerp, rand, smoothstep, type RGB } from "../src/math"
import type { Activity, Settings, Time, Wallpaper } from "../src/wallpaper"

// The scene runs slower than real time, which keeps it calm behind text.
const TIME_SCALE = 0.35
// Spacecraft and drifting objects move at a quarter of scene speed.
const CREATURE_SPEED = 0.25
// The planet's surface map, generated once.
const TW = 512
const TH = 256

// Where the planet sits and how big it is, in screen heights: its center x from the right edge, so it rises in the
// lower right clear of the text in the middle, and its center y and radius.
const PLANET = { x: 0.52, y: 1.1, r: 0.58 }
const RING = { tilt: 0.42, flat: 0.24, inner: 1.25, outer: 2.1 }
// How long a shooting star lasts, in scene seconds.
const METEOR = 1.2

// The times of day are where we are over the planet: its sunlit side, an orbital sunrise with the star at its edge,
// or its night side with city lights.
interface Look {
  // Direction light comes from (x right, y down, z toward the viewer).
  sun: readonly [number, number, number]
  starK: number
  nebula: [RGB, RGB]
  milkyWay: number
  atmosphere: RGB
  ring: number
  lighting: "front" | "limb" | "night"
  // Darkens spacecraft colors away from the sunlit side, leaving the edge light to pick them out.
  tint: RGB
  ringColor: RGB
  rockColor: RGB
  // Stars come in a few colors at night rather than plain white, so they read apart from light text.
  starTints: boolean
}

const LOOKS: Record<Time, Look> = {
  day: {
    sun: normalize(-0.55, -0.55, 0.62),
    starK: 0.35,
    nebula: [
      [0.02, 0.06, 0.1],
      [0.03, 0.03, 0.08],
    ],
    milkyWay: 0.25,
    atmosphere: [0.25, 0.5, 1],
    ring: 1,
    lighting: "front",
    tint: [1, 1, 1],
    ringColor: [0.78, 0.64, 0.46],
    rockColor: [0.62, 0.54, 0.46],
    starTints: false,
  },
  sunset: {
    sun: normalize(-0.5, -0.48, -0.72),
    starK: 0.6,
    nebula: [
      [0.09, 0.02, 0.07],
      [0.08, 0.04, 0.02],
    ],
    milkyWay: 0.5,
    atmosphere: [1, 0.5, 0.2],
    ring: 0.45,
    lighting: "limb",
    tint: [0.3, 0.26, 0.28],
    ringColor: [0.85, 0.62, 0.45],
    rockColor: [0.75, 0.62, 0.55],
    starTints: false,
  },
  night: {
    sun: normalize(0.6, 0.6, -0.5),
    starK: 1,
    nebula: [
      [0.08, 0.025, 0.14],
      [0.025, 0.055, 0.12],
    ],
    milkyWay: 1.3,
    atmosphere: [0.2, 0.35, 0.8],
    ring: 0.12,
    lighting: "night",
    tint: [0.05, 0.06, 0.09],
    ringColor: [0.35, 0.4, 0.9],
    rockColor: [0.4, 0.5, 0.95],
    starTints: true,
  },
}

const SURFACE = buildSurface()
const WHITE_STAR: RGB = [1, 0.97, 1.1]
const STAR_TINTS: RGB[] = [
  [0.55, 0.75, 1.2],
  [1.15, 0.85, 0.45],
  [1.1, 0.6, 0.85],
  [0.7, 0.6, 1.2],
]

interface Traveler {
  x: number
  y: number
  dir: number
  wait: number
}

interface Rock {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  spin: number
  angle: number
  seed: number
}

class Space extends Canvas {
  private time = 0
  private creatureTime = 0
  private readonly activity: Activity
  private readonly look: Look
  private lighting: Lighting = { style: "front", dir: [0, 0, 1] }
  // The near half of the rings, premultiplied by their alpha, drawn over the planet each frame. fineRing is the
  // supersampled layout pass's, box-filtered, for the real-size pass.
  private ringFront = new Float32Array(0)
  private fineRing: Float32Array<ArrayBuffer> | undefined
  private nebula: Float32Array | undefined
  private ringBox = [0, 0, 0, 0]
  private ringMask = new Uint8Array(0)
  private starPos: [number, number] = [0, 0]
  private stars = Array.from({ length: 320 }, (_, i) => ({ x: Math.random() * 3, y: Math.random(), layer: i % 3, b: 0.3 + Math.random() * 0.7, phase: Math.random() * TAU, tint: STAR_TINTS[i % STAR_TINTS.length] }))
  private comet = { x: -9, y: 0, vx: 0, vy: 0, next: 14 }
  private ufo = { x: -9, y: 0.2, dir: 1, next: 30 }
  private station: Traveler = { x: 0.2, y: 0.24, dir: 1, wait: 0 }
  private satellite: Traveler = { x: 1.4, y: 0.15, dir: -1, wait: 0 }
  private rocks: Rock[] = []
  private meteors: { x: number; y: number; vx: number; vy: number; age: number }[] = []
  // The easter egg: a long starship cruises across the sky, engines glowing. x < -5 while it waits.
  private starship = { x: -9, y: 0.2, wait: eggWait() * TIME_SCALE }

  constructor(settings: Settings) {
    super()
    this.activity = settings.activity
    this.look = LOOKS[settings.time]
    if (settings.time === "day") this.frame = 0.25
    if (settings.activity === "teeming")
      this.rocks = Array.from({ length: 6 }, (_, i) => ({
        x: Math.random() * 2,
        y: 0.08 + Math.random() * 0.45,
        vx: -(0.02 + Math.random() * 0.03),
        vy: (Math.random() - 0.5) * 0.01,
        r: 0.012 + Math.random() * 0.022,
        spin: (Math.random() - 0.5) * 0.6,
        angle: Math.random() * TAU,
        seed: i * 13.7,
      }))
  }

  step(dt: number) {
    dt = clamp(dt, 0, 0.1) * TIME_SCALE
    this.time += dt
    const cdt = dt * CREATURE_SPEED
    this.creatureTime += cdt
    for (const s of this.stars) {
      s.x -= (0.002 + s.layer * 0.003) * dt
      if (s.x < 0) s.x += this.A
    }
    this.stepComet(dt)
    this.stepGloom(dt)
    for (const m of this.meteors) {
      m.age += dt
      m.x += m.vx * dt
      m.y += m.vy * dt
    }
    this.meteors = this.meteors.filter((m) => m.age < METEOR)
    const ship = this.starship
    if (ship.x < -5) {
      ship.wait -= dt
      if (ship.wait <= 0) {
        ship.x = this.A + 0.4
        ship.y = rand(0.16, 0.24)
      }
    }
    if (ship.x > -5) {
      ship.x -= 0.1 * cdt
      if (ship.x < -0.4) {
        ship.x = -9
        ship.wait = eggWait(true) * TIME_SCALE
      }
    }
    if (this.activity !== "calm") {
      this.travel(this.station, 0.12, 20, cdt)
      this.travel(this.satellite, 0.18, 30, cdt)
    }
    if (this.activity === "teeming") {
      for (const r of this.rocks) {
        r.x += r.vx * cdt
        r.y += r.vy * cdt
        r.angle += r.spin * cdt
        if (r.x < -0.1) {
          r.x = this.A + 0.1
          r.y = rand(0.08, 0.5)
        }
      }
      this.stepUfo(dt)
    }
  }

  // A shooting star streaks away from the click, falling toward the planet.
  poke(x: number, y: number) {
    const dir = x < this.A / 2 ? 1 : -1
    this.meteors.push({ x, y, vx: dir * rand(0.25, 0.35), vy: rand(0.08, 0.15), age: 0 })
  }

  render() {
    this.restore()
    this.drawStars()
    this.drawMoon()
    this.drawPlanet()
    this.drawRingFront()
    this.drawStarGlare()
    this.drawComet()
    this.drawMeteors()
    if (this.activity !== "calm") {
      this.drawSatellite()
      this.drawStation()
    }
    if (this.starship.x > -5) this.drawStarship()
    if (this.activity === "teeming") {
      for (const r of this.rocks) this.drawRock(r)
      this.drawAstronaut()
      this.drawUfo()
    }
    this.finish()
  }

  protected override visit() {
    if (this.comet.x < -5) this.comet.next = 0
  }

  // The nebula, the Milky Way and the far half of the rings never move, so they are painted once per size.
  protected override layout() {
    const { W, H, A, look } = this
    const cx = W - PLANET.x * H
    const cy = PLANET.y * H
    const R = PLANET.r * H
    this.starPos = look.lighting === "front" ? [0.14 * W, 0.14 * H] : [cx + R * look.sun[0] / Math.hypot(look.sun[0], look.sun[1]), cy + R * look.sun[1] / Math.hypot(look.sun[0], look.sun[1])]
    this.lighting =
      look.lighting === "front"
        ? { style: "front", dir: look.sun }
        : look.lighting === "limb"
          ? { style: "rim", color: [1, 0.6, 0.3], x: this.starPos[0], y: this.starPos[1] }
          : { style: "rim", color: [0.3, 0.6, 1.5], x: cx, y: cy }
    // The nebula is smooth, so it is worked out once per real pixel, in the first layout pass, and spread over the
    // pixels of each pass.
    const px = this.px
    const nebula = this.nebula ?? this.makeNebula(W / px, H / px)
    this.nebula = px > 1 ? nebula : undefined
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const s = (Math.floor(y / px) * (W / px) + Math.floor(x / px)) * 3
        const o = (y * W + x) * 3
        this.hdr[o] = nebula[s]
        this.hdr[o + 1] = nebula[s + 1]
        this.hdr[o + 2] = nebula[s + 2]
      }
    // Rings: bands of dust in a tilted, flattened annulus. The far half is painted now, behind the planet; the near
    // half is kept to draw over it each frame.
    this.ringFront = new Float32Array(W * H * 4)
    this.ringMask = new Uint8Array(W * H)
    const ext = RING.outer * R
    const x0 = Math.max(0, Math.floor(cx - ext))
    const x1 = Math.min(W - 1, Math.ceil(cx + ext))
    const y0 = Math.max(0, Math.floor(cy - ext * 0.6))
    const y1 = H - 1
    this.ringBox = [x0, y0, x1, y1]
    const ct = Math.cos(RING.tilt)
    const st = Math.sin(RING.tilt)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx
        const dy = y + 0.5 - cy
        const qx = dx * ct + dy * st
        const qy = (-dx * st + dy * ct) / RING.flat
        const rho = Math.hypot(qx, qy) / R
        if (rho < RING.inner || rho > RING.outer) continue
        const gap = 1 - 0.85 * Math.exp(-(((rho - 1.72) / 0.035) ** 2))
        const density = (0.55 + 0.45 * Math.sin(rho * 55) * Math.sin(rho * 13 + 1)) * gap * smoothstep(RING.inner, RING.inner + 0.08, rho) * smoothstep(RING.outer, RING.outer - 0.1, rho)
        const a = 0.75 * density
        const k = look.ring * (0.6 + 0.4 * density)
        const o = y * W + x
        // By day the bands alternate between warm tan and cool gray dust.
        const warm = look.lighting === "front" ? 0.16 * Math.sin(rho * 9 + 1) : 0
        const rr = look.ringColor[0] * (1 + warm)
        const rg = look.ringColor[1]
        const rb = look.ringColor[2] * (1 - warm * 1.5)
        if (qy < 0) {
          this.blend(o * 3, rr * k, rg * k, rb * k, a)
          if (a > 0.3) this.ringMask[o] = 1
          continue
        }
        this.ringFront[o * 4] = rr * k * a
        this.ringFront[o * 4 + 1] = rg * k * a
        this.ringFront[o * 4 + 2] = rb * k * a
        this.ringFront[o * 4 + 3] = a
      }
    if (this.px > 1) this.fineRing = this.shrink(this.ringFront, 4)
    else if (this.fineRing) {
      this.ringFront = this.fineRing
      this.fineRing = undefined
    }
  }

  // The nebulae and the Milky Way at w by h pixels.
  private makeNebula(w: number, h: number) {
    const look = this.look
    const [n1, n2] = look.nebula
    const out = new Float32Array(w * h * 3)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const u = x / h
        const v = y / h
        const a = smoothstep(0.45, 0.85, fbm2(u * 2.2, v * 2.2, 5))
        const b = smoothstep(0.5, 0.9, fbm2(u * 3.1 + 7, v * 3.1 + 3, 5))
        const band = Math.abs(v - (0.15 + u * 0.25)) / 0.12
        const milky = Math.exp(-band * band) * (0.4 + 0.6 * fbm2(u * 9, v * 9, 4)) * 0.06 * look.milkyWay
        const o = (y * w + x) * 3
        const [mr, mg] = look.starTints ? [0.55, 0.4] : [0.85, 0.85]
        out[o] = 0.004 + n1[0] * a + n2[0] * b + milky * mr
        out[o + 1] = 0.005 + n1[1] * a + n2[1] * b + milky * mg
        out[o + 2] = 0.012 + n1[2] * a + n2[2] * b + milky
      }
    return out
  }

  private paint(c: RGB): RGB {
    const t = this.look.tint
    return [c[0] * t[0], c[1] * t[1], c[2] * t[2]]
  }

  // Stars in three depths drifting left at different speeds, dimmed by the glare on the sunlit side.
  private drawStars() {
    const { W, H, look } = this
    for (const s of this.stars) {
      const x = s.x * H
      const y = s.y * H
      const i = (y | 0) * W + (x | 0)
      if (x < 0 || x >= W || y >= H || this.ringMask[i]) continue
      const k = s.b * (0.4 + s.layer * 0.3) * look.starK * (s.b > 0.85 ? 0.75 + 0.25 * Math.sin(this.time * 1.5 + s.phase) : 1) * 0.5
      const t = look.starTints ? s.tint : WHITE_STAR
      this.point(x, y, k * t[0], k * t[1], k * t[2], s.b > 0.9 ? 3 : s.b > 0.65 ? 2 : 1, true)
    }
  }

  // The planet: continents, ice and clouds from the surface map, turning slowly; sunlight, an atmospheric glow at
  // the edge, and on the dark side city lights and aurora.
  private drawPlanet() {
    const { W, H, hdr, look } = this
    const cx = W - PLANET.x * H
    const cy = PLANET.y * H
    const R = PLANET.r * H
    const rot = this.time * 0.02
    const cr = Math.cos(rot)
    const sr = Math.sin(rot)
    const [Lx, Ly, Lz] = look.sun
    const pad = 0.1 * R
    const lsx = Lx / (Math.hypot(Lx, Ly) || 1)
    const lsy = Ly / (Math.hypot(Lx, Ly) || 1)
    this.touch(cx - R - pad - 1, cy - R - pad - 1, cx + R + pad + 1, H - 1)
    for (let y = Math.max(0, Math.floor(cy - R - pad)); y < H; y++)
      for (let x = Math.max(0, Math.floor(cx - R - pad)); x <= Math.min(W - 1, Math.ceil(cx + R + pad)); x++) {
        const dx = (x + 0.5 - cx) / R
        const dy = (y + 0.5 - cy) / R
        const r2 = dx * dx + dy * dy
        const r = Math.sqrt(r2)
        const o = (y * W + x) * 3
        const facing = (dx * lsx + dy * lsy) / (r || 1)
        const glowLit = look.lighting === "night" ? 0.25 : look.lighting === "limb" ? 0.2 + 1.6 * Math.max(0, facing) ** 4 : 0.3 + 0.7 * Math.max(0, facing)
        if (r > 1) {
          // At night a wide band of airglow rises off the limb, so whatever passes in front of it reads dark.
          const halo = Math.exp(-(r - 1) / 0.025) * glowLit * 0.6 + (look.lighting === "night" ? Math.exp(-(r - 1) / 0.09) * 0.07 : 0)
          hdr[o] += look.atmosphere[0] * halo
          hdr[o + 1] += look.atmosphere[1] * halo
          hdr[o + 2] += look.atmosphere[2] * halo
          continue
        }
        const nz = Math.sqrt(1 - r2)
        const diffuse = Math.max(0, dx * Lx + dy * Ly + nz * Lz)
        const X = dx * cr + nz * sr
        const Z = -dx * sr + nz * cr
        const lon = (Math.atan2(X, Z) / TAU + 1) % 1
        const lat = Math.asin(clamp(-dy, -1, 1)) / Math.PI + 0.5
        const t = (Math.min(TH - 1, (lat * TH) | 0) * TW + ((lon * TW) | 0)) % (TW * TH)
        const cloud = SURFACE.cloud[t]
        const light = 0.03 + 1.15 * diffuse
        let cr0 = SURFACE.albedo[t * 3] * light
        let cg0 = SURFACE.albedo[t * 3 + 1] * light
        let cb0 = SURFACE.albedo[t * 3 + 2] * light
        const cl = 0.04 + 1.2 * diffuse
        cr0 += (cl - cr0) * cloud * 0.85
        cg0 += (cl - cg0) * cloud * 0.85
        cb0 += (cl * 1.02 - cb0) * cloud * 0.85
        const city = SURFACE.city[t] * (1 - smoothstep(0, 0.12, diffuse)) * (1 - cloud * 0.7)
        cr0 += city * 1
        cg0 += city * 0.72
        cb0 += city * 0.35
        const edge = Math.pow(1 - nz, 3) * glowLit * 1.2
        cr0 += look.atmosphere[0] * edge
        cg0 += look.atmosphere[1] * edge
        cb0 += look.atmosphere[2] * edge
        if (look.lighting === "night") {
          const latitude = lat - 0.5
          const aurora = smoothstep(0.28, 0.36, latitude) * (1 - smoothstep(0.4, 0.47, latitude)) * (0.5 + 0.5 * Math.sin(lon * 70 + this.time * 0.6)) * 0.35
          cr0 += 0.1 * aurora
          cg0 += 0.9 * aurora
          cb0 += 0.4 * aurora
        }
        this.blend(o, cr0, cg0, cb0, clamp((1 - r) * R + 0.5, 0, 1))
      }
  }

  private drawRingFront() {
    const [x0, y0, x1, y1] = this.ringBox
    const { W, ringFront } = this
    this.touch(x0, y0, x1, y1)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const o = y * W + x
        const a = ringFront[o * 4 + 3]
        if (a <= 0) continue
        const i = o * 3
        this.hdr[i] = this.hdr[i] * (1 - a) + ringFront[o * 4]
        this.hdr[i + 1] = this.hdr[i + 1] * (1 - a) + ringFront[o * 4 + 1]
        this.hdr[i + 2] = this.hdr[i + 2] * (1 - a) + ringFront[o * 4 + 2]
      }
  }

  // The star: a white-hot point with diffraction spikes by day, or flaring at the planet's edge at sunrise.
  private drawStarGlare() {
    const { W, H, hdr, look } = this
    if (look.lighting === "night") return
    const [sx, sy] = this.starPos
    // After an error the star dims, as if behind a passing dust cloud.
    const strength = (look.lighting === "front" ? 1 : 1.4) * (1 - smoothstep(0, 1, this.gloom) * 0.6)
    const reach = 0.45 * H
    this.touch(sx - reach - 1, sy - reach - 1, sx + reach, sy + reach)
    for (let y = Math.max(0, Math.floor(sy - reach)); y < Math.min(H, sy + reach); y++)
      for (let x = Math.max(0, Math.floor(sx - reach)); x < Math.min(W, sx + reach); x++) {
        const dx = x + 0.5 - sx
        const dy = y + 0.5 - sy
        const d = Math.hypot(dx, dy) / H
        const spikes = Math.exp(-Math.abs(dx) / 1.2) * Math.exp(-Math.abs(dy) / (0.15 * H)) + Math.exp(-Math.abs(dy) / 1.2) * Math.exp(-Math.abs(dx) / (0.15 * H))
        const k = (Math.exp(-d / 0.012) * 4 + Math.exp(-d / 0.07) * 0.35 + spikes * 0.25) * strength
        const o = (y * W + x) * 3
        hdr[o] += k
        hdr[o + 1] += k * (look.lighting === "front" ? 0.95 : 0.7)
        hdr[o + 2] += k * (look.lighting === "front" ? 0.85 : 0.45)
      }
  }

  // A small grey moon, drifting along a gentle arc and lit like the planet.
  private drawMoon() {
    const { W, H, look } = this
    const a = this.creatureTime * 0.05
    const cx = (0.3 + 0.06 * Math.cos(a)) * H
    const cy = (0.24 + 0.025 * Math.sin(a)) * H
    const R = 0.035 * H
    // Cobalt rather than grey at night.
    const [mr, mg, mb] = look.lighting === "night" ? look.rockColor : [0.9, 0.9, 0.95]
    for (let y = Math.max(0, Math.floor(cy - R - 1)); y <= Math.min(H - 1, cy + R + 1); y++)
      for (let x = Math.max(0, Math.floor(cx - R - 1)); x <= Math.min(W - 1, cx + R + 1); x++) {
        const dx = (x + 0.5 - cx) / R
        const dy = (y + 0.5 - cy) / R
        const r2 = dx * dx + dy * dy
        if (r2 > 1.1) continue
        const nz = Math.sqrt(Math.max(0, 1 - r2))
        const lit = Math.max(0, dx * look.sun[0] + dy * look.sun[1] + nz * look.sun[2])
        const craters = 0.75 + 0.35 * fbm2(dx * 3 + 5, dy * 3 + 2, 4)
        const k = (0.015 + lit * 0.9) * craters
        this.blend((y * W + x) * 3, k * mr, k * mg, k * mb, clamp((1 - Math.sqrt(r2)) * R + 0.5, 0, 1))
      }
  }

  // Now and then a comet crosses, its tail streaming away from the star.
  private stepComet(dt: number) {
    const c = this.comet
    if (c.x < -5) {
      c.next -= dt
      if (c.next > 0) return
      const fromRight = Math.random() < 0.5
      c.x = fromRight ? this.A + 0.1 : -0.1
      c.y = rand(0.05, 0.3)
      c.vx = (fromRight ? -1 : 1) * 0.07
      c.vy = rand(0.005, 0.02)
      return
    }
    c.x += c.vx * dt
    c.y += c.vy * dt
    if (c.x < -0.4 || c.x > this.A + 0.4) {
      c.x = -9
      c.next = rand(40, 75)
    }
  }

  private drawComet() {
    const c = this.comet
    if (c.x < -5) return
    const H = this.H
    const hx = c.x * H
    const hy = c.y * H
    const [sx, sy] = this.look.lighting === "night" ? [hx + c.vx * H, hy + c.vy * H] : this.starPos
    const tl = Math.hypot(hx - sx, hy - sy) || 1
    const ux = (hx - sx) / tl
    const uy = (hy - sy) / tl
    for (let i = 0; i < 48; i++) {
      const t = i / 47
      const d = t * 0.25 * H
      const k = (1 - t) ** 1.6 * 0.5
      this.disc(hx + ux * d, hy + uy * d, 0.8 + t * 3, 0.5 * k, 0.75 * k, 1 * k, 0.5 * (1 - t))
    }
    this.disc(hx, hy, 1.4, 2.5, 2.8, 3, 1)
  }

  // Meteors: a bright head and a fading trail, flaring up and dying away; tinted rather than white at night.
  private drawMeteors() {
    const H = this.H
    const c = this.look.starTints ? STAR_TINTS[0] : WHITE_STAR
    for (const m of this.meteors) {
      const k = Math.sin((m.age / METEOR) * Math.PI)
      const v = Math.hypot(m.vx, m.vy)
      for (let i = 0; i < 48; i++) {
        const t = i / 47
        const d = t * 0.12 * H
        const a = (1 - t) * k
        this.splat(m.x * H - (m.vx / v) * d, m.y * H - (m.vy / v) * d, c[0] * a, c[1] * a, c[2] * a)
      }
      this.disc(m.x * H, m.y * H, 1.1, c[0] * 1.3, c[1] * 1.3, c[2] * 1.3, k)
    }
  }

  // A long starship gliding across: a tapered hull with a raised bridge, two engine pods trailing blue glow, rows
  // of amber windows and blinking running lights.
  private drawStarship() {
    const H = this.H
    const s = this.starship
    const S = 0.55 * H
    const x = s.x * H
    const y = s.y * H
    const P = (u: number, v: number): [number, number] => [x - u * S, y + v * S]
    const hull = this.paint([0.7, 0.72, 0.78])
    const dark = this.paint([0.35, 0.37, 0.42])
    this.shape(
      [
        cap(...P(-0.45, 0.04), ...P(-0.1, 0.06), 0.022 * S, 0.02 * S, dark),
        cap(...P(-0.45, -0.04), ...P(-0.1, -0.06), 0.022 * S, 0.02 * S, dark),
        cap(...P(-0.4, 0), ...P(0.5, 0), 0.05 * S, 0.012 * S, hull),
        cap(...P(-0.15, -0.045), ...P(0.05, -0.04), 0.02 * S, 0.014 * S, hull),
        ell(...P(0.08, -0.04), 0.035 * S, 0.012 * S, 0, hull),
      ],
      this.lighting,
      0.8,
    )
    for (let i = 0; i < 10; i++) this.splat(...P(-0.3 + i * 0.06, 0.008), 1.3, 0.65, 0.12)
    for (const v of [-0.04, 0.04]) {
      const [ex, ey] = P(-0.47, v)
      this.disc(ex, ey, 0.016 * S, 0.35, 1, 2.2, 0.9)
      this.splat(ex, ey, 0.3, 0.8, 1.6)
    }
    const blink = Math.sin(this.time * 3) > 0.7 ? 1.5 : 0
    this.splat(...P(-0.1, -0.075), blink, 0.1 * blink, 0.1 * blink)
    this.splat(...P(-0.1, 0.075), 0.1 * blink, blink, 0.2 * blink)
  }

  // Spacecraft cross the sky slowly, wait offscreen, then come back.
  private travel(t: Traveler, speed: number, pause: number, dt: number) {
    if (t.wait > 0) {
      t.wait -= dt
      if (t.wait <= 0) t.x = t.dir > 0 ? -0.3 : this.A + 0.3
      return
    }
    t.x += t.dir * speed * dt
    if (t.x < -0.35 || t.x > this.A + 0.35) t.wait = pause
  }

  // A space station: a long truss with modules in the middle and pairs of ribbed solar panels, lights blinking.
  private drawStation() {
    const t = this.station
    if (t.wait > 0) return
    const H = this.H
    const S = 0.18 * H
    const x = t.x * H
    const y = (0.3 + 0.05 * Math.sin(t.x * 2)) * H
    const a = 0.12 * Math.sin(this.creatureTime * 0.1)
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const P = (u: number, v: number): [number, number] => [x + (u * ca - v * sa) * S, y + (u * sa + v * ca) * S]
    const panel = this.paint([0.18, 0.22, 0.5])
    const white = this.paint([0.8, 0.8, 0.82])
    const parts: Part[] = [cap(...P(-0.5, 0), ...P(0.5, 0), 0.012 * S, 0.012 * S, this.paint([0.55, 0.55, 0.58]))]
    for (const u of [-0.42, -0.27, 0.27, 0.42]) parts.push(cap(...P(u, -0.22), ...P(u, -0.04), 0.055 * S, 0.055 * S, panel, 4), cap(...P(u, 0.04), ...P(u, 0.22), 0.055 * S, 0.055 * S, panel, 4))
    parts.push(cap(...P(-0.13, 0), ...P(0.13, 0), 0.045 * S, 0.045 * S, white), cap(...P(0, -0.12), ...P(0, 0.1), 0.035 * S, 0.035 * S, white), cap(...P(0.13, 0.02), ...P(0.2, 0.08), 0.02 * S, 0.02 * S, white))
    this.shape(parts, this.lighting, 0.8)
    // At night the modules' windows glow amber and light the panels beside them.
    if (this.look.lighting === "night") {
      lightPool(this.hdr, this.W, H, ...P(0, 0), 0.4 * S, 0.25 * S, [1, 0.6, 0.15], 3, 0.008)
      for (const u of [-0.08, 0, 0.08]) this.disc(...P(u, 0), 0.018 * S, 1.6, 0.85, 0.2, 0.9)
    }
    const blink = Math.sin(this.time * 4) > 0.6 ? 1.5 : 0
    this.splat(...P(0.5, 0), blink, 0.1 * blink, 0.1 * blink)
    this.splat(...P(-0.5, 0), 0.1 * blink, blink, 0.2 * blink)
  }

  // A small satellite with a gold body, two ribbed panels and a blinking red light.
  private drawSatellite() {
    const t = this.satellite
    if (t.wait > 0) return
    const H = this.H
    const S = 0.06 * H
    const x = t.x * H
    const y = (0.15 + t.x * 0.05) * H
    const P = (u: number, v: number): [number, number] => [x + u * S, y + v * S]
    const panel = this.paint([0.18, 0.22, 0.5])
    this.shape([cap(...P(-0.55, 0), ...P(-0.12, 0), 0.08 * S, 0.08 * S, panel, 3), cap(...P(0.12, 0), ...P(0.55, 0), 0.08 * S, 0.08 * S, panel, 3), cap(...P(-0.09, 0), ...P(0.09, 0), 0.08 * S, 0.08 * S, this.paint([0.8, 0.6, 0.2])), ell(...P(0, -0.13), 0.06 * S, 0.03 * S, 0, this.paint([0.75, 0.75, 0.78]))], this.lighting, 0.8)
    if (Math.sin(this.time * 3 + 1) > 0.7) this.splat(...P(0, 0.1), 1.5, 0.1, 0.1)
  }

  // A tumbling asteroid: a lumpy rock with a pitted surface, lit from the star's side.
  private drawRock(r: Rock) {
    const { W, H, look } = this
    const cx = r.x * H
    const cy = r.y * H
    const R = r.r * H
    for (let y = Math.max(0, Math.floor(cy - R * 1.3)); y <= Math.min(H - 1, cy + R * 1.3); y++)
      for (let x = Math.max(0, Math.floor(cx - R * 1.3)); x <= Math.min(W - 1, cx + R * 1.3); x++) {
        const dx = (x + 0.5 - cx) / R
        const dy = (y + 0.5 - cy) / R
        const theta = Math.atan2(dy, dx) - r.angle
        const edge = 1 + 0.22 * (fbm1(((theta / TAU + 1) % 1) * 6 + r.seed, 3) - 0.5) * 2
        const rr = Math.hypot(dx, dy) / edge
        if (rr > 1.05) continue
        const nz = Math.sqrt(Math.max(0, 1 - rr * rr))
        const lit = Math.max(0, (dx / edge) * look.sun[0] + (dy / edge) * look.sun[1] + nz * look.sun[2])
        const pits = 0.7 + 0.45 * fbm2(dx * 2.5 + Math.cos(r.angle) * 2 + r.seed, dy * 2.5 + Math.sin(r.angle) * 2, 4)
        const ambient = look.lighting === "night" ? 0.01 : 0.02
        // At night the planet's glow below rims the side of the rock facing it.
        const rim = look.lighting === "night" ? Math.pow(1 - nz, 2) * Math.max(0, ((dx / edge) * (W - PLANET.x * H - cx) + (dy / edge) * (PLANET.y * H - cy)) / Math.hypot(W - PLANET.x * H - cx, PLANET.y * H - cy)) * 0.6 : 0
        const k = (ambient + lit * 0.7 + rim) * pits
        this.blend((y * W + x) * 3, k * look.rockColor[0], k * look.rockColor[1], k * look.rockColor[2], clamp((1.05 - rr) * R, 0, 1))
      }
  }

  // An astronaut floating and turning slowly, gold visor catching the light.
  private drawAstronaut() {
    const H = this.H
    const t = this.creatureTime
    const x = (0.28 + 0.05 * Math.sin(t * 0.13)) * H
    const y = (0.6 + 0.03 * Math.sin(t * 0.21)) * H
    const a = t * 0.08
    const S = 0.09 * H
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const P = (u: number, v: number): [number, number] => [x + (u * ca - v * sa) * S, y + (u * sa + v * ca) * S]
    const suit = this.paint([0.88, 0.88, 0.9])
    const pack = this.paint([0.7, 0.7, 0.72])
    this.shape(
      [
        cap(...P(-0.03, -0.2), ...P(-0.03, 0.06), 0.14 * S, 0.13 * S, pack),
        cap(...P(0, 0.12), ...P(0.08, 0.42), 0.065 * S, 0.055 * S, suit),
        cap(...P(0.08, 0.12), ...P(0.22, 0.37), 0.065 * S, 0.055 * S, suit),
        ell(...P(0.04, -0.05), 0.16 * S, 0.2 * S, a, suit),
        cap(...P(0.12, -0.15), ...P(0.3, -0.02), 0.055 * S, 0.045 * S, suit),
        cap(...P(-0.06, -0.15), ...P(-0.22, 0.05), 0.055 * S, 0.045 * S, suit),
        ell(...P(0.06, -0.33), 0.13 * S, 0.13 * S, a, suit),
        ell(...P(0.11, -0.33), 0.085 * S, 0.075 * S, a, this.paint([0.9, 0.62, 0.18])),
      ],
      this.lighting,
      0.8,
    )
    if (this.look.lighting !== "night") this.add(...P(0.14, -0.36), 1.2, 1.1, 0.9)
    // At night the helmet lamp lights the suit and the dark around it amber.
    if (this.look.lighting !== "night") return
    lightPool(this.hdr, this.W, H, ...P(0.2, -0.33), 0.6 * S, 0.6 * S, [1, 0.6, 0.15], 2.5, 0.01)
    this.disc(...P(0.12, -0.33), 0.06 * S, 1.2, 0.6, 0.12, 0.8)
  }

  // Now and then a flying saucer glides across the top of the sky, its rim lights chasing round.
  private stepUfo(dt: number) {
    const u = this.ufo
    if (u.x < -5) {
      u.next -= dt
      if (u.next > 0) return
      u.dir = Math.random() < 0.5 ? 1 : -1
      u.x = u.dir > 0 ? -0.15 : this.A + 0.15
      u.y = rand(0.08, 0.2)
      return
    }
    u.x += u.dir * 0.09 * dt
    if (u.x < -0.3 || u.x > this.A + 0.3) {
      u.x = -9
      u.next = rand(60, 120)
    }
  }

  private drawUfo() {
    const u = this.ufo
    if (u.x < -5) return
    const H = this.H
    const x = u.x * H
    const y = (u.y + Math.sin(this.time * 1.5) * 0.008) * H
    const tilt = Math.sin(this.time * 1.1) * 0.08
    this.shape([ell(x, y - 0.016 * H, 0.04 * H, 0.03 * H, tilt, this.paint([0.45, 0.75, 0.85])), ell(x, y, 0.09 * H, 0.022 * H, tilt, this.paint([0.6, 0.62, 0.66]))], this.lighting, 0.8)
    for (let i = 0; i < 6; i++) {
      const on = Math.floor(this.time * 4) % 6 === i ? 2 : 0.4
      const lx = x + Math.cos((i / 5) * Math.PI) * 0.075 * H
      const c = [[1, 0.2, 0.2], [0.2, 1, 0.3], [0.3, 0.5, 1]][i % 3]
      this.splat(lx, y + 0.008 * H, c[0] * on, c[1] * on, c[2] * on)
    }
  }
}

function normalize(x: number, y: number, z: number) {
  const l = Math.hypot(x, y, z)
  return [x / l, y / l, z / l] as const
}

// The planet's surface map: oceans, continents shading from green to desert to ice toward the poles, clouds, and
// city lights along the land. Sampled from noise on the sphere, so it wraps seamlessly as the planet turns.
function buildSurface() {
  const albedo = new Float32Array(TW * TH * 3)
  const cloud = new Float32Array(TW * TH)
  const city = new Float32Array(TW * TH)
  for (let j = 0; j < TH; j++) {
    const lat = (j / TH - 0.5) * Math.PI
    for (let i = 0; i < TW; i++) {
      const lon = (i / TW) * TAU
      const X = Math.cos(lat) * Math.sin(lon)
      const Y = Math.sin(lat)
      const Z = Math.cos(lat) * Math.cos(lon)
      const h = fbm2(X * 1.8 + Z * 1.1 + 3.1, Y * 1.8 - Z * 0.9 + 7.7, 5)
      const ice = smoothstep(0.38, 0.45, Math.abs(Y) * 0.5 + (h - 0.5) * 0.15)
      const t = j * TW + i
      let c: RGB
      if (h > 0.52) {
        const dry = smoothstep(0.35, 0.75, fbm2(X * 3 + 20, Z * 3 + Y * 2, 3)) * (1 - Math.abs(Y))
        c = [lerp(0.13, 0.42, dry), lerp(0.24, 0.34, dry), lerp(0.08, 0.2, dry)]
        // Cities cluster in a few regions, as scattered sparks rather than a carpet.
        const cluster = smoothstep(0.52, 0.72, fbm2(X * 9 + Z * 5 + 40, Y * 9 - Z * 4, 3))
        if (Math.abs(Y) < 0.8 && hash2(i, j) > 1 - cluster * 0.6) city[t] = (0.4 + hash2(j, i) * 0.6) * cluster
      } else {
        const depth = smoothstep(0.3, 0.52, h)
        c = [lerp(0.015, 0.04, depth), lerp(0.06, 0.2, depth), lerp(0.2, 0.4, depth)]
      }
      albedo[t * 3] = lerp(c[0], 0.85, ice)
      albedo[t * 3 + 1] = lerp(c[1], 0.88, ice)
      albedo[t * 3 + 2] = lerp(c[2], 0.92, ice)
      cloud[t] = smoothstep(0.5, 0.75, fbm2(X * 3 + Z * 2 + 11, Y * 6 + Z * 1.5, 4))
    }
  }
  return { albedo, cloud, city }
}

export const space: Wallpaper = {
  id: "space",
  name: "Space",
  description: "A ringed planet turning slowly below a nebula and drifting stars, with a comet now and then",
  activity: {
    calm: "The planet, its rings, a moon and the stars",
    lively: "Adds an orbiting space station and a satellite",
    teeming: "Adds asteroids, a floating astronaut and a flying saucer",
  },
  scrim: {
    day: [
      [10, 14, 30],
      [8, 10, 24],
      [6, 8, 18],
    ],
    sunset: [
      [26, 12, 24],
      [14, 8, 20],
      [6, 4, 12],
    ],
    night: [
      [4, 4, 12],
      [3, 3, 10],
      [2, 2, 6],
    ],
  },
  create: (settings) => new Space(settings),
}

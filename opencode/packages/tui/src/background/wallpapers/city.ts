import { Canvas, cap, ell, type Lighting, type Part } from "../src/canvas"
import { bob, limb, stride } from "../src/creature"
import { eggWait } from "../src/egg"
import { bird, flyAway, startle, type Flier } from "../src/flock"
import { haze } from "../src/grade"
import { lightPool } from "../src/light"
import { LightMap } from "../src/lightmap"
import { TAU, clamp, fbm1, hash, hash2, lerp, noise1, rand, smoothstep, type RGB } from "../src/math"
import { groundShadow, sunShade, type Shade } from "../src/shadow"
import { driftClouds, makeClouds, makeStars, makeStorm, paintClouds, paintHaze, paintSky, paintStars, paintStorm, type Cloud, type Orb, type Star } from "../src/sky"
import type { Activity, Settings, Time, Wallpaper } from "../src/wallpaper"
import { gust, sway } from "../src/wind"

// The scene runs slower than real time, which keeps it calm behind text.
const TIME_SCALE = 0.35
// People move at a quarter of scene speed, so they stroll rather than hurry.
const CREATURE_SPEED = 0.25
// Heights down the screen: the far bank where the towers stand and the river begins, the railway bridge's rails, the
// near quay, the elevated highway's road surface, and the street beneath it.
const BANK = 0.58
const RAIL = 0.625
const QUAY = 0.76
const ROAD = 0.8
const UNDER = ROAD + 0.04
const STREET = 0.9

// What changes with the time of day. Towers, vehicles and the bridge have one daytime color each; tint darkens them
// into silhouettes at sunset and night, when windows, lamps and neon light up instead.
interface Look {
  style: "rim" | "front"
  light: RGB
  sky: [number, RGB][]
  orb: Orb
  stars: number
  clouds: { top: RGB; bottom: RGB; alpha: number }
  // The far skyline's hazy color and the river from far to near.
  haze: RGB
  river: [far: RGB, near: RGB]
  reflect: number
  tint: RGB
  // Window colors, the share of windows lit, and how strongly lamps, lights and neon glow (0 by day).
  windows: RGB[]
  lit: number
  glow: number
  night: boolean
}

const AMBER: RGB = [1.25, 0.58, 0.12]
const GOLD: RGB = [1.15, 0.8, 0.22]

const LOOKS: Record<Time, Look> = {
  day: {
    style: "front",
    light: [1, 0.95, 0.85],
    sky: [
      [0, [0.12, 0.32, 0.7]],
      [0.3, [0.28, 0.52, 0.82]],
      [BANK, [0.62, 0.74, 0.86]],
    ],
    orb: { x: 0.14, y: 0.11, r: 0.035, core: [5, 4.6, 3.8], glow: [1, 0.95, 0.8], near: 0.45, wide: 0.12 },
    stars: 0,
    clouds: { top: [1.1, 1.1, 1.1], bottom: [0.6, 0.66, 0.78], alpha: 0.85 },
    haze: [0.48, 0.6, 0.8],
    river: [
      [0.12, 0.3, 0.48],
      [0.05, 0.16, 0.3],
    ],
    reflect: 0.55,
    tint: [1, 1, 1],
    windows: [],
    lit: 0,
    glow: 0,
    night: false,
  },
  sunset: {
    style: "rim",
    // Smog: magenta overhead, thick amber over the rooftops, and a dull orange sun sinking between the towers.
    light: [1, 0.55, 0.16],
    sky: [
      [0, [0.06, 0.012, 0.06]],
      [0.2, [0.2, 0.035, 0.16]],
      [0.38, [0.55, 0.14, 0.22]],
      [BANK, [1, 0.56, 0.14]],
    ],
    orb: { x: 0.62, y: 0.4, r: 0.065, core: [2.6, 1.3, 0.35], glow: [1, 0.5, 0.12], near: 0.45, wide: 0.35 },
    stars: 0,
    clouds: { top: [0.2, 0.04, 0.16], bottom: [0.95, 0.4, 0.3], alpha: 0.5 },
    haze: [0.6, 0.27, 0.12],
    river: [
      [0.62, 0.28, 0.12],
      [0.14, 0.03, 0.1],
    ],
    reflect: 0.6,
    tint: [0.22, 0.1, 0.13],
    windows: [AMBER, GOLD],
    lit: 0.18,
    glow: 0.55,
    night: false,
  },
  night: {
    style: "rim",
    light: [0.35, 0.42, 1.4],
    sky: [
      [0, [0.004, 0.006, 0.03]],
      [0.32, [0.016, 0.018, 0.07]],
      [0.45, [0.05, 0.025, 0.12]],
      [BANK, [0.15, 0.05, 0.2]],
    ],
    orb: { x: 0.82, y: 0.12, r: 0.03, core: [1, 0.72, 0.3], glow: [0.45, 0.3, 0.12], near: 0.2, wide: 0.08, moon: true },
    stars: 50,
    clouds: { top: [0.015, 0.02, 0.05], bottom: [0.08, 0.05, 0.2], alpha: 0.4 },
    haze: [0.035, 0.03, 0.08],
    river: [
      [0.03, 0.025, 0.08],
      [0.008, 0.012, 0.04],
    ],
    reflect: 0.8,
    tint: [0.03, 0.04, 0.09],
    windows: [AMBER, GOLD, [0.15, 0.8, 0.9], [1.05, 0.2, 0.62], [0.3, 0.4, 1.25], [0.62, 0.28, 1.1]],
    lit: 0.32,
    glow: 1,
    night: true,
  },
}

// Daylight comes from the upper left, where the sun is.
const DAYLIGHT = (() => {
  const l = Math.hypot(0.5, 0.6, 0.6)
  return [-0.5 / l, -0.6 / l, 0.6 / l] as const
})()

// Daytime colors.
const FACADES: RGB[] = [
  [0.3, 0.42, 0.6],
  [0.7, 0.55, 0.4],
  [0.18, 0.33, 0.55],
  [0.62, 0.36, 0.26],
  [0.22, 0.43, 0.48],
  [0.66, 0.6, 0.53],
]
const PAINT: RGB[] = [
  [0.75, 0.12, 0.1],
  [0.15, 0.3, 0.65],
  [0.85, 0.85, 0.82],
  [0.12, 0.12, 0.14],
  [0.92, 0.72, 0.15],
  [0.3, 0.55, 0.4],
  [0.55, 0.56, 0.6],
]
const HAIR: RGB[] = [
  [0.12, 0.08, 0.05],
  [0.45, 0.28, 0.12],
  [0.05, 0.05, 0.06],
  [0.7, 0.55, 0.3],
]
const NEON: RGB[] = [
  [1.5, 0.2, 0.95],
  [0.2, 1.3, 1.25],
  [0.7, 0.3, 1.6],
  [1.6, 0.3, 0.15],
  [1.4, 0.95, 0.2],
]
const CONCRETE: RGB = [0.58, 0.56, 0.53]
const FLAGS: RGB[] = [
  [0.8, 0.12, 0.1],
  [0.12, 0.32, 0.75],
]
const STEEL: RGB = [0.62, 0.17, 0.11]
const HEADLIGHT: RGB = [1.4, 0.95, 0.3]
const TAILLIGHT: RGB = [1.4, 0.08, 0.06]
const TRAIN_LIGHT: RGB = [0.18, 0.85, 0.95]
const RAIN: RGB = [0.05, 0.1, 0.16]

// The far lane runs left, the near lane right behind the barrier, which hides the near cars' wheels.
const LANES = [
  { y: ROAD + 0.006, dir: -1, speed: 0.075, scale: 0.85 },
  { y: ROAD + 0.018, dir: 1, speed: 0.09, scale: 1 },
]
// Seconds between cars entering each lane.
const TRAFFIC: Record<Activity, [number, number]> = { calm: [7, 16], lively: [2.5, 6], teeming: [1.3, 3.2] }
const TRAIN_CARS = 5
const COACH = 0.1
// How long the superhero takes to fly across, in scene seconds.
const HERO = 30

interface Tower {
  // Each tier above the first is a setback, inset and standing on the one below.
  tiers: { x0: number; x1: number; top: number }[]
  facade: RGB
  // 0 a grid of windows, 1 ribbon bands, 2 vertical strips.
  windows: number
  palette: number
  crown: number
  far: boolean
  seed: number
}

interface Car {
  x: number
  lane: number
  bus: boolean
  color: RGB
}

interface Walker {
  x: number
  dir: number
  // Strides taken: one per step of both feet.
  phase: number
  size: number
  coat: RGB
  hair: RGB
  umbrella: RGB
}

interface Boat {
  x: number
  dir: number
  speed: number
  y: number
  tour: boolean
}

interface Sign {
  x0: number
  y0: number
  x1: number
  y1: number
  color: RGB
  seed: number
}

class City extends Canvas {
  private time = 0
  private readonly activity: Activity
  private readonly look: Look
  private lighting: Lighting = { style: "front", dir: DAYLIGHT }
  private readonly shade: Shade
  // The river with the skyline reflected in it, which each frame ripples sideways where `water` is set.
  private river = new Float32Array(0)
  // The supersampled layout pass's river, box-filtered, for the real-size pass.
  private fineRiver: Float32Array<ArrayBuffer> | undefined
  private water = new Uint8Array(0)
  private stars: Star[]
  private visibleStars: Star[] = []
  private clouds: Cloud[]
  private beacons: [number, number][] = []
  private flickers: { x: number; y: number; w: number; h: number; on: RGB; off: RGB; phase: number }[] = []
  private sign: Sign | undefined
  private cars: Car[] = []
  private gaps = [0, 0]
  private warm = false
  private train = { x: -9, dir: 1, next: 6 }
  private blimp = { x: -9, dir: 1, next: 6 }
  private boats: Boat[] = [
    { x: 0.35, dir: 1, speed: 0.03, y: 0.705, tour: false },
    { x: 1.4, dir: -1, speed: 0.02, y: 0.735, tour: true },
  ]
  private walkers: Walker[] = []
  private rain: { x: number; y: number; speed: number }[] = []
  private lights = new LightMap()
  private readonly wet: boolean
  private storm = makeStorm()
  private pigeons: Flier[] = []
  // The easter egg: a caped superhero flies across the skyline. t counts scene seconds from the start of the flight.
  private hero = { wait: eggWait() * TIME_SCALE, t: -1, dir: 1 }

  constructor(settings: Settings) {
    super()
    this.activity = settings.activity
    this.look = LOOKS[settings.time]
    if (settings.time === "day") this.frame = 0.4
    this.stars = makeStars(this.look.stars, 0.45)
    this.clouds = makeClouds(2, "stratus", 0.05, 0.12)
    this.shade = sunShade(settings.time, this.look.orb)
    this.wet = this.look.night && settings.activity === "teeming"
    if (settings.activity !== "teeming") return
    const umbrellas: RGB[] = [[0.1, 0.55, 0.6], [0.6, 0.1, 0.4], [0.65, 0.35, 0.05], [0.3, 0.15, 0.6], [0.6, 0.1, 0.08]]
    this.walkers = Array.from({ length: 5 }, (_, i) => ({ x: 0.15 + i * 0.37, dir: i % 2 ? -1 : 1, phase: Math.random(), size: [1, 0.92, 1.06, 0.97, 1.03][i], coat: PAINT[(i * 3) % PAINT.length], hair: HAIR[i % HAIR.length], umbrella: umbrellas[i] }))
    if (this.look.night) this.rain = Array.from({ length: 30 }, () => ({ x: Math.random() * 2, y: Math.random(), speed: rand(0.9, 1.3) }))
  }

  step(dt: number) {
    dt = clamp(dt, 0, 0.1) * TIME_SCALE
    this.time += dt
    const cdt = dt * CREATURE_SPEED
    driftClouds(this.clouds, this.A, dt)
    driftClouds(this.storm, this.A, dt)
    this.stepGloom(dt)
    this.pigeons = flyAway(this.pigeons, dt, this.A)
    this.stepHero(dt)
    this.stepTraffic(dt)
    this.stepBlimp(dt)
    if (this.activity !== "calm") this.stepTrain(dt)
    for (const b of this.boats) {
      b.x += b.dir * b.speed * dt
      if (b.x > this.A + 0.15) b.x = -0.15
      if (b.x < -0.15) b.x = this.A + 0.15
    }
    for (const w of this.walkers) {
      w.phase += (0.06 * cdt) / (0.07 * w.size)
      w.x += w.dir * 0.06 * cdt
      if (w.x > this.A + 0.05) w.x = -0.05
      if (w.x < -0.05) w.x = this.A + 0.05
    }
    for (const r of this.rain) {
      r.y += r.speed * dt
      r.x -= r.speed * 0.15 * dt
      if (r.y < 1.03) continue
      r.y -= 1.06
      r.x = Math.random() * (this.A + 0.2)
    }
  }

  render() {
    const { W, H, look } = this
    this.restore()
    this.lights.clear(W, H)
    paintStars(this.hdr, W, H, this.visibleStars, this.time, BANK, 0.4, this.points)
    paintClouds(this.hdr, W, H, this.clouds, look.clouds.top, look.clouds.bottom, look.clouds.alpha, look.orb)
    paintStorm(this.hdr, W, H, this.storm, look.clouds.top, look.clouds.bottom, this.gloom)
    if (this.hero.t >= 0) this.drawHero()
    this.drawBlimp()
    this.drawRiver()
    this.drawLights()
    if (this.activity !== "calm") this.drawTrain()
    if (this.activity === "teeming") for (const b of this.boats) this.drawBoat(b)
    this.drawPromenade()
    for (const c of this.cars) this.ground(c.x, LANES[c.lane].y, (c.bus ? 0.08 : 0.04) * LANES[c.lane].scale, (c.bus ? 0.023 : 0.015) * LANES[c.lane].scale, 1)
    for (const c of this.cars) if (c.lane === 0) this.drawCar(c)
    for (const c of this.cars) if (c.lane === 1) this.drawCar(c)
    // The barrier sits in front of the near lane, so it is copied back over the cars.
    const a = Math.floor((ROAD + 0.012) * H) * W * 3
    this.hdr.set(this.background.subarray(a, Math.ceil((ROAD + 0.026) * H) * W * 3), a)
    for (const w of this.walkers) this.ground(w.x, 0.996, 0.02, 0.1, 0.8)
    for (const w of this.walkers) this.drawWalker(w)
    // At night the lamps under the highway light the sidewalk and the people passing beneath them.
    if (look.night) for (let i = 0; this.pillarX(i) - 0.21 < this.A + 0.1; i++) lightPool(this.hdr, W, H, (this.pillarX(i) - 0.21) * H, 0.96 * H, 0.14 * H, 0.08 * H, [1, 0.5, 0.12], 3, 0)
    if (this.activity === "teeming" && look.glow > 0) this.buzzNeon()
    this.lights.apply(this.hdr)
    for (const b of this.pigeons) this.shape(bird(b, H, 0.022 * H, this.paint([0.42, 0.44, 0.5])), this.lighting, 0.4)
    this.drawRain()
    this.finish()
  }

  protected override visit() {
    if (this.blimp.x < -5) this.blimp.next = 0
  }

  // Pigeons burst up off the street, the quay or the highway below the click.
  poke(x: number, y: number) {
    startle(this.pigeons, x, Math.max(y, QUAY), 5)
  }

  // Everything that never moves is painted once per size into `background`, then copied in each frame.
  protected override layout() {
    const { W, H, A, look } = this
    this.lighting = look.style === "front" ? { style: "front", dir: DAYLIGHT } : { style: "rim", color: look.light, x: look.orb.x * W, y: look.orb.y * H }
    paintSky(this.hdr, W, H, look.sky, look.orb, this.px)
    const sky = this.hdr.slice()
    this.beacons = []
    this.flickers = []
    this.sign = undefined
    // Hazy towers on the far side of the city, then the skyline, tallest in two districts toward the sides where text
    // rarely covers them, and lower across the middle.
    for (let x = -0.03, i = 0; x < A + 0.03; i++) {
      const w = 0.035 + hash(i * 1.7 + 0.3) * 0.05
      this.paintTower(this.tower(x, w, 0.06 + hash(i * 3.1 + 0.7) ** 1.5 * 0.17, i + 500, true))
      x += w * (0.7 + hash(i * 5.3) * 0.4)
    }
    // City haze glowing with the horizon's light over the far towers, which the downtown skyline stands in front of.
    const horizon = look.sky[look.sky.length - 1][1]
    paintHaze(this.hdr, W, H, BANK - 0.3, BANK, horizon, 0.7)
    const near: Tower[] = []
    for (let x = -0.02, i = 0; x < A + 0.02; i++) {
      const w = 0.05 + hash(i * 2.3 + 0.1) * 0.055
      const c = x + w / 2
      const downtown = 0.16 * Math.max(Math.exp(-(((c - 0.36) / 0.26) ** 2)), Math.exp(-(((c - A + 0.36) / 0.26) ** 2)))
      near.push(this.tower(x, w, 0.08 + hash(i * 4.7 + 0.2) ** 1.6 * (0.16 + downtown * 0.45) + downtown, i, false))
      x += w + (hash(i * 6.1) - 0.35) * 0.03
    }
    // The tallest two get a spire and an antenna.
    const tallest = [...near].sort((a, b) => a.tiers[a.tiers.length - 1].top - b.tiers[b.tiers.length - 1].top)
    tallest[0].crown = 3
    tallest[1].crown = 2
    for (const t of near) this.paintTower(t)
    if (look === LOOKS.day) haze(this.hdr, sky, W, H, BANK, BANK + 0.01, 0.12)
    paintHaze(this.hdr, W, H, BANK - 0.1, BANK, horizon, 0.25)
    this.visibleStars = this.stars.filter((s) => {
      const o = (Math.floor(s.y * H) * W + Math.floor(s.x * W)) * 3
      return this.hdr[o] === sky[o] && this.hdr[o + 1] === sky[o + 1] && this.hdr[o + 2] === sky[o + 2]
    })
    if (this.activity === "teeming") this.placeSigns(near)
    this.paintRiver()
    this.river = this.hdr.slice()
    this.paintBridge()
    this.paintHighway()
    if (this.activity === "teeming") for (const s of this.streetSigns()) this.neon(s, true, true)
    // Water is wherever nothing solid has been painted over the river.
    this.water = new Uint8Array(W * H)
    for (let i = Math.floor(BANK * H) * W; i < Math.min(H, Math.ceil(QUAY * H)) * W; i++) this.water[i] = this.hdr[i * 3] === this.river[i * 3] && this.hdr[i * 3 + 2] === this.river[i * 3 + 2] ? 1 : 0
    this.paintLamps()
    if (this.px > 1) this.fineRiver = this.shrink(this.river)
    else if (this.fineRiver) {
      this.river = this.fineRiver
      this.fineRiver = undefined
    }
    if (this.wet) this.paintWetStreet()
    if (this.warm) return
    this.warm = true
    for (let i = 0; i < 400; i++) this.stepTraffic(0.25)
  }

  private ground(x: number, y: number, w: number, h: number, tip?: number) {
    const H = this.H
    groundShadow(this.hdr, this.W, H, this.shade, x * H, y * H, w * H, h * H, tip)
  }

  private paint(c: RGB): RGB {
    const t = this.look.tint
    return [c[0] * t[0], c[1] * t[1], c[2] * t[2]]
  }

  private rect(x0: number, y0: number, x1: number, y1: number) {
    const H = this.H
    return [[x0 * H, y0 * H], [x1 * H, y0 * H], [x1 * H, y1 * H], [x0 * H, y1 * H]] as const
  }

  // Adds a soft elliptical glow to buf, which is hdr or the river.
  private glow(buf: Float32Array, cx: number, cy: number, rx: number, ry: number, c: RGB, k: number) {
    const { W, H } = this
    for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(H, Math.ceil(cy + ry)); y++)
      for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(W, Math.ceil(cx + rx)); x++) {
        const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry)
        if (d >= 1) continue
        const a = (1 - d) ** 2 * k
        const o = (y * W + x) * 3
        buf[o] += c[0] * a
        buf[o + 1] += c[1] * a
        buf[o + 2] += c[2] * a
      }
    if (buf === this.hdr) this.touch(cx - rx - 1, cy - ry - 1, cx + rx + 1, cy + ry + 1)
  }

  private tower(x: number, w: number, h: number, seed: number, far: boolean): Tower {
    const n = far ? 1 : 1 + Math.floor(hash(seed * 1.3 + 0.5) * 2.6)
    const shares = [[1], [0.7, 0.3], [0.55, 0.28, 0.17]][n - 1]
    let bottom = BANK
    const tiers = shares.map((share, k) => {
      bottom -= share * h
      return { x0: x + w * 0.13 * k, x1: x + w - w * 0.13 * k, top: bottom }
    })
    return { tiers, facade: FACADES[Math.floor(hash(seed * 7.7) * FACADES.length)], windows: Math.floor(hash(seed * 9.1 + 0.2) * 3), palette: Math.floor(hash(seed * 2.9 + 0.4) * 6), crown: hash(seed * 4.3) < 0.35 ? 1 : 0, far, seed }
  }

  // A tower drawn pixel by pixel: a facade with a shaded side by day, rim-lit edges at sunset and night, and a grid,
  // bands or strips of windows, some of them lit.
  private paintTower(t: Tower) {
    const { W, H, A, look, px } = this
    const day = look.style === "front"
    const top = t.tiers[t.tiers.length - 1]
    const cx = (t.tiers[0].x0 + t.tiers[0].x1) / 2
    const sunLeft = look.orb.x * A < cx
    const rimGlow = day ? 0 : (0.35 + 0.65 * Math.exp(-Math.abs(cx - look.orb.x * A) / 0.45)) * (t.far ? 0.15 : 0.3)
    const body: RGB = t.far ? (day ? [lerp(t.facade[0], look.haze[0], 0.6), lerp(t.facade[1], look.haze[1], 0.6), lerp(t.facade[2], look.haze[2], 0.6)] : look.haze) : this.paint(t.facade)
    const cw = t.far ? 0.006 : 0.0085
    const ch = t.far ? 0.009 : 0.012
    const palette = look.windows
    for (let k = 0; k < t.tiers.length; k++) {
      const tier = t.tiers[k]
      const width = tier.x1 - tier.x0
      const px0 = tier.x0 * H
      const px1 = tier.x1 * H
      const py0 = tier.top * H
      const py1 = (k ? t.tiers[k - 1].top : BANK) * H
      for (let y = Math.max(0, Math.floor(py0)); y < Math.min(H, Math.ceil(py1)); y++) {
        const cy = clamp(Math.min(y + 1 - py0, py1 - y), 0, 1)
        const v = (y + 0.5) / H - tier.top
        const up = 1 - ((y + 0.5) / H - top.top) / (BANK - top.top)
        for (let x = Math.max(0, Math.floor(px0)); x < Math.min(W, Math.ceil(px1)); x++) {
          const cov = clamp(Math.min(x + 1 - px0, px1 - x), 0, 1) * cy
          if (cov <= 0) continue
          const u = (x + 0.5) / H - tier.x0
          const side = day && !t.far && u > width * 0.72 ? 0.62 : 1
          const shade = day ? side * (0.9 + 0.15 * up) : 1
          let r = body[0] * shade
          let g = body[1] * shade
          // The shaded side takes the blue of the sky.
          let b = body[2] * shade * (side < 1 ? 1.25 : 1)
          // Windows are finer than the supersampled layout's pixels can show, so they keep to real pixels.
          const wu = ((Math.floor(x / px) + 0.5) * px) / H - tier.x0 - 0.004
          const wv = ((Math.floor(y / px) + 0.5) * px) / H - tier.top - 0.006
          const fu = wu / cw - Math.floor(wu / cw)
          const fv = wv / ch - Math.floor(wv / ch)
          const inside = wu > 0 && wv > 0 && wu + 0.004 < width - 0.003 && (t.windows === 0 ? fu < 0.55 && fv < 0.6 : t.windows === 1 ? fv < 0.5 : fu < 0.45)
          if (inside && (!t.far || !day)) {
            const col = Math.floor(wu / (t.windows === 1 ? cw * 2.5 : cw))
            const row = Math.floor(wv / (t.windows === 2 ? ch * 1.5 : ch))
            const h = hash2(t.seed * 13.1 + col * 1.7, row * 3.3 + k * 17)
            const glass = day ? 0.55 + 0.2 * up : 0.6
            r = lerp(r * glass, 0.26, day ? 0.35 : 0)
            g = lerp(g * glass, 0.46, day ? 0.35 : 0)
            b = lerp(b * glass, 0.78, day ? 0.35 : 0)
            if (h < look.lit * (t.far ? 0.6 : 1)) {
              const h2 = hash(h * 91.7)
              const c = palette[h2 < 0.75 ? t.palette % palette.length : Math.floor(h2 * 997) % palette.length]
              const k2 = (0.55 + 0.45 * hash(h * 37.1)) * look.glow * (t.far ? 0.55 : 1)
              r = c[0] * k2
              g = c[1] * k2
              b = c[2] * k2
            }
            if (day && h > 0.985) {
              r = 1.3
              g = 1.2
              b = 1
            }
          }
          if (rimGlow > 0) {
            const edge = (sunLeft ? u : width - u) * H
            const rim = (Math.exp(-edge / (1.5 * px)) + 0.6 * Math.exp((-v * H) / px)) * rimGlow
            r += look.light[0] * rim
            g += look.light[1] * rim
            b += look.light[2] * rim
          }
          this.blend((y * W + x) * 3, r, g, b, cov)
        }
      }
    }
    if (t.far) return
    const mid = ((top.x0 + top.x1) / 2) * H
    const roof = top.top * H
    const w = (top.x1 - top.x0) * H
    const dark = this.paint(t.facade.map((c) => c * 0.7) as RGB)
    if (t.crown === 1) this.polygon(this.rect(top.x0 + (top.x1 - top.x0) * 0.25, top.top - 0.01, top.x1 - (top.x1 - top.x0) * 0.3, top.top + 0.001), dark)
    if (t.crown === 2) {
      this.polygon(this.rect(top.x0 + (top.x1 - top.x0) * 0.3, top.top - 0.012, top.x1 - (top.x1 - top.x0) * 0.3, top.top + 0.001), dark)
      this.shape([cap(mid, roof - 0.012 * H, mid, roof - 0.07 * H, 0.0025 * H, 0.0012 * H, dark)], this.lighting, 0.5)
      this.beacons.push([mid / H, top.top - 0.07])
    }
    if (t.crown === 3) {
      this.polygon([[mid - w / 2, roof + this.px], [mid, roof - 0.06 * H], [mid + w / 2, roof + this.px]], dark)
      this.shape([cap(mid, roof - 0.05 * H, mid, roof - 0.1 * H, 0.002 * H, 0.001 * H, dark)], this.lighting, 0.5)
      this.beacons.push([mid / H, top.top - 0.1])
    }
    // A few grid windows switch on and off over time.
    if (t.windows !== 0 || look.lit === 0) return
    const tier = t.tiers[0]
    for (let i = 0; i < 2; i++) {
      const col = Math.floor(hash(t.seed * 3.7 + i) * ((tier.x1 - tier.x0 - 0.008) / 0.0085))
      const row = Math.floor(hash(t.seed * 5.9 + i) * ((BANK - tier.top - 0.012) / 0.012))
      const on = look.windows[Math.floor(hash(t.seed + i * 0.3) * look.windows.length)]
      this.flickers.push({ x: tier.x0 + 0.004 + col * 0.0085, y: tier.top + 0.006 + row * 0.012, w: 0.0085 * 0.55, h: 0.012 * 0.6, on: [on[0] * look.glow, on[1] * look.glow, on[2] * look.glow], off: body.map((c) => c * 0.6) as RGB, phase: hash(t.seed * 1.1 + i) * 100 })
    }
  }

  // The two neon signs hung under the highway.
  private streetSigns(): Sign[] {
    const a = this.pillarX(1)
    const b = this.pillarX(3)
    return [
      { x0: a - 0.012, y0: UNDER + 0.006, x1: a + 0.012, y1: STREET - 0.012, color: NEON[0], seed: 7 },
      { x0: b - 0.012, y0: UNDER + 0.01, x1: b + 0.012, y1: STREET - 0.015, color: NEON[2], seed: 11 },
    ]
  }

  // The signs under the highway throw their color on the street below, and now and then one buzzes and dims for a
  // moment, its light on the street dimming with it.
  private buzzNeon() {
    const { H, look } = this
    for (const s of this.streetSigns()) {
      const dip = smoothstep(0.78, 0.95, noise1(this.time * 1.5, s.seed))
      const k = look.glow * (1 - 0.6 * dip)
      this.lights.pool(((s.x0 + s.x1) / 2) * H, (STREET + 0.035) * H, 0.08 * H, 0.055 * H, s.color, 2.2 * k, 0.012 * k)
      if (dip > 0.01) this.polygon(this.rect(s.x0, s.y0, s.x1, s.y1), this.paint([0.1, 0.08, 0.12]), 0.55 * dip)
    }
  }

  // Neon signs on a few towers: a tall one down a facade and one on a rooftop.
  private placeSigns(near: Tower[]) {
    const tall = near.filter((t, i) => i % 3 === 1 && BANK - t.tiers[0].top > 0.16)
    tall.forEach((t, i) => {
      const tier = t.tiers[0]
      const x = tier.x0 + 0.006 + hash(t.seed) * Math.max(0, tier.x1 - tier.x0 - 0.03)
      const y = tier.top + 0.03 + hash(t.seed * 2.1) * 0.04
      const s = { x0: x, y0: y, x1: x + 0.016, y1: y + 0.075, color: NEON[(i + 1) % NEON.length], seed: t.seed }
      // The second one flickers, so it is lit each frame while it is on.
      if (i === 1) this.sign = s
      this.neon(s, true, i !== 1)
    })
    const roof = near.find((t, i) => i > 2 && t.tiers.length === 1 && t.crown === 0 && t.tiers[0].x1 - t.tiers[0].x0 > 0.07)
    if (!roof) return
    const r = roof.tiers[0]
    const x = (r.x0 + r.x1) / 2
    this.shape([cap((x - 0.02) * this.H, r.top * this.H, (x - 0.02) * this.H, (r.top - 0.01) * this.H, 0.001 * this.H, 0.001 * this.H, this.paint(CONCRETE)), cap((x + 0.02) * this.H, r.top * this.H, (x + 0.02) * this.H, (r.top - 0.01) * this.H, 0.001 * this.H, 0.001 * this.H, this.paint(CONCRETE))], this.lighting, 0)
    this.neon({ x0: x - 0.034, y0: r.top - 0.03, x1: x + 0.034, y1: r.top - 0.009, color: NEON[4], seed: roof.seed }, false, true)
  }

  // A sign panel framed in a neon tube, with glyph-like strokes. Lit signs glow at sunset and night; by day, or while
  // switched off, the tubes are muted colored glass.
  private neon(s: Sign, vertical: boolean, lit: boolean) {
    const H = this.H
    this.polygon(this.rect(s.x0, s.y0, s.x1, s.y1), this.paint([0.1, 0.08, 0.12]))
    const on = lit && this.look.glow > 0
    const k = on ? this.look.glow : 0.3
    const tube: RGB = [s.color[0] * k, s.color[1] * k, s.color[2] * k]
    const r = Math.max(0.55 * this.px, 0.0013 * H)
    const inset = 0.0025
    const [x0, y0, x1, y1] = [(s.x0 + inset) * H, (s.y0 + inset) * H, (s.x1 - inset) * H, (s.y1 - inset) * H]
    const parts: Part[] = [cap(x0, y0, x1, y0, r, r, tube), cap(x1, y0, x1, y1, r, r, tube), cap(x1, y1, x0, y1, r, r, tube), cap(x0, y1, x0, y0, r, r, tube)]
    const size = vertical ? x1 - x0 : y1 - y0
    const count = Math.max(1, Math.floor((vertical ? y1 - y0 : x1 - x0) / size))
    const strokes = [[0.15, 0.2, 0.85, 0.2], [0.15, 0.5, 0.85, 0.5], [0.15, 0.8, 0.85, 0.8], [0.2, 0.15, 0.2, 0.85], [0.5, 0.15, 0.5, 0.85], [0.8, 0.15, 0.8, 0.85], [0.2, 0.2, 0.8, 0.8], [0.8, 0.2, 0.2, 0.8]]
    const step = (vertical ? y1 - y0 : x1 - x0) / count
    for (let g = 0; g < count; g++) {
      const gx = vertical ? x0 + size * 0.2 : x0 + g * step + (step - size * 0.6) / 2
      const gy = vertical ? y0 + g * step + (step - size * 0.6) / 2 : y0 + size * 0.2
      for (let n = 0; n < 3; n++) {
        const [a, b, c, d] = strokes[Math.floor(hash(s.seed * 3.1 + g * 7.3 + n * 1.9) * strokes.length)]
        const z = size * 0.6
        parts.push(cap(gx + a * z, gy + b * z, gx + c * z, gy + d * z, r * 0.9, r * 0.9, tube))
      }
    }
    this.shape(parts, this.lighting, 0)
    if (!on) return
    this.glow(this.hdr, ((s.x0 + s.x1) / 2) * H, ((s.y0 + s.y1) / 2) * H, (s.x1 - s.x0) * H * 1.2 + 4 * this.px, (s.y1 - s.y0) * H * 0.9 + 4 * this.px, s.color, 0.12 * k)
  }

  // The river darkens toward the near quay and mirrors the skyline, the reflection stretched downward into streaks and
  // broken by ripples.
  private paintRiver() {
    const { W, H, hdr, look, px } = this
    const r0 = Math.floor(BANK * H)
    const r1 = Math.min(H, Math.ceil(QUAY * H))
    const [far, near] = look.river
    const smear = Math.max(2 * px, Math.round(0.006 * H))
    for (let y = r0; y < r1; y++) {
      const depth = (y - r0) / (r1 - r0)
      const sy = r0 - px - Math.floor((y - r0) * 0.7)
      const k = lerp(1, 0.6, depth) * look.reflect
      for (let x = 0; x < W; x++) {
        const ripple = 0.88 + 0.12 * Math.sin((x / px) * 0.12 + (y / px) * 0.9 + fbm1((x / px) * 0.04 + (y / px) * 0.17, 3) * 5)
        let r = 0
        let g = 0
        let b = 0
        for (let j = 0; j < 4; j++) {
          const o = (clamp(sy + (j - 1) * smear, 0, H - 1) * W + x) * 3
          r += hdr[o]
          g += hdr[o + 1]
          b += hdr[o + 2]
        }
        const o = (y * W + x) * 3
        hdr[o] = lerp(lerp(far[0], near[0], depth), (r / 4) * ripple, k)
        hdr[o + 1] = lerp(lerp(far[1], near[1], depth), (g / 4) * ripple, k)
        hdr[o + 2] = lerp(lerp(far[2], near[2], depth), (b / 4) * ripple, k)
      }
    }
  }

  // A railway bridge across the river: a steel deck carried on arches between stone piers.
  private paintBridge() {
    const { A, H } = this
    const deck = RAIL + 0.01
    const foot = RAIL + 0.05
    const span = 0.3
    const steel = this.paint(STEEL)
    for (let px = 0.08; px < A + span; px += span) {
      this.polygon([[(px - 0.009) * H, deck * H], [(px + 0.009) * H, deck * H], [(px + 0.013) * H, (foot + 0.004) * H], [(px - 0.013) * H, (foot + 0.004) * H]], this.paint([0.5, 0.46, 0.42]))
      const arch = (s: number): [number, number] => [(px - span + s * span) * H, (foot - 0.002 - Math.sin(Math.PI * s) * (foot - deck - 0.006)) * H]
      const parts: Part[] = []
      for (let i = 0; i < 12; i++) parts.push(cap(...arch(i / 12), ...arch((i + 1) / 12), 0.0035 * H, 0.0035 * H, steel))
      for (let i = 1; i < 10; i++) {
        const [x, y] = arch(i / 10)
        parts.push(cap(x, y, x, deck * H, 0.0012 * H, 0.0012 * H, steel))
      }
      this.shape(parts, this.lighting, 0.4)
    }
    this.polygon(this.rect(-0.01, RAIL, A + 0.01, deck), steel)
    this.polygon(this.rect(-0.01, RAIL - 0.001, A + 0.01, RAIL + 0.002), this.paint([0.3, 0.28, 0.27]))
  }

  private pillarX(i: number) {
    return 0.18 + i * 0.42
  }

  // The quay promenade, the elevated highway on its pillars with lamps along it, and the street underneath.
  private paintHighway() {
    const { A, H } = this
    const edge = this.paint([0.45, 0.42, 0.38])
    this.polygon(this.rect(-0.01, QUAY, A + 0.01, ROAD), this.paint([0.52, 0.43, 0.34]))
    this.polygon(this.rect(-0.01, QUAY, A + 0.01, QUAY + 0.004), edge)
    const rail: Part[] = [cap(-1, (QUAY - 0.012) * H, A * H + 1, (QUAY - 0.012) * H, 0.0012 * H, 0.0012 * H, edge)]
    for (let x = 0.01; x < A; x += 0.03) rail.push(cap(x * H, QUAY * H, x * H, (QUAY - 0.012) * H, 0.001 * H, 0.001 * H, edge))
    this.shape(rail, this.lighting, 0.3)
    // Shadows of the promenade trees, which are drawn each frame so they can sway.
    for (let x = 0.29; x < A + 0.05; x += 0.34) this.ground(x, QUAY + 0.014, 0.03, 0.05, 1.3)
    // Shade under the deck, deepening toward it, then the street and its sidewalk.
    for (let y = UNDER; y < STREET; y += 0.005) this.polygon(this.rect(-0.01, y, A + 0.01, y + 0.0052), this.paint([0.12 + (y - UNDER) * 2, 0.12 + (y - UNDER) * 2, 0.15 + (y - UNDER) * 2]))
    this.polygon(this.rect(-0.01, STREET, A + 0.01, 0.965), this.paint([0.26, 0.26, 0.28]))
    for (let x = 0.02; x < A; x += 0.07) this.polygon(this.rect(x, 0.931, x + 0.032, 0.935), this.paint([0.8, 0.72, 0.35]))
    this.polygon(this.rect(-0.01, 0.965, A + 0.01, 1.01), this.paint([0.44, 0.37, 0.31]))
    this.polygon(this.rect(-0.01, 0.965, A + 0.01, 0.969), this.paint([0.62, 0.6, 0.56]))
    for (let i = 0; this.pillarX(i) - 0.04 < A; i++) {
      const x = this.pillarX(i)
      this.ground(x, STREET, 0.045, STREET - UNDER, 1)
      this.polygon([[(x - 0.028) * H, UNDER * H], [(x + 0.028) * H, UNDER * H], [(x + 0.02) * H, STREET * H], [(x - 0.02) * H, STREET * H]], this.paint(CONCRETE))
      this.polygon([[(x + 0.012) * H, UNDER * H], [(x + 0.028) * H, UNDER * H], [(x + 0.02) * H, STREET * H], [(x + 0.008) * H, STREET * H]], this.paint([0.42, 0.41, 0.4]))
    }
    this.polygon(this.rect(-0.01, ROAD, A + 0.01, ROAD + 0.012), this.paint([0.3, 0.3, 0.32]))
    this.polygon(this.rect(-0.01, ROAD + 0.012, A + 0.01, ROAD + 0.026), this.paint(CONCRETE))
    this.polygon(this.rect(-0.01, ROAD + 0.017, A + 0.01, ROAD + 0.019), this.paint([0.45, 0.44, 0.42]))
    this.polygon(this.rect(-0.01, ROAD + 0.026, A + 0.01, UNDER), this.paint([0.36, 0.36, 0.38]))
    const pole = this.paint([0.32, 0.33, 0.36])
    for (let x = 0.12; x < A + 0.05; x += 0.34)
      this.shape([cap(x * H, (ROAD + 0.013) * H, x * H, (ROAD - 0.05) * H, 0.0018 * H, 0.0014 * H, pole), cap(x * H, (ROAD - 0.05) * H, (x + 0.02) * H, (ROAD - 0.053) * H, 0.0012 * H, 0.0012 * H, pole), ell((x + 0.022) * H, (ROAD - 0.052) * H, 0.007 * H, 0.0025 * H, 0, pole)], this.lighting, 0.5)
  }

  // Lamps on the highway and under it, and the lights along the bridge with their reflections in the river. Glows go
  // into both the background and the river, since the river is redrawn from its own copy each frame.
  private paintLamps() {
    const { A, H, hdr, river, look } = this
    if (look.glow <= 0) return
    const k = look.glow
    for (let x = 0.12; x < A + 0.05; x += 0.34)
      for (const buf of [hdr, river]) {
        this.glow(buf, (x + 0.022) * H, (ROAD - 0.05) * H, 0.035 * H, 0.03 * H, AMBER, 0.5 * k)
        this.glow(buf, (x + 0.022) * H, (ROAD - 0.051) * H, 0.006 * H, 0.003 * H, AMBER, 1.5 * k)
        this.glow(buf, (x + 0.03) * H, (ROAD + 0.004) * H, 0.07 * H, 0.012 * H, AMBER, 0.35 * k)
      }
    for (let i = 0; this.pillarX(i) - 0.21 < A; i++) {
      const x = this.pillarX(i) - 0.21
      this.polygon(this.rect(x - 0.008, UNDER, x + 0.008, UNDER + 0.003), this.paint([0.3, 0.3, 0.32]))
      this.glow(hdr, x * H, (UNDER + 0.003) * H, 0.012 * H, 0.004 * H, GOLD, 1.4 * k)
      this.glow(hdr, x * H, (UNDER + 0.01) * H, 0.08 * H, 0.035 * H, AMBER, 0.25 * k)
      this.glow(hdr, x * H, (STREET + 0.02) * H, 0.13 * H, 0.03 * H, AMBER, 0.3 * k)
    }
    for (let x = 0.02; x < A; x += 0.05) {
      this.glow(hdr, x * H, (RAIL + 0.005) * H, 0.004 * H, 0.004 * H, GOLD, 1.6 * k)
      for (const buf of [hdr, river]) this.glow(buf, x * H, (RAIL + 0.005) * H, 0.015 * H, 0.012 * H, AMBER, 0.25 * k)
      this.glow(river, x * H, (RAIL + 0.1) * H, 0.003 * H, 0.04 * H, AMBER, 0.5 * k)
    }
  }

  // After rain the street mirrors the underside of the highway, its pillars, lamps and the sign hung on one.
  private paintWetStreet() {
    const { W, H, hdr, px } = this
    const s0 = Math.floor(STREET * H)
    for (let y = s0; y < H; y++) {
      const sy = s0 - px - Math.floor((y - s0) * 0.8)
      for (let x = 0; x < W; x++) {
        const puddle = 0.35 + 0.65 * smoothstep(0.4, 0.62, fbm1((x / px) * 0.03 + Math.floor((y / px) * 0.4) * 5.3, 2))
        const streak = 0.7 + 0.3 * Math.sin((x / px) * 1.3 + (y / px) * 0.2)
        let r = 0
        let g = 0
        let b = 0
        for (let j = 0; j < 3; j++) {
          const o = (clamp(sy - j * 2 * px, 0, H - 1) * W + x) * 3
          r += hdr[o]
          g += hdr[o + 1]
          b += hdr[o + 2]
        }
        const k = (0.65 * puddle * streak) / 3
        const o = (y * W + x) * 3
        hdr[o] = hdr[o] * 0.6 + r * k
        hdr[o + 1] = hdr[o + 1] * 0.6 + g * k
        hdr[o + 2] = hdr[o + 2] * 0.6 + b * k
      }
    }
  }

  // The river ripples: each row of water shifts sideways by a slowly changing fraction of a pixel or two.
  private drawRiver() {
    const { W, H, hdr, river, water } = this
    const r0 = Math.floor(BANK * H)
    const r1 = Math.min(H, Math.ceil(QUAY * H))
    this.touch(0, r0, W - 1, r1 - 1)
    for (let y = r0; y < r1; y++) {
      const amp = (0.25 + ((y - r0) / (r1 - r0)) * 0.9) * (H / 200)
      const s = Math.sin(y * 0.45 + this.time * 1.3) * amp + Math.sin(y * 0.17 - this.time * 0.7) * amp * 0.6
      const si = Math.floor(s)
      const f = s - si
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        if (!water[i]) continue
        const a = (y * W + clamp(x + si, 0, W - 1)) * 3
        const b = (y * W + clamp(x + si + 1, 0, W - 1)) * 3
        hdr[i * 3] = river[a] + (river[b] - river[a]) * f
        hdr[i * 3 + 1] = river[a + 1] + (river[b + 1] - river[a + 1]) * f
        hdr[i * 3 + 2] = river[a + 2] + (river[b + 2] - river[a + 2]) * f
      }
    }
  }

  // Red beacons blinking on the tallest towers, windows switching on and off, and the flickering neon sign.
  private drawLights() {
    const { H, look } = this
    for (const [i, [x, y]] of this.beacons.entries()) {
      const k = Math.max(0, Math.sin(this.time * 2.2 + i * 2)) ** 8
      if (k < 0.02) continue
      this.disc(x * H, y * H, Math.max(0.8, 0.0025 * H), 1.4 * k, 0.08 * k, 0.05 * k, 1)
      this.glow(this.hdr, x * H, y * H, 0.012 * H, 0.012 * H, TAILLIGHT, 0.4 * k)
    }
    for (const f of this.flickers) {
      const on = hash(Math.floor(this.time / 12 + f.phase)) > 0.45
      this.polygon(this.rect(f.x, f.y, f.x + f.w, f.y + f.h), on ? f.on : f.off)
    }
    if (!this.sign || look.glow <= 0 || hash(Math.floor(this.time * 0.4) + 3.7) <= 0.15) return
    const s = this.sign
    this.neon(s, true, true)
    // While it is lit, it tints the facade and windows around it.
    this.lights.pool(((s.x0 + s.x1) / 2) * H, ((s.y0 + s.y1) / 2) * H, 0.04 * H, 0.07 * H, s.color, 1.5 * look.glow, 0.02 * look.glow)
  }

  // Trees along the promenade between the highway lamps, nodding in the wind, and two flags that hang slack in calm
  // air and stream out when a gust comes through.
  private drawPromenade() {
    const { A, H } = this
    const base = QUAY + 0.014
    const leaves = this.paint([0.22, 0.42, 0.18])
    for (let i = 0, x = 0.29; x < A + 0.05; i++, x += 0.34) {
      const lean = sway(x, this.time, i * 1.7, 0.9) * 0.0015
      this.shape([cap(x * H, base * H, (x + lean * 0.5) * H, (base - 0.022) * H, 0.002 * H, 0.0015 * H, this.paint([0.35, 0.25, 0.16]))], this.lighting, 0.4)
      this.shape([ell((x + lean) * H, (base - 0.036) * H, 0.014 * H, 0.013 * H, 0, leaves), ell((x - 0.011 + lean * 0.7) * H, (base - 0.026) * H, 0.011 * H, 0.009 * H, 0, leaves), ell((x + 0.011 + lean * 0.7) * H, (base - 0.027) * H, 0.011 * H, 0.009 * H, 0, leaves)], this.lighting, 0.7)
    }
    const pole = this.paint([0.62, 0.62, 0.64])
    for (const [i, x] of [0.205, 0.205 + 0.34 * Math.floor((A - 0.4) / 0.34)].entries()) {
      const top = base - 0.075
      this.shape([cap(x * H, base * H, x * H, (top - 0.004) * H, 0.0013 * H, 0.001 * H, pole)], this.lighting, 0.4)
      const g = gust(x, this.time)
      // From hanging nearly straight down to flying level, rippling faster the harder it blows.
      const droop = 1.25 * (1 - (0.3 + 0.7 * g))
      const L = 0.03
      const upper: [number, number][] = []
      const lower: [number, number][] = []
      for (let k = 0; k <= 6; k++) {
        const s = (k / 6) * L
        const wave = Math.sin(k * 1.1 - this.time * (3 + 5 * g) + i) * 0.0025 * (k / 6)
        const px = x + s * Math.cos(droop) + wave * Math.sin(droop)
        const py = top + s * Math.sin(droop) + wave * Math.cos(droop)
        upper.push([px * H, py * H])
        lower.push([px * H, (py + 0.016) * H])
      }
      this.polygon([...upper, ...lower.reverse()], this.paint(FLAGS[i]))
    }
  }

  private stepTraffic(dt: number) {
    for (const c of this.cars) c.x += LANES[c.lane].dir * LANES[c.lane].speed * dt
    this.cars = this.cars.filter((c) => c.x > -0.15 && c.x < this.A + 0.15)
    for (const lane of [0, 1]) {
      this.gaps[lane] -= dt
      if (this.gaps[lane] > 0) continue
      this.gaps[lane] = rand(...TRAFFIC[this.activity])
      this.cars.push({ x: LANES[lane].dir > 0 ? -0.12 : this.A + 0.12, lane, bus: Math.random() < 0.15, color: PAINT[Math.floor(Math.random() * PAINT.length)] })
    }
  }

  // A car or bus seen from the side; at sunset and night it shows headlights and red tail lights.
  private drawCar(c: Car) {
    const { H, look } = this
    const lane = LANES[c.lane]
    const s = lane.scale
    const P = (u: number, v: number): [number, number] => [(c.x + u * lane.dir * s) * H, (lane.y - v * s) * H]
    const body = this.paint(c.bus ? [0.85, 0.55, 0.12] : c.color)
    const glass = this.paint([0.2, 0.26, 0.34])
    const half = c.bus ? 0.04 : 0.02
    if (c.bus) {
      this.polygon([P(-0.04, 0.003), P(0.04, 0.003), P(0.04, 0.02), P(0.037, 0.023), P(-0.04, 0.023)], body)
      const windows: RGB = look.glow > 0 ? [GOLD[0] * look.glow * 0.8, GOLD[1] * look.glow * 0.8, GOLD[2] * look.glow * 0.8] : glass
      this.polygon([P(-0.036, 0.013), P(0.037, 0.013), P(0.037, 0.02), P(-0.036, 0.02)], windows)
    }
    if (!c.bus) {
      this.polygon([P(-0.02, 0.003), P(0.02, 0.003), P(0.02, 0.008), P(0.013, 0.0095), P(0.006, 0.015), P(-0.012, 0.015), P(-0.018, 0.0095), P(-0.02, 0.008)], body)
      this.polygon([P(-0.0105, 0.0098), P(0.004, 0.0098), P(0.0055, 0.0135), P(-0.0095, 0.0135)], glass)
    }
    const wheel = this.paint([0.06, 0.06, 0.07])
    for (const u of c.bus ? [-0.027, 0.027] : [-0.012, 0.012]) this.disc(...P(u, 0.003), 0.003 * s * H, wheel[0], wheel[1], wheel[2], 1)
    if (look.glow <= 0) return
    const k = look.glow
    const [hx, hy] = P(half, 0.006)
    this.glow(this.hdr, hx, hy, 0.003 * H, 0.003 * H, HEADLIGHT, 2 * k)
    this.glow(this.hdr, hx + lane.dir * 0.012 * H, hy, 0.02 * H, 0.006 * H, HEADLIGHT, 0.3 * k)
    const [tx, ty] = P(-half, 0.007)
    this.glow(this.hdr, tx, ty, 0.004 * H, 0.003 * H, TAILLIGHT, 1.2 * k)
  }

  // Now and then a train crosses the bridge.
  private stepTrain(dt: number) {
    const t = this.train
    const length = TRAIN_CARS * (COACH + 0.004)
    if (t.x < -5) {
      t.next -= dt
      if (t.next > 0) return
      t.x = t.dir > 0 ? 0 : this.A
      return
    }
    t.x += t.dir * 0.08 * dt
    if (t.x < -length - 0.05 || t.x > this.A + length + 0.05) {
      t.x = -9
      t.next = rand(25, 50)
      t.dir = Math.random() < 0.5 ? 1 : -1
    }
  }

  private drawTrain() {
    const t = this.train
    if (t.x < -5) return
    const { H, look } = this
    const body = this.paint([0.72, 0.75, 0.8])
    const stripe = this.paint([0.15, 0.35, 0.7])
    const lit = look.glow > 0
    const windows: RGB = lit ? [TRAIN_LIGHT[0] * look.glow, TRAIN_LIGHT[1] * look.glow, TRAIN_LIGHT[2] * look.glow] : this.paint([0.2, 0.27, 0.36])
    const top = RAIL - 0.026
    for (let i = 0; i < TRAIN_CARS; i++) {
      const front = t.x - t.dir * i * (COACH + 0.004)
      const back = front - t.dir * COACH
      if (Math.max(front, back) < -0.01 || Math.min(front, back) > this.A + 0.01) continue
      const X = (u: number) => (front - t.dir * u) * H
      const nose = i === 0 ? 0.016 : 0.002
      this.polygon([[X(COACH), top * H], [X(nose), top * H], [X(0), (top + (i === 0 ? 0.012 : 0.002)) * H], [X(0), (RAIL - 0.002) * H], [X(COACH), (RAIL - 0.002) * H]], body)
      this.polygon([[X(COACH), (RAIL - 0.008) * H], [X(0.002), (RAIL - 0.008) * H], [X(0.002), (RAIL - 0.005) * H], [X(COACH), (RAIL - 0.005) * H]], stripe)
      for (let w = i === 0 ? 1 : 0; w < 6; w++) {
        const u = 0.008 + w * 0.0155
        this.polygon([[X(u), (top + 0.005) * H], [X(u + 0.011), (top + 0.005) * H], [X(u + 0.011), (top + 0.013) * H], [X(u), (top + 0.013) * H]], windows)
        // At night the lit windows reflect in the river below the bridge.
        if (lit) this.glow(this.hdr, X(u + 0.0055), (RAIL + 0.105) * H, 0.006 * H, 0.025 * H, TRAIN_LIGHT, 0.12 * look.glow)
      }
    }
    if (!lit) return
    this.glow(this.hdr, t.x * H, (RAIL - 0.008) * H, 0.004 * H, 0.004 * H, HEADLIGHT, 2 * look.glow)
    this.glow(this.hdr, (t.x + t.dir * 0.03) * H, (RAIL - 0.008) * H, 0.04 * H, 0.01 * H, HEADLIGHT, 0.25 * look.glow)
  }

  // A blimp drifts over the city every few minutes.
  private stepBlimp(dt: number) {
    const b = this.blimp
    if (b.x < -5) {
      b.next -= dt
      if (b.next > 0) return
      b.x = b.dir > 0 ? -0.12 : this.A + 0.12
      return
    }
    b.x += b.dir * 0.03 * dt
    if (b.x < -0.15 || b.x > this.A + 0.15) {
      b.x = -9
      b.next = rand(60, 110)
      b.dir = Math.random() < 0.5 ? 1 : -1
    }
  }

  private drawBlimp() {
    const b = this.blimp
    if (b.x < -5) return
    const { H, look } = this
    const x = b.x * H
    const y = (0.22 + Math.sin(this.time * 0.5) * 0.004) * H
    const d = b.dir
    const skin = this.paint([0.78, 0.78, 0.82])
    const fin = this.paint([0.2, 0.32, 0.7])
    this.polygon([[x - d * 0.05 * H, y], [x - d * 0.085 * H, y - 0.026 * H], [x - d * 0.078 * H, y]], fin)
    this.polygon([[x - d * 0.05 * H, y], [x - d * 0.085 * H, y + 0.026 * H], [x - d * 0.078 * H, y]], fin)
    this.shape([ell(x, y, 0.075 * H, 0.022 * H, 0, skin), ell(x + d * 0.01 * H, y + 0.023 * H, 0.012 * H, 0.004 * H, 0, this.paint([0.3, 0.3, 0.34]))], this.lighting, 0.7)
    const band: RGB = look.glow > 0 ? [NEON[1][0] * look.glow * 0.7, NEON[1][1] * look.glow * 0.7, NEON[1][2] * look.glow * 0.7] : fin
    this.ellipse(x + d * 0.005 * H, y, 0.045 * H, 0.0065 * H, band[0], band[1], band[2], 1)
    if (look.glow <= 0) return
    this.glow(this.hdr, x, y, 0.06 * H, 0.02 * H, NEON[1], 0.08 * look.glow)
    const k = Math.max(0, Math.sin(this.time * 2.5)) ** 6
    this.glow(this.hdr, x - d * 0.083 * H, y - 0.024 * H, 0.006 * H, 0.006 * H, TAILLIGHT, k)
  }

  private stepHero(dt: number) {
    const h = this.hero
    if (h.t < 0) {
      h.wait -= dt
      if (h.wait > 0) return
      h.t = 0
      h.dir = Math.random() < 0.5 ? 1 : -1
      return
    }
    h.t += dt
    if (h.t < HERO) return
    h.t = -1
    h.wait = eggWait(true) * TIME_SCALE
  }

  // A superhero flying flat out over the towers, one fist forward and a red cape rippling behind.
  private drawHero() {
    const { A, H } = this
    const h = this.hero
    const p = h.t / HERO
    const x = (h.dir > 0 ? lerp(-0.15, A + 0.15, p) : lerp(A + 0.15, -0.15, p)) * H
    const y = (0.27 - 0.07 * Math.sin(p * Math.PI) + Math.sin(this.time * 1.5) * 0.004) * H
    const S = 0.13 * H
    const P = (u: number, v: number): [number, number] => [x + u * h.dir * S, y + v * S]
    // At night the city's light catches the hero from below, so it doesn't vanish into the dark like a silhouette.
    const tone = (c: RGB): RGB => (this.look.night ? [c[0] * 0.3, c[1] * 0.3, c[2] * 0.3] : this.paint(c))
    const suit = tone([0.15, 0.3, 0.85])
    const red = tone([0.85, 0.12, 0.1])
    const skin = tone([0.85, 0.62, 0.48])
    const edge = (i: number, v: number): [number, number] => P(0.1 - i * 0.16, v + Math.sin(this.time * 5 - i * 1.1) * 0.025 * i)
    this.polygon([...[0, 1, 2, 3, 4, 5].map((i) => edge(i, -0.07 - i * 0.008)), ...[5, 4, 3, 2, 1, 0].map((i) => edge(i, 0.05 + i * 0.012))], red)
    this.shape(
      [
        cap(...P(0.15, 0), ...P(-0.25, 0.02), 0.075 * S, 0.06 * S, suit),
        cap(...P(-0.25, 0), ...P(-0.58, -0.01), 0.05 * S, 0.04 * S, suit),
        cap(...P(-0.25, 0.04), ...P(-0.56, 0.06), 0.05 * S, 0.04 * S, suit),
        cap(...P(-0.56, -0.01), ...P(-0.68, -0.015), 0.045 * S, 0.04 * S, red),
        cap(...P(-0.54, 0.06), ...P(-0.66, 0.065), 0.045 * S, 0.04 * S, red),
        cap(...P(0.14, -0.03), ...P(0.46, -0.07), 0.035 * S, 0.03 * S, suit),
        ell(...P(0.49, -0.072), 0.04 * S, 0.036 * S, 0, skin),
        ell(...P(0.26, -0.05), 0.085 * S, 0.075 * S, 0, skin),
        ell(...P(0.23, -0.1), 0.08 * S, 0.04 * S, 0.3 * h.dir, tone([0.08, 0.06, 0.06])),
      ],
      this.lighting,
      0.6,
    )
    this.shape([cap(...P(-0.2, -0.015), ...P(-0.2, 0.055), 0.016 * S, 0.016 * S, tone([0.95, 0.75, 0.15]))], this.lighting, 0.3)
  }

  // A water taxi or a tour boat on the river, with a wake behind it and lights after dark.
  private drawBoat(b: Boat) {
    const { H, look } = this
    const L = b.tour ? 0.12 : 0.06
    const y = (b.y + Math.sin(this.time * 1.4 + b.speed * 100) * 0.0012) * H
    const X = (u: number) => (b.x + u * b.dir) * H
    const foam: RGB = look.night ? [0.04, 0.12, 0.2] : look.glow > 0 ? [0.3, 0.14, 0.1] : [0.25, 0.3, 0.35]
    for (let i = 1; i < 14; i++) {
      const k = (1 - i / 14) * 0.6
      this.splat(X(-L / 2 - i * 0.006), y + (i % 2 ? 0.5 : 1.5), foam[0] * k, foam[1] * k, foam[2] * k)
      this.splat(X(-L / 2 - i * 0.006), y - (i % 2 ? 0.5 : 0), foam[0] * k, foam[1] * k, foam[2] * k)
    }
    this.polygon([[X(-L / 2), y - 0.008 * H], [X(L / 2 + 0.006), y - 0.009 * H], [X(L / 2 - 0.006), y], [X(-L / 2 + 0.004), y]], this.paint(b.tour ? [0.85, 0.82, 0.75] : [0.75, 0.6, 0.15]))
    const cabin = this.paint(b.tour ? [0.75, 0.74, 0.72] : [0.85, 0.85, 0.82])
    const decks = b.tour ? 2 : 1
    const lit = look.glow > 0
    const glass: RGB = lit ? [AMBER[0] * look.glow * 0.8, AMBER[1] * look.glow * 0.8, AMBER[2] * look.glow * 0.8] : this.paint([0.2, 0.27, 0.36])
    for (let k = 0; k < decks; k++) {
      const top = y - (0.008 + (k + 1) * 0.009) * H
      const [u0, u1] = [-L / 2 + 0.008 + k * 0.012, L / 2 - 0.012 - k * 0.01]
      this.polygon([[X(u0), top], [X(u1), top], [X(u1 + 0.004), top + 0.009 * H], [X(u0), top + 0.009 * H]], cabin)
      this.polygon([[X(u0 + 0.003), top + 0.002 * H], [X(u1 - 0.002), top + 0.002 * H], [X(u1 - 0.002), top + 0.006 * H], [X(u0 + 0.003), top + 0.006 * H]], glass)
      if (lit) this.glow(this.hdr, (X(u0) + X(u1)) / 2, y + 0.02 * H, (Math.abs(X(u1) - X(u0)) / 2) * 0.8, 0.018 * H, AMBER, 0.12 * look.glow)
    }
    if (lit) this.glow(this.hdr, X(L / 2), y - 0.006 * H, 0.004 * H, 0.004 * H, HEADLIGHT, 1.5 * look.glow)
  }

  // People strolling along the sidewalk, under umbrellas when it rains. Each step lands and holds, knees bending,
  // arms swinging against the legs and the body rising over each stride.
  private drawWalker(w: Walker) {
    const { H, look } = this
    const S = 0.1 * H * w.size
    const rise = bob(w.phase) * 0.015
    const P = (u: number, v: number): [number, number] => [w.x * H + u * w.dir * S, 0.996 * H + (v - rise) * S]
    const coat = this.paint(w.coat)
    const legs = this.paint([0.15, 0.15, 0.2])
    const skin = this.paint([0.8, 0.6, 0.48])
    const shoe = this.paint([0.08, 0.07, 0.07])
    const side = (s: number, far: boolean): Part[] => {
      const [reach, lift] = stride(w.phase, s > 0 ? 0 : 0.5)
      const fu = reach * 0.21
      const fv = -lift * 0.07 - 0.025 + rise
      const umbrella = this.wet && !far
      const hand: [number, number] = umbrella ? [0.12, -0.85] : [-reach * 0.13 + 0.02, -0.44]
      const shade = (c: RGB): RGB => (far ? [c[0] * 0.7, c[1] * 0.7, c[2] * 0.7] : c)
      return [
        ...limb(P, 0, -0.47, fu, fv, 0.24, 0.24, -1, 0.045 * S, 0.037 * S, 0.032 * S, shade(legs)),
        cap(...P(fu - 0.02, fv), ...P(fu + 0.06, fv + 0.006), 0.028 * S, 0.024 * S, shoe),
        ...limb(P, 0.01, -0.77, ...hand, 0.18, 0.18, umbrella ? -1 : 1, 0.033 * S, 0.028 * S, 0.025 * S, shade(coat)),
      ]
    }
    this.shape(side(-1, true), this.lighting, 0.6)
    this.shape(
      [
        ...side(1, false),
        cap(...P(0, -0.42), ...P(0.01, -0.8), 0.085 * S, 0.075 * S, coat),
        ell(...P(0.02, -0.89 + Math.cos(TAU * 2 * w.phase - 1) * 0.008), 0.06 * S, 0.068 * S, 0, skin),
        ell(...P(0.005, -0.925 + Math.cos(TAU * 2 * w.phase - 1) * 0.008), 0.062 * S, 0.04 * S, -0.3 * w.dir, this.paint(w.hair)),
      ],
      this.lighting,
      0.6,
    )
    if (!this.wet) return
    const [cx, cy] = P(0.08, -1.08)
    // Lit by the street at night.
    const u: RGB = [w.umbrella[0] * look.glow * 0.9, w.umbrella[1] * look.glow * 0.9, w.umbrella[2] * look.glow * 0.9]
    this.polygon(Array.from({ length: 11 }, (_, i) => [cx + Math.cos(Math.PI + (i / 10) * Math.PI) * 0.26 * S, cy + Math.sin(Math.PI + (i / 10) * Math.PI) * 0.13 * S + (i % 2 ? 0 : 0.02 * S)] as const), u)
    this.shape([cap(cx, cy, ...P(0.12, -0.85), 0.012 * S, 0.012 * S, this.paint([0.3, 0.3, 0.32]))], this.lighting, 0)
  }

  // Rain catches the city's light as faint teal streaks.
  private drawRain() {
    const H = this.H
    const n = Math.max(3, Math.round(0.022 * H))
    for (const r of this.rain) {
      const x = r.x * H
      const y = r.y * H
      for (let k = 0; k < n; k++) {
        const a = (1 - k / n) * 0.9
        this.splat(x + k * 0.15, y - k, RAIN[0] * a, RAIN[1] * a, RAIN[2] * a)
      }
    }
  }
}

export const city: Wallpaper = {
  id: "city",
  name: "City",
  description: "A skyline over a river, traffic on an elevated highway, and a blimp drifting over now and then",
  activity: {
    calm: "Skyline, river and light traffic on the highway",
    lively: "Adds a train crossing the bridge and more traffic",
    teeming: "Adds neon signs, boats on the river, people on the street, and rain at night",
  },
  scrim: {
    day: [
      [20, 40, 70],
      [24, 38, 52],
      [26, 26, 32],
    ],
    sunset: [
      [28, 8, 26],
      [38, 16, 12],
      [16, 8, 12],
    ],
    night: [
      [3, 4, 16],
      [8, 4, 18],
      [4, 3, 12],
    ],
  },
  create: (settings) => new City(settings),
}

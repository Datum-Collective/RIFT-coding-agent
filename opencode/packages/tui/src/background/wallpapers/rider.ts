import { Canvas, cap, ell, type Lighting, type Part } from "../src/canvas"
import { bob, stride } from "../src/creature"
import { eggWait } from "../src/egg"
import { lightPool } from "../src/light"
import { TAU, clamp, fbm2, hash2, lerp, rand, smoothstep, type RGB } from "../src/math"
import { fillShadow, groundShadow, sunShade, type Shade } from "../src/shadow"
import { touch } from "../src/touched"
import type { Activity, Settings, Time, Wallpaper } from "../src/wallpaper"
import { gust } from "../src/wind"

// The scene runs slower than real time, which keeps it calm behind text.
const TIME_SCALE = 0.35
// The rider walks and rides at a quarter of scene speed.
const CREATURE_SPEED = 0.25
// The bike's middle, in screen heights from the top, and its length and the rider's height at full size.
const BIKE_Y = 0.2
const BIKE_L = 0.6
const RIDER_S = 0.28
// The rider's stride (two steps) in screen heights at full size, and his walking speed.
const STRIDE = 0.1
// How long each part of the lively and teeming loops lasts, in creature seconds.
const LIVELY = { up: 1.4, look: 1.6, turn: 0.45, down: 1.4, rest: 1, back: 0.45 }
const TEEMING = { up: 1.9, wait: 0.4, mount: 0.9, idle: 0.8, off: 1.7, away: 2.2, slide: 2.2, settle: 0.6, dismount: 0.9, turn: 0.45, down: 1.9, rest: 0.6, back: 0.45 }
// Where the loops start, in creature seconds, so he is walking up toward the bike as in the poster about 45 seconds in.
const START = 1 - 45 * TIME_SCALE * CREATURE_SPEED
// The easter egg: psychic force lifts chunks of pavement around a spot, in scene seconds.
const PSYCHIC = { rise: 3, hold: 26, drop: 28, gone: 46 }

// What changes with the time of day. There is no sky: the scene looks straight down at pale concrete, so the light
// is a direction (or, at night, a rim from the moon) and a sun position off screen for the shadows.
interface Look {
  style: "front" | "rim"
  dir: readonly [number, number, number]
  light: RGB
  sun: { x: number; y: number }
  ground: RGB
  halo: RGB
  seam: RGB
  chip: RGB
  dust: RGB
  tint: RGB
  pill: [pale: RGB, blue: RGB]
  screen: RGB
  lamps: number
  night: boolean
}

function unit(x: number, y: number, z: number) {
  const l = Math.hypot(x, y, z)
  return [x / l, y / l, z / l] as const
}

const LOOKS: Record<Time, Look> = {
  day: {
    style: "front",
    dir: unit(-0.45, -0.6, 0.66),
    light: [1, 1, 1],
    sun: { x: 0.1, y: 0.1 },
    ground: [0.7, 0.715, 0.77],
    halo: [0.84, 0.84, 0.87],
    seam: [0.36, 0.38, 0.45],
    chip: [0.9, 0.92, 0.97],
    dust: [0.6, 0.57, 0.52],
    tint: [1, 1, 1],
    pill: [
      [0.92, 0.94, 0.98],
      [0.12, 0.38, 0.85],
    ],
    screen: [0.85, 0.92, 1],
    lamps: 0,
    night: false,
  },
  sunset: {
    style: "front",
    dir: unit(-0.85, -0.25, 0.48),
    light: [1, 0.7, 0.45],
    sun: { x: -0.15, y: 0.3 },
    ground: [0.66, 0.34, 0.14],
    halo: [0.88, 0.52, 0.22],
    seam: [0.28, 0.14, 0.1],
    chip: [0.9, 0.6, 0.36],
    dust: [0.85, 0.55, 0.3],
    tint: [1, 0.66, 0.46],
    pill: [
      [0.95, 0.72, 0.5],
      [0.1, 0.25, 0.62],
    ],
    screen: [1, 0.75, 0.5],
    lamps: 0.2,
    night: false,
  },
  // Dark blue asphalt under a cobalt moon. The red stays saturated, the pill turns cobalt, and the bike's lamps glow
  // amber and red: nothing white or gray.
  night: {
    style: "rim",
    dir: unit(0.4, -0.6, 0.6),
    light: [0.25, 0.5, 1.5],
    sun: { x: 0.85, y: -0.25 },
    ground: [0.03, 0.046, 0.11],
    halo: [0.05, 0.085, 0.21],
    seam: [0.012, 0.018, 0.045],
    chip: [0.06, 0.11, 0.28],
    dust: [0.08, 0.14, 0.36],
    tint: [0.38, 0.1, 0.22],
    pill: [
      [0.1, 0.28, 1.1],
      [0.03, 0.08, 0.4],
    ],
    screen: [0.1, 0.22, 0.6],
    lamps: 1,
    night: true,
  },
}

// Daytime colors.
const PAINT: RGB = [0.88, 0.09, 0.05]
const TIRE: RGB = [0.06, 0.065, 0.06]
const CANOPY: RGB = [0.2, 0.06, 0.06]
const SEAT: RGB = [0.32, 0.13, 0.06]
const JACKET: RGB = [0.92, 0.1, 0.06]
const TROUSERS: RGB = [0.78, 0.08, 0.05]
const GLOVES: RGB = [0.68, 0.07, 0.05]
const CUFF: RGB = [0.66, 0.66, 0.7]
const HAIR: RGB = [0.02, 0.02, 0.03]
const SKIN: RGB = [0.9, 0.62, 0.46]
const HEADLAMP: RGB = [1.7, 1.1, 0.45]
const TAILLAMP: RGB = [2, 0.1, 0.05]

// The cracks and chips in the poster, in its own pixels (2000 x 1125, the bike's middle at 1007, 260).
const CRACKS = [
  [862, 362, 852, 392, 848, 425, 838, 450, 822, 472, 815, 505, 806, 528, 788, 548, 770, 572, 748, 598, 722, 628, 700, 652, 688, 668],
  [848, 425, 868, 418, 882, 409],
  [838, 450, 856, 461],
  [815, 505, 838, 495, 860, 478],
  [788, 548, 760, 558, 730, 566, 702, 570],
  [770, 572, 792, 590],
  [748, 598, 738, 622, 743, 646],
  [722, 628, 699, 631],
]
const CHIPS = [
  [785, 412, 5],
  [905, 382, 4],
  [742, 648, 8],
  [1137, 637, 6],
  [1157, 606, 3],
  [1062, 675, 4],
  [866, 466, 3],
  [930, 700, 3],
  [1210, 520, 3],
]

const JOINTS = ["head", "neck", "shL", "shR", "elL", "elR", "haL", "haR", "hip", "hipL", "hipR", "knL", "knR", "ftL", "ftR"] as const
type Point = [number, number]
// The rider's joints in pixels, his height S in pixels, and which way he faces: 0 away from the viewer (the pill on his
// back shows), 1 toward (his face shows).
type Pose = Record<(typeof JOINTS)[number], Point> & { S: number; face: number }

interface Bike {
  x: number
  y: number
  angle: number
  on: boolean
}

// A trail of points in screen heights, each with its age: the tail lamp's streak or skid marks.
interface Trail {
  pts: { x: number; y: number; age: number }[]
  life: number
  open: boolean
}

interface Crack {
  lines: number[][]
  age: number
  life: number
  grow: number
}

interface Bit {
  x: number
  y: number
  vx: number
  vy: number
  spin: number
  size: number
  paper: boolean
  age: number
  life: number
}

class Rider extends Canvas {
  private time = 0
  private creatureTime = 0
  private readonly activity: Activity
  private readonly look: Look
  private lighting: Lighting = { style: "front", dir: LOOKS.day.dir }
  private readonly shade: Shade
  // Scale for narrow screens, and where things stand, in screen heights.
  private k = 1
  private cx = 1
  private cycle = START
  private rider = { x: 1, y: 0.58, face: 0, mount: 0 }
  private gait = { phase: 0.3, go: 0 }
  private bike: Bike = { x: 1, y: BIKE_Y, angle: 0, on: true }
  private lamps = 0
  private trails: Trail[] = []
  private streak: Trail | undefined
  private skids: Trail[] = []
  private cracks: Crack[] = []
  private bits: Bit[] = []
  private dust: { x: number; y: number; phase: number }[] = []
  // The visitor when a task is done: another of the gang's bikes speeding past along the bottom.
  private visitor: { x: number; y: number; speed: number; trail: Trail } | undefined
  private psychic = { wait: eggWait() * TIME_SCALE, t: -1, x: 1, y: 0.8, chunks: [] as { a: number; r: number; size: number; lift: number; phase: number }[] }
  private crater: Crack | undefined

  constructor(settings: Settings) {
    super()
    this.activity = settings.activity
    this.look = LOOKS[settings.time]
    // Seen from above, the shadows lie spread out on the pale ground, deeper than in the side-on scenes.
    const shade = sunShade(settings.time, this.look.sun)
    this.shade = { ...shade, cast: Math.min(0.9, shade.cast * 1.3) }
    this.lamps = this.look.lamps
    const motes = { calm: 5, lively: 8, teeming: 12 }[settings.activity]
    this.dust = Array.from({ length: motes }, () => ({ x: Math.random() * 3, y: rand(0.1, 0.95), phase: Math.random() * TAU }))
    if (settings.activity === "calm") return
    const papers = settings.activity === "teeming" ? 2 : 1
    const pebbles = settings.activity === "teeming" ? 7 : 4
    for (let i = 0; i < papers; i++) this.bits.push({ x: Math.random() * 2, y: rand(0.4, 0.95), vx: 0, vy: 0, spin: Math.random() * TAU, size: rand(0.022, 0.03), paper: true, age: 0, life: Infinity })
    for (let i = 0; i < pebbles; i++) this.bits.push({ x: Math.random() * 2, y: rand(0.35, 0.97), vx: 0, vy: 0, spin: Math.random() * TAU, size: rand(0.004, 0.007), paper: false, age: 0, life: Infinity })
  }

  step(dt: number) {
    dt = clamp(dt, 0, 0.1) * TIME_SCALE
    this.time += dt
    const cdt = dt * CREATURE_SPEED
    this.creatureTime += cdt
    this.stepGloom(dt)
    this.stepScript(cdt)
    this.stepTrails(cdt)
    this.stepVisitor(cdt)
    this.stepBits(dt)
    this.stepPsychic(dt)
    for (const c of this.cracks) {
      c.age += dt
      c.grow = Math.min(1, c.grow + dt * 0.8)
    }
    this.cracks = this.cracks.filter((c) => c.age < c.life)
    for (const d of this.dust) {
      d.x += (0.006 + 0.07 * gust(d.x, this.time)) * dt
      d.y += Math.sin(this.time * 0.3 + d.phase) * 0.002 * dt
      if (d.x > this.A + 0.1) d.x = -0.1
    }
  }

  render() {
    this.restore()
    const { W, H } = this
    if (this.gloom > 0)
      for (let i = 0; i < 3; i++) {
        const x = ((this.time * 0.012 + i * 0.9) % (this.A + 1.2)) - 0.6
        const y = 0.15 + i * 0.33
        fillShadow(this.hdr, W, H, x * H, y * H, (x + 0.25) * H, (y + 0.02) * H, 0.45 * H, 0.4 * H, 0.3, 0.34, 0.45, smoothstep(0, 1, this.gloom) * 0.5, 1, 1)
      }
    for (const s of this.skids) this.drawTrail(s, this.paint([0.1, 0.1, 0.12]), 0.007, 0.3, false)
    for (const c of this.cracks) this.drawCrack(c)
    if (this.crater) this.drawCrater()
    for (const b of this.bits) this.drawBit(b)
    this.drawDust()
    for (const t of this.trails) this.drawTrail(t, TAILLAMP, 0.007, this.look.night ? 0.95 : 0.8, true)
    if (this.activity === "teeming" && this.bike.on) this.drawParked()
    this.drawRider()
    if (this.visitor) this.drawVisitor()
    if (this.psychic.t >= 0) this.drawChunks()
    this.finish()
  }

  protected override visit() {
    if (this.visitor) return
    this.visitor = { x: this.A + 0.4, y: this.openRow(0.8, 0.92), speed: 0.9, trail: this.newTrail(this.trails, 2.5) }
  }

  // A click cracks the pavement a little and scatters a few pebbles.
  poke(x: number, y: number) {
    if (this.cracks.length > 8) this.cracks.shift()
    this.cracks.push(this.makeCrack(x, y, 4, 0.035, 0.07, 60))
    for (let i = 0; i < 5; i++) {
      const a = rand(0, TAU)
      const v = rand(0.05, 0.14)
      this.bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6, spin: a, size: rand(0.004, 0.008), paper: false, age: 0, life: rand(30, 45) })
    }
  }

  protected override layout() {
    const { W, H, A, look } = this
    this.k = clamp(A / 0.85, 0.55, 1)
    this.cx = A / 2
    this.bike.x = this.cx
    this.rider.x = this.cx
    this.lighting = look.style === "front" ? { style: "front", dir: look.dir } : { style: "rim", color: look.light, x: look.sun.x * W, y: look.sun.y * H }
    this.drawGround()
    // The bike stands still in calm and lively, so it is painted once with its shadow and lamps.
    if (this.activity !== "teeming") this.drawParked()
    // The script places the rider for the first frame.
    this.stepScript(0)
  }

  private paint(c: RGB): RGB {
    const t = this.look.tint
    return [c[0] * t[0], c[1] * t[1], c[2] * t[2]]
  }

  // A point of the poster, in its own pixels, in screen heights.
  private poster(px: number, py: number): Point {
    return [this.cx + ((px - 1007) / 1125) * this.k, BIKE_Y + ((py - 260) / 1125) * this.k]
  }

  // Pale concrete, brighter in a soft pool around the figure, with broad stains and a fine grain; a dark seam runs down
  // the middle, and cracks spider out beside it with chips of concrete.
  private drawGround() {
    const { W, H, look, hdr, px } = this
    const grain = this.cells ? 2 : 1
    const seamW = Math.max(0.0013 * H * this.k, (this.cells ? 0.9 : 0.6) * px)
    for (let y = 0; y < H; y++) {
      const v = (y + 0.5) / H
      const seamX = this.cx - 0.006 * this.k + 0.0015 * Math.sin(v * 9)
      const seamA = smoothstep(BIKE_Y + 0.08 * this.k, BIKE_Y + 0.13 * this.k, v) * (1 - 0.65 * smoothstep(0.6, 1, v)) * 0.55
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / H
        const dx = (u - this.cx) / 0.42
        const dy = (v - BIKE_Y - 0.27 * this.k) / 0.36
        const pool = Math.exp(-(dx * dx + dy * dy) * 1.6)
        const stain = 1 + (fbm2(u * 2.2, v * 2.2, 3) - 0.5) * 0.1 + (fbm2(u * 9 + 3, v * 9, 2) - 0.5) * 0.04
        const g = 1 + (hash2(Math.floor(x / px / grain), Math.floor(y / px / grain)) - 0.5) * 0.03
        const m = stain * g
        const o = (y * W + x) * 3
        hdr[o] = lerp(look.ground[0], look.halo[0], pool) * m
        hdr[o + 1] = lerp(look.ground[1], look.halo[1], pool) * m
        hdr[o + 2] = lerp(look.ground[2], look.halo[2], pool) * m
        const s = clamp(seamW - Math.abs(u - seamX) * H + 0.5, 0, 1) * seamA
        if (s > 0) this.blend(o, look.seam[0], look.seam[1], look.seam[2], s)
      }
    }
    const w = Math.max(0.0012 * H * this.k, (this.cells ? 0.75 : 0.5) * px)
    for (const line of CRACKS) {
      const pts = []
      for (let i = 0; i < line.length; i += 2) pts.push(this.poster(line[i], line[i + 1]))
      // A pale broken edge on the lit side, then the dark crack itself.
      if (!look.night) stroke(hdr, W, H, pts.flatMap(([x, y]) => [x * H + 1.3 * px, y * H + 0.6 * px, 0.5, w]), look.chip, 0)
      stroke(hdr, W, H, pts.flatMap(([x, y]) => [x * H, y * H, 0.8, w]), look.seam, 0)
    }
    for (const [cx, cy, size] of CHIPS) {
      const [x, y] = this.poster(cx, cy)
      const r = Math.max(((size / 1125) * this.k * H) / 1.4, 0.7 * px)
      this.ellipse(x * H + r * 0.5, y * H + r * 0.5, r * 1.2, r * 0.8, look.seam[0], look.seam[1], look.seam[2], 0.55)
      this.ellipse(x * H, y * H, r, r * 0.75, look.chip[0], look.chip[1], look.chip[2], 0.9)
    }
  }

  // Advances the rider and the bike through the loop for this activity level.
  private stepScript(cdt: number) {
    const before = { x: this.rider.x, y: this.rider.y }
    this.cycle += cdt
    if (this.activity === "calm") this.calmAt()
    if (this.activity === "lively") this.livelyAt(this.cycle)
    if (this.activity === "teeming") this.teemingAt(this.cycle)
    const d = Math.hypot(this.rider.x - before.x, this.rider.y - before.y)
    this.gait.phase += d / (STRIDE * this.k)
    this.gait.go = clamp(this.gait.go + (d > 1e-7 && this.rider.mount === 0 ? cdt : -cdt) * 2.5, 0, 1)
  }

  private calmAt() {
    Object.assign(this.rider, { x: this.cx, y: BIKE_Y + 0.38 * this.k, face: 0, mount: 0 })
  }

  // He walks slowly up toward the bike, stands looking at it, turns, wanders back and turns to walk up again.
  private livelyAt(cycle: number) {
    const T = LIVELY
    const total = T.up + T.look + T.turn + T.down + T.rest + T.back
    const near = BIKE_Y + 0.33 * this.k
    const far = Math.min(0.86, BIKE_Y + 0.6 * this.k)
    const t = ((cycle % total) + total) % total
    const r = this.rider
    r.x = this.cx
    r.mount = 0
    const ends = [T.up, T.look, T.turn, T.down, T.rest, T.back].reduce<number[]>((list, d) => [...list, (list.at(-1) ?? 0) + d], [])
    if (t < ends[0]) return void Object.assign(r, { y: lerp(far, near, walk(t / T.up)), face: 0 })
    if (t < ends[1]) return void Object.assign(r, { y: near, face: 0 })
    if (t < ends[2]) return void Object.assign(r, { y: near, face: smoothstep(0, 1, (t - ends[1]) / T.turn) })
    if (t < ends[3]) return void Object.assign(r, { y: lerp(near, far, walk((t - ends[2]) / T.down)), face: 1 })
    if (t < ends[4]) return void Object.assign(r, { y: far, face: 1 })
    Object.assign(r, { y: far, face: 1 - smoothstep(0, 1, (t - ends[4]) / T.back) })
  }

  // He walks up to the bike, climbs on and rides off, leaving the tail lamp's red streak; a while later the bike slides
  // back into its place sideways, and he climbs off and wanders back down.
  private teemingAt(cycle: number) {
    const T = TEEMING
    const steps = [T.up, T.wait, T.mount, T.idle, T.off, T.away, T.slide, T.settle, T.dismount, T.turn, T.down, T.rest, T.back]
    const total = steps.reduce((a, b) => a + b, 0)
    const t = ((cycle % total) + total) % total
    let i = 0
    let s = t
    while (i < steps.length - 1 && s >= steps[i]) s -= steps[i++]
    const p = s / steps[i]
    const k = this.k
    const r = this.rider
    const b = this.bike
    const far = Math.min(0.86, BIKE_Y + 0.6 * k)
    const spot = { x: this.cx + 0.05 * k, y: BIKE_Y + 0.2 * k }
    const lamps = this.look.lamps
    b.on = true
    b.angle = 0
    b.y = BIKE_Y
    b.x = this.cx
    this.lamps = lamps
    r.face = 0
    r.mount = 0
    // 0 walk up, 1 wait, 2 mount, 3 idle, 4 ride off, 5 away, 6 slide in, 7 settle, 8 dismount, 9 turn, 10 walk down,
    // 11 rest, 12 turn back.
    if (i === 0) Object.assign(r, { x: lerp(this.cx, spot.x, walk(p)), y: lerp(far, spot.y, walk(p)) })
    if (i >= 1 && i <= 9) Object.assign(r, { x: spot.x, y: spot.y })
    if (i === 2) r.mount = smoothstep(0, 1, p)
    if (i === 3) r.mount = 1
    if (i === 3) this.lamps = Math.max(lamps, 0.25) * (1 + 0.6 * smoothstep(0, 0.4, p))
    if (i === 4) {
      // Away to the left, faster and faster, until it is off the screen.
      r.mount = 1
      this.lamps = Math.max(lamps, 0.25) * 1.6
      b.x = this.cx - (this.cx + 0.75) * p * p
      this.streak ??= this.newTrail(this.trails, 2.6)
    }
    if (i === 5) {
      r.mount = 1
      b.on = false
    }
    if (i === 6) {
      // In from the right, broadside and slowing, the tail swung out; it straightens as it stops.
      r.mount = 1
      this.lamps = Math.max(lamps, 0.25) * 1.6
      const q = 1 - (1 - p) ** 2
      b.x = this.cx + (this.A - this.cx + 0.5) * (1 - q)
      b.y = BIKE_Y + 0.1 * k * (1 - smoothstep(0.55, 1, p))
      b.angle = 1.15 * (1 - smoothstep(0.6, 1, p))
      this.streak ??= this.newTrail(this.trails, 2.6)
      if (p > 0.08 && p < 0.95) this.skid()
    }
    if (i === 7) r.mount = 1
    if (i === 8) r.mount = 1 - smoothstep(0, 1, p)
    if (i === 9) r.face = smoothstep(0, 1, p)
    if (i === 10) Object.assign(r, { x: lerp(spot.x, this.cx, walk(p)), y: lerp(spot.y, far, walk(p)), face: 1 })
    if (i === 11) Object.assign(r, { x: this.cx, y: far, face: 1 })
    if (i === 12) Object.assign(r, { x: this.cx, y: far, face: 1 - smoothstep(0, 1, p) })
    if (i !== 4 && i !== 6) {
      if (this.streak) this.streak.open = false
      this.streak = undefined
      for (const s of this.skids) s.open = false
    }
    if (!this.streak) return
    const [tx, ty] = this.bikePoint(b, 1, 0.48, -0.01)
    const last = this.streak.pts.at(-1)
    if (!last || Math.hypot(tx / this.H - last.x, ty / this.H - last.y) > 0.012) this.streak.pts.push({ x: tx / this.H, y: ty / this.H, age: 0 })
  }

  private newTrail(list: Trail[], life: number): Trail {
    const trail = { pts: [], life, open: true }
    list.push(trail)
    return trail
  }

  // A skid mark from the rear tyre, swung out as the bike slides in.
  private skid() {
    const b = this.bike
    const [x, y] = this.bikePoint(b, 1, 0.4, 0.12)
    if (x > this.W + 4) return
    const trail = this.skids.find((s) => s.open) ?? this.newTrail(this.skids, 9)
    const last = trail.pts.at(-1)
    if (!last || Math.hypot(x / this.H - last.x, y / this.H - last.y) > 0.01) trail.pts.push({ x: x / this.H, y: y / this.H, age: 0 })
  }

  private stepTrails(cdt: number) {
    for (const list of [this.trails, this.skids]) for (const t of list) for (const p of t.pts) p.age += cdt
    const alive = (t: Trail) => t.open || t.pts.some((p) => p.age < t.life)
    this.trails = this.trails.filter(alive)
    this.skids = this.skids.filter(alive)
    for (const t of [...this.trails, ...this.skids]) t.pts = t.pts.filter((p, i, all) => p.age < t.life || (all[i + 1]?.age ?? 0) < t.life)
  }

  private stepVisitor(cdt: number) {
    const v = this.visitor
    if (!v) return
    v.x -= v.speed * cdt
    const [tx, ty] = [v.x + 0.48 * BIKE_L * 0.55 * this.k, v.y - 0.01 * BIKE_L * 0.55 * this.k]
    const last = v.trail.pts.at(-1)
    if (!last || Math.hypot(tx - last.x, ty - last.y) > 0.015) v.trail.pts.push({ x: tx, y: ty, age: 0 })
    if (v.x > -0.5) return
    v.trail.open = false
    this.visitor = undefined
  }

  // Loose paper and pebbles skitter downwind as the gusts pass, then settle.
  private stepBits(dt: number) {
    for (const b of this.bits) {
      b.age += dt
      const g = gust(b.x, this.time)
      const push = b.paper ? 0.35 : 0.05
      b.vx += (g * g * push - b.vx * (b.paper ? 1.5 : 3)) * dt
      b.vy += (-b.vy * 3 + (b.paper ? Math.sin(this.time * 2 + b.spin) * 0.03 * g : 0)) * dt
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.spin += b.vx * dt * (b.paper ? 40 : 20)
      if (b.x < this.A + 0.06) continue
      b.x = -0.06
      b.y = this.openRow(0.4, 0.95)
    }
    this.bits = this.bits.filter((b) => b.age < b.life)
  }

  private stepPsychic(dt: number) {
    const e = this.psychic
    if (e.t < 0) {
      e.wait -= dt
      if (e.wait > 0) return
      e.t = 0
      ;[e.x, e.y] = this.openSpot(0.25, this.A - 0.25, 0.7, 0.9)
      e.chunks = Array.from({ length: 9 }, (_, i) => ({ a: (i / 9) * TAU + rand(-0.2, 0.2), r: rand(0.02, 0.07), size: rand(0.009, 0.018), lift: rand(0.05, 0.11), phase: rand(0, TAU) }))
      this.crater = this.makeCrack(e.x, e.y, 9, 0.06, 0.12, PSYCHIC.gone + 30)
      this.crater.grow = 0
      return
    }
    e.t += dt
    if (this.crater) {
      this.crater.age += dt
      this.crater.grow = Math.min(1, this.crater.grow + dt * 0.6)
      if (this.crater.age > this.crater.life) this.crater = undefined
    }
    if (e.t < PSYCHIC.gone) return
    e.t = -1
    e.wait = eggWait(true) * TIME_SCALE
  }

  private makeCrack(x: number, y: number, branches: number, min: number, max: number, life: number): Crack {
    const lines: number[][] = []
    for (let i = 0; i < branches; i++) {
      let a = (i / branches) * TAU + rand(-0.4, 0.4)
      const length = rand(min, max)
      const line = [x, y]
      const n = 5
      for (let j = 1; j <= n; j++) {
        a += rand(-0.5, 0.5)
        const [px, py] = [line.at(-2) ?? x, line.at(-1) ?? y]
        line.push(px + Math.cos(a) * (length / n), py + Math.sin(a) * (length / n) * 0.75)
        if (j === 2 && Math.random() < 0.5) {
          const b = a + (Math.random() < 0.5 ? -0.9 : 0.9)
          const [qx, qy] = [line.at(-2) ?? x, line.at(-1) ?? y]
          lines.push([qx, qy, qx + Math.cos(b) * length * 0.3, qy + Math.sin(b) * length * 0.22])
        }
      }
      lines.push(line)
    }
    return { lines, age: 0, life, grow: 0 }
  }

  // A point on the bike, u along it (front at -0.5) and v down, in pixels.
  private bikePoint(b: Bike, scale: number, u: number, v: number): Point {
    const L = BIKE_L * this.k * scale * this.H
    const c = Math.cos(b.angle)
    const s = Math.sin(b.angle)
    return [b.x * this.H + (u * c - v * s) * L, b.y * this.H + (u * s + v * c) * L]
  }

  // The hero's bike with its shadow and lamps.
  private drawParked() {
    const b = this.bike
    const H = this.H
    const L = BIKE_L * this.k * H
    groundShadow(this.hdr, this.W, H, this.shade, b.x * H + 0.02 * L, (b.y + 0.07 * this.k) * H, 0.95 * L, 0.22 * L, 0.9)
    this.drawBike(b, 1, PAINT, this.lamps)
  }

  // The red capsule bike side-on from above, facing left: big dark tyres, a long low body, the dark canopy and clear
  // windscreen at the front, a brown seat, a few colored sticker patches and its lamps.
  private drawBike(b: Bike, scale: number, paint: RGB, lamps: number) {
    const L = BIKE_L * this.k * scale * this.H
    const P = (u: number, v: number) => this.bikePoint(b, scale, u, v)
    const E = (u: number, v: number, rx: number, ry: number, a: number, color: RGB) => ell(...P(u, v), rx * L, ry * L, a + b.angle, color)
    const C = (au: number, av: number, bu: number, bv: number, r0: number, r1: number, color: RGB) => cap(...P(au, av), ...P(bu, bv), r0 * L, r1 * L, color)
    const tire = this.paint(TIRE)
    const dark = this.paint([0.1, 0.09, 0.09])
    this.shape([E(-0.405, 0.036, 0.092, 0.106, 0, tire), E(0.4, 0.034, 0.095, 0.106, 0, tire), C(-0.28, 0.105, 0.28, 0.105, 0.032, 0.032, dark)], this.lighting, 0.8)
    const hub = this.paint([0.34, 0.33, 0.33])
    this.shape([E(-0.4, 0.06, 0.036, 0.042, 0, hub), E(0.42, 0.05, 0.04, 0.048, 0, hub)], this.lighting, 0.6)
    const red = this.paint(paint)
    this.shape(
      [
        E(-0.215, 0.035, 0.205, 0.085, 0, red),
        C(-0.36, 0.06, -0.06, 0.03, 0.06, 0.08, red),
        E(-0.4, 0.085, 0.05, 0.04, 0.3, red),
        C(-0.36, -0.01, -0.28, -0.055, 0.045, 0.04, red),
        E(0.1, 0.075, 0.14, 0.055, 0, red),
        E(-0.02, 0.02, 0.06, 0.07, 0, red),
        C(0.2, 0.03, 0.4, 0.03, 0.085, 0.062, red),
        E(0.3, -0.035, 0.11, 0.06, -0.12, red),
      ],
      this.lighting,
      0.6,
    )
    const seat = this.paint(SEAT)
    this.shape([C(-0.01, -0.02, 0.12, -0.04, 0.068, 0.07, seat), C(0.13, -0.05, 0.19, -0.088, 0.068, 0.055, seat)], this.lighting, 0.7)
    const stitch = this.paint([0.2, 0.08, 0.04])
    this.shape([C(0.06, -0.085, 0.065, 0.015, 0.006, 0.006, stitch), C(0.135, -0.1, 0.132, -0.01, 0.006, 0.006, stitch)], this.lighting, 0)
    this.shape([E(0.17, -0.105, 0.035, 0.018, -0.4, this.paint([0.5, 0.24, 0.12])), E(0.03, -0.065, 0.045, 0.016, -0.1, this.paint([0.46, 0.21, 0.1]))], this.lighting, 0)
    const canopy = this.paint(CANOPY)
    this.shape([E(-0.17, -0.085, 0.17, 0.072, -0.15, canopy), E(-0.02, -0.08, 0.035, 0.06, 0, this.paint([0.16, 0.14, 0.14]))], this.lighting, 0.7)
    this.shape([E(-0.22, -0.105, 0.06, 0.012, -0.2, this.paint([0.42, 0.24, 0.24]))], this.lighting, 0)
    // Sticker patches: a star-and-bar roundel, a yellow badge edged in blue and an orange one on the nose.
    this.shape([E(-0.295, 0.01, 0.046, 0.011, 0, this.paint([0.85, 0.86, 0.9]))], this.lighting, 0.2)
    this.shape([E(-0.295, 0.01, 0.019, 0.019, 0, this.paint([0.12, 0.2, 0.6]))], this.lighting, 0.2)
    // A slanted patch w by h about (u, v), its long side tilted by a.
    const badge = (u: number, v: number, w: number, h: number, a: number) => [P(u - w + h * 0.3, v - w * a - h), P(u + w + h * 0.3, v + w * a - h), P(u + w - h * 0.3, v + w * a + h), P(u - w - h * 0.3, v - w * a + h)]
    this.polygon(badge(-0.205, 0.045, 0.048, 0.02, 0.15), this.paint([0.1, 0.18, 0.55]))
    this.polygon(badge(-0.205, 0.045, 0.04, 0.013, 0.15), this.paint([0.95, 0.72, 0.12]))
    this.polygon(badge(-0.37, 0.085, 0.036, 0.015, 0.25), this.paint([0.95, 0.5, 0.1]))
    // The clear windscreen sweeping up over the canopy, a pale sheen with a brighter top edge.
    const s = this.look.screen
    const arc = [
      [-0.36, -0.08],
      [-0.29, -0.14],
      [-0.2, -0.195],
      [-0.1, -0.232],
      [-0.045, -0.238],
      [-0.01, -0.16],
    ]
    this.polygon([...arc.map(([u, v]) => P(u, v)), P(-0.06, -0.14), P(-0.2, -0.14), P(-0.32, -0.07)], s, 0.2)
    this.shape(
      arc.slice(1).map(([u, v], i) => C(arc[i][0], arc[i][1], u, v, 0.006, 0.006, s)),
      this.lighting,
      0,
    )
    if (this.look.night) this.shape(arc.slice(1).map(([u, v], i) => C(arc[i][0], arc[i][1], u, v, 0.006, 0.006, [s[0] * 1.5, s[1] * 1.5, s[2] * 1.5])), this.lighting, 0)
    // Lamps: amber at the nose and red at the tail, glowing once the light falls.
    const glow = clamp(lamps, 0, 2)
    const lit = (off: RGB, on: RGB): RGB => [lerp(off[0], on[0], Math.min(1, glow)), lerp(off[1], on[1], Math.min(1, glow)), lerp(off[2], on[2], Math.min(1, glow))]
    this.shape([E(-0.47, 0.045, 0.018, 0.024, 0, lit(this.paint([0.9, 0.85, 0.6]), HEADLAMP)), E(0.485, -0.01, 0.014, 0.022, 0, lit(this.paint([0.5, 0.04, 0.03]), TAILLAMP))], this.lighting, 0)
    if (glow <= 0) return
    // The headlamp's beam spreads ahead of the nose: a bright pool near it and a wider, dimmer one further out.
    const [hx, hy] = P(-0.62, 0.075)
    lightPool(this.hdr, this.W, this.H, hx, hy, 0.2 * L, 0.085 * L, [1, 0.55, 0.16], 2.4 * glow, 0.025 * glow)
    const [fx, fy] = P(-0.9, 0.11)
    lightPool(this.hdr, this.W, this.H, fx, fy, 0.4 * L, 0.17 * L, [1, 0.55, 0.16], 1.8 * glow, 0.02 * glow)
    const [tx, ty] = P(0.56, 0.02)
    lightPool(this.hdr, this.W, this.H, tx, ty, 0.12 * L, 0.07 * L, [1, 0.06, 0.04], 2.5 * glow, 0.04 * glow)
  }

  // The rider: on foot, climbing on, or riding.
  private drawRider() {
    const r = this.rider
    const H = this.H
    const S = RIDER_S * this.k * H
    const standing = this.standingPose(r.x * H, r.y * H, S, r.face)
    if (r.mount <= 0) groundShadow(this.hdr, this.W, H, this.shade, r.x * H, r.y * H, 0.34 * S, 0.95 * S, 0.7)
    if (r.mount > 0 && !this.bike.on) return
    const pose = r.mount <= 0 ? standing : r.mount >= 1 ? this.seatedPose(this.bike, 1) : mixPose(standing, this.seatedPose(this.bike, 1), r.mount)
    this.drawPose(pose, JACKET, true)
  }

  private standingPose(x: number, y: number, S: number, face: number): Pose {
    const g = this.gait
    const dir = face < 0.5 ? -1 : 1
    const sw = 0.62 + 0.38 * Math.abs(Math.cos(Math.PI * face))
    const [rl, ll] = stride(g.phase, 0)
    const [rr, lr] = stride(g.phase, 0.5)
    const reach = 0.1 * g.go
    // Standing still he breathes, and his jacket stirs as a gust goes by.
    const stir = gust(x / this.H, this.time)
    const rise = (bob(g.phase) - 0.5) * 0.012 * g.go + Math.sin(this.time * 1.1) * 0.003
    const footL = dir * rl * reach - ll * 0.035 * g.go
    const footR = dir * rr * reach - lr * 0.035 * g.go
    const swingL = -dir * rr * 0.09 * g.go + stir * 0.008
    const swingR = -dir * rl * 0.09 * g.go + stir * 0.012
    const P = (u: number, v: number): Point => [x + u * S, y + v * S]
    return {
      S,
      face,
      head: P(0, -0.885 + rise),
      neck: P(0, -0.775 + rise),
      shL: P(-0.16 * sw, -0.705 + rise),
      shR: P(0.16 * sw, -0.705 + rise),
      elL: P(-0.23 * sw, -0.6 + rise + swingL * 0.4),
      elR: P(0.23 * sw, -0.6 + rise + swingR * 0.4),
      haL: P(-0.215 * sw - Math.max(0, swingL) * 0.3, -0.48 + rise + swingL),
      haR: P(0.215 * sw + Math.max(0, swingR) * 0.3, -0.48 + rise + swingR),
      hip: P(0, -0.47 + rise),
      hipL: P(-0.06 * sw, -0.45 + rise),
      hipR: P(0.06 * sw, -0.45 + rise),
      knL: P(-0.058 * sw, -0.25 + footL * 0.5 - ll * 0.02 * g.go),
      knR: P(0.058 * sw, -0.25 + footR * 0.5 - lr * 0.02 * g.go),
      ftL: P(-0.055 * sw, -0.04 + footL),
      ftR: P(0.055 * sw, -0.04 + footR),
    }
  }

  // Crouched on the seat, leaning forward to the bars, in the bike's own frame so he leans and slides with it.
  private seatedPose(b: Bike, scale: number): Pose {
    const P = (u: number, v: number) => this.bikePoint(b, scale, u, v)
    const sway = Math.sin(this.time * 9) * 0.002 * (this.lamps > 0.5 ? 1 : 0)
    return {
      S: RIDER_S * this.k * scale * this.H,
      face: 0,
      head: P(-0.135, -0.175 + sway),
      neck: P(-0.085, -0.145 + sway),
      shL: P(-0.065, -0.17 + sway),
      shR: P(-0.05, -0.105 + sway),
      elL: P(-0.12, -0.16),
      elR: P(-0.1, -0.075),
      haL: P(-0.16, -0.13),
      haR: P(-0.15, -0.085),
      hip: P(0.075, -0.085),
      hipL: P(0.075, -0.1),
      hipR: P(0.075, -0.055),
      knL: P(-0.03, -0.085),
      knR: P(-0.025, -0.01),
      ftL: P(0.02, -0.06),
      ftR: P(0.03, 0.045),
    }
  }

  // Draws a pose: trousers and boots, the jacket, arms and gloves, black hair, and the pill on his back (or his face).
  private drawPose(p: Pose, jacket: RGB, pill: boolean) {
    const S = p.S
    const trousers = this.paint(jacket === JACKET ? TROUSERS : [jacket[0] * 0.8, jacket[1] * 0.8, jacket[2] * 0.8])
    const boots = this.paint(jacket === JACKET ? JACKET : [0.1, 0.1, 0.12])
    const coat = this.paint(jacket)
    this.shape([cap(...p.hipL, ...p.knL, 0.06 * S, 0.052 * S, trousers), cap(...p.knL, ...p.ftL, 0.052 * S, 0.046 * S, trousers), cap(...p.hipR, ...p.knR, 0.06 * S, 0.052 * S, trousers), cap(...p.knR, ...p.ftR, 0.052 * S, 0.046 * S, trousers)], this.lighting, 0.8)
    this.shape([ell(...p.ftL, 0.055 * S, 0.062 * S, 0, boots), ell(...p.ftR, 0.055 * S, 0.062 * S, 0, boots)], this.lighting, 0.8)
    const hips = Math.atan2(p.hipR[1] - p.hipL[1], p.hipR[0] - p.hipL[0])
    this.shape([cap(...p.neck, ...p.hip, 0.135 * S, 0.12 * S, coat), ell(...p.hip, 0.14 * S, 0.06 * S, hips, coat), cap(...p.shL, ...p.shR, 0.078 * S, 0.078 * S, coat), ell(...p.neck, 0.085 * S, 0.048 * S, 0, this.paint([jacket[0] * 1.05, jacket[1] * 1.3, jacket[2] * 1.3]))], this.lighting, 0.85)
    const gloves = this.paint(jacket === JACKET ? GLOVES : [0.1, 0.1, 0.12])
    const arm = (sh: Point, el: Point, ha: Point): Part[] => [cap(...sh, ...el, 0.055 * S, 0.048 * S, coat), cap(...el, ...ha, 0.048 * S, 0.038 * S, coat)]
    this.shape([...arm(p.shL, p.elL, p.haL), ...arm(p.shR, p.elR, p.haR)], this.lighting, 0.9)
    const cuff = this.paint(CUFF)
    this.shape([ell(...p.haL, 0.04 * S, 0.042 * S, 0, gloves), ell(...p.haR, 0.04 * S, 0.042 * S, 0, gloves)], this.lighting, 0.7)
    this.shape([ell(lerp(p.elL[0], p.haL[0], 0.75), lerp(p.elL[1], p.haL[1], 0.75), 0.038 * S, 0.014 * S, Math.atan2(p.haL[1] - p.elL[1], p.haL[0] - p.elL[0]) + Math.PI / 2, cuff), ell(lerp(p.elR[0], p.haR[0], 0.75), lerp(p.elR[1], p.haR[1], 0.75), 0.038 * S, 0.014 * S, Math.atan2(p.haR[1] - p.elR[1], p.haR[0] - p.elR[0]) + Math.PI / 2, cuff)], this.lighting, 0.3)
    const hair = this.paint(HAIR)
    const [hx, hy] = p.head
    this.shape([ell(hx, hy, 0.09 * S, 0.088 * S, 0, hair), ell(hx - 0.065 * S, hy - 0.04 * S, 0.048 * S, 0.034 * S, 0.6, hair), ell(hx + 0.06 * S, hy - 0.05 * S, 0.048 * S, 0.034 * S, -0.5, hair), ell(hx + 0.01 * S, hy - 0.085 * S, 0.042 * S, 0.034 * S, 0.1, hair), ell(hx - 0.075 * S, hy + 0.03 * S, 0.03 * S, 0.04 * S, 0.3, hair)], this.lighting, 0.35)
    if (p.face > 0.6) {
      const f = (p.face - 0.6) / 0.4
      this.shape([ell(hx, hy + 0.02 * S, 0.06 * S * f, 0.058 * S, 0, this.paint(SKIN))], this.lighting, 0.6)
      this.shape([ell(hx, hy - 0.035 * S, 0.072 * S, 0.035 * S, 0, hair)], this.lighting, 0.5)
    }
    if (!pill || p.face > 0.4) return
    const spine = Math.atan2(p.neck[1] - p.hip[1], p.neck[0] - p.hip[0])
    const a = spine + Math.PI / 2 - 0.35
    const side = Math.sin(Math.PI * p.face) * 0.12 * S
    const c: Point = [lerp(p.neck[0], p.hip[0], 0.45) + side, lerp(p.neck[1], p.hip[1], 0.45)]
    const d: Point = [Math.cos(a) * 0.075 * S, Math.sin(a) * 0.075 * S]
    const [pale, blue] = this.look.pill
    this.shape([cap(c[0] - d[0], c[1] - d[1], ...c, 0.034 * S, 0.034 * S, pale), cap(...c, c[0] + d[0], c[1] + d[1], 0.034 * S, 0.034 * S, blue)], this.lighting, 0.6)
  }

  // The tail lamp's streak glows and fades from its oldest end; skid marks are dark rubber.
  private drawTrail(t: Trail, color: RGB, radius: number, strength: number, glow: boolean) {
    if (t.pts.length < 2) return
    const H = this.H
    const r = Math.max(radius * this.k * H, this.cells ? 1 : 0.6)
    const pts = t.pts.flatMap((p) => [p.x * H, p.y * H, strength * clamp(1 - p.age / t.life, 0, 1) ** 1.5, r])
    if (glow) stroke(this.hdr, this.W, H, pts.map((v, i) => (i % 4 === 3 ? v * 4 : i % 4 === 2 ? v * 0.4 : v)), color, 1)
    stroke(this.hdr, this.W, H, pts, color, glow ? 0.6 : 0)
  }

  private drawCrack(c: Crack) {
    const H = this.H
    const fade = clamp((c.life - c.age) / 8, 0, 1)
    const w = Math.max(0.0012 * H * this.k, this.cells ? 0.75 : 0.5)
    for (const line of c.lines) {
      const n = Math.max(2, Math.ceil((line.length / 2) * c.grow))
      const pts: number[] = []
      for (let i = 0; i < n * 2 && i < line.length; i += 2) pts.push(line[i] * H, line[i + 1] * H, 0.8 * fade, w)
      if (!this.look.night) stroke(this.hdr, this.W, H, pts.map((v, i) => (i % 4 === 0 ? v + 1.3 : i % 4 === 1 ? v + 0.6 : i % 4 === 2 ? v * 0.6 : v)), this.look.chip, 0)
      stroke(this.hdr, this.W, H, pts, this.look.seam, 0)
    }
  }

  // The egg's crater: a dished ring in the pavement under the floating chunks, with cracks running out from it.
  private drawCrater() {
    const c = this.crater
    if (!c) return
    const H = this.H
    const e = this.psychic
    const fade = clamp((c.life - c.age) / 10, 0, 1) * c.grow
    const s = this.look.seam
    this.ellipse(e.x * H, e.y * H, 0.07 * H, 0.03 * H, s[0], s[1], s[2], 0.25 * fade)
    this.ellipse(e.x * H, e.y * H, 0.045 * H, 0.019 * H, s[0], s[1], s[2], 0.3 * fade)
    this.drawCrack(c)
  }

  // Chunks of pavement float up around the crater, bob in the air, then drop back.
  private drawChunks() {
    const e = this.psychic
    const H = this.H
    const up = smoothstep(0, PSYCHIC.rise, e.t) * (1 - smoothstep(PSYCHIC.hold, PSYCHIC.drop, e.t))
    if (up <= 0) return
    const color = this.look.chip
    for (const c of e.chunks) {
      const x = (e.x + Math.cos(c.a) * c.r) * H
      const y = (e.y + Math.sin(c.a) * c.r * 0.45) * H
      const lift = (c.lift + Math.sin(this.time * 0.8 + c.phase) * 0.006) * up * H
      groundShadow(this.hdr, this.W, H, this.shade, x, y, c.size * 2.2 * H, c.size * 2 * H, 0.8, lift)
      this.shape([ell(x, y - lift, c.size * H, c.size * 0.75 * H, c.phase, color)], this.lighting, 0.8)
    }
    if (this.look.night) lightPool(this.hdr, this.W, H, e.x * H, (e.y - 0.04) * H, 0.12 * H, 0.08 * H, [0.3, 0.45, 1], 1.2 * up, 0.012 * up)
  }

  private drawBit(b: Bit) {
    const H = this.H
    const fade = clamp((b.life - b.age) / 6, 0, 1)
    if (fade <= 0) return
    const x = b.x * H
    const y = b.y * H
    const s = this.look.seam
    if (!b.paper) {
      const r = Math.max(b.size * this.k * H, this.cells ? 0.8 : 0.5)
      this.ellipse(x + r * 0.4, y + r * 0.5, r * 1.15, r * 0.8, s[0], s[1], s[2], 0.45 * fade)
      const c = this.look.chip
      return this.ellipse(x, y, r, r * 0.8, c[0], c[1], c[2], 0.85 * fade)
    }
    // A sheet of paper tumbling end over end as it blows along.
    const w = b.size * H
    const flip = Math.cos(b.spin)
    const a = b.spin * 0.3
    const P = (u: number, v: number): Point => [x + (u * Math.cos(a) - v * flip * Math.sin(a)) * w, y + (u * Math.sin(a) + v * flip * Math.cos(a)) * w * 0.8]
    this.ellipse(x + 0.2 * w, y + 0.35 * w, w * 0.6, w * 0.25, s[0], s[1], s[2], 0.3)
    const c = this.look.chip
    this.polygon([P(-0.5, -0.35), P(0.5, -0.4), P(0.48, 0.35), P(-0.5, 0.38)], [c[0] * 0.9, c[1] * 0.88, c[2] * 0.82])
  }

  private drawDust() {
    const H = this.H
    const c = this.look.dust
    for (const d of this.dust) {
      const g = gust(d.x, this.time)
      const a = 0.08 + 0.2 * g
      this.ellipse(d.x * H, d.y * H, (0.012 + 0.02 * g) * H, 0.005 * H, c[0], c[1], c[2], a)
    }
  }

  // Another rider of the gang, smaller in the distance, speeding along the bottom with its tail lamp streaking.
  private drawVisitor() {
    const v = this.visitor
    if (!v) return
    const b: Bike = { x: v.x, y: v.y, angle: 0, on: true }
    const L = BIKE_L * this.k * 0.55 * this.H
    groundShadow(this.hdr, this.W, this.H, this.shade, v.x * this.H, v.y * this.H + 0.07 * L, 0.95 * L, 0.2 * L, 0.9)
    this.drawBike(b, 0.55, [0.12, 0.32, 0.8], Math.max(this.look.lamps, 0.3) * 1.5)
    this.drawPose(this.seatedPose(b, 0.55), [0.1, 0.35, 0.3], false)
  }
}

// Eases a walk from standing to a steady pace and back to a stop.
function walk(p: number) {
  const ramp = 0.15
  const t = clamp(p, 0, 1)
  const v = 1 / (1 - ramp)
  if (t < ramp) return (v * t * t) / (2 * ramp)
  if (t > 1 - ramp) return 1 - (v * (1 - t) * (1 - t)) / (2 * ramp)
  return v * (t - ramp / 2)
}

function mixPose(a: Pose, b: Pose, t: number): Pose {
  const out = { S: lerp(a.S, b.S, t), face: lerp(a.face, b.face, t) } as Pose
  for (const j of JOINTS) out[j] = [lerp(a[j][0], b[j][0], t), lerp(a[j][1], b[j][1], t)]
  return out
}

// Mixes color along a polyline: pts holds x, y, strength and radius per point, in pixels. soft 0 draws a crisp
// anti-aliased line; soft 1 a glow falling off to nothing at the radius. Each pixel is drawn by the one segment its
// nearest point falls on, so joints don't darken.
function stroke(hdr: Float32Array, W: number, H: number, pts: number[], color: RGB, soft: number) {
  const n = pts.length / 4
  for (let i = 0; i + 1 < n; i++) {
    const [ax, ay, aa, ar] = [pts[i * 4], pts[i * 4 + 1], pts[i * 4 + 2], pts[i * 4 + 3]]
    const [bx, by, ba, br] = [pts[i * 4 + 4], pts[i * 4 + 5], pts[i * 4 + 6], pts[i * 4 + 7]]
    if (aa <= 0 && ba <= 0) continue
    const R = Math.max(ar, br) + 1
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - R))
    const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + R))
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - R))
    const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + R))
    if (x0 > x1 || y0 > y1) continue
    touch(hdr, x0, y0, x1, y1)
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy || 1e-6
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - ax
        const py = y + 0.5 - ay
        const raw = (px * dx + py * dy) / len2
        if ((raw < 0 && i > 0) || (raw >= 1 && i < n - 2)) continue
        const t = clamp(raw, 0, 1)
        const d = Math.hypot(px - dx * t, py - dy * t)
        const r = ar + (br - ar) * t
        const a = aa + (ba - aa) * t
        const hard = clamp(r - d + 0.5, 0, 1)
        const fall = Math.max(0, 1 - d / r) ** 2
        const cov = (hard + (fall - hard) * soft) * a
        if (cov <= 0) continue
        const o = (y * W + x) * 3
        hdr[o] += (color[0] - hdr[o]) * cov
        hdr[o + 1] += (color[1] - hdr[o + 1]) * cov
        hdr[o + 2] += (color[2] - hdr[o + 2]) * cov
      }
  }
}

export const rider: Wallpaper = {
  id: "rider",
  name: "Rider",
  description: "A red capsule bike on pale cracked concrete, its rider walking up to it, with another of the gang speeding by now and then",
  fixedTime: "day",
  activity: {
    calm: "The bike, the rider standing by it, and drifting dust",
    lively: "He walks slowly up to the bike and back, and paper and pebbles skitter in the gusts",
    teeming: "He rides off in a red tail-light streak and slides back in sideways",
  },
  scrim: {
    day: [
      [40, 44, 56],
      [42, 45, 56],
      [38, 41, 52],
    ],
    sunset: [
      [46, 28, 20],
      [50, 30, 20],
      [42, 24, 16],
    ],
    night: [
      [4, 7, 18],
      [4, 7, 18],
      [3, 5, 14],
    ],
  },
  create: (settings) => new Rider(settings),
}

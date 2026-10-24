import { Canvas, cap, ell, type Lighting, type Part } from "../src/canvas"
import { eggWait } from "../src/egg"
import { clamp, hash, hash2, lerp, rand, smoothstep, type RGB } from "../src/math"
import { driftClouds, makeStorm, paintSky, paintStorm, type Orb } from "../src/sky"
import type { Activity, Settings, Time, Wallpaper } from "../src/wallpaper"

// The scene runs slower than real time, which keeps it calm behind text.
const TIME_SCALE = 0.35
// Bikes ride at a quarter of scene speed.
const CREATURE_SPEED = 0.25
// The avenue runs straight away from the camera between walls of towers. The world is measured so that a unit at
// depth 1 is one screen height: a point (X, Y, Z) lands at x = A / 2 + X / Z and y = HORIZON + (CAM - Y) / Z.
const HORIZON = 0.6
const CAM = 0.1
// Half the road's width, where the lamps stand, and how far the avenue runs before the far skyline closes it off.
const ROAD = 0.22
const LAMPS = 0.26
const END = 9
const FAR = 16
const LAMP_STEP = 0.3
// A bike's length, and the height of its tail light, which leaves the light trails.
const BIKE = 0.065
const TAIL = 0.36 * BIKE
// Trails fade over this many creature seconds.
const FADE = 0.4
// Where the dome of light rises at the far end, and how long it lasts in scene seconds.
const DOME_Z = 13
const DOME = 40

// What changes with the time of day. Facades, glass and lit windows are colors of their own per look; bikes and
// riders have one daytime color each, which tint darkens into silhouettes.
interface Look {
  style: "rim" | "front"
  light: RGB
  sky: [number, RGB][]
  orb: Orb
  facades: RGB[]
  // How the street-facing sides of the left and right walls are lit, relative to the faces toward the camera.
  sides: [RGB, RGB]
  glass: RGB
  windows: RGB[]
  lit: number
  // Haze from low to high, how deep it takes to close in, and a glow it gathers around the far end of the avenue.
  haze: [RGB, RGB]
  fog: number
  glare: number
  edge: RGB
  // City light from the street below, on the lower floors.
  uplight: RGB
  shops: RGB[]
  road: RGB
  walk: RGB
  paint: RGB
  lamp: RGB
  // How bright tail lights, trails, searchlights and lamps are (trails show faintly by day).
  trail: number
  beam: RGB
  tint: RGB
  night: boolean
}

const LOOKS: Record<Time, Look> = {
  day: {
    style: "front",
    light: [1, 0.96, 0.88],
    sky: [
      [0, [0.26, 0.44, 0.66]],
      [0.32, [0.48, 0.6, 0.72]],
      [HORIZON, [0.78, 0.77, 0.68]],
    ],
    orb: { x: 0.56, y: 0.07, r: 0.028, core: [3, 2.9, 2.5], glow: [1, 0.95, 0.8], near: 0.3, wide: 0.2 },
    facades: [
      [0.3, 0.42, 0.56],
      [0.5, 0.47, 0.42],
      [0.24, 0.4, 0.46],
      [0.38, 0.46, 0.6],
      [0.55, 0.5, 0.42],
    ],
    sides: [
      [0.8, 0.82, 0.86],
      [0.5, 0.56, 0.7],
    ],
    glass: [0.1, 0.16, 0.27],
    windows: [[0.5, 0.62, 0.72]],
    lit: 0.03,
    haze: [
      [0.66, 0.68, 0.64],
      [0.46, 0.58, 0.74],
    ],
    fog: 5.5,
    glare: 0.1,
    edge: [0.3, 0.3, 0.26],
    uplight: [0, 0, 0],
    shops: [
      [0.5, 0.36, 0.26],
      [0.28, 0.4, 0.44],
    ],
    road: [0.2, 0.22, 0.27],
    walk: [0.38, 0.38, 0.38],
    paint: [0.8, 0.75, 0.5],
    lamp: [0, 0, 0],
    trail: 0.55,
    beam: [0, 0, 0],
    tint: [1, 1, 1],
    night: false,
  },
  sunset: {
    style: "rim",
    light: [1.2, 0.5, 0.16],
    sky: [
      [0, [0.1, 0.025, 0.11]],
      [0.22, [0.3, 0.06, 0.2]],
      [0.42, [0.75, 0.22, 0.24]],
      [HORIZON, [1.2, 0.55, 0.18]],
    ],
    orb: { x: 0.5, y: 0.45, r: 0.042, core: [2.2, 1, 0.3], glow: [1, 0.4, 0.14], near: 0.4, wide: 0.32 },
    facades: [
      [0.09, 0.04, 0.12],
      [0.07, 0.04, 0.1],
      [0.12, 0.05, 0.1],
      [0.06, 0.04, 0.12],
    ],
    sides: [
      [0.8, 0.8, 0.85],
      [0.8, 0.8, 0.85],
    ],
    glass: [0.05, 0.025, 0.06],
    windows: [
      [1, 0.58, 0.18],
      [1, 0.78, 0.32],
      [0.9, 0.32, 0.45],
    ],
    lit: 0.14,
    haze: [
      [1, 0.4, 0.14],
      [0.5, 0.1, 0.28],
    ],
    fog: 2.6,
    glare: 0.9,
    edge: [0.9, 0.38, 0.12],
    uplight: [0.08, 0.03, 0.03],
    shops: [
      [0.9, 0.45, 0.15],
      [0.8, 0.2, 0.4],
    ],
    road: [0.07, 0.035, 0.06],
    walk: [0.1, 0.05, 0.08],
    paint: [0.5, 0.3, 0.2],
    lamp: [1.1, 0.6, 0.2],
    trail: 0.9,
    beam: [0.12, 0.07, 0.05],
    tint: [0.2, 0.09, 0.12],
    night: false,
  },
  night: {
    style: "rim",
    light: [0.25, 0.9, 0.8],
    sky: [
      [0, [0.008, 0.016, 0.05]],
      [0.28, [0.02, 0.05, 0.11]],
      [0.48, [0.04, 0.13, 0.15]],
      [HORIZON, [0.08, 0.27, 0.21]],
    ],
    orb: { x: -2, y: -2, r: 0.01, core: [0, 0, 0], glow: [0, 0, 0], near: 0, wide: 0 },
    facades: [
      [0.035, 0.06, 0.14],
      [0.02, 0.07, 0.11],
      [0.05, 0.05, 0.14],
      [0.03, 0.08, 0.16],
    ],
    sides: [
      [0.7, 0.85, 0.85],
      [0.7, 0.85, 0.85],
    ],
    glass: [0.012, 0.025, 0.06],
    windows: [
      [0.2, 0.72, 0.95],
      [1, 0.74, 0.3],
      [0.25, 0.9, 0.7],
      [0.42, 0.55, 1],
    ],
    lit: 0.42,
    haze: [
      [0.07, 0.26, 0.19],
      [0.025, 0.07, 0.16],
    ],
    fog: 3.2,
    glare: 0.45,
    edge: [0.05, 0.22, 0.32],
    uplight: [0.02, 0.08, 0.06],
    shops: [
      [1, 0.25, 0.45],
      [0.2, 0.85, 0.85],
      [1, 0.55, 0.15],
    ],
    road: [0.015, 0.025, 0.05],
    walk: [0.03, 0.045, 0.08],
    paint: [0.16, 0.22, 0.2],
    lamp: [0.3, 1, 0.8],
    trail: 1.2,
    beam: [0.05, 0.13, 0.13],
    tint: [0.14, 0.16, 0.26],
    night: true,
  },
}

const DAYLIGHT = (() => {
  const l = Math.hypot(0.5, 0.6, 0.6)
  return [-0.5 / l, -0.6 / l, 0.6 / l] as const
})()

// The tail-light streaks: red at the edge, burning orange at the core.
const TRAIL_EDGE: RGB = [1.1, 0.1, 0.04]
const TRAIL_CORE: RGB = [0.8, 0.42, 0.06]
const TAILLIGHT: RGB = [1.5, 0.1, 0.05]
const AMBER: RGB = [1.5, 0.85, 0.15]
const GOLD: RGB = [1.4, 1, 0.4]
const BEACON: RGB = [1.4, 0.08, 0.06]
// Daytime colors of bikes and jackets; the first bike is the red one.
const BIKES: RGB[] = [
  [0.85, 0.07, 0.05],
  [0.12, 0.14, 0.22],
  [0.6, 0.58, 0.55],
  [0.18, 0.32, 0.6],
  [0.75, 0.42, 0.08],
  [0.08, 0.08, 0.09],
]
const JACKETS: RGB[] = [
  [0.62, 0.55, 0.42],
  [0.1, 0.1, 0.12],
  [0.35, 0.22, 0.12],
  [0.15, 0.2, 0.32],
  [0.55, 0.12, 0.1],
]
// Seconds between bikes entering, by activity.
const TRAFFIC: Record<Activity, [number, number]> = { calm: [40, 90], lively: [9, 20], teeming: [2, 5] }

// A block: a box standing beside the avenue on one side, its street-facing wall at |X| = xi, running back to xo, from
// depth z0 to z1 and height y0 to y1. Windows repeat every pu along the wall and pv up it.
interface Block {
  side: number
  xi: number
  xo: number
  z0: number
  z1: number
  y0: number
  y1: number
  color: number
  seed: number
  pu: number
  pv: number
  du: number
  dv: number
  shop: number
}

// A round tower of stacked tiers, each narrower than the one below, with a ring of lights at each step.
interface Tower {
  x: number
  z: number
  tiers: [r: number, y0: number, y1: number][]
  color: number
  seed: number
}

// A thin mast: lamp posts, antennas and spires.
interface Mast {
  x: number
  z: number
  r: number
  y0: number
  y1: number
}

interface Bike {
  x: number
  z: number
  lane: number
  weave: number
  phase: number
  speed: number
  yaw: number
  lean: number
  color: RGB
  jacket: RGB
  // The tail light's path: x, y, z and the creature time it passed, every few pixels.
  trail: number[]
  // The slide's clock in creature seconds, -1 before it starts, and which way it slides (0 for none).
  slide: number
  dir: number
}

interface Burst {
  x: number
  y: number
  t: number
}

interface City {
  blocks: Block[]
  towers: Tower[]
  masts: Mast[]
  beacons: Mast[]
}

class Megacity extends Canvas {
  private time = 0
  private creatureTime = 0
  private readonly activity: Activity
  private readonly look: Look
  private lighting: Lighting = { style: "front", dir: DAYLIGHT }
  private readonly city = buildCity()
  private storm = makeStorm()
  // Depth of what each pixel shows (Infinity for sky), and which lit window it shows, if any, as a hash from 0 to 1.
  private depth = new Float32Array(0)
  private win = new Float32Array(0)
  private fineDepth: Float32Array<ArrayBuffer> | undefined
  // Windows that switch on and off now and then: their pixels, lit color and box.
  private flickers: { pixels: Int32Array; color: RGB; box: [number, number, number, number]; phase: number }[] = []
  // Beacons that show against the sky, in pixels.
  private beacons: [number, number][] = []
  private searchlights: { x: number; y: number; z: number; phase: number }[] = []
  private heat = new Float32Array(0)
  private bikes: Bike[] = []
  private gap = 0
  private slideWait = rand(60, 120)
  private warm = false
  private bursts: Burst[] = []
  private craft = { x: -9, dir: 1, next: rand(10, 30), y: 1.6 }
  private dome = { wait: eggWait() * TIME_SCALE, t: -1 }

  constructor(settings: Settings) {
    super()
    this.activity = settings.activity
    this.look = LOOKS[settings.time]
    this.gap = rand(...TRAFFIC[this.activity]) * 0.3
  }

  step(dt: number) {
    dt = clamp(dt, 0, 0.1) * TIME_SCALE
    this.time += dt
    const cdt = dt * CREATURE_SPEED
    this.creatureTime += cdt
    this.stepGloom(dt)
    driftClouds(this.storm, this.A, dt)
    this.stepBikes(dt, cdt)
    this.bursts = this.bursts.filter((b) => this.time - b.t < 5)
    if (this.activity === "teeming") this.stepCraft(dt)
    this.stepDome(dt)
  }

  render() {
    const { W, H, look } = this
    this.restore()
    this.drawWindows()
    paintStorm(this.hdr, W, H, this.storm, [0.1, 0.12, 0.16], [0.03, 0.04, 0.06], this.gloom)
    if (this.gloom > 0) this.occlude(0, 0, W - 1, Math.ceil(0.4 * H), Infinity)
    if (this.dome.t >= 0) this.drawDome()
    if (this.craft.x > -5) this.drawCraft()
    if (this.activity !== "calm" && look.beam[0] + look.beam[1] > 0) for (const s of this.searchlights) this.drawSearchlight(s)
    this.drawBeacons()
    this.drawTrails()
    for (const b of [...this.bikes].sort((a, c) => c.z - a.z)) this.drawBike(b)
    this.finish()
  }

  // The gang roars through when the agent finishes a task.
  protected override visit() {
    const lanes = [-0.15, -0.06, 0.05, 0.14, -0.1]
    lanes.forEach((lane, i) => this.bikes.push(this.bike(lane, 0.12 - i * 0.06, i === 0 ? 0 : 1 + i)))
  }

  // A click on the road sends a bike up the avenue; on the towers, a burst of windows lights up around it.
  poke(x: number, y: number) {
    if (y > HORIZON + 0.03) {
      this.bikes.push(this.bike(clamp((x - this.A / 2) * (y - HORIZON) * 0.8, -0.17, 0.17), 0.12, Math.floor(Math.random() * BIKES.length)))
      return
    }
    this.bursts.push({ x: x * this.H, y: y * this.H, t: this.time })
  }

  protected override layout() {
    const { W, H, look } = this
    this.lighting = look.style === "front" ? { style: "front", dir: DAYLIGHT } : { style: "rim", color: look.light, x: (this.A / 2) * H, y: (HORIZON - 0.15) * H }
    paintSky(this.hdr, W, H, look.sky, look.orb, this.px)
    const real = this.px === 1
    const depth = new Float32Array(W * H)
    const win = new Float32Array(real ? W * H : 0)
    paintCity(this.hdr, W, H, this.px, this.city, look, depth, win)
    this.paintLamps()
    if (!real) {
      this.fineDepth = this.shrinkDepth(depth)
      return
    }
    // The real-size pass's depth is coarser at edges than the supersampled one's nearest-surface average, so use
    // the nearest of the four.
    this.depth = this.fineDepth ?? depth
    this.fineDepth = undefined
    this.win = win
    this.heat = new Float32Array(W * H)
    this.findFlickers()
    this.findBeacons()
    this.findSearchlights()
    if (this.warm) return
    this.warm = true
    for (let i = 0; i < 300; i++) {
      this.creatureTime += 0.2 * CREATURE_SPEED
      this.stepBikes(0.2, 0.2 * CREATURE_SPEED)
    }
  }

  private shrinkDepth(depth: Float32Array) {
    const S = this.px
    const W = this.W / S
    const H = this.H / S
    const out = new Float32Array(W * H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let z = Infinity
        for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) z = Math.min(z, depth[(y * S + j) * this.W + x * S + i])
        out[y * W + x] = z
      }
    return out
  }

  private paint(c: RGB): RGB {
    const t = this.look.tint
    return [c[0] * t[0], c[1] * t[1], c[2] * t[2]]
  }

  // A point in the world, in pixels.
  private project(X: number, Y: number, Z: number): [number, number] {
    return [(this.A / 2 + X / Z) * this.H, (HORIZON + (CAM - Y) / Z) * this.H]
  }

  // Lamps along both curbs: a post with its head glowing over the road, and a pool of light beneath.
  private paintLamps() {
    const { H, look } = this
    const k = look.lamp[0] + look.lamp[1] + look.lamp[2]
    if (k <= 0) return
    for (let z = LAMP_STEP; z < END; z += LAMP_STEP)
      for (const side of [-1, 1]) {
        const [x, y] = this.project(side * (LAMPS - 0.02), 0.11, z)
        const r = (0.006 / z) * H
        glow(this.hdr, this.W, this.H, x, y, Math.max(r * 6, 2 * this.px), Math.max(r * 4, 1.5 * this.px), look.lamp, 0.35)
        glow(this.hdr, this.W, this.H, x, y, Math.max(r * 1.5, 0.8 * this.px), Math.max(r, 0.6 * this.px), look.lamp, 1.6)
      }
  }

  // A few unlit windows in the outer thirds of the screen switch on and off now and then.
  private findFlickers() {
    const { W, H, look } = this
    this.flickers = []
    if (look.lit < 0.1) return
    for (let tries = 0; tries < 400 && this.flickers.length < 10; tries++) {
      const left = hash(tries * 3.7) < 0.5
      const x = Math.floor((left ? hash(tries * 1.3) * 0.3 : 1 - hash(tries * 1.3) * 0.3) * W)
      const y = Math.floor((0.05 + hash(tries * 2.9) * 0.5) * H)
      const h = this.win[y * W + x]
      if (h <= 0 || h < look.lit || this.flickers.some((f) => Math.abs(f.box[0] - x) < 6 && Math.abs(f.box[1] - y) < 6)) continue
      const pixels: number[] = []
      const box: [number, number, number, number] = [W, H, -1, -1]
      for (let j = Math.max(0, y - 10); j < Math.min(H, y + 10); j++)
        for (let i = Math.max(0, x - 10); i < Math.min(W, x + 10); i++) {
          if (this.win[j * W + i] !== h) continue
          pixels.push(j * W + i)
          box[0] = Math.min(box[0], i)
          box[1] = Math.min(box[1], j)
          box[2] = Math.max(box[2], i)
          box[3] = Math.max(box[3], j)
        }
      if (pixels.length < 2 || pixels.length > 40) continue
      const c = look.windows[Math.floor(hash(h * 51.3) * look.windows.length)]
      const k = 0.55 + 0.3 * hash(h * 7.1)
      this.flickers.push({ pixels: Int32Array.from(pixels), color: [c[0] * k, c[1] * k, c[2] * k], box, phase: hash(tries * 9.1) * 100 })
    }
  }

  // Red lights on the antennas and spires whose tips show against the sky.
  private findBeacons() {
    const { W, H } = this
    this.beacons = []
    for (const m of this.city.beacons) {
      const [x, y] = this.project(m.x, m.y1, m.z)
      const i = Math.floor(y) * W + Math.floor(x)
      if (x < 0 || y < 0 || x >= W || y >= H || this.depth[Math.max(0, i - W)] < m.z - 0.01) continue
      this.beacons.push([x, y])
    }
  }

  // Searchlights on two rooftops, one each side of the avenue, where the roof meets the sky.
  private findSearchlights() {
    const { W, H, A } = this
    this.searchlights = []
    for (const [side, f] of [
      [-1, 0.28],
      [1, 0.24],
    ] as const) {
      const x = Math.floor((A / 2 + side * f * Math.min(A / 2, 1.1)) * H)
      if (x < 0 || x >= W) continue
      let y = 0
      while (y < H * HORIZON && this.depth[y * W + x] === Infinity) y++
      if (y >= H * HORIZON || y < 2) continue
      this.searchlights.push({ x, y, z: this.depth[y * W + x], phase: side > 0 ? 2 : 0 })
    }
  }

  // Restores the background where something nearer than z stands in front of what was drawn in the box.
  private occlude(x0: number, y0: number, x1: number, y1: number, z: number) {
    const { W, H, hdr, background, depth } = this
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, Math.ceil(y1)); y++)
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, Math.ceil(x1)); x++) {
        const i = y * W + x
        if (depth[i] >= z) continue
        hdr[i * 3] = background[i * 3]
        hdr[i * 3 + 1] = background[i * 3 + 1]
        hdr[i * 3 + 2] = background[i * 3 + 2]
      }
  }

  // Flickering windows, and the bursts of windows a click lights up, spreading out from it and going out again.
  private drawWindows() {
    const { W, H, hdr, look } = this
    for (const f of this.flickers) {
      if (hash(Math.floor(this.time / 14 + f.phase)) < 0.5) continue
      for (const i of f.pixels) {
        hdr[i * 3] = f.color[0]
        hdr[i * 3 + 1] = f.color[1]
        hdr[i * 3 + 2] = f.color[2]
      }
      this.touch(...f.box)
    }
    const colors: RGB[] = [GOLD, [1.3, 0.62, 0.2], [0.35, 1.1, 1.3]]
    for (const b of this.bursts) {
      const age = this.time - b.t
      const R = 0.16 * H
      const reach = smoothstep(0, 1.2, age) * R
      const fade = 1 - smoothstep(2.5, 5, age)
      const x0 = Math.max(0, Math.floor(b.x - R))
      const x1 = Math.min(W - 1, Math.ceil(b.x + R))
      const y0 = Math.max(0, Math.floor(b.y - R))
      const y1 = Math.min(H - 1, Math.ceil(b.y + R))
      this.touch(x0, y0, x1, y1)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = y * W + x
          const h = this.win[i]
          if (h <= 0) continue
          const d = Math.hypot(x - b.x, y - b.y)
          // Each window comes on as the ring reaches it, a little later the further out it is.
          if (d > reach * (0.7 + 0.3 * hash(h * 17.3)) || hash(h * 3.3) > 0.9) continue
          const c = colors[hash(h * 51.3) < 0.75 ? 0 : hash(h * 51.3) < 0.9 ? 1 : 2]
          const k = fade * Math.min(1, 1.6 * (1 - (d / R) ** 2))
          hdr[i * 3] += (c[0] - hdr[i * 3]) * k
          hdr[i * 3 + 1] += (c[1] - hdr[i * 3 + 1]) * k
          hdr[i * 3 + 2] += (c[2] - hdr[i * 3 + 2]) * k
        }
    }
  }

  private drawBeacons() {
    const { H, look } = this
    for (const [i, [x, y]] of this.beacons.entries()) {
      const k = Math.max(0, Math.sin(this.time * 1.6 + i * 2.3)) ** 6 * (look.night ? 1 : 0.7)
      if (k < 0.03) continue
      glow(this.hdr, this.W, H, x, y, Math.max(1.2, 0.005 * H), Math.max(1.2, 0.005 * H), BEACON, 1.4 * k)
      glow(this.hdr, this.W, H, x, y, 0.016 * H, 0.016 * H, BEACON, 0.25 * k)
      this.touch(x - 0.016 * H - 1, y - 0.016 * H - 1, x + 0.016 * H + 1, y + 0.016 * H + 1)
    }
  }

  // A searchlight beam swinging slowly across the sky above its rooftop, behind anything nearer.
  private drawSearchlight(s: { x: number; y: number; z: number; phase: number }) {
    const { W, H, hdr, depth, look } = this
    const angle = -Math.PI / 2 + Math.sin(this.time * 0.07 + s.phase) * 0.55 + (s.x < W / 2 ? 0.2 : -0.2)
    const ax = Math.cos(angle)
    const ay = Math.sin(angle)
    const length = 0.9 * H
    const x1 = s.x + ax * length
    const y1 = s.y + ay * length
    const spread = 0.12
    const bx0 = Math.max(0, Math.floor(Math.min(s.x, x1) - length * spread - 2))
    const bx1 = Math.min(W - 1, Math.ceil(Math.max(s.x, x1) + length * spread + 2))
    const by0 = Math.max(0, Math.floor(Math.min(s.y, y1)))
    const by1 = Math.min(H - 1, Math.ceil(s.y))
    for (let y = by0; y <= by1; y++) {
      let lo = W
      let hi = -1
      for (let x = bx0; x <= bx1; x++) {
        const i = y * W + x
        if (depth[i] <= s.z) continue
        const dx = x + 0.5 - s.x
        const dy = y + 0.5 - s.y
        const along = dx * ax + dy * ay
        if (along <= 0) continue
        const across = Math.abs(dx * ay - dy * ax) / (along * spread + 1.5)
        if (across >= 1) continue
        const k = (1 - across * across) ** 2 * (1 - along / length) * (1 - this.gloom * 0.7)
        hdr[i * 3] += look.beam[0] * k
        hdr[i * 3 + 1] += look.beam[1] * k
        hdr[i * 3 + 2] += look.beam[2] * k
        lo = Math.min(lo, x)
        hi = Math.max(hi, x)
      }
      if (hi >= lo) this.touch(lo, y, hi, y)
    }
  }

  private stepBikes(dt: number, cdt: number) {
    this.gap -= dt
    if (this.gap <= 0) {
      this.gap = rand(...TRAFFIC[this.activity])
      const group = this.activity === "teeming" && Math.random() < 0.4 ? 2 + Math.floor(Math.random() * 3) : 1
      for (let i = 0; i < group; i++) {
        const lane = (Math.random() < 0.5 ? -1 : 1) * rand(0.05, 0.17)
        // Calm sends one bike now and then, already far up the avenue.
        const b = this.bike(lane, this.activity === "calm" ? 1.1 : 0.12 - i * 0.05, Math.floor(Math.random() * BIKES.length))
        this.bikes.push(b)
      }
    }
    if (this.activity === "teeming") {
      this.slideWait -= dt
      const rider = this.bikes.find((b) => b.slide < 0 && b.dir === 0 && b.z < 0.25 && Math.abs(b.lane) > 0.1)
      if (this.slideWait <= 0 && rider) {
        this.slideWait = rand(70, 140)
        rider.dir = -Math.sign(rider.lane)
        rider.color = BIKES[0]
        rider.jacket = JACKETS[0]
      }
    }
    for (const b of this.bikes) {
      if (b.dir !== 0 && b.z >= 0.36 && b.slide < 0) b.slide = 0
      if (b.slide >= 0) this.stepSlide(b, cdt)
      if (b.slide < 0) {
        b.z += b.speed * (0.2 + b.z) * cdt
        b.x = b.lane + b.weave * Math.sin(b.z * 5 + b.phase)
        b.yaw = Math.atan(b.weave * 5 * Math.cos(b.z * 5 + b.phase))
        b.lean = -b.yaw * 0.6
      }
      this.recordTrail(b)
    }
    this.bikes = this.bikes.filter((b) => b.z < 6.5 || (b.trail.length > 0 && this.creatureTime - b.trail[b.trail.length - 1] < FADE * 4))
  }

  private bike(lane: number, z: number, i: number): Bike {
    return { x: lane, z, lane, weave: this.activity === "calm" ? 0 : rand(0.01, this.activity === "teeming" ? 0.05 : 0.03), phase: rand(0, 6), speed: rand(0.5, 0.7), yaw: 0, lean: 0, color: BIKES[i % BIKES.length], jacket: JACKETS[i % JACKETS.length], trail: [], slide: -1, dir: 0 }
  }

  // The slide: the bike swings sideways across the road, leaning hard, skids nearly to a stop, then straightens and
  // rides off up the avenue.
  private stepSlide(b: Bike, cdt: number) {
    b.slide += cdt
    const s = b.slide
    const turn = smoothstep(0, 0.35, s) * (1 - smoothstep(1.35, 1.9, s))
    const heading = b.dir * 1.35 * turn
    const speed = b.speed * lerp(1, 0.08, smoothstep(0.2, 1.1, s)) * (s > 1.35 ? smoothstep(1.35, 2.2, s) * 0.92 + 0.08 : 1)
    b.x = clamp(b.x + Math.sin(heading) * speed * cdt, -0.19, 0.19)
    b.z += Math.cos(heading) * speed * cdt
    b.yaw = heading * 1.08
    b.lean = -b.dir * 0.55 * turn
    if (s < 2.3) return
    b.slide = -1
    b.dir = 0
    b.weave = 0
    b.lane = b.x
  }

  private recordTrail(b: Bike) {
    const H = Math.max(36, this.H)
    const tx = b.x - Math.sin(b.yaw) * 0.5 * BIKE
    const tz = b.z - Math.cos(b.yaw) * 0.5 * BIKE
    if (tz < 0.08) return
    const t = b.trail
    const n = t.length
    const sx = tx / tz
    const sy = -TAIL / tz
    if (n && Math.hypot(sx - t[n - 4] / t[n - 2], sy + TAIL / t[n - 2]) * H < 3) return
    t.push(tx, TAIL, tz, this.creatureTime)
    // Old points have faded out.
    let drop = 0
    while (drop < t.length && this.creatureTime - t[drop + 3] > FADE * 4) drop += 4
    if (drop) t.splice(0, drop)
  }

  // Tail-light trails: each segment of each path burns into a heat buffer, keeping the hottest where they overlap, then
  // the heat is colored and added to the scene.
  private drawTrails() {
    const { W, H, hdr, heat, look } = this
    const fade = FADE * (look.night ? 1 : 0.6)
    for (const b of this.bikes) {
      const t = b.trail
      if (t.length < 8) continue
      const head = [b.x - Math.sin(b.yaw) * 0.5 * BIKE, TAIL, b.z - Math.cos(b.yaw) * 0.5 * BIKE, this.creatureTime]
      const pts = [...t, ...head]
      const box = [W, H, -1, -1]
      for (let i = pts.length - 8; i >= 0; i -= 4) {
        const za = pts[i + 2]
        const zb = pts[i + 6]
        if (za < 0.08 || zb < 0.08) continue
        const ia = Math.exp(-(this.creatureTime - pts[i + 3]) / fade) * look.trail
        const ib = Math.exp(-(this.creatureTime - pts[i + 7]) / fade) * look.trail
        if (ia < 0.02 && ib < 0.02) break
        const [ax, ay] = this.project(pts[i], pts[i + 1], za)
        const [bx, by] = this.project(pts[i + 4], pts[i + 5], zb)
        const ra = this.thick(0.009 / za, 1.2)
        const rb = this.thick(0.009 / zb, 1.2)
        const r = Math.max(ra, rb) + 1
        const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r))
        const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r))
        const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + r))
        const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + r))
        if (x1 < x0 || y1 < y0) continue
        burn(heat, W, ax, ay, bx, by, ra, rb, ia, ib, x0, y0, x1, y1)
        this.touch(x0, y0, x1, y1)
        box[0] = Math.min(box[0], x0)
        box[1] = Math.min(box[1], y0)
        box[2] = Math.max(box[2], x1)
        box[3] = Math.max(box[3], y1)
      }
      if (box[2] >= box[0]) glowHeat(hdr, heat, W, box[0], box[1], box[2], box[3])
    }
  }

  // A motorbike and its rider from behind, turning side-on as it slides: parts placed in the bike's own frame
  // (forward, across, up), banked by its lean, turned by its yaw and seen in perspective.
  private drawBike(b: Bike) {
    const { H, look } = this
    if (b.z < 0.08 || b.z > 7) return
    const cy = Math.cos(b.yaw)
    const sy = Math.sin(b.yaw)
    const cl = Math.cos(b.lean)
    const sl = Math.sin(b.lean)
    const P = (f: number, l: number, u: number): [number, number] => {
      const across = l * cl - u * sl
      const up = l * sl + u * cl
      return this.project(b.x + (f * sy + across * cy) * BIKE, up * BIKE, b.z + (f * cy - across * sy) * BIKE)
    }
    const S = (BIKE / b.z) * H
    const r = (k: number) => Math.max(k * S, this.cells ? 0.6 : 0.3)
    const body = this.paint(b.color)
    const jacket = this.paint(b.jacket)
    const tire = this.paint([0.05, 0.05, 0.06])
    const side = Math.abs(sy)
    const wheel = (f: number): Part => {
      const [x, y] = P(f, 0, 0.15)
      return ell(x, y, Math.max(r(0.055), r(0.15) * side), r(0.15), 0, tire)
    }
    // A long, low shell with a rounded nose cowl and a tail hump.
    const shell: Part[] = [cap(...P(-0.46, 0, 0.29), ...P(0.22, 0, 0.28), r(0.11), r(0.11), body), ell(...P(0.32, 0, 0.35), r(0.19) * Math.max(side, 0.6), r(0.12), 0, body), cap(...P(-0.5, 0, 0.35), ...P(-0.3, 0, 0.39), r(0.07), r(0.08), body)]
    const knee = 0.12
    const rider: Part[] = [
      cap(...P(-0.16, 0, 0.45), ...P(0.16, 0, 0.6), r(0.085), r(0.095), jacket),
      cap(...P(-0.14, -knee, 0.46), ...P(0.06, -knee, 0.36), r(0.06), r(0.05), jacket),
      cap(...P(-0.14, knee, 0.46), ...P(0.06, knee, 0.36), r(0.06), r(0.05), jacket),
      cap(...P(0.16, -0.1, 0.58), ...P(0.36, -0.13, 0.46), r(0.038), r(0.032), jacket),
      cap(...P(0.16, 0.1, 0.58), ...P(0.36, 0.13, 0.46), r(0.038), r(0.032), jacket),
      ell(...P(0.28, 0, 0.7), r(0.075), r(0.072), 0, this.paint([0.1, 0.1, 0.12])),
    ]
    if (side > 0.5) {
      this.shape([wheel(-0.36), wheel(0.36)], this.lighting, 0.6)
      this.shape(shell, this.lighting, 0.8)
      this.shape(rider, this.lighting, 0.7)
    }
    if (side <= 0.5) {
      this.shape([wheel(0.36)], this.lighting, 0.6)
      this.shape(shell, this.lighting, 0.8)
      this.shape(rider, this.lighting, 0.7)
      this.shape([wheel(-0.36)], this.lighting, 0.6)
    }
    const k = Math.max(0.35, look.trail)
    const [tx, ty] = P(-0.56, 0, 0.36)
    glow(this.hdr, this.W, H, tx, ty, Math.max(r(0.09), 1.2), Math.max(r(0.04), 1), TAILLIGHT, 1.6 * k)
    glow(this.hdr, this.W, H, tx, ty, r(0.35), r(0.2), TAILLIGHT, 0.25 * k)
    // Two round amber lamps either side of the tail light.
    for (const l of [-0.1, 0.1]) {
      const [lx, ly] = P(-0.52, l, 0.26)
      this.disc(lx, ly, Math.max(r(0.035), 0.7), AMBER[0] * k, AMBER[1] * k, AMBER[2] * k, 1)
    }
    this.touch(tx - r(0.4) - 2, ty - r(0.3) - 2, tx + r(0.4) + 2, ty + r(0.3) + 2)
  }

  // Now and then an airship crosses high over the city, its windows lit and its lights blinking, behind the towers.
  private stepCraft(dt: number) {
    const c = this.craft
    if (c.x < -5) {
      c.next -= dt
      if (c.next > 0) return
      c.dir = Math.random() < 0.5 ? 1 : -1
      c.x = -c.dir * 1.6
      c.y = rand(1.45, 1.65)
      return
    }
    c.x += c.dir * 0.03 * dt
    if (Math.abs(c.x) < 1.7) return
    c.x = -9
    c.next = rand(50, 110)
  }

  private drawCraft() {
    const { H, look } = this
    const c = this.craft
    const Z = 3.2
    const [x, y] = this.project(c.x, c.y + Math.sin(this.time * 0.4) * 0.01, Z)
    const s = (0.2 / Z) * H
    if (x < -s * 1.2 || x > this.W + s * 1.2) return
    const hull = this.paint([0.55, 0.56, 0.6])
    const d = c.dir
    this.polygon([[x - d * s * 0.85, y], [x - d * s * 1.1, y - s * 0.28], [x - d * s * 1.02, y]], this.paint([0.3, 0.15, 0.15]))
    this.shape([ell(x, y, s, s * 0.22, 0, hull), ell(x + d * s * 0.15, y + s * 0.24, s * 0.22, s * 0.07, 0, this.paint([0.25, 0.25, 0.3]))], this.lighting, 0.7)
    const lit = look.night || look.lit > 0.1
    const band: RGB = lit ? [look.windows[0][0] * 0.8, look.windows[0][1] * 0.8, look.windows[0][2] * 0.8] : this.paint([0.2, 0.25, 0.35])
    this.ellipse(x + d * s * 0.1, y + s * 0.02, s * 0.55, Math.max(0.6, s * 0.035), band[0], band[1], band[2], 1)
    const blink = Math.max(0, Math.sin(this.time * 2.4)) ** 6
    if (blink > 0.03) {
      glow(this.hdr, this.W, H, x - d * s * 1.05, y - s * 0.26, 3, 3, BEACON, 1.5 * blink)
      glow(this.hdr, this.W, H, x + d * s, y, 3, 3, [0.2, 1.2, 0.4], 1.2 * blink)
    }
    this.touch(x - s * 1.2 - 4, y - s * 0.4 - 4, x + s * 1.2 + 4, y + s * 0.4 + 4)
    this.occlude(x - s * 1.2 - 4, y - s * 0.4 - 4, x + s * 1.2 + 4, y + s * 0.4 + 4, Z)
  }

  private stepDome(dt: number) {
    const d = this.dome
    if (d.t < 0) {
      d.wait -= dt
      if (d.wait > 0) return
      d.t = 0
      return
    }
    d.t += dt
    if (d.t < DOME) return
    d.t = -1
    d.wait = eggWait(true) * TIME_SCALE
  }

  // The easter egg: a dome of light swells up silently at the far end of the avenue, hangs there, and fades.
  private drawDome() {
    const { W, H, hdr, depth, look } = this
    const p = this.dome.t / DOME
    const R = (3.2 * smoothstep(0, 0.25, p) ** 0.6) / DOME_Z
    const fade = smoothstep(0, 0.05, p) * (1 - smoothstep(0.55, 1, p))
    if (R <= 0 || fade <= 0) return
    const [cx, cy] = this.project(0, 0, DOME_Z)
    const r = R * H
    const color: RGB = look.night ? [0.35, 0.8, 1.3] : [1.1, 0.95, 0.85]
    const x0 = Math.max(0, Math.floor(cx - r * 2))
    const x1 = Math.min(W - 1, Math.ceil(cx + r * 2))
    const y0 = Math.max(0, Math.floor(cy - r * 2))
    const y1 = Math.min(H - 1, Math.ceil(cy))
    this.touch(x0, y0, x1, y1)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x
        if (depth[i] < DOME_Z) continue
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r
        // A bright, hard-edged dome inside a softer halo.
        const k = (d < 1 ? 0.45 + 0.4 * d ** 4 : 0.5 * (1 - smoothstep(1, 2, d)) ** 3) * fade
        hdr[i * 3] += color[0] * k
        hdr[i * 3 + 1] += color[1] * k
        hdr[i * 3 + 2] += color[2] * k
      }
  }
}

// The city's layout in world units, the same at every size: a wall of blocks along each side of the avenue, a taller
// row behind it and a third behind that, a stepped round tower on the left and a spired one on the right, lamp posts
// along the curbs, and antennas on some roofs.
function buildCity(): City {
  const blocks: Block[] = []
  const masts: Mast[] = []
  const beacons: Mast[] = []
  const rows = [
    { xi: [0.31, 0.4], deep: [0.25, 0.7], gap: [0.03, 0.12], h: [0.4, 1.2], z: 0.12, back: 0.3 },
    { xi: [0.7, 0.85], deep: [0.3, 0.8], gap: [0.04, 0.14], h: [0.9, 2.1], z: 0.3, back: 0.6 },
    { xi: [1.4, 1.7], deep: [0.5, 1.1], gap: [0.02, 0.08], h: [1.8, 3.4], z: 0.2, back: 40 },
  ]
  let seed = 1
  for (const side of [-1, 1])
    rows.forEach((row, k) => {
      for (let z = row.z; z < END; seed++) {
        const r = (n: number) => hash(seed * 7.13 + n * 1.97 + side * 0.31)
        const deep = lerp(row.deep[0], row.deep[1], r(1))
        // Low blocks in front of the stepped tower and the spire, so they show above them.
        const low = k === 0 && ((side < 0 && z > 0.55 && z < 1.1) || (side > 0 && z > 0.9 && z < 1.7))
        const plaza = (k === 0 && ((side < 0 && z > 1.1 && z < 1.48) || (side > 0 && z > 1.7 && z < 2.05))) || (k === 1 && ((side < 0 && z > 0.9 && z < 1.6) || (side > 0 && z > 1.3 && z < 2.1)))
        const h = low ? 0.28 + r(2) * 0.12 : lerp(row.h[0], row.h[1], r(2) ** 1.4)
        const xi = lerp(row.xi[0], row.xi[1], r(3))
        const block = { side, xi, xo: xi + row.back, z0: z, z1: z + deep, y0: 0, y1: h, color: Math.floor(r(4) * 97), seed, pu: lerp(0.014, 0.026, r(5)), pv: lerp(0.016, 0.028, r(6)), du: [0.55, 1, 0.4, 0.6][Math.floor(r(7) * 4)], dv: [0.55, 0.5, 1, 0.6][Math.floor(r(7) * 4)], shop: k === 0 ? Math.floor(r(8) * 7) : -1 }
        if (!plaza) blocks.push(block)
        // Setback crowns and antennas.
        if (!plaza && !low && r(9) < 0.45) {
          const inset = Math.min(0.06, deep * 0.15)
          const top = h + lerp(0.06, 0.25, r(10))
          blocks.push({ ...block, xi: xi + inset, xo: block.xo - inset, z0: z + inset, z1: z + deep - inset, y0: h, y1: top, seed: seed + 0.5 })
          if (r(11) < 0.6) {
            const mast = { x: side * (xi + inset + 0.03), z: z + deep * 0.5, r: 0.004, y0: top, y1: top + lerp(0.1, 0.35, r(12)) }
            masts.push(mast)
            if (r(13) < 0.7) beacons.push(mast)
          }
        }
        z += deep + lerp(row.gap[0], row.gap[1], r(14)) * (k === 0 && r(15) < 0.2 ? 2.5 : 1)
      }
    })
  for (let z = LAMP_STEP; z < END; z += LAMP_STEP) for (const side of [-1, 1]) masts.push({ x: side * LAMPS, z, r: 0.0025, y0: 0, y1: 0.11 })
  const towers: Tower[] = [
    {
      x: -0.52,
      z: 1.3,
      tiers: [
        [0.15, 0, 0.5],
        [0.13, 0.5, 0.64],
        [0.105, 0.64, 0.75],
        [0.08, 0.75, 0.83],
        [0.05, 0.83, 0.88],
      ],
      color: 2,
      seed: 900,
    },
    {
      x: 0.48,
      z: 1.9,
      tiers: [
        [0.11, 0, 1.05],
        [0.08, 1.05, 1.16],
        [0.045, 1.16, 1.24],
      ],
      color: 0,
      seed: 901,
    },
  ]
  const spire = { x: 0.48, z: 1.9, r: 0.008, y0: 1.24, y1: 1.65 }
  const crown = { x: -0.52, z: 1.3, r: 0.006, y0: 0.88, y1: 1.02 }
  masts.push(spire, crown, { x: -0.55, z: 1.27, r: 0.004, y0: 0.83, y1: 0.94 }, { x: -0.49, z: 1.27, r: 0.004, y0: 0.83, y1: 0.94 })
  beacons.push(spire, crown)
  return { blocks, towers, masts, beacons }
}

// Every surface's candidates along one column of pixels, nearest first: depth, the heights they cover, and which
// surface it is (block front 0, block side 1, tower 2, mast 3, far skyline 4 and 5).
const MAX_HITS = 256
const hitZ = new Float64Array(MAX_HITS)
const hitY0 = new Float64Array(MAX_HITS)
const hitY1 = new Float64Array(MAX_HITS)
const hitKind = new Int32Array(MAX_HITS)
const hitRef = new Int32Array(MAX_HITS)
const hitU = new Float64Array(MAX_HITS)
const hitDu = new Float64Array(MAX_HITS)
const hitCover = new Float64Array(MAX_HITS)
const hitN = new Float64Array(MAX_HITS)
const order = new Int32Array(MAX_HITS)
const shade = new Float64Array(3)

// Casts a ray through every pixel into the city: down each column, the surfaces it can meet are worked out once, and
// each pixel blends them front to back, so roof lines and masts come out anti-aliased. The ground and the sky (already
// painted in hdr) fill what is left. Writes each pixel's depth, and at the real size which lit window it shows.
function paintCity(hdr: Float32Array, W: number, H: number, px: number, city: City, look: Look, depth: Float32Array, win: Float32Array) {
  const cx = W / H / 2
  for (let x = 0; x < W; x++) {
    const dx = (x + 0.5) / H - cx
    const n = columnHits(city, dx, H, px)
    for (let y = 0; y < H; y++) {
      const sy = (y + 0.5) / H
      const up = HORIZON - sy
      const ground = up < 0 ? CAM / -up : Infinity
      let r = 0
      let g = 0
      let b = 0
      let rest = 1
      let z = Infinity
      let window = 0
      for (let k = 0; k < n && rest > 0.004; k++) {
        const j = order[k]
        const Z = hitZ[j]
        if (Z > ground) break
        const Y = CAM + up * Z
        const dv = Z / H
        const cover = clamp((hitY1[j] - Y) / dv + 0.5, 0, 1) * clamp((Y - hitY0[j]) / dv + 0.5, 0, 1) * hitCover[j]
        if (cover <= 0) continue
        const w = surface(city, look, j, Y, Z, dv, dx, sy)
        r += rest * cover * shade[0]
        g += rest * cover * shade[1]
        b += rest * cover * shade[2]
        if (rest > 0.5 && rest * (1 - cover) <= 0.5) {
          z = Z
          window = cover > 0.9 ? w : 0
        }
        rest *= 1 - cover
      }
      const o = (y * W + x) * 3
      if (rest > 0.004 && up < 0) {
        road(look, dx * ground, ground, H, sy, dx)
        hdr[o] = shade[0]
        hdr[o + 1] = shade[1]
        hdr[o + 2] = shade[2]
        if (rest > 0.5) z = ground
      }
      hdr[o] = r + rest * hdr[o]
      hdr[o + 1] = g + rest * hdr[o + 1]
      hdr[o + 2] = b + rest * hdr[o + 2]
      depth[y * W + x] = z
      if (win.length) win[y * W + x] = window
    }
  }
}

function columnHits(city: City, dx: number, H: number, px: number) {
  let n = 0
  const add = (Z: number, y0: number, y1: number, kind: number, ref: number, u: number, du: number, cover: number, nrm: number) => {
    if (n >= MAX_HITS || Z <= 0.02) return
    hitZ[n] = Z
    hitY0[n] = y0
    hitY1[n] = y1
    hitKind[n] = kind
    hitRef[n] = ref
    hitU[n] = u
    hitDu[n] = du
    hitCover[n] = cover
    hitN[n] = nrm
    n++
  }
  const side = Math.sign(dx)
  const ax = Math.abs(dx)
  const blocks = city.blocks
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.side !== side) continue
    const X = ax * b.z0
    if (X >= b.xi && X <= b.xo) add(b.z0, b.y0, b.y1, 0, i, X - b.xi, b.z0 / H, 1, 0)
    if (X >= b.xi) continue
    const Z = b.xi / ax
    if (Z <= b.z1) add(Z, b.y0, b.y1, 1, i, Z - b.z0, (Z * Z) / (b.xi * H), 1, 0)
  }
  // Round towers: where the ray meets each tier's cylinder, from the quadratic in Z.
  const towers = city.towers
  for (let i = 0; i < towers.length; i++) {
    const t = towers[i]
    for (const [r, y0, y1] of t.tiers) {
      const a = dx * dx + 1
      const bq = -2 * (dx * t.x + t.z)
      const c = t.x * t.x + t.z * t.z - r * r
      const disc = bq * bq - 4 * a * c
      // How far the ray passes from the tier's axis, for anti-aliasing its sides.
      const pass = (t.x - dx * t.z) / Math.sqrt(a)
      const edge = clamp((r - Math.abs(pass)) / (t.z / H) + 0.5, 0, 1)
      if (edge <= 0) continue
      const Z = disc > 0 ? (-bq - Math.sqrt(disc)) / (2 * a) : (dx * t.x + t.z) / a
      const across = clamp(-pass / r, -1, 1)
      add(Z, y0, y1, 2, i, across, Z / H, edge, Math.asin(across) * r)
    }
  }
  const masts = city.masts
  for (let i = 0; i < masts.length; i++) {
    const m = masts[i]
    const d = Math.abs(dx * m.z - m.x) / m.z
    const radius = Math.max(m.r / m.z, (0.6 * px) / H)
    const cover = clamp((radius - d) * H + 0.5, 0, 1) * Math.min(1, (m.r / m.z) / radius + 0.3)
    if (cover > 0) add(m.z, m.y0, m.y1, 3, i, 0, 0, cover, 0)
  }
  add(END, 0, farHeight(dx * END, 0.16, 0.3, 0.75, 3), 4, 0, dx * END, END / H, 1, 0)
  add(FAR, 0, farHeight(dx * FAR, 0.3, 0.8, 1.6, 11), 5, 0, dx * FAR, FAR / H, 1, 0)
  for (let k = 0; k < n; k++) {
    let m = k
    order[k] = k
    while (m > 0 && hitZ[order[m - 1]] > hitZ[k]) {
      order[m] = order[m - 1]
      m--
    }
    order[m] = k
  }
  return n
}

function farHeight(X: number, width: number, low: number, span: number, seed: number) {
  const i = Math.floor(X / width)
  return low + hash(i * 1.37 + seed) ** 1.5 * span
}

// The color of surface j at height Y and depth Z, into shade; returns the lit window's hash there, or 0.
function surface(city: City, look: Look, j: number, Y: number, Z: number, dv: number, dx: number, sy: number) {
  const kind = hitKind[j]
  if (kind === 3) {
    const c = look.facades[0]
    shade[0] = c[0] * 0.5
    shade[1] = c[1] * 0.5
    shade[2] = c[2] * 0.6
    return fog(look, Y, Z, dx, sy, 0)
  }
  if (kind >= 4) {
    const k = kind === 4 ? 0 : 1
    const c = look.facades[k]
    const u = hitU[j]
    const w = windows(look, u, Y - 0.03, hitDu[j], dv, 0.03, 0.025, 0.5, 0.5, 300 + k * 50 + Math.floor(u / 0.16) * 3, 1, 0.75)
    shade[0] = lerp(c[0], shade[0], w)
    shade[1] = lerp(c[1], shade[1], w)
    shade[2] = lerp(c[2], shade[2], w)
    return fog(look, Y, Z, dx, sy, 0)
  }
  if (kind === 2) {
    const t = city.towers[hitRef[j]]
    const across = hitU[j]
    const facing = Math.sqrt(Math.max(0, 1 - across * across))
    const c = look.facades[t.color % look.facades.length]
    const du = hitDu[j] / Math.max(0.25, facing)
    const tier = t.tiers.find(([, y0, y1]) => Y >= y0 - dv && Y <= y1 + dv) ?? t.tiers[0]
    const w = windows(look, hitN[j] + 1, Y - tier[1] - 0.012, du, dv, 0.016, 0.02, 0.5, 0.6, t.seed + tier[1] * 100, tier[2] - tier[1] - 0.03, 1)
    const lit = look.style === "front" ? 0.75 + 0.35 * clamp(-across * 0.8 + 0.4, 0, 1) : 0.75 + 0.25 * facing
    const k = lit * (1 - w)
    shade[0] = c[0] * k + shade[0] * w
    shade[1] = c[1] * k + shade[1] * w
    shade[2] = c[2] * k + shade[2] * w
    // A ring of lights at the top of each tier, and a lit rim on the side toward the city's glow.
    const ring = smoothstep(0.016, 0.008, tier[2] - Y) * (look.night ? 1 : look.lit > 0.1 ? 0.6 : 0.15)
    const rim = smoothstep(0.65, 0.95, Math.abs(across))
    const ringColor = look.windows[t.seed % look.windows.length]
    for (let i = 0; i < 3; i++) shade[i] += ringColor[i] * ring * 0.9 + look.edge[i] * rim * 0.8 + look.uplight[i] * Math.exp(-Y / 0.3)
    return fog(look, Y, Z, dx, sy, 0)
  }
  const b = city.blocks[hitRef[j]]
  const front = kind === 0
  const u = hitU[j]
  const du = hitDu[j]
  const c = look.facades[b.color % look.facades.length]
  const lit = front ? ([1, 1, 1] as RGB) : look.sides[b.side < 0 ? 0 : 1]
  const extent = front ? b.xo - b.xi : b.z1 - b.z0
  const v = Y - b.y0
  const height = b.y1 - b.y0
  const zone = smoothstep(0.004, 0.01, u) * smoothstep(0.004, 0.01, extent - u) * (b.y0 > 0 ? 1 : smoothstep(0.035, 0.045, v))
  const w = windows(look, u - 0.008, v - 0.045, du, dv, b.pu, b.pv, b.du, b.dv, b.seed * 3 + (front ? 0 : 1), height - 0.065, zone)
  // Day: a little lighter toward the top, where less of the street's shadow reaches.
  const grade = look.style === "front" ? 0.9 + 0.15 * smoothstep(0, 1.5, Y) : 1
  for (let i = 0; i < 3; i++) shade[i] = c[i] * lit[i] * grade * (1 - w) + shade[i] * w
  // Shopfronts glow along the street.
  if (b.shop >= 0 && b.y0 === 0 && !front) {
    const s = look.shops[b.shop % look.shops.length]
    const k = smoothstep(0.034, 0.028, v) * smoothstep(0.004, 0.008, v) * (0.5 + 0.5 * hash(Math.floor(u / 0.05) + b.seed)) * (b.shop < 4 ? 1 : 0.3)
    for (let i = 0; i < 3; i++) shade[i] = lerp(shade[i], s[i], k)
  }
  // Cel-style highlights on the corner nearest the street and along the roof line.
  const corner = Math.max(smoothstep(1.6, 0.4, u / du), smoothstep(1.6, 0.4, (b.y1 - Y) / dv) * 0.7)
  for (let i = 0; i < 3; i++) shade[i] += look.edge[i] * corner + look.uplight[i] * Math.exp(-Y / 0.3)
  return fog(look, Y, Z, dx, sy, window.lit)
}

// Window state shared between windows() and surface(): the hash of the lit window under the pixel's center.
const window = { lit: 0 }

// Lit and dark windows in rows and columns, box-filtered over the pixel's footprint (du by dv) so distant facades
// average out instead of breaking into speckle. Sets shade to the windows' color and returns how much of the pixel
// they cover.
function windows(look: Look, u: number, v: number, du: number, dv: number, pu: number, pv: number, duty: number, dutyV: number, seed: number, top: number, zone: number) {
  window.lit = 0
  const cover = zone * pulse(u, du, pu, duty) * pulse(v, dv, pv, dutyV) * smoothstep(0, dv, top - v)
  if (cover <= 0) return 0
  const iu = Math.floor(u / pu)
  const iv = Math.floor(v / pv)
  const h = hash2(seed * 0.731 + iu * 1.31, iv * 2.17 + seed * 0.11)
  // Whole floors and stretches of a facade tend to be lit or dark together.
  const share = look.lit * (0.35 + 1.3 * hash2(Math.floor(iv / 4) + seed * 0.37, Math.floor(iu / 5) * 0.7))
  const lit = h < share
  const pick = look.windows[Math.floor(hash(h * 91.7 + seed) * look.windows.length)]
  const glow = 0.5 + 0.45 * hash(h * 37.1)
  const near = lit ? [pick[0] * glow, pick[1] * glow, pick[2] * glow] : look.glass
  // The mix a distant facade averages out to.
  const avg = look.windows[Math.floor(hash(seed * 3.3) * look.windows.length)]
  const m = smoothstep(0.45, 1.3, Math.max(du / pu, dv / pv))
  const a = Math.min(1, look.lit * 1.1) * 0.7
  for (let i = 0; i < 3; i++) shade[i] = lerp(near[i], lerp(look.glass[i], avg[i] * 0.7, a), m)
  if (m < 0.3 && cover > 0.5) window.lit = h || 1e-6
  return cover
}

// The share of [x - w / 2, x + w / 2] that falls in the first duty of each period p.
function pulse(x: number, w: number, p: number, duty: number) {
  if (duty >= 1) return 1
  const a = (x - w / 2) / p
  const b = (x + w / 2) / p
  const F = (s: number) => Math.floor(s) * duty + Math.min(s - Math.floor(s), duty)
  return b - a < 1e-6 ? (a - Math.floor(a) < duty ? 1 : 0) : (F(b) - F(a)) / (b - a)
}

// Mixes shade toward the haze by depth: green-teal low down, deeper blue higher up, gathering into a glow around the
// far end of the avenue. Passes the window hash through.
function fog(look: Look, Y: number, Z: number, dx: number, sy: number, id: number) {
  const k = 1 - Math.exp(-Z / look.fog)
  const t = smoothstep(0.1, 1.6, Y)
  const g = 1 + look.glare * Math.exp(-(dx * dx) / 0.05 - ((sy - HORIZON + 0.08) ** 2) / 0.03)
  for (let i = 0; i < 3; i++) shade[i] = lerp(shade[i], lerp(look.haze[0][i], look.haze[1][i], t) * g, k * 0.92)
  return id
}

// The avenue's surface at (X, Z): asphalt with dashed lanes and solid edge lines, the sidewalks beyond, pools of light
// under the lamps, a sheen of the far glow on the road, and haze with distance.
function road(look: Look, X: number, Z: number, H: number, sy: number, dx: number) {
  const ax = Math.abs(X)
  const onRoad = ax < ROAD
  const c = onRoad ? look.road : look.walk
  for (let i = 0; i < 3; i++) shade[i] = c[i]
  // A pixel's footprint across and along the road.
  const fx = Z / H
  const fz = (Z * Z) / (CAM * H)
  const line = (at: number, width: number) => clamp((width / 2 - Math.abs(ax - at)) / fx + 0.5, 0, 1)
  const dash = pulse(Z, fz, 0.16, 0.45)
  const paint = Math.min(1, line(0.11, 0.005) * dash + line(ROAD - 0.012, 0.006) + line(0.005, 0.003))
  // Distant paint thins out to nothing rather than sparkling.
  const p = paint * smoothstep(4.5, 1.5, Z)
  for (let i = 0; i < 3; i++) shade[i] = lerp(shade[i], look.paint[i], p)
  const curb = clamp((0.006 - Math.abs(ax - ROAD)) / fx + 0.5, 0, 1)
  for (let i = 0; i < 3; i++) shade[i] = lerp(shade[i], look.walk[i] * 1.3, curb)
  // Lamp pools, nearest lamps on this side.
  const k = Math.round(Z / LAMP_STEP)
  let pool = 0
  for (let n = Math.max(1, k - 1); n <= k + 1; n++) {
    const dz = Z - n * LAMP_STEP
    const dl = ax - LAMPS + 0.04
    pool += Math.exp(-(dz * dz) / 0.006 - (dl * dl) / 0.012)
  }
  const sheen = smoothstep(1.2, 6, Z) * (1 - smoothstep(0, 0.3, Math.abs(dx)))
  for (let i = 0; i < 3; i++) shade[i] += look.lamp[i] * pool * 0.12 + look.haze[0][i] * sheen * 0.25
  fog(look, 0, Z, dx, sy, 0)
}

// Adds a soft elliptical glow centered on (cx, cy) in pixels.
function glow(hdr: Float32Array, W: number, H: number, cx: number, cy: number, rx: number, ry: number, c: RGB, k: number) {
  for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(H, Math.ceil(cy + ry)); y++)
    for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(W, Math.ceil(cx + rx)); x++) {
      const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry)
      if (d >= 1) continue
      const a = (1 - d) ** 2 * k
      const o = (y * W + x) * 3
      hdr[o] += c[0] * a
      hdr[o + 1] += c[1] * a
      hdr[o + 2] += c[2] * a
    }
}

// Burns one segment of a trail, from (ax, ay) to (bx, by) with radii and heats at each end, into heat, keeping the
// hotter of what is there and this.
function burn(heat: Float32Array, W: number, ax: number, ay: number, bx: number, by: number, ra: number, rb: number, ia: number, ib: number, x0: number, y0: number, x1: number, y1: number) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy || 1e-6
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - ax
      const py = y + 0.5 - ay
      const t = clamp((px * dx + py * dy) / len2, 0, 1)
      const d = Math.hypot(px - dx * t, py - dy * t)
      const r = ra + (rb - ra) * t
      if (d >= r) continue
      const q = 1 - d / r
      const h = (ia + (ib - ia) * t) * q * q * (3 - 2 * q)
      const i = y * W + x
      if (h > heat[i]) heat[i] = h
    }
}

// Colors the heat in the box, red where it is faint and burning orange where it is hot, adds it to hdr and clears it.
function glowHeat(hdr: Float32Array, heat: Float32Array, W: number, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = y * W + x
      const h = heat[i]
      if (h <= 0) continue
      heat[i] = 0
      const o = i * 3
      hdr[o] += TRAIL_EDGE[0] * h + TRAIL_CORE[0] * h * h
      hdr[o + 1] += TRAIL_EDGE[1] * h + TRAIL_CORE[1] * h * h
      hdr[o + 2] += TRAIL_EDGE[2] * h + TRAIL_CORE[2] * h * h
    }
}

export const megacity: Wallpaper = {
  id: "megacity",
  name: "Megacity",
  description: "A canyon of towers over a neon avenue, where motorbikes ride off into the haze trailing red light",
  fixedTime: "night",
  activity: {
    calm: "The glowing city, windows coming and going, and a distant bike now and then",
    lively: "Adds bikes riding up the avenue with their light trails, and searchlights sweeping the sky",
    teeming: "Adds a biker gang streaming through, a sideways slide now and then, and an airship overhead",
  },
  scrim: {
    day: [
      [24, 34, 46],
      [28, 36, 42],
      [22, 24, 30],
    ],
    sunset: [
      [26, 8, 26],
      [40, 14, 18],
      [16, 6, 12],
    ],
    night: [
      [2, 6, 16],
      [3, 12, 16],
      [3, 5, 12],
    ],
  },
  create: (settings) => new Megacity(settings),
}

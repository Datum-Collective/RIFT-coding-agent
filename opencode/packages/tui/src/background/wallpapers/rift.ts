import { Canvas } from "../src/canvas"
import { clamp, fbm1, fbm2, lerp, rand, smoothstep, type RGB } from "../src/math"
import type { Activity, AgentEvent, Settings, Wallpaper } from "../src/wallpaper"

// RIFT's own wallpaper: a seam of azure light torn through a dark field. It widens while the agent works, sends a pulse
// down its length now and then, and when a task finishes a green check-light runs along it and a burst of sparks
// leaves it. After an error it dims, flickers red and settles until the next event.

// Like every scene, slower than real time so nothing is busy behind text.
const TIME_SCALE = 0.4
// RIFT's accent.
const AZURE: RGB = [0.1, 0.36, 1]
const ICE: RGB = [0.6, 0.86, 1]
const GREEN: RGB = [0.15, 1, 0.5]
const RED: RGB = [1, 0.18, 0.14]

// The seam is sampled at this many points along its length.
const POINTS = 72
const MOTES: Record<Activity, number> = { calm: 26, lively: 56, teeming: 100 }
const ECHOES: Record<Activity, number> = { calm: 0, lively: 2, teeming: 4 }
// Real seconds between pulses when idle; busy is quicker.
const PULSE_EVERY: Record<Activity, number> = { calm: 10, lively: 6, teeming: 3.5 }
const PULSE_SPEED = 0.3
const CHEER = 3
// Side cracks forking off the seam: where along it, which side, how far they reach (screen heights) and their lean.
const BRANCHES = [
  { at: 0.18, side: 1, length: 0.2, lean: 0.55, seed: 2 },
  { at: 0.34, side: -1, length: 0.26, lean: 0.4, seed: 5 },
  { at: 0.52, side: 1, length: 0.3, lean: 0.6, seed: 9 },
  { at: 0.66, side: -1, length: 0.18, lean: 0.5, seed: 13 },
  { at: 0.82, side: 1, length: 0.22, lean: 0.35, seed: 17 },
]
const BRANCH_POINTS = 14

interface Mote {
  t: number
  // Distance from the seam in screen heights, drifting outward, and the side it left on.
  off: number
  side: number
  rise: number
  age: number
  life: number
  speed: number
  warm: number
}

class Rift extends Canvas {
  private time = 0
  private readonly activity: Activity
  private readonly motes: Mote[] = []
  private readonly pulses: { t: number; green: boolean }[] = []
  private nextPulse = 2
  // How wide and bright the seam is, easing toward 1 while the agent works and 0.3 when it does not.
  private open = 0.3
  private target = 0.3
  // 1 right after a task finishes, falling to 0: tints the seam green.
  private cheer = 0
  private readonly xs = new Float32Array(POINTS)
  private readonly ys = new Float32Array(POINTS)
  private readonly ws = new Float32Array(POINTS)

  constructor(settings: Settings) {
    super()
    this.activity = settings.activity
  }

  step(dt: number) {
    dt = clamp(dt, 0, 0.1) * TIME_SCALE
    this.time += dt
    this.stepGloom(dt)
    this.open += (this.target - this.open) * Math.min(1, dt * 1.2)
    this.cheer = Math.max(0, this.cheer - dt / CHEER)

    this.nextPulse -= dt
    if (this.nextPulse <= 0) {
      this.pulses.push({ t: 0, green: false })
      this.nextPulse = PULSE_EVERY[this.activity] * TIME_SCALE * (this.target > 0.5 ? 0.5 : 1) * rand(0.8, 1.3)
    }
    for (const pulse of this.pulses) pulse.t += dt * PULSE_SPEED
    while (this.pulses.length && this.pulses[0].t > 1.1) this.pulses.shift()

    const want = Math.round(MOTES[this.activity] * (0.6 + 0.8 * this.open))
    while (this.motes.length < want) this.spawn()
    for (const mote of this.motes) {
      mote.age += dt
      mote.off += mote.speed * dt
    }
    for (let i = this.motes.length - 1; i >= 0; i--) {
      if (this.motes[i].age >= this.motes[i].life) this.motes.splice(i, 1)
    }
  }

  private spawn(burst = false) {
    this.motes.push({
      t: Math.random(),
      off: rand(0.004, 0.02),
      side: Math.random() < 0.5 ? -1 : 1,
      rise: rand(-0.01, 0.03),
      age: burst ? 0 : rand(0, 4),
      life: rand(4, 8),
      speed: burst ? rand(0.05, 0.12) : rand(0.008, 0.03),
      warm: Math.random(),
    })
  }

  protected override visit() {
    for (let i = 0; i < 3; i++) this.pulses.push({ t: -i * 0.14, green: true })
    this.cheer = 1
    for (let i = 0; i < 24; i++) this.spawn(true)
  }

  override react(event: AgentEvent) {
    super.react(event)
    if (event === "busy") {
      this.target = 1
      this.nextPulse = Math.min(this.nextPulse, 0.4)
    } else this.target = 0.3
  }

  // Where the seam crosses the screen, in pixels: from near the upper right to the lower middle, torn by noise.
  private lay() {
    const { H, A, xs, ys, ws, time } = this
    for (let i = 0; i < POINTS; i++) {
      const t = i / (POINTS - 1)
      const tear =
        (fbm1(t * 5 + 3, 7, 4) - 0.5) * 0.2 + (fbm1(t * 19 + 1, 4, 3) - 0.5) * 0.035 + Math.sin(time * 0.45 + t * 5) * 0.006
      xs[i] = (lerp(0.74, 0.52, t) * A + tear) * H
      ys[i] = (t * 1.12 - 0.06) * H
      const taper = smoothstep(0, 0.12, t) * smoothstep(1, 0.88, t)
      const pulse = 0.65 + 0.7 * fbm1(t * 8 + time * 0.8, 11, 3)
      ws[i] = this.thick(0.0028 + 0.0045 * this.open, 1.4) * (0.3 + 0.7 * taper) * pulse
    }
  }

  // Draws one stroke of the glow, a pixel at a time: a very wide faint halo, a broad glow and a thin white-hot core.
  private stroke(xs: ArrayLike<number>, ys: ArrayLike<number>, ws: ArrayLike<number>, n: number, level: number, body: RGB, core: RGB) {
    for (let i = 0; i < n - 1; i++) {
      const dx = xs[i + 1] - xs[i]
      const dy = ys[i + 1] - ys[i]
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)))
      for (let s = 0; s < steps; s++) {
        const f = s / steps
        const x = xs[i] + dx * f
        const y = ys[i] + dy * f
        const w = lerp(ws[i], ws[i + 1], f)
        this.disc(x, y, w * 5, body[0] * level * 0.14, body[1] * level * 0.14, body[2] * level * 0.14, 0.08)
        this.disc(x, y, w * 2.2, body[0] * level * 0.6, body[1] * level * 0.6, body[2] * level * 0.6, 0.3)
        this.disc(x, y, w * 0.7, core[0] * level * 2.4, core[1] * level * 2.4, core[2] * level * 2.4, 0.95)
      }
    }
  }

  render() {
    this.restore()
    this.lay()
    const { xs, ys, ws, open, gloom, cheer } = this
    const flicker = gloom > 0 ? 0.75 + 0.25 * Math.sin(this.time * 31) * Math.sin(this.time * 7.3) : 1
    const level = (0.9 + 1.6 * open) * (1 - 0.55 * gloom) * flicker
    const mix = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]
    const body = mix(mix(AZURE, GREEN, cheer), RED, gloom)
    const core = mix(mix(ICE, [0.8, 1, 0.9], cheer), [1, 0.6, 0.55], gloom)

    // Echoes: faint copies of the seam either side, breathing.
    const echoX = new Float32Array(POINTS)
    const echoW = new Float32Array(POINTS)
    for (let k = 1; k <= ECHOES[this.activity]; k++) {
      for (const side of [-1, 1]) {
        const dx = side * k * this.H * (0.03 + 0.006 * Math.sin(this.time * 0.6 + k))
        for (let i = 0; i < POINTS; i++) {
          echoX[i] = xs[i] + dx
          echoW[i] = ws[i] * 0.25
        }
        this.stroke(echoX, ys, echoW, POINTS, level * 0.3 * (1 - k / (ECHOES[this.activity] + 1)), body, body)
      }
    }

    this.stroke(xs, ys, ws, POINTS, level, body, core)

    // Cracks forking off it, thinner the further they run.
    const bx = new Float32Array(BRANCH_POINTS)
    const by = new Float32Array(BRANCH_POINTS)
    const bw = new Float32Array(BRANCH_POINTS)
    for (const crack of BRANCHES) {
      const at = crack.at * (POINTS - 1)
      const i = Math.min(POINTS - 2, Math.floor(at))
      const f = at - i
      const x0 = lerp(xs[i], xs[i + 1], f)
      const y0 = lerp(ys[i], ys[i + 1], f)
      const w0 = lerp(ws[i], ws[i + 1], f)
      const reach = crack.length * this.H * (0.5 + 0.5 * this.open)
      for (let j = 0; j < BRANCH_POINTS; j++) {
        const u = j / (BRANCH_POINTS - 1)
        const jag = (fbm1(u * 6 + crack.seed, crack.seed, 3) - 0.5) * 0.12 * this.H
        bx[j] = x0 + crack.side * u * reach + jag * 0.3
        by[j] = y0 + u * reach * crack.lean + jag
        bw[j] = w0 * 0.55 * (1 - u) ** 1.3
      }
      this.stroke(bx, by, bw, BRANCH_POINTS, level * 0.8, body, core)
    }

    // Pulses running down the seam.
    for (const pulse of this.pulses) {
      if (pulse.t < 0 || pulse.t > 1) continue
      const at = pulse.t * (POINTS - 1)
      const i = Math.min(POINTS - 2, Math.floor(at))
      const f = at - i
      const x = lerp(xs[i], xs[i + 1], f)
      const y = lerp(ys[i], ys[i + 1], f)
      const w = lerp(ws[i], ws[i + 1], f)
      const c = pulse.green ? GREEN : ICE
      const fade = Math.sin(Math.PI * clamp(pulse.t, 0, 1))
      this.disc(x, y, w * 3.2, c[0] * 0.8 * fade, c[1] * 0.8 * fade, c[2] * 0.8 * fade, 0.35)
      this.disc(x, y, w * 1.1, c[0] * 3 * fade, c[1] * 3 * fade, c[2] * 3 * fade, 0.9)
    }

    // Sparks leaving the seam.
    for (const mote of this.motes) {
      const at = mote.t * (POINTS - 1)
      const i = Math.min(POINTS - 2, Math.floor(at))
      const f = at - i
      const x = lerp(xs[i], xs[i + 1], f) + mote.side * mote.off * this.H
      const y = lerp(ys[i], ys[i + 1], f) - mote.rise * mote.age * this.H
      const life = Math.sin(Math.PI * clamp(mote.age / mote.life, 0, 1))
      const warm = mote.warm * cheer
      const r = lerp(body[0], ICE[0], 0.5) * 0.9 * life * (1 - warm) + GREEN[0] * warm * life
      const g = lerp(body[1], ICE[1], 0.5) * 0.9 * life * (1 - warm) + GREEN[1] * warm * life
      const b = lerp(body[2], ICE[2], 0.5) * 0.9 * life * (1 - warm) + GREEN[2] * warm * life
      this.splat(x, y, r * 0.8, g * 0.8, b * 0.8)
    }
    this.finish()
  }

  // Runs after every resize: the dark field and the soft glow the seam lives in, painted once.
  protected override layout() {
    const { W, H, A, hdr } = this
    for (let y = 0; y < H; y++) {
      const v = y / H
      for (let x = 0; x < W; x++) {
        const u = x / H
        // Deep blue-black, a little lighter toward the top, with slow clouds of azure and a wide glow around the seam.
        const cloud = fbm2(u * 1.3, v * 1.3 + 4)
        const seam = Math.exp(-(((u - lerp(0.74, 0.52, v) * A) / 0.3) ** 2))
        const k = 0.012 * cloud + 0.16 * seam * (0.55 + 0.45 * cloud)
        const o = (y * W + x) * 3
        hdr[o] = 0.002 + 0.01 * (1 - v) * 0.3 + AZURE[0] * k * 0.5
        hdr[o + 1] = 0.004 + 0.01 * (1 - v) * 0.4 + AZURE[1] * k * 0.6
        hdr[o + 2] = 0.012 + 0.02 * (1 - v) * 0.5 + AZURE[2] * k
      }
    }
  }
}

export const rift: Wallpaper = {
  id: "rift",
  name: "Rift",
  description: "RIFT's own: a seam of azure light torn through the dark, widening while the agent works, with a green check-light when it finishes",
  fixedTime: "night",
  activity: {
    calm: "A slow seam with a few sparks drifting off it",
    lively: "Adds faint echoes of the seam and more sparks",
    teeming: "Four echoes, a swarm of sparks and quick pulses",
  },
  scrim: {
    day: [
      [2, 6, 18],
      [2, 8, 22],
      [1, 4, 12],
    ],
    sunset: [
      [2, 6, 18],
      [2, 8, 22],
      [1, 4, 12],
    ],
    night: [
      [2, 6, 18],
      [2, 8, 22],
      [1, 4, 12],
    ],
  },
  create: (settings) => new Rift(settings),
}

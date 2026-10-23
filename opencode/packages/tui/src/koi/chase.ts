/**
 * The koi chase: two koi circling a lily pad in the middle of still water, the same distance apart
 * all the way round. Now and then one flicks its tail and leaves a little swirl in the water, and
 * now and then faint ripples spread round the pad.
 *
 * Adapted from koi-screensaver by Erik Johansson (MIT licence). See THIRD_PARTY_NOTICES.md.
 */
import { clamp } from "./colour"
import { INTRO_HOLD } from "./intro"
import { JOINTS, PATTERNS, SEG, follow, newKoi, type Koi } from "./koi"
import { angleTo, remainder, smooth } from "./math"
import type { Pond } from "./pond"

export type Swirl = { x: number; y: number; a: number; dir: number; age: number; life: number }

/** One faint arc round the pad: it opens, drifts outwards a little and fades, thickest in its middle. */
export type Ripple = { r0: number; a0: number; span: number; wob: number; delay: number; age: number; life: number }

export type ChaseState = {
  /** Where the chase has got to round the circle. */
  theta: number
  /** The radius the koi swim round. */
  rp: number
  /** The pad's radius. */
  padR: number
  speed: number
  /** The chase only sets off when the koi do. */
  started: boolean
  /** Seconds until the next tail flick. */
  flickT: number
  swirls: Swirl[]
  /** Seconds until the next ripples round the pad. */
  rippleT: number
  ripples: Ripple[]
}

// Sizes as fractions of the shorter side of the screen.
const KOI_SIZE = 0.0185
const RADIUS = 0.248
const PAD = 0.0995

/** Seconds a tail flick takes to reach its strongest. */
const FLICK_RISE = 0.35

/** How far a ripple drifts out, in pad radii. */
const RIPPLE_GROW = 0.28

/** How many sizes the pad opens in while the logo breaks up. */
const PAD_STEPS = 40

/** How many times a second a ripple moves on. */
const RIPPLE_STEPS = 6

export function setupChase(p: Pond) {
  const m = Math.min(p.w, p.h)
  p.size = m * KOI_SIZE
  const c: ChaseState = {
    rp: m * RADIUS,
    theta: Math.PI,
    // A slow lap, about half a minute.
    speed: 18 * p.size * 0.17,
    flickT: 6 + p.rng.float() * 6,
    rippleT: 8 + p.rng.float() * 6,
    padR: m * PAD,
    started: true,
    swirls: [],
    ripples: [],
  }
  p.chase = c

  // One still pad in the middle, its notch up and to the right.
  p.pads = [{ x: p.w / 2, y: p.h / 2, r: c.padR, rot: -0.55, notch: 0.09, wobble: 1, flower: 0, fx: 0, fy: 0 }]

  p.koi = [newKoi(p, PATTERNS[1]!), newKoi(p, PATTERNS[0]!)]
  p.koi.forEach((k, i) => {
    k.slot = i * Math.PI
    k.depth = 0.3
    k.stroke = 0.45
    // Start in place on the circle, the body laid along it.
    const a = c.theta + k.slot
    k.heading = a + Math.PI / 2
    const gap = SEG * p.size
    for (let n = 0; n < JOINTS; n++) {
      const b = a - (n * gap) / c.rp
      k.j[n] = { x: p.w / 2 + Math.cos(b) * c.rp, y: p.h / 2 + Math.sin(b) * c.rp }
    }
    k.speed = c.speed
  })
}

/** Moves the chase on: the circle turns, now and then a tail flicks, now and then ripples open. */
export function stepChase(p: Pond, dt: number) {
  const c = p.chase!
  const intro = p.intro
  if (!c.started && intro && intro.release.length > 0 && intro.t >= intro.release[0]!) c.started = true
  if (c.started) c.theta += (c.speed / c.rp) * dt

  // While the logo is up the pad waits; it opens out as the letters lift off the water.
  // In steps: the pad's pixels are worked out afresh whenever its size changes, so it opens in a
  // few dozen sizes and not a new one every frame.
  const grow = intro ? Math.round(smooth((intro.t - INTRO_HOLD) / 2.5) * PAD_STEPS) / PAD_STEPS : 1
  p.pads[0]!.r = c.padR * grow

  // Now and then one of them flicks its tail.
  c.flickT -= dt
  if (c.flickT <= 0) {
    c.flickT = 7 + p.rng.float() * 9
    const k = p.koi[p.rng.int(p.koi.length)]!
    // Under way.
    if (k.ease >= 1 && k.flick === 0) k.flick = 1e-9
  }

  // Now and then two or three faint arcs open round the pad and drift out, staggered.
  c.rippleT -= dt
  if (c.rippleT <= 0 && !intro) {
    c.rippleT = 18 + p.rng.float() * 12
    const n = 2 + p.rng.int(2)
    const start = p.rng.float() * 2 * Math.PI
    for (let k = 0; k < n; k++) {
      c.ripples.push({
        r0: c.padR * (1.16 + 0.15 * k),
        a0: start + k * 2.1 + (p.rng.float() - 0.5) * 0.8,
        span: 1.3 + 0.9 * p.rng.float(),
        wob: p.rng.float() * 6.28,
        delay: 0.7 * k,
        age: 0,
        life: 6.5,
      })
    }
  }
  c.ripples = c.ripples.filter((r) => (r.age += dt) < r.delay + r.life)
  c.swirls = c.swirls.filter((w) => (w.age += dt) < w.life)
}

/** Leaves a swirl at a koi's tail tip, curling the way it sweeps. */
function swirlFrom(p: Pond, k: Koi) {
  const t = k.j[JOINTS - 1]!
  const b = k.j[JOINTS - 2]!
  const dir = p.rng.int(2) === 0 ? -1 : 1
  const a = Math.atan2(t.y - b.y, t.x - b.x) + (dir * Math.PI) / 2
  p.chase!.swirls.push({ x: t.x, y: t.y, a, dir, age: 0, life: 1.4 })
}

/**
 * Keeps a koi in its place on the circle: steering on to the circle, and swimming a little faster
 * or slower until it is level with its place, then holding it.
 */
export function chaseSwim(p: Pond, k: Koi, dt: number) {
  const c = p.chase!
  const length = 18 * p.size
  const cx = p.w / 2
  const cy = p.h / 2
  const head = k.j[0]!
  const r = Math.hypot(head.x - cx, head.y - cy)
  const phi = Math.atan2(head.y - cy, head.x - cx)

  // Along the circle (clockwise on screen), leaning in or out towards it.
  const g = clamp((r - c.rp) / (0.5 * length), -1, 1)
  const tx = -Math.sin(phi) - Math.cos(phi) * g
  const ty = Math.cos(phi) - Math.sin(phi) * g
  const want = Math.atan2(ty, tx)
  const maxTurn = k.speed / (0.4 * length)
  k.heading += (k.speed / Math.max(r, 1) + clamp(angleTo(k.heading, want) * 2, -maxTurn, maxTurn)) * dt

  let goal = c.speed
  if (c.started) {
    const gap = remainder(c.theta + k.slot - phi, 2 * Math.PI)
    goal *= clamp(1 + 1.2 * gap, 0.55, 1.7)
  }
  k.speed += (goal - k.speed) * Math.min(1, dt * 1.5)

  // An easy, steady stroke, and a few stronger beats when it flicks: the stroke builds over a
  // third of a second and settles back over about one, rather than snapping.
  let e = 0
  if (k.flick > 0) {
    const was = k.flick
    k.flick += dt
    e = smooth(k.flick / FLICK_RISE) * Math.exp(-Math.max(0, k.flick - FLICK_RISE) / 0.8)
    // At the strongest sweep.
    if (was < FLICK_RISE && k.flick >= FLICK_RISE) swirlFrom(p, k)
    if (k.flick > 4) k.flick = 0
  }
  k.stroke = 0.45 + 0.8 * e
  k.phase += dt * (2.6 + 3.4 * k.stroke)

  head.x += Math.cos(k.heading) * k.speed * dt
  head.y += Math.sin(k.heading) * k.speed * dt
  follow(p, k)
}

/** The curl of water a tail flick leaves: a spiral that opens and fades where the tail was. */
export function drawSwirls(p: Pond) {
  const s = p.size
  for (const w of p.chase!.swirls) {
    const open = w.age / w.life
    const r = (1 + 2.5 * open) * s
    const amp = 0.95 * Math.pow(1 - open, 1.2)
    // The curl shortens from its outer end as it opens.
    const end = 1 - 0.6 * open
    const steps = 48
    for (let i = 0; i <= steps; i++) {
      const t = (end * i) / steps
      const a = w.a + w.dir * t * 4.5
      const rr = r * (0.4 + 0.6 * t)
      const x = w.x + Math.cos(a) * rr
      const y = w.y + Math.sin(a) * rr
      const width = s * (0.22 + 0.2 * (1 - t))
      const v = amp * (0.55 + 0.45 * (1 - t))
      p.fill(x, y, width, (index) => {
        if (v > p.height[index]!) p.height[index] = v
      })
    }
  }
}

/** How far from the pad's middle a ripple can reach. */
const rippleReach = (c: ChaseState) => (r: Ripple) => r.r0 + RIPPLE_GROW * c.padR + 0.02 * c.padR + 2

export function drawRipples(p: Pond) {
  const c = p.chase!
  const cx = p.w / 2
  const cy = p.h / 2
  const reach = rippleReach(c)
  for (const r of c.ripples) {
    // A ripple changes slowly, so it moves on only a few times a second.
    const age = Math.floor(r.age * RIPPLE_STEPS) / RIPPLE_STEPS
    const t = (age - r.delay) / r.life
    if (t <= 0 || t >= 1) continue
    const amp = 0.75 * Math.pow(Math.sin(Math.PI * t), 1.3)
    const rad = r.r0 + RIPPLE_GROW * c.padR * smooth(t)
    // Half the line's width at its thickest.
    const w = 1.4
    const inner = rad - 0.02 * c.padR - w - 1
    p.fill(cx, cy, reach(r), (i, dx, dy) => {
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < inner) return
      const a = Math.atan2(dy, dx)
      const u = ((((a - r.a0 + 4 * Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / r.span
      if (u >= 1) return
      const taper = Math.pow(Math.sin(Math.PI * u), 0.8)
      const ww = w * (0.35 + 0.65 * taper)
      const off = Math.abs(d - rad - 0.012 * c.padR * Math.sin(3 * a + r.wob))
      if (off >= ww) return
      const v = amp * taper * (1 - (off / ww) * (off / ww))
      if (v > p.height[i]!) p.height[i] = v
    })
  }
}

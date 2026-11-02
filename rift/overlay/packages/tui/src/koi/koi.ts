/**
 * A koi: a spine of thirteen joints, dragged along behind a head that wanders, turns back from the
 * banks, keeps clear of the others, and now and then puts on a burst of speed.
 *
 * Adapted from koi-screensaver by Erik Johansson (MIT licence). See THIRD_PARTY_NOTICES.md.
 */
import { clamp } from "./colour"
import { angleTo } from "./math"
import { Tag } from "./palette"
import type { Random } from "./random"
import type { KoiShape } from "./shape"

export const JOINTS = 13
/** Joint spacing; a koi is 18 units long at size 1. */
export const SEG = 1.5

/** A koi's half-width at each joint, head to tail. */
export const RADII = [2.5, 2.9, 2.9, 2.7, 2.4, 2.05, 1.75, 1.45, 1.2, 1.0, 0.85, 0.7, 0.6] as const

export type Pt = { x: number; y: number }

export type Pattern = {
  body: number
  /** A patch over each joint, or `Tag.water` for none. */
  back: readonly number[]
  /** A metallic koi: light catches a stripe down its back. */
  sheen?: boolean
}

const w = Tag.water
const K = Tag.ink
const R = Tag.red
const G = Tag.gold

export const PATTERNS: Pattern[] = [
  { body: K, back: [w, R, R, w, w, R, R, R, w, w, w, w, w] }, // ink with azure patches
  { body: R, back: [w, K, K, w, K, K, w, w, K, K, w, K, w] }, // azure with ink patches
  { body: G, back: [w, w, w, w, w, w, w, w, w, w, w, w, w], sheen: true }, // metallic grey
  { body: K, back: [R, w, w, w, w, w, w, w, w, w, w, w, w] }, // ink with an azure crown
  { body: Tag.orange, back: [w, w, K, K, w, w, w, K, w, w, w, w, w] }, // pale azure with ink
  { body: R, back: [w, G, w, w, G, G, w, w, w, G, w, w, w] }, // azure and grey
  { body: K, back: [w, w, R, R, R, w, w, w, R, R, w, w, w] },
  { body: G, back: [w, R, R, w, w, w, R, w, w, w, w, w, w] },
]

export type Koi = {
  j: Pt[]
  heading: number
  speed: number
  cruise: number
  burst: number
  burstT: number
  wander: number
  wanderT: number
  phase: number
  stroke: number
  /** How deep it swims, 0 at the surface to 1 at the bottom; it keeps to it. */
  depth: number
  pat: Pattern
  /** 1 when whole; less while a scene gathers it up. */
  grow: number
  /** 1 when swimming freely; less while it starts to. */
  ease: number
  /** The chase: its place on the circle, behind the leader. */
  slot: number
  /** The chase: seconds into a tail flick, 0 for none. */
  flick: number
  shape?: KoiShape
}

/** What a koi needs to know of the pond it swims in. */
export type Habitat = {
  w: number
  h: number
  /** Koi scale; a koi is 18*size long. */
  size: number
  rng: Random
  koi: Koi[]
}

/** A koi glides about a fifth of its length each second. */
export const baseSpeed = (size: number) => 18 * size * 0.2

export function newKoi(home: Habitat, pat: Pattern): Koi {
  const m = 18 * home.size
  const x = m + home.rng.float() * Math.max(1, home.w - 2 * m)
  const y = m + home.rng.float() * Math.max(1, home.h - 2 * m)
  const heading = home.rng.float() * 2 * Math.PI
  const cruise = 0.75 + 0.35 * home.rng.float()
  const phase = home.rng.float() * 6.28
  const burstT = 4 + home.rng.float() * 12
  return {
    j: Array.from({ length: JOINTS }, (_, n) => {
      const d = SEG * home.size * n
      return { x: x - Math.cos(heading) * d, y: y - Math.sin(heading) * d }
    }),
    heading,
    speed: cruise * baseSpeed(home.size),
    cruise,
    burst: 0,
    burstT,
    wander: heading,
    wanderT: 0,
    phase,
    stroke: 0,
    depth: 0,
    pat,
    grow: 1,
    ease: 1,
    slot: 0,
    flick: 0,
  }
}

export function swim(home: Habitat, k: Koi, dt: number) {
  const length = 18 * home.size
  const base = baseSpeed(home.size)
  const head = k.j[0]!

  // Wander: every few seconds pick a new heading to drift towards.
  k.wanderT -= dt
  if (k.wanderT <= 0) {
    k.wander = k.heading + (home.rng.float() - 0.5) * 2.4
    k.wanderT = 4 + home.rng.float() * 7
  }
  let sx = Math.cos(k.wander)
  let sy = Math.sin(k.wander)

  // Turn back from the banks.
  const margin = length * 1.1
  const push = (v: number, lo: number, hi: number) => {
    if (v < lo + margin) return (lo + margin - v) / margin
    if (v > hi - margin) return -(v - (hi - margin)) / margin
    return 0
  }
  sx += 3 * push(head.x, 0, home.w)
  sy += 3 * push(head.y, 0, home.h)

  // Drift back towards the open water in the middle, once they stray past a third of the way to
  // the edge.
  const nx = (head.x / home.w) * 2 - 1
  const ny = (head.y / home.h) * 2 - 1
  const r = Math.hypot(nx, ny)
  if (r > 0.3) {
    const f = (3.0 * (r - 0.3)) / r
    sx -= nx * f
    sy -= ny * f
  }

  // Keep a little apart from the others.
  for (const other of home.koi) {
    if (other === k) continue
    for (const n of [0, 4, 8]) {
      const dx = head.x - other.j[n]!.x
      const dy = head.y - other.j[n]!.y
      const d = Math.hypot(dx, dy)
      if (d > 0 && d < length * 1.1) {
        const f = 2.6 * (1 - d / (length * 1.1))
        sx += (dx / d) * f
        sy += (dy / d) * f
      }
    }
  }

  const want = Math.atan2(sy, sx)
  // Turning radius never tighter than about half a body length.
  const maxTurn = k.speed / (0.5 * length)
  k.heading += clamp(angleTo(k.heading, want) * 1.3, -maxTurn, maxTurn) * dt

  // Now and then a few strong strokes, then a long glide.
  k.burstT -= dt
  if (k.burstT <= 0) {
    k.burst = 0.6 + 0.6 * home.rng.float()
    k.burstT = 9 + home.rng.float() * 16
  }
  k.burst *= Math.exp(-dt / 1.6)
  const goal = base * (k.cruise + k.burst)
  k.speed += (goal - k.speed) * Math.min(1, dt * 0.9)
  const effort = k.speed / base - 0.4 + 2 * k.burst
  k.stroke += (clamp(effort, 0.35, 1.2) - k.stroke) * Math.min(1, dt * 2)
  k.phase += dt * (2.6 + 3.4 * k.stroke)

  head.x += Math.cos(k.heading) * k.speed * dt
  head.y += Math.sin(k.heading) * k.speed * dt
  follow(home, k)
}

/** Drags the body after the head, but a koi's spine only bends so far. */
export function follow(home: Habitat, k: Koi) {
  const gap = SEG * home.size
  let back = k.heading + Math.PI
  for (let n = 1; n < JOINTS; n++) {
    const a = k.j[n - 1]!
    const b = k.j[n]!
    let ang = Math.atan2(b.y - a.y, b.x - a.x)
    ang = back + clamp(angleTo(back, ang), -0.22, 0.22)
    b.x = a.x + Math.cos(ang) * gap
    b.y = a.y + Math.sin(ang) * gap
    back = ang
  }
}

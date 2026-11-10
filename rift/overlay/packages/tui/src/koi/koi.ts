/**
 * A koi: a spine of thirteen joints, dragged along behind its head. Where the head goes is the
 * stream's to decide (see `stream`).
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
  phase: number
  stroke: number
  /** How deep it swims, 0 at the surface to 1 at the bottom; it keeps to it. */
  depth: number
  pat: Pattern
  shape?: KoiShape
}

/** What a koi needs to know of the pond it swims in. */
export type Habitat = {
  w: number
  h: number
  /** Koi scale; a koi is 18*size long. */
  size: number
  rng: Random
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
  // Drawn and unused since the wandering koi went, so a seed still makes exactly the stream it did.
  home.rng.float()
  return {
    j: Array.from({ length: JOINTS }, (_, n) => {
      const d = SEG * home.size * n
      return { x: x - Math.cos(heading) * d, y: y - Math.sin(heading) * d }
    }),
    heading,
    speed: cruise * baseSpeed(home.size),
    cruise,
    phase,
    stroke: 0,
    depth: 0,
    pat,
  }
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

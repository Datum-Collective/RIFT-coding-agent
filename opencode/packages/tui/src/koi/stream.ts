/**
 * The stream: a narrow strip of water just above the composer that small koi swim through while
 * the user types. They come in from one side, cruise the length of it drifting between lanes,
 * and leave by the other; typing stirs them into short bursts, and now and then one touches the
 * surface and leaves a ring.
 *
 * The koi are the pond's own (spine, sway, fins and tail); only the steering is different, since a
 * strip a few rows tall has no room for the pond's wide turns.
 */
import { clamp } from "./colour"
import { JOINTS, PATTERNS, SEG, follow, newKoi, type Koi } from "./koi"
import { angleTo } from "./math"
import type { Pond } from "./pond"

/** One koi's way through the stream. */
type Run = {
  /** +1 swims left to right, -1 right to left. */
  dir: number
  /** The height it is drifting towards, in world units. */
  lane: number
  /** Seconds until it picks another lane. */
  laneT: number
}

export type StreamState = {
  runs: Map<Koi, Run>
  /** False once the user has stopped typing: no more koi come in. */
  open: boolean
  /** Seconds until the next koi comes in. */
  nextT: number
  /** Keystrokes since the last ring, so the rings come with typing and not with time. */
  strokes: number
}

/**
 * Koi scale in the stream: a koi is 18*size long, about fourteen cells. Any smaller and a body is
 * only three pixels thick, and the fins make it read as a dart rather than a fish.
 */
const SIZE = 1.55

/** At most this many in the stream at once. */
const MOST = 3

/** The steepest a koi swims across the stream, in radians from straight along it. */
const STEEPEST = 0.5

export function setupStream(p: Pond) {
  p.size = SIZE
  p.stream = { runs: new Map(), open: true, nextT: 0, strokes: 0 }
}

/** Moves the stream on: a new koi now and then while it is open, and each koi along its way. */
export function stepStream(p: Pond, dt: number) {
  const s = p.stream!
  s.nextT -= dt
  if (s.open && s.nextT <= 0 && p.koi.length < MOST) {
    const first = p.koi.length === 0
    const companion = p.koi.length === 1 && p.rng.float() < 0.6 ? s.runs.get(p.koi[0]!) : undefined
    enter(p, companion?.dir)
    // Koi often come in pairs: a second follows the first in a moment, then a longer wait.
    s.nextT = first ? 0.9 + p.rng.float() * 1.2 : 3 + p.rng.float() * 4
  }
  const length = 18 * p.size
  p.koi = p.koi.filter((k) => {
    const run = s.runs.get(k)!
    const tail = k.j[JOINTS - 1]!.x
    const gone = run.dir > 0 ? tail > p.w + length * 0.2 : tail < -length * 0.2
    if (gone) s.runs.delete(k)
    return !gone
  })
}

/** A keystroke: the koi quicken, and every few keys one touches the surface. */
export function stirStream(p: Pond) {
  const s = p.stream!
  s.open = true
  for (const k of p.koi) k.burst = Math.min(1.1, k.burst + 0.14)
  s.strokes++
  if (p.koi.length === 0 || s.strokes < 5 + p.rng.int(4)) return
  s.strokes = 0
  const head = p.koi[p.rng.int(p.koi.length)]!.j[0]!
  p.addRing(head.x, head.y, 1.2 * p.size, 5 * p.size, 0.55, 1.6, 0.9 * p.size)
}

/** Steers a koi along the stream: lengthwise, drifting towards its lane, with a gentle weave. */
export function streamSwim(p: Pond, k: Koi, dt: number) {
  const run = p.stream!.runs.get(k)!
  const length = 18 * p.size
  const head = k.j[0]!

  run.laneT -= dt
  if (run.laneT <= 0) {
    run.lane = pickLane(p)
    run.laneT = 2 + p.rng.float() * 4
  }

  // Lengthwise, bent towards the lane and weaving a little, never steeper than STEEPEST.
  const weave = Math.sin(k.phase * 0.18) * 0.12
  const climb = clamp(((run.lane - head.y) / (0.6 * length)) * STEEPEST, -STEEPEST, STEEPEST) + weave
  const want = run.dir > 0 ? climb : Math.PI - climb
  const maxTurn = k.speed / (0.5 * length)
  k.heading += clamp(angleTo(k.heading, want) * 1.6, -maxTurn, maxTurn) * dt

  // About a body length a second, a little more in a burst, gliding back down after it.
  k.burst *= Math.exp(-dt / 1.4)
  const goal = length * (k.cruise + 0.8 * k.burst)
  k.speed += (goal - k.speed) * Math.min(1, dt * 1.2)
  k.stroke += (clamp(0.45 + 1.2 * k.burst, 0.35, 1.2) - k.stroke) * Math.min(1, dt * 2)
  k.phase += dt * (3 + 3.6 * k.stroke)

  head.x += Math.cos(k.heading) * k.speed * dt
  head.y += Math.sin(k.heading) * k.speed * dt
  follow(p, k)
}

/** A koi comes in at one side, already swimming, its body still off the screen behind it. */
function enter(p: Pond, dir = p.rng.int(2) === 0 ? 1 : -1) {
  const k = newKoi(p, PATTERNS[p.rng.int(PATTERNS.length)]!)
  const lane = pickLane(p)
  k.heading = dir > 0 ? 0 : Math.PI
  k.cruise = 0.8 + 0.4 * p.rng.float()
  k.speed = 18 * p.size * k.cruise
  k.depth = 0.15 + 0.6 * p.rng.float()
  const x = dir > 0 ? -1 : p.w + 1
  const gap = SEG * p.size
  k.j = Array.from({ length: JOINTS }, (_, n) => ({ x: x - Math.cos(k.heading) * gap * n, y: lane }))
  p.stream!.runs.set(k, { dir, lane, laneT: 1.5 + p.rng.float() * 3 })
  p.koi.push(k)
}

/**
 * A height to swim at, clear enough of the stream's banks that the fins stay in the water: of a few
 * picked at random, the one furthest from the other koi's lanes, so they pass rather than pile up.
 */
function pickLane(p: Pond) {
  const margin = Math.min(p.h / 2, 3.2 * p.size)
  const lanes = [...p.stream!.runs.values()].map((run) => run.lane)
  const candidates = Array.from({ length: 4 }, () => margin + p.rng.float() * Math.max(0, p.h - 2 * margin))
  const room = (y: number) => Math.min(Infinity, ...lanes.map((lane) => Math.abs(lane - y)))
  return candidates.reduce((best, y) => (room(y) > room(best) ? y : best))
}

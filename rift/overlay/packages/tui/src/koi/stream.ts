/**
 * The stream: a narrow strip of water just above the composer that small koi swim through while
 * the user types. They come in from one side, cruise the length of it drifting between lanes,
 * and leave by the other, and now and then one touches the surface and leaves a ring.
 *
 * They swim the way koi do, burst and coast: a bout of a few tail beats pushes the fish on, then
 * the body straightens and it glides, slowing, until it is slow enough to start the next bout.
 * Typing urges them on, so the bouts come quicker, with faster, wider beats and shorter glides;
 * each koi hears the urge a moment late, so the school never beats as one.
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
  /** Where it is in its weave across the lane, in radians; it goes round as the koi swims on. */
  weave: number
  gait: Gait
  /** Seconds this koi takes to answer the user's rhythm. */
  lag: number
  /** The urge as this koi has heard it so far, `lag` seconds behind. */
  heard: number
}

/** A bout of tail beats with `left` half-beats to go, or a glide until speed falls below `rest`. */
type Gait = { kind: "beat"; left: number } | { kind: "glide"; rest: number }

export type StreamState = {
  runs: Map<Koi, Run>
  /** False once the user has stopped typing: no more koi come in. */
  open: boolean
  /** Seconds until the next koi comes in. */
  nextT: number
  /** Keystrokes since the last ring, so the rings come with typing and not with time. */
  strokes: number
  /** How hard the typing urges the koi on, 0 to 1: up with each keystroke, fading when it stops. */
  urge: number
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

/** Water drag, per second: coasting, a koi loses half its speed in 1.2 seconds. */
const DRAG = Math.LN2 / 1.2

/** Seconds for the urge to fade to a third once the typing stops. */
const URGE_FADE = 1.3

export function setupStream(p: Pond) {
  p.size = SIZE
  p.stream = { runs: new Map(), open: true, nextT: 0, strokes: 0, urge: 0 }
}

/** Moves the stream on: a new koi now and then while it is open, and each koi along its way. */
export function stepStream(p: Pond, dt: number) {
  const s = p.stream!
  s.urge *= Math.exp(-dt / URGE_FADE)
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

/** A keystroke: the koi are urged on, and every few keys one touches the surface. */
export function stirStream(p: Pond) {
  const s = p.stream!
  s.open = true
  s.urge += (1 - s.urge) * 0.22
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
  run.weave += ((k.speed * dt) / length) * 0.9
  const climb = clamp(((run.lane - head.y) / (0.6 * length)) * STEEPEST, -STEEPEST, STEEPEST) + Math.sin(run.weave) * 0.12
  const want = run.dir > 0 ? climb : Math.PI - climb
  const maxTurn = k.speed / (0.5 * length)
  k.heading += clamp(angleTo(k.heading, want) * 1.6, -maxTurn, maxTurn) * dt

  run.heard += (p.stream!.urge - run.heard) * (1 - Math.exp(-dt / run.lag))
  const heard = run.heard
  let thrust = 0
  if (run.gait.kind === "beat") {
    // Faster and wider beats the more it is urged. Thrust comes twice a beat, once per sweep of the
    // tail. Kept up, a bout would settle at 1.6 times the koi's pace; it never lasts that long, so
    // a bout and the glide after it come to about its pace: a body length a second, more if urged.
    const before = k.phase
    k.phase += 2 * Math.PI * (1.2 + 2.6 * heard) * dt
    k.stroke += (0.45 + 0.75 * heard - k.stroke) * Math.min(1, dt * 6)
    thrust = 1.6 * 2 * DRAG * length * (k.cruise + 0.9 * heard) * Math.sin(k.phase) ** 2
    run.gait.left -= Math.floor(k.phase / Math.PI) - Math.floor(before / Math.PI)
    if (run.gait.left <= 0) run.gait = glide(p)
  } else {
    // The body straightens and the tail barely sways; once slow enough, it beats again.
    k.phase += 0.9 * dt
    k.stroke += (0.06 - k.stroke) * Math.min(1, dt * 8)
    if (k.speed < length * (run.gait.rest + 0.7 * heard)) run.gait = bout(p, heard)
  }
  k.speed += (thrust - DRAG * k.speed) * dt

  // The head recoils a little against each sweep of the tail, so its path wobbles.
  const course = k.heading - 0.07 * k.stroke * Math.sin(k.phase - 2.5)
  head.x += Math.cos(course) * k.speed * dt
  head.y += Math.sin(course) * k.speed * dt
  follow(p, k)
}

/** A bout of beats: a few when unhurried, more when urged on. */
function bout(p: Pond, heard: number): Gait {
  return { kind: "beat", left: 2 * (2 + Math.round(3 * heard) + p.rng.int(2)) }
}

/** A glide, until the koi slows to about half a body length a second, or more when urged on. */
function glide(p: Pond): Gait {
  return { kind: "glide", rest: 0.45 + 0.1 * p.rng.float() }
}

/** A koi comes in at one side, coasting, its body still off the screen behind it. */
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
  const s = p.stream!
  s.runs.set(k, {
    dir,
    lane,
    laneT: 1.5 + p.rng.float() * 3,
    weave: p.rng.float() * 2 * Math.PI,
    gait: glide(p),
    lag: 0.1 + 0.35 * p.rng.float(),
    heard: s.urge,
  })
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

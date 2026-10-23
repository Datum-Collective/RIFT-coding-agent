/**
 * The intro: the logo, which is on the screen already, rests a moment while the pond fades in
 * round it and the blue behind the letters fades away. Then each letter breaks into motes that
 * stream over to a koi, body, fins and tail. Where each mote lands, the koi grows out from under it
 * in the same colour while the mote melts into it, so the koi is built up from the letters' pieces,
 * and swims away.
 *
 * Adapted from koi-screensaver by Erik Johansson (MIT licence), whose wordmark is painted on to the
 * water first; here the logo is already there. See THIRD_PARTY_NOTICES.md.
 */
import { clamp, mix, type Rgb } from "./colour"
import { JOINTS, RADII, SEG, type Koi, type Pt } from "./koi"
import { inkMask, letters, shareOut } from "./letters"
import { isInk, type Logo } from "./logo"
import { smooth } from "./math"
import { Tag } from "./palette"
import type { Pond } from "./pond"
import type { KoiShape } from "./shape"

/**
 * The whole intro takes about six seconds. Each part is as short as it can be and still read: the
 * logo needs two seconds or so to be recognised, a mote needs about a second to be followed through
 * the air, and a koi needs a moment to close up before it is let go.
 */

/** Seconds the logo rests before it breaks up. */
export const INTRO_HOLD = 2.5

/** Seconds between one koi's letters letting go and the next's. */
const STAGGER = 0.18

/** Seconds the motes of one koi are spread over, from the first to leave to the last. */
const SPREAD = 0.65

/** Seconds a mote is in the air: at least this, and up to half as much again. */
const FLIGHT = 1.2
const FLIGHT_EXTRA = 0.5

/** Seconds a landed mote takes to melt into the koi. */
const MELT = 0.5

/** Seconds the koi takes to close up after the last mote. */
const CLOSE_UP = 0.6

/** Seconds a koi takes to get up to speed once it is let go, and a chase's pad to open out. */
export const RELEASE_EASE = 2.2

/** The blue backdrop fades out in the second half of the rest, so it is gone as the letters go. */
const BACKDROP_FROM = 0.9
const BACKDROP_FOR = 1.3

/** A logo pixel is a cell wide and half a cell tall: this many pond pixels across and down. */
const ACROSS = 2
const DOWN = 1

/** One pixel of a letter, on its way to a point on a koi. */
export type Mote = {
  /** Its place in the logo. */
  hx: number
  hy: number
  /** The koi it becomes part of. */
  k: number
  /** The joint it flows to, how far on towards the next one (0 to 1), and how far across the body there (-1 to 1). */
  n: number
  f: number
  u: number
  /** Or a fin instead: 1 and 2 the paddles, 3 the tail. */
  fin: number
  /** How far out along the fin, and across it. */
  ft: number
  fo: number
  /** The koi colour it turns into. */
  tag: number
  /** Its own colour in the logo. */
  color: Rgb
  start: number
  dur: number
  /** How far it swings out on the way, in path lengths. */
  curl: number
}

/** A pixel of the artwork behind the letters. */
export type Backdrop = { hx: number; hy: number; color: Rgb }

export type Intro = {
  t: number
  /** Half a logo pixel, across and down, in world units. */
  hw: number
  hh: number
  /** Where the logo's top left pixel is, in the pond's pixels. */
  origin: { x: number; y: number }
  motes: Mote[]
  backdrop: Backdrop[]
  /** When each koi starts to swim. */
  release: number[]
  /** Where each koi's letters were. */
  centre: Pt[]
  splashed: boolean[]
  count: number[]
  /** When each koi's first mote lands, and its last. */
  first: number[]
  last: number[]
  end: number
}

/** The colour of a koi at joint n, u of the way across its body. */
function tagAt(k: Koi, n: number, u: number) {
  if (k.pat.sheen && n >= 1 && n < 9 && Math.abs(u) < 0.3) return Tag.sheen
  const patch = k.pat.back[n]!
  if (patch !== Tag.water && Math.abs(u) < 0.62) return patch
  return k.pat.body
}

/** The point at joint n, u of the way across a koi drawn at `size`. */
function bodyPoint(k: Koi, n: number, f: number, u: number, size: number): Pt {
  const m = Math.min(JOINTS - 1, n + 1)
  const c = { x: k.j[n]!.x + (k.j[m]!.x - k.j[n]!.x) * f, y: k.j[n]!.y + (k.j[m]!.y - k.j[n]!.y) * f }
  const a = k.j[Math.max(0, n - 1)]!
  const b = k.j[Math.min(JOINTS - 1, n + 2)]!
  const dx = a.x - b.x
  const dy = a.y - b.y
  const d = Math.hypot(dx, dy)
  if (d === 0) return c
  const r = u * (RADII[n]! + (RADII[m]! - RADII[n]!) * f) * size * 0.85
  return { x: c.x - (dy / d) * r, y: c.y + (dx / d) * r }
}

/** Whether a logo with its top left corner in this cell lies wholly on the pond. */
export const logoFits = (p: Pond, logo: Logo, at: { col: number; row: number }) =>
  at.col >= 0 && at.row >= 0 && at.col + logo.cols <= p.cols && at.row + logo.rows <= p.rows

/**
 * Lays the logo's letters over a pond and hides each koi inside its letters, to be gathered up out
 * of them. Does nothing if the logo has no letters or does not fit on the pond.
 */
export function startIntro(p: Pond, logo: Logo, at: { col: number; row: number }) {
  if (!logoFits(p, logo, at)) return
  const mask = inkMask(logo)
  const ls = letters(mask, logo.w, logo.h)
  if (ls.length === 0) return

  const hw = ACROSS / 2
  const hh = (DOWN * p.aspect) / 2
  const origin = { x: at.col * 2, y: at.row * 2 }
  const home = (q: { x: number; y: number }): Pt => ({ x: origin.x + q.x * ACROSS + hw, y: (origin.y + q.y * DOWN) * p.aspect + hh })
  const colourOf = (q: { x: number; y: number }) => logo.pixels[q.y * logo.w + q.x]!

  const groups = shareOut(ls, p.koi.length)
  const n = groups.length
  const intro: Intro = {
    t: 0,
    hw,
    hh,
    origin,
    motes: [],
    backdrop: [],
    release: new Array<number>(n).fill(0),
    centre: Array.from({ length: n }, () => ({ x: 0, y: 0 })),
    splashed: new Array<boolean>(n).fill(false),
    count: new Array<number>(n).fill(0),
    first: new Array<number>(n).fill(0),
    last: new Array<number>(n).fill(0),
    end: 0,
  }

  // The artwork behind the letters: drawn as it is, then faded away.
  for (let y = 0; y < logo.h; y++) {
    for (let x = 0; x < logo.w; x++) {
      const colour = logo.pixels[y * logo.w + x]
      if (!colour || isInk(colour)) continue
      const h = home({ x, y })
      intro.backdrop.push({ hx: h.x, hy: h.y, color: colour })
    }
  }

  const cum: number[] = []
  let total = 0
  for (const r of RADII) {
    total += r
    cum.push(total)
  }

  groups.forEach((g, i) => {
    if (g.length === 0) return // a letter too small to share with every koi it was given
    const k = p.koi[i]!
    const c = { x: 0, y: 0 }
    for (const q of g) {
      const h = home(q)
      c.x += h.x
      c.y += h.y
    }
    c.x /= g.length
    c.y /= g.length
    intro.centre[i] = c

    // Lie along the letter, head up or down by turns, the middle of the body over the middle of
    // the letter.
    const heading = i % 2 === 1 ? Math.PI / 2 : -Math.PI / 2
    const dx = Math.cos(heading)
    const dy = Math.sin(heading)
    const gap = SEG * p.size
    for (let j = 0; j < JOINTS; j++) {
      const d = gap * (6 - j)
      k.j[j] = { x: c.x + dx * d, y: c.y + dy * d }
    }
    k.heading = heading
    k.wander = heading
    k.wanderT = 3 + p.rng.float() * 3
    k.burst = 0.6
    k.grow = 0
    k.ease = 0

    // Match the letter's pixels to points on the koi, front to front and side to side, so each
    // letter folds into its fish rather than scrambling.
    type Spot = { along: number; across: number; j: number; f: number; u: number; fin: number; ft: number; fo: number }
    const m = g.length
    const targets: Spot[] = []
    for (let t = 0; t < m; t++) {
      let r = p.rng.float() * total
      let j = 0
      while (cum[j]! < r) j++
      const u = p.rng.float() * 2 - 1
      const f = p.rng.float()
      let spot: Spot = { along: -j - f, across: u, j, f, u, fin: 0, ft: 0, fo: 0 }
      // About one in six goes to a fin or the tail, so the koi is built whole from the pieces.
      r = p.rng.float()
      if (r < 0.16) {
        const ft = p.rng.float()
        const fo = p.rng.float() * 2 - 1
        if (r < 0.065) spot = { along: -2.5 - ft, across: -1.3 - ft, j: 0, f: 0, u: 0, fin: 1, ft, fo }
        else if (r < 0.13) spot = { along: -2.5 - ft, across: 1.3 + ft, j: 0, f: 0, u: 0, fin: 2, ft, fo }
        else spot = { along: -12.5 - ft, across: fo * 0.5, j: 0, f: 0, u: 0, fin: 3, ft, fo }
      }
      targets.push(spot)
    }
    const sources = g.map((q, s) => {
      const h = home(q)
      const rx = h.x - c.x
      const ry = h.y - c.y
      return { along: rx * dx + ry * dy, across: -rx * dy + ry * dx, s }
    })
    const byAlong = (a: { along: number }, b: { along: number }) => b.along - a.along
    const byAcross = (a: { across: number }, b: { across: number }) => a.across - b.across
    targets.sort(byAlong)
    sources.sort(byAlong)
    const bands = Math.max(1, Math.trunc(Math.sqrt(m) / 2))
    let curl = 0.15 + 0.1 * p.rng.float()
    if (p.rng.int(2) === 0) curl = -curl
    const start = INTRO_HOLD + STAGGER * i
    intro.release[i] = start + 0.3
    for (let band = 0; band < bands; band++) {
      const lo = Math.trunc((band * m) / bands)
      const hi = Math.trunc(((band + 1) * m) / bands)
      const t = targets.slice(lo, hi).sort(byAcross)
      const s = sources.slice(lo, hi).sort(byAcross)
      for (let index = 0; index < t.length; index++) {
        const q = g[s[index]!.s]!
        const h = home(q)
        const target = t[index]!
        const tag = target.fin > 0 ? k.pat.body : tagAt(k, target.j, target.u)
        const mote: Mote = {
          hx: h.x,
          hy: h.y,
          k: i,
          n: target.j,
          f: target.f,
          u: target.u,
          fin: target.fin,
          ft: target.ft,
          fo: target.fo,
          tag,
          color: colourOf(q),
          start: start + (SPREAD * band) / bands + 0.3 * p.rng.float(),
          dur: FLIGHT + FLIGHT_EXTRA * p.rng.float(),
          curl: curl * (0.7 + 0.6 * p.rng.float()),
        }
        intro.end = Math.max(intro.end, mote.start + mote.dur)
        const land = mote.start + mote.dur
        if (intro.count[i] === 0 || land < intro.first[i]!) intro.first[i] = land
        intro.last[i] = Math.max(intro.last[i]!, land)
        intro.motes.push(mote)
        intro.count[i]!++
      }
    }
  })

  const chase = p.chase
  if (chase) {
    // The water is still while the logo rests: nothing is left from the seconds the pond was
    // settled in, which may have left swirls, ripples and a koi part way through a tail flick.
    chase.ripples = []
    chase.swirls = []
    for (const k of p.koi) k.flick = 0
  }
  if (chase && groups.length > 0 && intro.count[0]! > 0) {
    // The chase sets off from where the first koi's letters were, and waits for it; its pad opens
    // out as the letters lift off the water.
    chase.theta = Math.atan2(intro.centre[0]!.y - p.h / 2, intro.centre[0]!.x - p.w / 2)
    chase.started = false
    p.pads[0]!.r = 0
  }
  p.intro = intro
  p.rings.length = 0
}

/** Whether koi i has closed up over all its motes. */
export const built = (intro: Intro, i: number) => intro.count[i]! > 0 && intro.t >= intro.last[i]! + CLOSE_UP

/** Moves the intro on: koi are uncovered and let go, the water rings, and at the end the intro is over. */
export function stepIntro(p: Pond, dt: number) {
  const intro = p.intro!
  intro.t += dt
  p.koi.forEach((k, i) => {
    if (i >= intro.count.length || intro.count[i] === 0) {
      k.grow = 1
      k.ease = 1
      return
    }
    // Drawn whole from the first landing on, but only where motes have landed (see revealMask).
    k.grow = 0
    if (intro.t >= intro.first[i]!) k.grow = 1
    k.ease = smooth((intro.t - intro.release[i]!) / RELEASE_EASE)
    if (!intro.splashed[i] && intro.t >= intro.release[i]! - 0.3) {
      // The letter lifts off the water.
      intro.splashed[i] = true
      const c = intro.centre[i]!
      p.addRing(c.x, c.y, 2 * p.size, 6 * p.size, 0.7, 2.6, 1.0 * p.size)
    }
  })
  let done = intro.t >= intro.end && intro.t >= intro.release[intro.release.length - 1]! + RELEASE_EASE
  for (let i = 0; i < intro.count.length; i++) if (intro.count[i]! > 0 && !built(intro, i)) done = false
  if (done) {
    for (const k of p.koi) {
      k.grow = 1
      k.ease = 1
    }
    p.intro = undefined
  }
}

/** Where a mote lands on its koi now: a point on the body, or on a paddle fin or the tail, as the koi is drawn. */
export function landing(p: Pond, m: Mote): Pt {
  const k = p.koi[m.k]!
  if (m.fin === 0) return bodyPoint(k, m.n, m.f, m.u, p.size)
  const j = k.j
  const s = p.size
  if (m.fin === 3) {
    const last = j[JOINTS - 1]!
    const before = j[JOINTS - 2]!
    const a = Math.atan2(last.y - before.y, last.x - before.x)
    const d = (0.5 + 0.8 * m.ft) * s
    const o = m.fo * 0.55 * s
    return { x: last.x + Math.cos(a) * d - Math.sin(a) * o, y: last.y + Math.sin(a) * d + Math.cos(a) * o }
  }
  const side = m.fin === 2 ? 1 : -1
  const a = Math.atan2(j[0]!.y - j[2]!.y, j[0]!.x - j[2]!.x) + Math.PI + side * 1.25
  const d = (RADII[2]! + 0.6 + 2 * m.ft) * s
  const o = m.fo * (1.3 - 0.6 * m.ft) * s
  return { x: j[2]!.x + Math.cos(a) * d - Math.sin(a) * o, y: j[2]!.y + Math.sin(a) * d + Math.cos(a) * o }
}

/** Where a mote is now, its half size across and down, and how far along its way it is, 0 to 1. */
export function moteAt(p: Pond, m: Mote) {
  const intro = p.intro!
  const progress = clamp((intro.t - m.start) / m.dur, 0, 1)
  if (progress === 0) return { x: m.hx, y: m.hy, hw: intro.hw, hh: intro.hh, progress: 0 }
  const t = landing(p, m)
  const e = smooth(progress)
  const dx = t.x - m.hx
  const dy = t.y - m.hy
  const arc = Math.sin(Math.PI * e) * m.curl
  const s = 0.5 * p.size
  return {
    x: m.hx + dx * e - dy * arc,
    y: m.hy + dy * e + dx * arc,
    hw: intro.hw + (Math.max(s, 0.55) - intro.hw) * e,
    hh: intro.hh + (Math.max(s, 0.55 * p.aspect) - intro.hh) * e,
    progress,
  }
}

/**
 * Everything about how a mote looks now, worked out once: where it is, how big, its colour (its own
 * in the logo, turning into its koi's colour as it flies) and how opaque (fully, until it lands,
 * then it melts into the koi growing out from under it).
 */
export function moteLook(p: Pond, m: Mote) {
  const at = moteAt(p, m)
  if (at.progress === 0) return { x: at.x, y: at.y, hw: at.hw, hh: at.hh, colour: m.color, alpha: 1 }
  return {
    x: at.x,
    y: at.y,
    hw: at.hw,
    hh: at.hh,
    colour: mix(m.color, p.pal.tags[m.tag]!, smooth((at.progress - 0.15) / 0.6)),
    alpha: 1 - smooth((p.intro!.t - m.start - m.dur) / MELT),
  }
}

export const moteColour = (p: Pond, m: Mote): Rgb => moteLook(p, m).colour

export const moteAlpha = (p: Pond, m: Mote) => moteLook(p, m).alpha

/** How opaque the artwork behind the letters is: fully, then fading as the logo rests. */
export const backdropAlpha = (intro: Intro) => 1 - smooth((intro.t - BACKDROP_FROM) / BACKDROP_FOR)

/**
 * Marks the pixels of koi i's shape that its landed motes have uncovered: round each landing a
 * patch grows as the mote melts, and once the last has landed they all widen until the whole koi
 * shows. Undefined when it is built.
 */
export function revealMask(p: Pond, i: number, s: KoiShape): Uint8Array | undefined {
  const intro = p.intro
  if (!intro || i >= intro.count.length || intro.count[i] === 0 || built(intro, i)) return undefined
  const n = s.w * s.h
  if (s.mask.length < n) s.mask = new Uint8Array(n)
  const mask = s.mask
  mask.fill(0, 0, n)
  const closing = 6 * p.size * smooth((intro.t - intro.last[i]!) / CLOSE_UP)
  for (const m of intro.motes) {
    const land = m.start + m.dur
    if (m.k !== i || intro.t < land) continue
    const r = 2.3 * p.size * smooth((intro.t - land) / MELT) + closing
    const c = landing(p, m)
    const x0 = Math.max(s.x0, Math.trunc(c.x - r))
    const x1 = Math.min(s.x0 + s.w - 1, Math.trunc(c.x + r) + 1)
    const y0 = Math.max(s.y0, Math.trunc((c.y - r) / p.aspect))
    const y1 = Math.min(s.y0 + s.h - 1, Math.trunc((c.y + r) / p.aspect) + 1)
    const r2 = r * r
    for (let py = y0; py <= y1; py++) {
      const dy = (py + 0.5) * p.aspect - c.y
      const row = (py - s.y0) * s.w - s.x0
      for (let px = x0; px <= x1; px++) {
        const dx = px + 0.5 - c.x
        if (dx * dx + dy * dy <= r2) mask[row + px] = 1
      }
    }
  }
  return mask
}

/** Draws the logo's backdrop and the motes over the finished pond. */
export function drawIntro(p: Pond) {
  const intro = p.intro!
  const fade = backdropAlpha(intro)
  if (fade > 0) {
    for (const b of intro.backdrop) p.rect(b.hx, b.hy, intro.hw, intro.hh, (i) => p.composite(i, b.color, fade))
  }
  for (const m of intro.motes) {
    const look = moteLook(p, m)
    if (look.alpha <= 0) continue
    p.rect(look.x, look.y, look.hw, look.hh, (i) => p.composite(i, look.colour, look.alpha))
  }
}

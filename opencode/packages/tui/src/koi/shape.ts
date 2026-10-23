/**
 * A koi drawn smooth: the body runs joint to joint as one tapering outline, the fins and tail grow
 * out of it with soft joins, and the patches run together into soft blobs.
 *
 * Each part is worked out as a signed distance (below zero inside it) on a box of pixels just big
 * enough for the koi, and only near the part itself.
 *
 * Adapted from koi-screensaver by Erik Johansson (MIT licence). See THIRD_PARTY_NOTICES.md.
 */
import { clamp } from "./colour"
import { JOINTS, RADII, type Koi, type Pt } from "./koi"
import { Tag } from "./palette"

/** The pixel grid the pond is drawn on. A pixel is one unit wide and `aspect` units tall. */
export type Grid = { pw: number; ph: number; aspect: number; size: number }

export type KoiShape = {
  /** The box of pixels it covers. */
  x0: number
  y0: number
  w: number
  h: number
  /** Distance to the whole silhouette, below zero inside it. */
  sil: Floats
  patch: Floats
  sheen: Floats
  hasSheen: boolean
  patchTag: number
  eyes: [Pt, Pt]
  /** 0 while the koi is too small for eyes. */
  eyeR: number
  /** The spine as swayed this frame. */
  joints: Pt[]
}

const FAR = 1e9

type Floats = Float32Array<ArrayBuffer>

/** Joins two distances with a soft fillet `k` wide. */
export function smin(a: number, b: number, k: number) {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1)
  return b * (1 - h) + a * h - k * h * (1 - h)
}

type Disc = { x: number; y: number; r: number }

function blank(): KoiShape {
  return {
    x0: 0,
    y0: 0,
    w: 0,
    h: 0,
    sil: new Float32Array(0),
    patch: new Float32Array(0),
    sheen: new Float32Array(0),
    hasSheen: false,
    patchTag: Tag.water,
    eyes: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
    eyeR: 0,
    joints: Array.from({ length: JOINTS }, () => ({ x: 0, y: 0 })),
  }
}

/** A buffer with room for `n`, every cell set to "far from everything". */
function cleared(buffer: Floats, n: number): Floats {
  const out = buffer.length >= n ? buffer : new Float32Array(n)
  out.fill(FAR, 0, n)
  return out
}

let fins: Floats = new Float32Array(0)

/** Works out koi `k` as drawn this frame, swaying with its stroke. Reuses the koi's own buffers. */
export function shapeKoi(grid: Grid, k: Koi): KoiShape {
  const s = (k.shape ??= blank())
  const sz = grid.size * k.grow
  const j = s.joints
  for (let i = 0; i < JOINTS; i++) {
    j[i]!.x = k.j[i]!.x
    j[i]!.y = k.j[i]!.y
  }
  for (let i = 4; i < JOINTS; i++) {
    const a = k.j[i - 1]!
    const b = k.j[i]!
    const dx = a.x - b.x
    const dy = a.y - b.y
    const d = Math.hypot(dx, dy)
    if (d > 0) {
      const f = (i - 3) / (JOINTS - 4)
      const off = Math.sin(k.phase - f * 2.5) * f * f * k.stroke * 1.8 * sz
      j[i]!.x -= (dy / d) * off
      j[i]!.y += (dx / d) * off
    }
  }

  // The parts: paddle fins behind the head (three discs each), small fins further back, and the
  // round tail.
  const paddles: Disc[][] = [[], []]
  const head = Math.atan2(j[0]!.y - j[2]!.y, j[0]!.x - j[2]!.x)
  const flap = Math.sin(k.phase * 0.5) * 0.25
  ;[-1, 1].forEach((side, sideIndex) => {
    const a = head + Math.PI + side * (1.25 + flap)
    for (let t = 0; t < 3; t++) {
      const off = (RADII[2]! + 0.6 + t) * sz
      paddles[sideIndex]!.push({ x: j[2]!.x + Math.cos(a) * off, y: j[2]!.y + Math.sin(a) * off, r: (1.5 - t * 0.35) * sz })
    }
  })
  const small: Disc[] = []
  const back = Math.atan2(j[7]!.y - j[6]!.y, j[7]!.x - j[6]!.x)
  for (const side of [-1, 1]) {
    const a = back + side * 1.9
    small.push({ x: j[7]!.x + Math.cos(a) * 1.6 * sz, y: j[7]!.y + Math.sin(a) * 1.6 * sz, r: 0.8 * sz })
  }
  const last = j[JOINTS - 1]!
  const before = j[JOINTS - 2]!
  const ta = Math.atan2(last.y - before.y, last.x - before.x) + Math.sin(k.phase - 2) * 0.6 * k.stroke
  const tail: Disc[] = [
    { x: last.x + Math.cos(ta) * 1.2 * sz, y: last.y + Math.sin(ta) * 1.2 * sz, r: 0.75 * sz },
    { x: last.x + Math.cos(ta) * 0.6 * sz, y: last.y + Math.sin(ta) * 0.6 * sz, r: 0.65 * sz },
  ]

  // Just the pixels the parts can reach.
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const reach = (c: Disc) => {
    x0 = Math.min(x0, c.x - c.r)
    y0 = Math.min(y0, c.y - c.r)
    x1 = Math.max(x1, c.x + c.r)
    y1 = Math.max(y1, c.y + c.r)
  }
  j.forEach((q, i) => reach({ x: q.x, y: q.y, r: RADII[i]! * sz }))
  for (let side = 0; side < 2; side++) {
    for (const disc of paddles[side]!) reach(disc)
    reach(small[side]!)
    reach(tail[side]!)
  }
  s.x0 = Math.max(0, Math.floor(x0 - 2))
  s.y0 = Math.max(0, Math.floor((y0 - 2) / grid.aspect))
  s.w = Math.min(grid.pw, Math.ceil(x1 + 2)) - s.x0
  s.h = Math.min(grid.ph, Math.ceil((y1 + 2) / grid.aspect)) - s.y0
  if (s.w <= 0 || s.h <= 0) {
    s.w = 0
    s.h = 0
    s.eyeR = 0
    s.hasSheen = false
    return s
  }
  const n = s.w * s.h
  s.sil = cleared(s.sil, n)
  fins = cleared(fins, n)

  // The body, nose to tail, straight into the silhouette.
  disc(grid, s, s.sil, { x: j[0]!.x, y: j[0]!.y, r: RADII[0]! * sz }, 0)
  for (let i = 0; i < JOINTS - 1; i++) segment(grid, s, s.sil, j[i]!, j[i + 1]!, RADII[i]! * sz, RADII[i + 1]! * sz)
  // The fins and tail, each run together from its discs.
  for (let side = 0; side < 2; side++) {
    for (const part of paddles[side]!) disc(grid, s, fins, part, 0.5 * sz)
    disc(grid, s, fins, small[side]!, 0.3 * sz)
    disc(grid, s, fins, tail[side]!, 0.3 * sz)
  }
  // ... and grown out of the body with a soft join, where they meet it.
  const join = 0.35 * sz
  for (let i = 0; i < n; i++) {
    const body = s.sil[i]!
    const fin = fins[i]!
    if (fin < body + join) s.sil[i] = smin(body, fin, join)
  }

  // Patches over chosen joints, running together where they meet.
  s.patchTag = Tag.water
  s.patch = cleared(s.patch, n)
  for (let i = JOINTS - 1; i >= 0; i--) {
    const tag = k.pat.back[i]!
    if (tag === Tag.water) continue
    s.patchTag = tag
    disc(grid, s, s.patch, { x: j[i]!.x, y: j[i]!.y, r: RADII[i]! * sz * 0.62 }, 1.0 * sz)
  }
  s.hasSheen = Boolean(k.pat.sheen)
  if (s.hasSheen) {
    // A thin stripe of light along the spine, head to the start of the tail, narrowing as the body
    // does.
    s.sheen = cleared(s.sheen, n)
    for (let i = 1; i < 9; i++) segment(grid, s, s.sheen, j[i]!, j[i + 1]!, RADII[i]! * sz * 0.3, RADII[i + 1]! * sz * 0.3)
  }
  s.eyeR = 0
  if (k.grow >= 0.6) {
    const r = RADII[0]! * sz * 0.72
    s.eyeR = Math.max(0.55, 0.3 * sz)
    ;[-1, 1].forEach((side, e) => {
      const a = head + side * 1.1
      s.eyes[e]!.x = j[0]!.x + Math.cos(a) * r
      s.eyes[e]!.y = j[0]!.y + Math.sin(a) * r
    })
  }
  return s
}

/** Runs a disc into `buf`, with a soft join `k` wide (0 for none). */
function disc(grid: Grid, s: KoiShape, buf: Floats, c: Disc, k: number) {
  const e = c.r + k + 1
  const px0 = Math.max(s.x0, Math.floor(c.x - e))
  const px1 = Math.min(s.x0 + s.w - 1, Math.ceil(c.x + e))
  const py0 = Math.max(s.y0, Math.floor((c.y - e) / grid.aspect))
  const py1 = Math.min(s.y0 + s.h - 1, Math.ceil((c.y + e) / grid.aspect))
  for (let py = py0; py <= py1; py++) {
    const dy = (py + 0.5) * grid.aspect - c.y
    const row = (py - s.y0) * s.w - s.x0
    for (let px = px0; px <= px1; px++) {
      const dx = px + 0.5 - c.x
      const d = Math.sqrt(dx * dx + dy * dy) - c.r
      const i = row + px
      if (k > 0) {
        if (d < buf[i]! + k) buf[i] = smin(buf[i]!, d, k)
      } else if (d < buf[i]!) {
        buf[i] = d
      }
    }
  }
}

/** Runs a stretch of spine into `buf`, `ra` wide at `a` tapering to `rb` at `b`. */
function segment(grid: Grid, s: KoiShape, buf: Floats, a: Pt, b: Pt, ra: number, rb: number) {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const l2 = vx * vx + vy * vy
  const inv = l2 > 0 ? 1 / l2 : 0
  const r = Math.max(ra, rb) + 1
  const px0 = Math.max(s.x0, Math.floor(Math.min(a.x, b.x) - r))
  const px1 = Math.min(s.x0 + s.w - 1, Math.ceil(Math.max(a.x, b.x) + r))
  const py0 = Math.max(s.y0, Math.floor((Math.min(a.y, b.y) - r) / grid.aspect))
  const py1 = Math.min(s.y0 + s.h - 1, Math.ceil((Math.max(a.y, b.y) + r) / grid.aspect))
  for (let py = py0; py <= py1; py++) {
    const ay = (py + 0.5) * grid.aspect - a.y
    const row = (py - s.y0) * s.w - s.x0
    for (let px = px0; px <= px1; px++) {
      const ax = px + 0.5 - a.x
      const t = clamp((ax * vx + ay * vy) * inv, 0, 1)
      const ex = ax - t * vx
      const ey = ay - t * vy
      const d = Math.sqrt(ex * ex + ey * ey) - (ra + t * (rb - ra))
      const i = row + px
      if (d < buf[i]!) buf[i] = d
    }
  }
}

// Sky pieces shared by outdoor wallpapers: a depth-graded sky with a sun or moon, stars and drifting clouds.
import { TAU, clamp, fbm1, fbm2, lerp, rand, smoothstep, type RGB } from "./math"
import { addOrb, onOrb } from "./orbs"
import type { Points } from "./points"
import { touch } from "./touched"

// The sun or moon: x as a fraction of the width, y and r as fractions of the height.
export interface Orb {
  x: number
  y: number
  r: number
  core: RGB
  glow: RGB
  near: number
  wide: number
  moon?: boolean
}

// Stars come in a few colors rather than plain white, so they read apart from light text.
export const STAR_TINTS: RGB[] = [
  [0.55, 0.75, 1.2],
  [1.15, 0.85, 0.45],
  [1.1, 0.6, 0.85],
  [0.7, 0.6, 1.2],
]

export interface Star {
  x: number
  y: number
  b: number
  phase: number
  tint: RGB
}

// Fills the whole canvas with a vertical gradient through stops ([height fraction, color]), adds a glow around the orb
// and draws the orb itself. px is Canvas.px, for the moon's texture.
export function paintSky(hdr: Float32Array, W: number, H: number, stops: [number, RGB][], orb: Orb, px = 1) {
  const ox = orb.x * W
  const oy = orb.y * H
  const R = orb.r * H
  addOrb(hdr, ox, oy, R)
  for (let y = 0; y < H; y++) {
    const v = y / H
    const i = stops.findIndex(([at]) => at >= v)
    const [a, from] = stops[Math.max(0, i - 1)]
    const [b, to] = stops[i < 0 ? stops.length - 1 : i]
    const k = b > a ? smoothstep(a, b, v) : 1
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - ox, y - oy) / H
      const glow = orb.near * Math.exp(-d / (orb.r * 1.8)) + orb.wide * Math.exp(-d / 0.35)
      const o = (y * W + x) * 3
      hdr[o] = lerp(from[0], to[0], k) + glow * orb.glow[0]
      hdr[o + 1] = lerp(from[1], to[1], k) + glow * orb.glow[1]
      hdr[o + 2] = lerp(from[2], to[2], k) + glow * orb.glow[2]
      const r = d * H
      const cov = Math.min(1, Math.max(0, R - r + 0.5))
      if (cov <= 0) continue
      const limb = 0.85 + 0.15 * Math.sqrt(Math.max(0, 1 - (r / R) ** 2))
      const maria = orb.moon ? 1 - 0.18 * smoothstep(0.55, 0.75, fbm1(((x - ox) / px) * 0.25 + 3, 7) + fbm1(((y - oy) / px) * 0.25 + 1, 9) * 0.6) : 1
      const m = limb * maria
      hdr[o] += (orb.core[0] * m - hdr[o]) * cov
      hdr[o + 1] += (orb.core[1] * m - hdr[o + 1]) * cov
      hdr[o + 2] += (orb.core[2] * m - hdr[o + 2]) * cov
    }
  }
}

export function makeStars(count: number, top: number): Star[] {
  return Array.from({ length: count }, () => ({ x: Math.random(), y: Math.random() * top, b: 0.4 + Math.random() * 0.6, phase: Math.random() * TAU, tint: STAR_TINTS[Math.floor(Math.random() * STAR_TINTS.length)] }))
}

// Stars twinkling slowly, fading toward the horizon at `top`. Given a canvas's points, they go there, so terminal
// cells show them as round dots, the brightest a little larger.
export function paintStars(hdr: Float32Array, W: number, H: number, stars: Star[], time: number, top: number, brightness: number, points?: Points) {
  for (const s of stars) {
    const x = (s.x * W) | 0
    const y = (s.y * H) | 0
    if (x < 0 || y < 0 || x >= W || y >= H || onOrb(hdr, x + 0.5, y + 0.5, 1.5)) continue
    const k = s.b * Math.max(0, 1 - s.y / top) * (0.7 + 0.3 * Math.sin(time * 0.8 + s.phase)) * brightness
    if (points) {
      points.add(hdr, W, H, x, y, k * s.tint[0], k * s.tint[1], k * s.tint[2], s.b > 0.9 ? 3 : s.b > 0.65 ? 2 : 1)
      continue
    }
    const o = (y * W + x) * 3
    hdr[o] += k * s.tint[0]
    hdr[o + 1] += k * s.tint[1]
    hdr[o + 2] += k * s.tint[2]
    touch(hdr, x, y, x, y)
  }
}

// Puffs heaped into rounded cumulus with flat bases, taller towering cumulus that stand on y, high cirrus streaks with
// hooked ends, soft wisps, low stratus layers, and billowing volcanic ash.
export type CloudKind = "cumulus" | "towering" | "cirrus" | "wisp" | "stratus" | "ash"

export interface Cloud {
  x: number
  y: number
  speed: number
  kind: CloudKind | "shadow"
  // Half the width in screen heights, so the cloud wraps around only once it is off screen.
  w: number
  // Puffs (x, y, radius r) or strands (x, y, half-length r, half-thickness s, tilt t) relative to the cloud's position,
  // in screen heights, and the flat base puffs are cut off at.
  parts: { x: number; y: number; r: number; s: number; t: number }[]
  base: number
  seed: number
  sprite?: Sprite
}

// A cloud's shape, built once per screen size: opacity, surface normal, thickness (0 at the edge, 1 deep inside) and
// how much its edge glows when backlit, per pixel. (x0, y0) is its top-left pixel relative to the cloud's position and
// cy its middle in screen heights.
interface Sprite {
  H: number
  w: number
  h: number
  x0: number
  y0: number
  cy: number
  thin: number
  a: Float32Array
  nx: Float32Array
  ny: Float32Array
  nz: Float32Array
  d: Float32Array
  e: Float32Array
}

// Opacity ramps over edge (field values) up to alpha; thin clouds are lit nearly flat; size is the rough half-width.
const KINDS: Record<Cloud["kind"], { size: [number, number]; speed: [number, number]; edge: [number, number]; alpha: number; thin: number }> = {
  cumulus: { size: [0.08, 0.13], speed: [0.003, 0.007], edge: [0.02, 0.28], alpha: 1, thin: 0 },
  towering: { size: [0.09, 0.14], speed: [0, 0], edge: [0.02, 0.28], alpha: 0.85, thin: 0 },
  ash: { size: [0.1, 0.16], speed: [0.004, 0.007], edge: [0, 0.6], alpha: 0.8, thin: 0 },
  cirrus: { size: [0.14, 0.24], speed: [0.005, 0.009], edge: [0.05, 0.8], alpha: 0.9, thin: 0.7 },
  wisp: { size: [0.12, 0.2], speed: [0.003, 0.006], edge: [0.04, 0.85], alpha: 0.75, thin: 0.6 },
  stratus: { size: [0.25, 0.45], speed: [0.002, 0.004], edge: [0.12, 0.75], alpha: 0.75, thin: 0.5 },
  shadow: { size: [0.2, 0.45], speed: [0.004, 0.01], edge: [0, 0.8], alpha: 1, thin: 0 },
}

export function makeClouds(count: number, kind: CloudKind, y0: number, y1: number): Cloud[] {
  return Array.from({ length: count }, (_, i) => {
    const size = rand(KINDS[kind].size[0], KINDS[kind].size[1])
    const [parts, base] = shapeParts(kind, size)
    return { x: ((i + Math.random() * 0.8) / count) * 2, y: y0 + Math.random() * (y1 - y0), speed: rand(KINDS[kind].speed[0], KINDS[kind].speed[1]), kind, w: halfWidth(parts), parts, base, seed: Math.random() * 100 }
  })
}

// Soft shadows of clouds drifting across the ground between y0 and y1, flatter toward the horizon and bigger and
// faster nearer.
export function makeShadows(count: number, y0: number, y1: number): Cloud[] {
  return Array.from({ length: count }, (_, i) => {
    const near = (i + Math.random()) / count
    const w = lerp(KINDS.shadow.size[0], KINDS.shadow.size[1], near)
    const parts = [{ x: 0, y: 0, r: w, s: w * (0.12 + 0.12 * near), t: 0 }]
    return { x: Math.random() * 2, y: lerp(y0, y1, near), speed: lerp(KINDS.shadow.speed[0], KINDS.shadow.speed[1], near), kind: "shadow" as const, w, parts, base: Infinity, seed: Math.random() * 100 }
  })
}

export function driftClouds(clouds: Cloud[], A: number, dt: number) {
  for (const c of clouds) {
    c.x += c.speed * dt
    if (c.x > A + c.w) c.x = -c.w
  }
}

// Low, heavy clouds that gather after the agent fails: darker versions of the scene's own cloud colors, faded in by
// gloom (0 to 1). They drift like the others, so the caller moves them with driftClouds.
export function makeStorm(): Cloud[] {
  return makeClouds(8, "cumulus", 0.04, 0.26)
}

export function paintStorm(hdr: Float32Array, W: number, H: number, clouds: Cloud[], top: RGB, bottom: RGB, gloom: number) {
  if (gloom <= 0) return
  paintClouds(hdr, W, H, clouds, [top[0] * 0.45, top[1] * 0.45, top[2] * 0.5], [bottom[0] * 0.4, bottom[1] * 0.4, bottom[2] * 0.45], smoothstep(0, 1, gloom) * 0.8)
}

// Clouds lit by the sun or moon: the brighter of top and bottom is the side facing the light, the darker the side away
// from it. Near the orb they are backlit, with darker cores and glowing edges (gold near the moon, the clouds' own tint
// elsewhere at night). Without an orb, under an overcast deck, they are lit evenly from above.
export function paintClouds(hdr: Float32Array, W: number, H: number, clouds: Cloud[], top: RGB, bottom: RGB, alpha: number, orb?: Orb) {
  const [lit, shade] = luma(top) >= luma(bottom) ? [top, bottom] : [bottom, top]
  const low = !!orb && !orb.moon && orb.y > 0.3
  // How much light comes from the open sky above rather than from the orb, and how much every edge facing it glows.
  const sky = !orb ? 1 : orb.moon ? 0.25 : low ? 0 : 0.35
  const edge = !orb ? 0 : orb.moon ? 0.6 : low ? 0.3 : 0.15
  const k = !orb ? 0 : orb.moon ? 1.6 : low ? 1.4 : 0.6
  for (const c of clouds) {
    const s = spriteFor(c, H)
    const dx = orb ? orb.x * (W / H) - c.x : 0
    const dy = orb ? orb.y - c.y - s.cy : -1
    const dist = Math.hypot(dx, dy) || 1
    const back = orb ? Math.exp(-dist / 0.3) : 0
    const glow = orb?.glow ?? lit
    const m = orb?.moon ? back : 1
    const rim: RGB = [lerp(lit[0] * 2.5, glow[0] * k, m), lerp(lit[1] * 2.5, glow[1] * k, m), lerp(lit[2] * 2.5, glow[2] * k, m)]
    drawCloud(hdr, W, H, s, c.x * H, c.y * H, lit, shade, rim, dx / dist, dy / dist, back, edge, sky, alpha)
  }
}

// Darkens the ground under each shadow, below ground (a fraction of the height), and only under a high sun: pass no orb
// under an overcast deck.
export function paintShadows(hdr: Float32Array, W: number, H: number, shadows: Cloud[], ground: number, orb?: Orb) {
  if (!orb || orb.moon || orb.y > 0.3) return
  for (const c of shadows) drawShadow(hdr, W, H, spriteFor(c, H), c.x * H, c.y * H, ground * H)
}

// A static band of haze between y0 and y1, thickest low down, in long soft streaks; paint it into the background.
export function paintHaze(hdr: Float32Array, W: number, H: number, y0: number, y1: number, color: RGB, alpha: number) {
  for (let y = Math.max(0, Math.floor(y0 * H)); y < Math.min(H, Math.ceil(y1 * H)); y++) {
    const v = (y / H - y0) / (y1 - y0)
    const band = smoothstep(0, 1, v) * (1 - smoothstep(0.92, 1, v) * 0.5) * alpha
    for (let x = 0; x < W; x++) {
      const a = Math.min(1, band * (0.55 + 0.9 * fbm2((x / H) * 2.5, (y / H) * 18, 3)))
      const o = (y * W + x) * 3
      hdr[o] += (color[0] - hdr[o]) * a
      hdr[o + 1] += (color[1] - hdr[o + 1]) * a
      hdr[o + 2] += (color[2] - hdr[o + 2]) * a
    }
  }
}

function luma(c: RGB) {
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722
}

function shapeParts(kind: CloudKind, size: number): [Cloud["parts"], number] {
  const part = (x: number, y: number, r: number, s = 0, t = 0) => ({ x, y, r, s, t })
  if (kind === "cumulus") {
    // A row of puffs, biggest in the middle, heaped higher on top and cut off flat along the base.
    const h = size * rand(0.6, 0.8)
    const n = 5 + Math.floor(Math.random() * 3)
    const row = Array.from({ length: n }, (_, i) => {
      const f = (i / (n - 1)) * 2 - 1
      const r = h * (0.6 - 0.3 * Math.abs(f)) * rand(0.7, 1.2)
      return part(f * size * 0.7 + rand(-0.06, 0.06) * size, h * 0.35 - r * rand(0.5, 0.95), r)
    })
    const heap = Array.from({ length: 2 + Math.floor(Math.random() * 2) }, () => part(rand(-0.4, 0.4) * size, -h * rand(0.35, 0.55), h * rand(0.3, 0.42)))
    return [[...row, ...heap], h * 0.35]
  }
  if (kind === "towering") {
    // A broad foot on the horizon under a leaning column of puffs that narrows as it climbs.
    const h = size * rand(1.4, 1.9)
    const lean = rand(-0.25, 0.25) * size
    const foot = Array.from({ length: 5 }, (_, i) => part(((i / 4) * 2 - 1) * size * 0.72 + rand(-0.05, 0.05) * size, -size * rand(0.1, 0.2), size * rand(0.26, 0.36)))
    const column = Array.from({ length: 9 }, (_, i) => {
      const f = (i + 1) / 9
      const r = size * (0.5 - 0.22 * f) * rand(0.8, 1.1)
      return part(lean * f + rand(-0.3, 0.3) * size * (1 - 0.5 * f), -h * f * 0.75, r)
    })
    return [[...foot, ...column], 0]
  }
  // Ash spreads out downwind in a long, low smear of small billows.
  if (kind === "ash") return [Array.from({ length: 11 }, () => part(rand(-0.8, 0.8) * size, rand(-0.12, 0.12) * size, size * rand(0.16, 0.3))), Infinity]
  if (kind === "cirrus") return [Array.from({ length: 3 + Math.floor(Math.random() * 2) }, () => part(rand(-0.35, 0.35) * size, rand(-0.03, 0.03), size * rand(0.45, 0.7), rand(0.007, 0.012), rand(-0.1, 0.02))), Infinity]
  if (kind === "wisp") return [Array.from({ length: 2 + Math.floor(Math.random() * 2) }, () => part(rand(-0.3, 0.3) * size, rand(-0.012, 0.012), size * rand(0.55, 0.85), rand(0.007, 0.012), rand(-0.05, 0.05))), Infinity]
  return [Array.from({ length: 3 }, () => part(rand(-0.25, 0.25) * size, rand(-0.01, 0.01), size * rand(0.65, 0.9), rand(0.013, 0.022))), Infinity]
}

function halfWidth(parts: Cloud["parts"]) {
  return parts.reduce((m, p) => Math.max(m, Math.abs(p.x) + p.r * 1.12), 0)
}

function spriteFor(c: Cloud, H: number) {
  if (c.sprite?.H !== H) c.sprite = buildSprite(c, H)
  return c.sprite
}

function buildSprite(c: Cloud, H: number): Sprite {
  const kind = KINDS[c.kind]
  const puffy = c.kind === "cumulus" || c.kind === "towering" || c.kind === "ash"
  // Noise can push a puff's edge out a little past its radius.
  const grow = puffy ? 1.12 : 1
  const x0 = Math.floor((-c.w - 0.01) * H)
  const top = c.parts.reduce((m, p) => Math.min(m, p.y - (puffy ? p.r * grow : p.s * 4 + Math.abs(p.t) * p.r + (c.kind === "cirrus" ? 0.02 : 0))), 0)
  const bottom = c.parts.reduce((m, p) => Math.max(m, Math.min(c.base, p.y + (puffy ? p.r * grow : p.s * 4 + Math.abs(p.t) * p.r))), 0)
  const y0 = Math.floor(top * H) - 1
  const w = Math.ceil((c.w + 0.01) * H) - x0
  const h = Math.ceil(bottom * H) + 1 - y0
  const n = w * h
  const field = new Float32Array(n)
  const a = new Float32Array(n)
  const d = new Float32Array(n)
  const [lo, hi] = kind.edge
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const u = (x0 + i + 0.5) / H
      const v = (y0 + j + 0.5) / H
      const f = shapeAt(c, u, v, puffy)
      const k = j * w + i
      field[k] = f
      a[k] = smoothstep(lo, hi, f) * kind.alpha
      d[k] = smoothstep(lo, 1, f)
    }
  // Normals from the blurred field, so each puff reads as a dome.
  const r = Math.max(1, Math.round(H * 0.01))
  const blurred = boxBlur(boxBlur(field, w, h, r, 1, 0), w, h, r, 0, 1)
  const nx = new Float32Array(n)
  const ny = new Float32Array(n)
  const nz = new Float32Array(n)
  const e = new Float32Array(n)
  const scale = H * 0.02
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const k = j * w + i
      const gx = -(blurred[j * w + Math.min(w - 1, i + 1)] - blurred[j * w + Math.max(0, i - 1)]) * scale
      const gy = -(blurred[Math.min(h - 1, j + 1) * w + i] - blurred[Math.max(0, j - 1) * w + i]) * scale
      const l = Math.hypot(gx, gy, 1)
      nx[k] = gx / l
      ny[k] = gy / l
      nz[k] = 1 / l
      e[k] = (1 - d[k]) ** 2 * Math.sqrt(a[k])
    }
  return { H, w, h, x0, y0, cy: (y0 + h / 2) / H, thin: kind.thin, a, nx, ny, nz, d, e }
}

// The cloud's density at (u, v) relative to its position: the strongest puff or strand, broken up by noise at about the
// size of a character cell so edges fray softly instead of tracing ellipses.
function shapeAt(c: Cloud, u: number, v: number, puffy: boolean) {
  let f = -1
  for (const p of c.parts) {
    if (puffy) {
      f = Math.max(f, 1 - ((u - p.x) ** 2 + (v - p.y) ** 2) / (p.r * p.r))
      continue
    }
    const along = (u - p.x) / p.r
    if (along <= -1 || along >= 1) continue
    // Cirrus curl up at the downwind end into hooks and fan out toward the other; stratus swell and thin along their
    // length, with ragged ends.
    const cirrus = c.kind === "cirrus"
    const dv = v - p.y - p.t * (u - p.x) + (cirrus ? 0.02 * Math.max(0, along) ** 3 : 0)
    const s = p.s * (cirrus ? 1.3 - 0.6 * along : 0.5 + 1.1 * fbm1(u * 6 + p.x * 50, 3))
    const ends = 1 - along * along + (c.kind === "stratus" ? (fbm1(v * 60 + p.y * 90, 2) - 0.45) * 0.8 : 0)
    f = Math.max(f, ends * Math.exp(-((dv / s) ** 2)))
  }
  const seed = c.seed
  // Fraying only near the edge keeps the insides solid.
  const fray = (fbm2(u * 28 + seed, v * 28 + seed * 0.7, 3) - 0.44) * 2.4 * (1 - clamp(f, 0, 1))
  const base = c.base + (fbm1(u * 40 + seed, 3) - 0.5) * 0.008
  if (c.kind === "cumulus") return (f + fray) * smoothstep(base + 0.004, base - 0.01, v)
  if (c.kind === "towering") return (f + fray * 0.8) * smoothstep(0.002, -0.008, v)
  if (c.kind === "ash") return f + fray * 1.2
  // Fibers run along cirrus and wisps.
  if (c.kind === "cirrus") return f * clamp((fbm2(u * 5 + seed, v * 70, 3) - 0.25) * 2.6, 0, 1.3)
  if (c.kind === "wisp") return f * (0.55 + 0.9 * fbm2(u * 5 + seed, v * 45, 3))
  if (c.kind === "stratus") return f + fray * smoothstep(0, 0.2, f)
  return f * (0.6 + 0.8 * fbm2(u * 6 + seed, v * 18, 2))
}

// A box blur of radius r along (dx, dy): (1, 0) for rows, (0, 1) for columns.
function boxBlur(src: Float32Array, w: number, h: number, r: number, dx: number, dy: number) {
  const out = new Float32Array(src.length)
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      let sum = 0
      for (let t = -r; t <= r; t++) sum += src[clamp(j + t * dy, 0, h - 1) * w + clamp(i + t * dx, 0, w - 1)]
      out[j * w + i] = sum / (2 * r + 1)
    }
  return out
}

// One cloud's sprite at (x, y) in pixels, sliding smoothly between pixel columns. lx, ly point toward the orb; back is
// how far the cloud is backlit by it and edge how much every edge facing it glows anyway.
function drawCloud(hdr: Float32Array, W: number, H: number, s: Sprite, x: number, y: number, lit: RGB, shade: RGB, rim: RGB, lx: number, ly: number, back: number, edge: number, sky: number, alpha: number) {
  const l = Math.hypot(lx, ly, 0.4)
  const Lx = lx / l
  const Ly = ly / l
  const Lz = 0.4 / l
  const px = x + s.x0
  const X0 = Math.floor(px)
  const f = px - X0
  const Y0 = Math.round(y) + s.y0
  const sw = s.w
  touch(hdr, X0, Y0, X0 + sw, Y0 + s.h - 1)
  for (let j = Math.max(0, -Y0); j < Math.min(s.h, H - Y0); j++)
    for (let i = Math.max(0, -X0); i <= Math.min(sw, W - 1 - X0); i++) {
      const k = j * sw + i
      const a = ((i < sw ? s.a[k] : 0) * (1 - f) + (i > 0 ? s.a[k - 1] : 0) * f) * alpha
      if (a < 0.003) continue
      const q = i < sw ? k : k - 1
      const nx = s.nx[q]
      const ny = s.ny[q]
      const light = (Math.max(0, nx * Lx + ny * Ly + s.nz[q] * Lz) * (1 - sky) + (0.5 - 0.5 * ny) * sky) * (1 - 0.5 * back * s.d[q])
      const t = light + (1 - light) * s.thin
      const g = (back + edge) * s.e[q] * Math.max(0, nx * lx + ny * ly) * alpha
      const o = ((Y0 + j) * W + X0 + i) * 3
      hdr[o] += (shade[0] + (lit[0] - shade[0]) * t - hdr[o]) * a + rim[0] * g
      hdr[o + 1] += (shade[1] + (lit[1] - shade[1]) * t - hdr[o + 1]) * a + rim[1] * g
      hdr[o + 2] += (shade[2] + (lit[2] - shade[2]) * t - hdr[o + 2]) * a + rim[2] * g
    }
}

function drawShadow(hdr: Float32Array, W: number, H: number, s: Sprite, x: number, y: number, ground: number) {
  const px = x + s.x0
  const X0 = Math.floor(px)
  const f = px - X0
  const Y0 = Math.round(y) + s.y0
  const sw = s.w
  const fade = H * 0.03
  touch(hdr, X0, Math.max(Y0, Math.floor(ground)), X0 + sw, Y0 + s.h - 1)
  for (let j = Math.max(0, -Y0, Math.floor(ground) - Y0); j < Math.min(s.h, H - Y0); j++) {
    const row = clamp((Y0 + j - ground) / fade, 0, 1) * 0.38
    for (let i = Math.max(0, -X0); i <= Math.min(sw, W - 1 - X0); i++) {
      const k = j * sw + i
      const a = ((i < sw ? s.a[k] : 0) * (1 - f) + (i > 0 ? s.a[k - 1] : 0) * f) * row
      if (a < 0.003) continue
      // Shade is lit by the blue sky, so it darkens reds most.
      const o = ((Y0 + j) * W + X0 + i) * 3
      hdr[o] *= 1 - a
      hdr[o + 1] *= 1 - a * 0.88
      hdr[o + 2] *= 1 - a * 0.62
    }
  }
}

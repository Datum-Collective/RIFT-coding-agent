import type { AgentEvent, TextMap } from "./wallpaper"
import { clamp, rand, smoothstep, type RGB } from "./math"
import { Points, splat } from "./points"
import { trackOrbs } from "./orbs"
import { clearShadows, keepShadows } from "./shadow"
import { addBox, trackTouched } from "./touched"

// Bloom is computed at 1/BLOOM resolution, then again at half that for the wide halo.
const BLOOM = 4
const BLOOM_THRESHOLD = 0.82
// Bloom changes smaller than this are left out when finish decides which blocks to tone-map again: under 0.06 of a
// level at the steepest point of the tone curve.
const BLOOM_EPSILON = 1e-4
// layout() paints the static background at SUPERSAMPLE times the resolution while that stays within LAYOUT_PIXELS
// (about a 270x70-cell terminal), which keeps a resize under about 150 ms; larger canvases, such as real-pixel mode on
// a big terminal, paint it at their own size.
const SUPERSAMPLE = 2
const LAYOUT_PIXELS = 600_000

export type Part =
  | { kind: "capsule"; ax: number; ay: number; bx: number; by: number; r0: number; r1: number; color: RGB; ribs: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number; angle: number; color: RGB; ribs: number }

// A tapered capsule from (ax, ay) radius r0 to (bx, by) radius r1; ribs adds lengthwise ridges, as on a cactus.
export function cap(ax: number, ay: number, bx: number, by: number, r0: number, r1: number, color: RGB, ribs = 0): Part {
  return { kind: "capsule", ax, ay, bx, by, r0, r1, color, ribs }
}

// An ellipse rotated by angle; ribs runs ridges across its width.
export function ell(cx: number, cy: number, rx: number, ry: number, angle: number, color: RGB, ribs = 0): Part {
  return { kind: "ellipse", cx, cy, rx, ry, angle, color, ribs }
}

// A leafy blade along spine (points in pixels), widths[i] wide either side at each point: overlapping ellipses whose
// scalloped edges suggest leaflets. Fronds draw this on terminal cells (see Canvas.cells) instead of single leaflets,
// which would turn into speckle there.
export function blade(spine: readonly (readonly [number, number])[], widths: readonly number[], color: RGB): Part[] {
  return spine.slice(1).map(([bx, by], i) => {
    const [ax, ay] = spine[i]
    const half = Math.hypot(bx - ax, by - ay) * 0.75
    return ell((ax + bx) / 2, (ay + by) / 2, Math.max(half, 0.5), Math.max(0.5, (widths[i] + widths[i + 1]) / 2), Math.atan2(by - ay, bx - ax), color)
  })
}

// How shape() lights a shape. rim: backlit from a point (pixels), so only the outline facing it glows. front: lit from
// a direction (x right, y down, z toward the viewer), shading each part as a rounded form.
export type Lighting = { style: "rim"; color: RGB; x: number; y: number } | { style: "front"; dir: readonly [number, number, number] }

// Base for wallpaper scenes. Scenes draw linear light into `hdr` (3 floats per pixel) in `render`, then call `finish`,
// which adds bloom and a vignette and tone-maps into the RGBA `pixels` the engine reads. Scene coordinates usually
// run 0..A across and 0..1 down, so multiplying by H gives pixels.
export abstract class Canvas {
  W = 0
  H = 0
  A = 1
  // Set when each pixel is a sub-pixel of a terminal character cell (2 across, 4 down) and each cell shows only two
  // colors. Strokes under about two pixels across and texture finer than a cell turn into noise there, so scenes draw
  // bolder when it's set: thicker strokes (see thick()), solid blades for leaflets, coarser texture.
  protected cells = false
  hdr = new Float32Array(0)
  pixels = new Uint8Array(0)
  // Boxes [x0, y0, x1, y1, ...] in pixels, inclusive, around what render() drew this frame over the cached background.
  // restore() clears it; the drawing methods and the shared helpers (sky, shadows, light, water, wind) add to
  // it; scenes touch() what their own pixel loops write.
  readonly touched: number[] = []
  // Boxes around every pixel whose `pixels` value may differ from last frame's, for the engine to refit only the cells
  // under them.
  readonly changed: number[] = []
  // Whether this frame started with restore(); a scene that never calls it can have drawn anywhere.
  private restored = false
  // Still points of light registered this frame (see point()), for the engine to draw as dot glyphs on cells.
  readonly points = new Points()
  // The sun and moon discs layout() painted, [cx, cy, r, ...] in pixels (see src/orbs.ts).
  readonly orbs: number[] = []

  private bw = 0
  private bh = 0
  private bloomA = new Float32Array(0)
  private bloomB = new Float32Array(0)
  private bw2 = 0
  private bh2 = 0
  private bloom2A = new Float32Array(0)
  private bloom2B = new Float32Array(0)
  private bloomUp = new Float32Array(0)
  private bloomRow = new Float32Array(0)
  private vignette = new Float32Array(0)
  private rowA = new Int32Array(0)
  private rowB = new Int32Array(0)
  private rowF = new Float32Array(0)
  private colA = new Int32Array(0)
  private colB = new Int32Array(0)
  private colF = new Float32Array(0)
  // The still frame is hdr as layout() leaves it, the background scenes copy back each frame. finish blooms and
  // tone-maps it once; each frame then only works out the bloom blocks that differ from it and tone-maps again only
  // the blocks their pixels or bloom change. Bloom is linear after its per-block threshold, so this matches a full
  // bloom of the frame.
  private still = new Float32Array(0)
  private stillSource = new Float32Array(0)
  private stillBloom = new Float32Array(0)
  private stillPixels = new Uint8Array(0)
  private stillExposure = NaN
  private retone = new Uint8Array(0)
  // The blocks tone-mapped last frame; the rest of pixels holds the still frame's.
  private toned = new Uint8Array(0)
  private region = new Int32Array(4)

  // How overcast the scene is: eases to 1 after the agent fails and back to 0 with any other event (the engine sends
  // idle once an error is a couple of minutes old). Scenes call stepGloom from step and darken their light or bring in
  // clouds by it.
  protected gloom = 0
  private gloomy = false
  // Extra darkening toward the bottom corners (0 to 1), folded into the vignette: set it in the constructor to frame
  // a bright daytime foreground.
  protected frame = 0

  abstract step(dt: number): void
  abstract render(): void

  react(event: AgentEvent) {
    this.gloomy = event === "error"
    if (event === "done") this.visit()
  }

  // The agent finished a task: scenes bring on their rare visitor now.
  protected visit() {}

  protected stepGloom(dt: number) {
    this.gloom = clamp(this.gloom + (this.gloomy ? dt : -dt) * 0.3, 0, 1)
  }

  // Where OpenCode's text sits; unknown until the engine says, and in dev/snap.ts.
  protected text: TextMap | undefined

  textMap(map: TextMap) {
    this.text = map
  }

  // How hidden by text the point (x, y) in screen heights is, from 0 (open) to 1.
  protected covered(x: number, y: number) {
    const t = this.text
    if (!t) return 0
    return t.cover[clamp(Math.floor(y * t.rows), 0, t.rows - 1) * t.cols + clamp(Math.floor((x / this.A) * t.cols), 0, t.cols - 1)]
  }

  // A random point in the box from (x0, y0) to (x1, y1) in screen heights, the most open of a few tries once the
  // engine has said where text is: creatures wander toward open ground and visitors come on where they'll be seen.
  protected openSpot(x0: number, x1: number, y0: number, y1: number): [number, number] {
    let best: [number, number] = [rand(x0, x1), rand(y0, y1)]
    let least = this.covered(best[0], best[1])
    for (let i = 0; i < 5 && least > 0.05; i++) {
      const spot: [number, number] = [rand(x0, x1), rand(y0, y1)]
      const c = this.covered(spot[0], spot[1])
      if (c >= least) continue
      best = spot
      least = c
    }
    return best
  }

  // A height between y0 and y1 for a visitor crossing the whole screen: the least covered row of a few tries.
  protected openRow(y0: number, y1: number) {
    let best = rand(y0, y1)
    const t = this.text
    if (!t) return best
    const cover = (y: number) => {
      const row = clamp(Math.floor(y * t.rows), 0, t.rows - 1) * t.cols
      let sum = 0
      for (let c = 0; c < t.cols; c++) sum += t.cover[row + c]
      return sum
    }
    let least = cover(best)
    for (let i = 0; i < 4; i++) {
      const y = rand(y0, y1)
      const c = cover(y)
      if (c >= least) continue
      best = y
      least = c
    }
    return best
  }

  // Called after every size change, once the buffers match the new size, to paint what never moves into hdr; Canvas
  // keeps the result in `background` for render() to start from. It usually runs twice: first with W, H and hdr
  // `supersample` times larger, painting a background that is then box-filtered down so every static edge is
  // anti-aliased, then at the real size for everything else render() reads (positions, masks, per-pixel layers), whose
  // painting is dropped. `px` is one real pixel in the current pass's pixels: scale pixel-sized widths, offsets and
  // textures by it.
  protected layout() {}
  protected background = new Float32Array(0)
  protected px = 1
  // 1 for scenes whose layout() paints nothing.
  protected supersample = SUPERSAMPLE

  resize(W: number, H: number, cells = false) {
    W = Math.max(64, Math.round(W))
    H = Math.max(36, Math.round(H))
    if (W === this.W && H === this.H && cells === this.cells) return
    this.W = W
    this.H = H
    this.cells = cells
    this.points.on = cells
    this.A = W / H
    this.hdr = new Float32Array(W * H * 3)
    trackTouched(this.hdr, this.touched)
    this.orbs.length = 0
    trackOrbs(this.hdr, this.orbs)
    this.pixels = new Uint8Array(W * H * 4)
    this.bw = Math.ceil(W / BLOOM)
    this.bh = Math.ceil(H / BLOOM)
    this.bloomA = new Float32Array(this.bw * this.bh * 3)
    this.bloomB = new Float32Array(this.bw * this.bh * 3)
    this.bloomUp = new Float32Array(this.bw * this.bh * 3)
    this.bloomRow = new Float32Array(this.bw * 3)
    this.bw2 = Math.ceil(this.bw / 2)
    this.bh2 = Math.ceil(this.bh / 2)
    this.bloom2A = new Float32Array(this.bw2 * this.bh2 * 3)
    this.bloom2B = new Float32Array(this.bw2 * this.bh2 * 3)
    this.stillSource = new Float32Array(this.bw * this.bh * 3)
    this.stillBloom = new Float32Array(this.bw * this.bh * 3)
    this.stillPixels = new Uint8Array(W * H * 4)
    this.retone = new Uint8Array(this.bw * this.bh)
    this.toned = new Uint8Array(this.bw * this.bh)
    const invR = 1 / Math.hypot(W / 2, H / 2)
    this.vignette = new Float32Array(W * H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const dx = (x - W / 2) * invR
        const dy = (y - H / 2) * invR
        const corner = this.frame * smoothstep(0.45, 1, y / H) * (0.35 + 0.65 * (2 * Math.abs(x / W - 0.5)) ** 2)
        this.vignette[y * W + x] = (1 - 0.62 * Math.pow(dx * dx + dy * dy, 1.25)) * (1 - corner)
      }
    // Bilinear lookup from full-resolution rows and columns into the bloom grid.
    this.rowA = new Int32Array(H)
    this.rowB = new Int32Array(H)
    this.rowF = new Float32Array(H)
    for (let y = 0; y < H; y++) {
      const by = (y + 0.5) * (this.bh / H) - 0.5
      const i = clamp(Math.floor(by), 0, this.bh - 1)
      this.rowA[y] = i * this.bw * 3
      this.rowB[y] = Math.min(this.bh - 1, i + 1) * this.bw * 3
      this.rowF[y] = clamp(by - i, 0, 1)
    }
    this.colA = new Int32Array(W)
    this.colB = new Int32Array(W)
    this.colF = new Float32Array(W)
    for (let x = 0; x < W; x++) {
      const bx = (x + 0.5) * (this.bw / W) - 0.5
      const i = clamp(Math.floor(bx), 0, this.bw - 1)
      this.colA[x] = i * 3
      this.colB[x] = Math.min(this.bw - 1, i + 1) * 3
      this.colF[x] = clamp(bx - i, 0, 1)
    }
    const S = W * H * this.supersample ** 2 <= LAYOUT_PIXELS ? this.supersample : 1
    let fine: Float32Array | undefined
    if (S > 1) {
      const hdr = this.hdr
      this.W = W * S
      this.H = H * S
      this.px = S
      this.hdr = new Float32Array(W * S * H * S * 3)
      this.layout()
      fine = this.hdr
      this.W = W
      this.H = H
      this.px = 1
      this.hdr = hdr
    }
    this.layout()
    keepShadows(this.hdr)
    this.background = fine ? shrink(fine, W, H, S, 3) : this.hdr.slice()
    this.still = this.background
    this.stillExposure = NaN
  }

  // Box-filters buf, a buffer of the size being painted in layout()'s supersampled pass with `channels` values per
  // pixel, down to the real size; for per-pixel layers that render() reads, kept from that pass for the next.
  protected shrink(buf: Float32Array, channels = 3) {
    return shrink(buf, this.W / this.px, this.H / this.px, this.px, channels)
  }

  // A stroke radius in screen heights, in pixels; on terminal cells never under min real pixels, since thinner strokes
  // break up into noise there and shimmer as they move.
  protected thick(radius: number, min = 1) {
    return this.cells ? Math.max(radius * this.H, min * this.px) : radius * this.H
  }

  // Starts a frame: copies the background (or a buffer of the scene's own) into hdr and clears touched. A scene that
  // draws every pixel each frame passes undefined.
  protected restore(background: Float32Array | undefined = this.background) {
    if (background) this.hdr.set(background)
    this.touched.length = 0
    this.restored = true
  }

  // For scenes that build up their background over time: after changing `background` outside layout(), call this so
  // the next finish() works the still frame out again (and the engine refits every cell once).
  protected rebake() {
    this.stillExposure = NaN
  }

  // Makes what hdr holds now the background and still frame, for scenes whose whole view changes for a while and then
  // holds still, such as a walking camera that pauses: once kept, frames that restore() and draw only small things
  // cost as little as in any other scene. The next finish() tone-maps and refits everything once.
  protected hold() {
    this.background = this.hdr.slice()
    this.still = this.background
    this.stillExposure = NaN
  }

  // Marks pixels a scene's own loop writes during render(), x0..x1 by y0..y1 inclusive.
  protected touch(x0: number, y0: number, x1: number, y1: number) {
    addBox(this.touched, x0, y0, x1, y1)
  }

  // Adds light to one pixel.
  protected add(x: number, y: number, r: number, g: number, b: number) {
    const xi = x | 0
    const yi = y | 0
    if (xi < 0 || yi < 0 || xi >= this.W || yi >= this.H) return
    const i = (yi * this.W + xi) * 3
    this.hdr[i] += r
    this.hdr[i + 1] += g
    this.hdr[i + 2] += b
    this.touch(xi, yi, xi, yi)
  }

  // Adds a still point of light, such as a star or a distant lamp: one pixel, or on terminal cells a round dot glyph
  // (size 1 small, 2 medium, 3 large) where its cell is otherwise flat. Set glide for points that drift sideways. Draw
  // points before anything that may pass in front of them: whatever is drawn over one keeps it a plain pixel.
  protected point(x: number, y: number, r: number, g: number, b: number, size = 1, glide = false) {
    this.points.add(this.hdr, this.W, this.H, x, y, r, g, b, size, glide)
  }

  // Adds light for a moving speck (a snowflake, a spark, a firefly's core), shared between the pixels around it so
  // it glides rather than hopping a pixel at a time.
  protected splat(x: number, y: number, r: number, g: number, b: number) {
    splat(this.hdr, this.W, this.H, x, y, r, g, b)
  }

  // Mixes a color over the pixel at hdr index i by coverage a.
  protected blend(i: number, r: number, g: number, b: number, a: number) {
    const h = this.hdr
    h[i] += (r - h[i]) * a
    h[i + 1] += (g - h[i + 1]) * a
    h[i + 2] += (b - h[i + 2]) * a
    const y = Math.floor(i / 3 / this.W)
    const x = i / 3 - y * this.W
    this.touch(x, y, x, y)
  }

  // An anti-aliased filled circle, mixed over the scene.
  protected disc(cx: number, cy: number, rad: number, r: number, g: number, b: number, a: number) {
    fillDisc(this.hdr, this.W, this.H, cx, cy, rad, r, g, b, a)
    this.touch(cx - rad - 2, cy - rad - 2, cx + rad + 2, cy + rad + 2)
  }

  // An anti-aliased filled ellipse, mixed over the scene; handy for parts that narrow as a creature turns edge-on.
  protected ellipse(cx: number, cy: number, rx: number, ry: number, r: number, g: number, b: number, a: number) {
    fillEllipse(this.hdr, this.W, this.H, cx, cy, rx, ry, r, g, b, a)
    this.touch(cx - rx - 2, cy - ry - 2, cx + rx + 2, cy + ry + 2)
  }

  // An anti-aliased filled polygon in a flat color, for straight-edged things like buildings and machines.
  protected polygon(points: readonly (readonly [number, number])[], color: RGB, alpha = 1) {
    fillPolygon(this.hdr, this.W, this.H, points, color[0], color[1], color[2], alpha)
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const [x, y] of points) {
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
    if (points.length) this.touch(x0 - 2, y0 - 2, x1 + 2, y1 + 2)
  }

  // Draws parts as one shape: each pixel takes the nearest part's color, so joints stay seamless. With rim lighting
  // only the outline facing the light catches it; with front lighting each part is shaded as a rounded form.
  // light scales the effect (0 draws flat color).
  protected shape(parts: Part[], lighting: Lighting, light = 1) {
    fillShape(this.hdr, this.W, this.H, parts, lighting, light, this.px)
    for (const p of parts) {
      const r = (p.kind === "capsule" ? Math.max(p.r0, p.r1) : Math.max(p.rx, p.ry)) + 2
      if (p.kind === "capsule") this.touch(Math.min(p.ax, p.bx) - r, Math.min(p.ay, p.by) - r, Math.max(p.ax, p.bx) + r, Math.max(p.ay, p.by) + r)
      else this.touch(p.cx - r, p.cy - r, p.cx + r, p.cy + r)
    }
  }

  // Bloom, vignette and ACES tone mapping from hdr into pixels. Only the blocks that differ from the still frame, or
  // whose bloom does, are worked out again; the rest keep the still frame's pixels. On terminal cells, still points
  // come back out of hdr first (see point()).
  protected finish(exposure = 1.25) {
    this.points.resolve(this.hdr, this.W, this.vignette, exposure)
    clearShadows(this.hdr)
    const { W, H, bw, bh, retone } = this
    const fresh = exposure !== this.stillExposure
    if (fresh) {
      // Without a still frame to compare with, bloomSource marks every block for tone-mapping.
      bloomSource(this.still, W, H, bw, bh, this.stillSource, undefined, this.stillSource, retone, this.region)
      this.bloomA.set(this.stillSource)
      this.stillBloom.fill(0)
      bloom(bw, bh, this.bloomA, this.bloomB, this.bw2, this.bh2, this.bloom2A, this.bloom2B, this.stillBloom, retone, 0, 0, bw - 1, bh - 1)
      toneMap(this.still, this.stillPixels, W, H, bw, retone, this.stillBloom, this.bloomRow, this.vignette, this.rowA, this.rowB, this.rowF, this.colA, this.colB, this.colF, exposure)
      this.stillExposure = exposure
      this.pixels.set(this.stillPixels)
      this.toned.fill(0)
    }
    // Only blocks under what this frame drew can differ from the still frame.
    if (this.restored) markBlocks(retone, bw, bh, this.touched)
    else retone.fill(1)
    this.restored = false
    bloomSource(this.hdr, W, H, bw, bh, this.bloomA, this.still, this.stillSource, retone, this.region)
    const region = this.region
    const spread = region[2] >= region[0]
    if (spread) {
      this.bloomUp.set(this.stillBloom)
      bloom(bw, bh, this.bloomA, this.bloomB, this.bw2, this.bh2, this.bloom2A, this.bloom2B, this.bloomUp, retone, region[0], region[1], region[2], region[3])
    }
    settleBlocks(this.pixels, this.stillPixels, W, H, bw, bh, this.toned, retone, this.changed, fresh)
    toneMap(this.hdr, this.pixels, W, H, bw, retone, spread ? this.bloomUp : this.stillBloom, this.bloomRow, this.vignette, this.rowA, this.rowB, this.rowF, this.colA, this.colB, this.colF, exposure)
  }
}

// Marks the blocks (BLOOM pixels square) that any box overlaps.
function markBlocks(blocks: Uint8Array, bw: number, bh: number, boxes: readonly number[]) {
  blocks.fill(0)
  for (let b = 0; b < boxes.length; b += 4) {
    const x0 = Math.max(0, Math.floor(boxes[b] / BLOOM))
    const y0 = Math.max(0, Math.floor(boxes[b + 1] / BLOOM))
    const x1 = Math.min(bw - 1, Math.floor(boxes[b + 2] / BLOOM))
    const y1 = Math.min(bh - 1, Math.floor(boxes[b + 3] / BLOOM))
    for (let y = y0; y <= y1; y++) if (x0 <= x1) blocks.fill(1, y * bw + x0, y * bw + x1 + 1)
  }
}

// Puts the still frame's pixels back in blocks tone-mapped last frame but not this one, and lists in changed (as runs
// of blocks, in pixels) every block whose pixels may differ from last frame's: those tone-mapped in either frame.
function settleBlocks(pixels: Uint8Array, stillPixels: Uint8Array, W: number, H: number, bw: number, bh: number, toned: Uint8Array, retone: Uint8Array, changed: number[], fresh: boolean) {
  changed.length = 0
  if (fresh) changed.push(0, 0, W - 1, H - 1)
  for (let by = 0; by < bh; by++) {
    let run = -1
    for (let bx = 0; bx <= bw; bx++) {
      const b = by * bw + bx
      const moved = bx < bw && (toned[b] === 1 || retone[b] === 1)
      if (bx < bw && toned[b] && !retone[b])
        for (let y = by * BLOOM; y < Math.min(H, by * BLOOM + BLOOM); y++) {
          const o = (y * W + bx * BLOOM) * 4
          pixels.set(stillPixels.subarray(o, (y * W + Math.min(W, bx * BLOOM + BLOOM)) * 4), o)
        }
      if (bx < bw) toned[b] = retone[b]
      if (moved && run < 0) run = bx
      if (moved || run < 0) continue
      if (!fresh) changed.push(run * BLOOM, by * BLOOM, Math.min(W, bx * BLOOM) - 1, Math.min(H, by * BLOOM + BLOOM) - 1)
      run = -1
    }
  }
}

// Separable 7-tap binomial blur of cells x0..x1, y0..y1 of a 3-channel buffer w cells wide, in place, using tmp as
// scratch. Edges repeat the border.
function blur(a: Float32Array, tmp: Float32Array, w: number, x0: number, y0: number, x1: number, y1: number) {
  blurLines(a, tmp, x0, x1, 3, y0, y1, w * 3)
  blurLines(tmp, a, y0, y1, w * 3, x0, x1, 3)
}

// One pass of blur along lines l0..l1, lineStep apart, over samples k0..k1, step apart.
function blurLines(src: Float32Array, dst: Float32Array, k0: number, k1: number, step: number, l0: number, l1: number, lineStep: number) {
  for (let l = l0; l <= l1; l++) {
    const base = l * lineStep
    for (let k = k0; k <= k1; k++) {
      const m3 = base + Math.max(k - 3, k0) * step
      const m2 = base + Math.max(k - 2, k0) * step
      const m1 = base + Math.max(k - 1, k0) * step
      const o = base + k * step
      const p1 = base + Math.min(k + 1, k1) * step
      const p2 = base + Math.min(k + 2, k1) * step
      const p3 = base + Math.min(k + 3, k1) * step
      for (let c = 0; c < 3; c++) dst[o + c] = (src[m3 + c] + src[p3 + c] + 6 * (src[m2 + c] + src[p2 + c]) + 15 * (src[m1 + c] + src[p1 + c]) + 20 * src[o + c]) / 64
    }
  }
}

// Averages each S x S block of src (W * S by H * S pixels of `channels` values) into one pixel.
function shrink(src: Float32Array, W: number, H: number, S: number, channels: number) {
  const out = new Float32Array(W * H * channels)
  const k = 1 / (S * S)
  for (let y = 0; y < H; y++)
    for (let sy = 0; sy < S; sy++) {
      const row = (y * S + sy) * W * S
      for (let x = 0; x < W; x++)
        for (let sx = 0; sx < S; sx++) {
          const i = (row + x * S + sx) * channels
          const o = (y * W + x) * channels
          for (let c = 0; c < channels; c++) out[o + c] += src[i + c] * k
        }
    }
  return out
}

function fillDisc(hdr: Float32Array, W: number, H: number, cx: number, cy: number, rad: number, r: number, g: number, b: number, a: number) {
  const x0 = Math.max(0, Math.floor(cx - rad - 1))
  const x1 = Math.min(W - 1, Math.ceil(cx + rad + 1))
  const y0 = Math.max(0, Math.floor(cy - rad - 1))
  const y1 = Math.min(H - 1, Math.ceil(cy + rad + 1))
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx
      const cov = clamp(rad - Math.sqrt(dx * dx + dy * dy) + 0.5, 0, 1) * a
      if (cov <= 0) continue
      const i = (y * W + x) * 3
      hdr[i] += (r - hdr[i]) * cov
      hdr[i + 1] += (g - hdr[i + 1]) * cov
      hdr[i + 2] += (b - hdr[i + 2]) * cov
    }
  }
}

function fillEllipse(hdr: Float32Array, W: number, H: number, cx: number, cy: number, rx: number, ry: number, r: number, g: number, b: number, a: number) {
  const x0 = Math.max(0, Math.floor(cx - rx - 1))
  const x1 = Math.min(W - 1, Math.ceil(cx + rx + 1))
  const y0 = Math.max(0, Math.floor(cy - ry - 1))
  const y1 = Math.min(H - 1, Math.ceil(cy + ry + 1))
  const m = Math.min(rx, ry)
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - cy) / ry
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rx
      const cov = clamp((1 - Math.sqrt(dx * dx + dy * dy)) * m + 0.5, 0, 1) * a
      if (cov <= 0) continue
      const i = (y * W + x) * 3
      hdr[i] += (r - hdr[i]) * cov
      hdr[i + 1] += (g - hdr[i + 1]) * cov
      hdr[i + 2] += (b - hdr[i + 2]) * cov
    }
  }
}

// unit is Canvas.px: the rim light reaches 2.2 real pixels in.
function fillShape(hdr: Float32Array, W: number, H: number, parts: Part[], lighting: Lighting, light: number, unit: number) {
  if (!parts.length) return
  // The shape's overall extent: the pixels it can cover, and the direction its rim light comes from.
  let cx0 = Infinity
  let cy0 = Infinity
  let cx1 = -Infinity
  let cy1 = -Infinity
  // Each part's own bounds: a pixel outside them is too far from that part for it to be the one that colors it.
  // The ellipse distance is approximate and runs short past the tips of long ellipses, so they get a wider margin.
  const boxes = new Float32Array(parts.length * 4)
  for (let j = 0; j < parts.length; j++) {
    const p = parts[j]
    const radius = p.kind === "capsule" ? Math.max(p.r0, p.r1) : Math.max(p.rx, p.ry)
    const pad = p.kind === "capsule" ? radius + 1 : radius * (1 + 0.5 / Math.max(0.01, Math.min(p.rx, p.ry))) + 1
    const [ax, ay, bx, by] = p.kind === "capsule" ? [p.ax, p.ay, p.bx, p.by] : [p.cx, p.cy, p.cx, p.cy]
    cx0 = Math.min(cx0, ax - radius - 1, bx - radius - 1)
    cy0 = Math.min(cy0, ay - radius - 1, by - radius - 1)
    cx1 = Math.max(cx1, ax + radius + 1, bx + radius + 1)
    cy1 = Math.max(cy1, ay + radius + 1, by + radius + 1)
    boxes[j * 4] = Math.min(ax, bx) - pad
    boxes[j * 4 + 1] = Math.min(ay, by) - pad
    boxes[j * 4 + 2] = Math.max(ax, bx) + pad
    boxes[j * 4 + 3] = Math.max(ay, by) + pad
  }
  const lx0 = lighting.style === "rim" ? lighting.x : 0
  const ly0 = lighting.style === "rim" ? lighting.y : 0
  const sl = Math.hypot(lx0 - (cx0 + cx1) / 2, ly0 - (cy0 + cy1) / 2) || 1
  const sx = (lx0 - (cx0 + cx1) / 2) / sl
  const sy = (ly0 - (cy0 + cy1) / 2) / sl
  for (let y = Math.max(0, Math.floor(cy0)); y <= Math.min(H - 1, Math.ceil(cy1)); y++)
    for (let x = Math.max(0, Math.floor(cx0)); x <= Math.min(W - 1, Math.ceil(cx1)); x++) {
      const px = x + 0.5
      const py = y + 0.5
      let best = Infinity
      let part = parts[0]
      let nx = 0
      let ny = 0
      let e = 0
      let across = 0
      for (let j = 0; j < parts.length; j++) {
        if (px < boxes[j * 4] || py < boxes[j * 4 + 1] || px > boxes[j * 4 + 2] || py > boxes[j * 4 + 3]) continue
        const p = parts[j]
        if (p.kind === "capsule") {
          const dx = p.bx - p.ax
          const dy = p.by - p.ay
          const len2 = dx * dx + dy * dy || 1e-6
          const t = clamp(((px - p.ax) * dx + (py - p.ay) * dy) / len2, 0, 1)
          const ox = px - (p.ax + dx * t)
          const oy = py - (p.ay + dy * t)
          const r = p.r0 + (p.r1 - p.r0) * t
          const dist = Math.hypot(ox, oy) || 1e-6
          const d = dist - r
          if (d >= best) continue
          best = d
          part = p
          nx = ox / dist
          ny = oy / dist
          e = dist / Math.max(r, 0.5)
          across = (ox * dy - oy * dx) / Math.sqrt(len2) / Math.max(r, 0.5)
          continue
        }
        const ca = Math.cos(p.angle)
        const sa = Math.sin(p.angle)
        const ox = px - p.cx
        const oy = py - p.cy
        const lx = ox * ca + oy * sa
        const ly = -ox * sa + oy * ca
        const radial = Math.sqrt((lx / p.rx) ** 2 + (ly / p.ry) ** 2)
        const d = (radial - 1) * Math.min(p.rx, p.ry)
        if (d >= best) continue
        const gx = lx / (p.rx * p.rx)
        const gy = ly / (p.ry * p.ry)
        const gl = Math.hypot(gx, gy) || 1e-6
        best = d
        part = p
        nx = (gx * ca - gy * sa) / gl
        ny = (gx * sa + gy * ca) / gl
        e = radial
        across = lx / p.rx
      }
      const cov = clamp(0.5 - best, 0, 1)
      if (cov <= 0) continue
      const k = part.ribs ? 0.8 + 0.2 * Math.cos(across * Math.PI * part.ribs) : 1
      const c = part.color
      const o = (y * W + x) * 3
      if (lighting.style === "front") {
        // Treat the shape as rounded: the normal tilts from facing the viewer at the center to sideways at the edge.
        const r = Math.min(1, e)
        const lit = Math.max(0, nx * r * lighting.dir[0] + ny * r * lighting.dir[1] + Math.sqrt(1 - r * r) * lighting.dir[2])
        const shade = k * (1 - light + light * (0.45 + 0.75 * lit))
        hdr[o] += (c[0] * shade - hdr[o]) * cov
        hdr[o + 1] += (c[1] * shade - hdr[o + 1]) * cov
        hdr[o + 2] += (c[2] * shade - hdr[o + 2]) * cov
        continue
      }
      const lit = light * clamp((best + 2.2 * unit) / (2.2 * unit), 0, 1) * Math.max(0, nx * sx + ny * sy) * 0.8
      hdr[o] += (c[0] * k + lighting.color[0] * lit - hdr[o]) * cov
      hdr[o + 1] += (c[1] * k + lighting.color[1] * lit - hdr[o + 1]) * cov
      hdr[o + 2] += (c[2] * k + lighting.color[2] * lit - hdr[o + 2]) * cov
    }
}

// Tone-maps the pixels of the bloom blocks marked in retone. row is scratch for one row of bloom, blended between
// the two bloom rows above and below it.
function toneMap(hdr: Float32Array, pixels: Uint8Array, W: number, H: number, bw: number, retone: Uint8Array, bloomUp: Float32Array, row: Float32Array, vignette: Float32Array, rowA: Int32Array, rowB: Int32Array, rowF: Float32Array, colA: Int32Array, colB: Int32Array, colF: Float32Array, exposure: number) {
  for (let y = 0; y < H; y++) {
    const blocks = ((y / BLOOM) | 0) * bw
    let blended = false
    for (let x = 0; x < W; x++) {
      if (!retone[blocks + ((x / BLOOM) | 0)]) {
        x += BLOOM - 1
        continue
      }
      if (!blended) {
        const fy = rowF[y]
        for (let j = 0; j < bw * 3; j++) row[j] = bloomUp[rowA[y] + j] * (1 - fy) + bloomUp[rowB[y] + j] * fy
        blended = true
      }
      const i = y * W + x
      const fx = colF[x]
      const a = colA[x]
      const b = colB[x]
      const k = vignette[i] * exposure
      const o = i * 4
      for (let c = 0; c < 3; c++) {
        const v = (hdr[i * 3 + c] + row[a + c] * (1 - fx) + row[b + c] * fx) * k
        const mapped = ((v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14)) * 255
        pixels[o + c] = mapped < 0 ? 0 : mapped > 255 ? 255 : mapped
      }
      pixels[o + 3] = 255
    }
  }
}

// Each bloom block's average light above the threshold, into source. Given the still frame, only blocks marked in
// retone whose pixels differ from it are worked out, as the change from stillSource, and stay marked; the rest are
// zero. Sets
// the box of blocks whose source changed, as region [x0, y0, x1, y1], empty when x1 < x0.
function bloomSource(hdr: Float32Array, W: number, H: number, bw: number, bh: number, source: Float32Array, still: Float32Array | undefined, stillSource: Float32Array, retone: Uint8Array, region: Int32Array) {
  region[0] = bw
  region[1] = bh
  region[2] = -1
  region[3] = -1
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      const o = (by * bw + bx) * 3
      const same = still !== undefined && (!retone[by * bw + bx] || sameBlock(hdr, still, W, H, bx, by))
      retone[by * bw + bx] = same ? 0 : 1
      if (same) {
        source[o] = source[o + 1] = source[o + 2] = 0
        continue
      }
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let yy = by * BLOOM; yy < Math.min(H, by * BLOOM + BLOOM); yy++)
        for (let xx = bx * BLOOM; xx < Math.min(W, bx * BLOOM + BLOOM); xx++) {
          const i = (yy * W + xx) * 3
          r += hdr[i]
          g += hdr[i + 1]
          b += hdr[i + 2]
          n++
        }
      r /= n
      g /= n
      b /= n
      const l = r * 0.2126 + g * 0.7152 + b * 0.0722
      const k = l > 1e-4 ? Math.max(0, l - BLOOM_THRESHOLD) / l : 0
      source[o] = r * k - (still ? stillSource[o] : 0)
      source[o + 1] = g * k - (still ? stillSource[o + 1] : 0)
      source[o + 2] = b * k - (still ? stillSource[o + 2] : 0)
      if (!source[o] && !source[o + 1] && !source[o + 2]) continue
      region[0] = Math.min(region[0], bx)
      region[1] = Math.min(region[1], by)
      region[2] = Math.max(region[2], bx)
      region[3] = Math.max(region[3], by)
    }
}

function sameBlock(hdr: Float32Array, still: Float32Array, W: number, H: number, bx: number, by: number) {
  for (let y = by * BLOOM; y < Math.min(H, by * BLOOM + BLOOM); y++)
    for (let i = (y * W + bx * BLOOM) * 3; i < (y * W + Math.min(W, bx * BLOOM + BLOOM)) * 3; i++) if (hdr[i] !== still[i]) return false
  return true
}

// Spreads the bloom source in bloomA (overwritten) and adds it into out: two blurred levels folded into one. The
// source must be zero outside cells x0..x1, y0..y1, so only the cells its light can reach are worked out (blurs that
// stop where the light runs out match blurs over the whole grid). Marks in retone every block whose pixels read a
// cell that changes by more than BLOOM_EPSILON.
function bloom(bw: number, bh: number, bloomA: Float32Array, bloomB: Float32Array, bw2: number, bh2: number, bloom2A: Float32Array, bloom2B: Float32Array, out: Float32Array, retone: Uint8Array, x0: number, y0: number, x1: number, y1: number) {
  // Each blur spreads light 3 cells.
  const ax0 = Math.max(0, x0 - 6)
  const ay0 = Math.max(0, y0 - 6)
  const ax1 = Math.min(bw - 1, x1 + 6)
  const ay1 = Math.min(bh - 1, y1 + 6)
  blur(bloomA, bloomB, bw, ax0, ay0, ax1, ay1)
  blur(bloomA, bloomB, bw, ax0, ay0, ax1, ay1)
  const cx0 = Math.max(0, (ax0 >> 1) - 6)
  const cy0 = Math.max(0, (ay0 >> 1) - 6)
  const cx1 = Math.min(bw2 - 1, (ax1 >> 1) + 6)
  const cy1 = Math.min(bh2 - 1, (ay1 >> 1) + 6)
  bloom2A.fill(0)
  for (let y = cy0; y <= cy1; y++)
    for (let x = cx0; x <= cx1; x++) {
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let yy = y * 2; yy < Math.min(bh, y * 2 + 2); yy++)
        for (let xx = x * 2; xx < Math.min(bw, x * 2 + 2); xx++) {
          const i = (yy * bw + xx) * 3
          r += bloomA[i]
          g += bloomA[i + 1]
          b += bloomA[i + 2]
          n++
        }
      const o = (y * bw2 + x) * 3
      bloom2A[o] = r / n
      bloom2A[o + 1] = g / n
      bloom2A[o + 2] = b / n
    }
  blur(bloom2A, bloom2B, bw2, cx0, cy0, cx1, cy1)
  blur(bloom2A, bloom2B, bw2, cx0, cy0, cx1, cy1)
  // Fold the wide level into the narrow one so finish does a single bilinear fetch.
  for (let y = Math.max(0, cy0 * 2 - 3); y <= Math.min(bh - 1, cy1 * 2 + 3); y++) {
    const sy = clamp((y + 0.5) * (bh2 / bh) - 0.5, 0, bh2 - 1)
    const sy0 = Math.floor(sy)
    const sy1 = Math.min(bh2 - 1, sy0 + 1)
    const fy = sy - sy0
    for (let x = Math.max(0, cx0 * 2 - 3); x <= Math.min(bw - 1, cx1 * 2 + 3); x++) {
      const sx = clamp((x + 0.5) * (bw2 / bw) - 0.5, 0, bw2 - 1)
      const sx0 = Math.floor(sx)
      const sx1 = Math.min(bw2 - 1, sx0 + 1)
      const fx = sx - sx0
      const o = (y * bw + x) * 3
      let change = 0
      for (let c = 0; c < 3; c++) {
        const a = bloom2A[(sy0 * bw2 + sx0) * 3 + c] * (1 - fx) + bloom2A[(sy0 * bw2 + sx1) * 3 + c] * fx
        const b = bloom2A[(sy1 * bw2 + sx0) * 3 + c] * (1 - fx) + bloom2A[(sy1 * bw2 + sx1) * 3 + c] * fx
        const v = bloomA[o + c] * 1.1 + (a * (1 - fy) + b * fy) * 1.4
        out[o + c] += v
        change += Math.abs(v)
      }
      if (change < BLOOM_EPSILON) continue
      for (let yy = Math.max(0, y - 1); yy <= Math.min(bh - 1, y + 1); yy++)
        for (let xx = Math.max(0, x - 1); xx <= Math.min(bw - 1, x + 1); xx++) retone[yy * bw + xx] = 1
    }
  }
}

function fillPolygon(hdr: Float32Array, W: number, H: number, pts: readonly (readonly [number, number])[], r: number, g: number, b: number, a: number) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  const n = pts.length
  for (let y = Math.max(0, Math.floor(y0 - 1)); y <= Math.min(H - 1, Math.ceil(y1 + 1)); y++)
    for (let x = Math.max(0, Math.floor(x0 - 1)); x <= Math.min(W - 1, Math.ceil(x1 + 1)); x++) {
      const px = x + 0.5
      const py = y + 0.5
      let inside = false
      let dmin = 0.5
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [ax, ay] = pts[j]
        const [bx, by] = pts[i]
        if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside
        // Only edges within half a pixel change the coverage.
        if (px < Math.min(ax, bx) - 0.5 || px > Math.max(ax, bx) + 0.5 || py < Math.min(ay, by) - 0.5 || py > Math.max(ay, by) + 0.5) continue
        const dx = bx - ax
        const dy = by - ay
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1e-6)))
        dmin = Math.min(dmin, Math.hypot(px - ax - dx * t, py - ay - dy * t))
      }
      const cov = Math.max(0, Math.min(1, (inside ? dmin : -dmin) + 0.5)) * a
      if (cov <= 0) continue
      const o = (y * W + x) * 3
      hdr[o] += (r - hdr[o]) * cov
      hdr[o + 1] += (g - hdr[o + 1]) * cov
      hdr[o + 2] += (b - hdr[o + 2]) * cov
    }
}

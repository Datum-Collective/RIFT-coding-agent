/**
 * The singularity: a black hole that opens behind the RIFT logo on the home screen, tears the
 * logo's dots off into filaments and swallows them, then spins with its accretion disk until a key
 * sends it away and the logo comes back, dot for dot.
 *
 * It is drawn in braille. Each terminal cell is two dots across and four down, so the scene is a
 * grid of 2*cols by 4*rows dots, and since a cell is about twice as tall as it is wide, a dot is
 * square and a circle of dots is round on screen. A cell shows one colour, the intensity-weighted
 * mix of the light that lands in it.
 *
 * The physics is faked wherever a fake looks right: the disk is bent into an arch and a far arc by a
 * closed-form formula, inner dots orbit faster than outer ones by a power law, the side turning toward
 * the viewer is brighter, and the colour runs white-hot to crimson from the inner edge to the rim.
 * Every per-frame structure is a typed array made once, so a frame allocates nothing.
 */
import { DOT_BIT, type Logo } from "./logo"
import { random } from "./random"
import { bannerColours, type BannerColours } from "../banner"

const TAU = Math.PI * 2

/* Geometrised units, G = c = M = 1: every length is in units of the hole's mass M. The black disc is
   not the horizon (2M). Light grazing the photon sphere at 3M reaches a distant observer at the
   critical impact parameter b_c = 3√3 M ≈ 5.196 M, about 2.6 r_s, and that is the shadow's radius. */
export const R_SHADOW = 3 * Math.sqrt(3)
export const R_ISCO = 6
export const R_DISK_OUT = 22
/** Angle between the disk's axis and the line of sight: near edge-on, so lensing lifts the far half into an arch. */
const INCLINATION = (80 * Math.PI) / 180
const COS_I = Math.cos(INCLINATION)
const SIN_I = Math.sin(INCLINATION)

/* Kepler's third law: Ω(r) = Ω_isco (r / r_isco)^(-3/2). Inner orbits are faster by a power law, not an
   exponential; the rim turns (22/6)^1.5 ≈ 7 times slower than the ISCO. */
const ISCO_PERIOD_S = 4.4
export const OMEGA_ISCO = TAU / ISCO_PERIOD_S
/** Each disk particle is drawn as the arc it swept in this long, so the disk reads as motion. */
const STREAK_S = 0.15

/* Brightness: the side moving toward the viewer is brighter, I ∝ δ^3 with δ = 1 / (1 − β_los), and the
   inner edge dims by g^3, g = √(1 − 2M/r). The colour shift is damped to δ^0.3 so the radial thermal grading stays readable. */
const DISK_EXPOSURE = 1.3
const DISK_FLARE = 0.02
const COLOR_SHIFT_EXP = 0.3
const IMAGE_GAIN_MAX = 3
/** Light below this is not worth drawing. */
const I_FLOOR = 0.03

/* How many disk particles, by the scale. A streak's length in dots grows with the scale and the disk's
   area with its square, so a count proportional to the scale keeps the disk equally dense at any size:
   4000 at 120x40, about 5400 at 200x50. */
const DISK_MIN = 1500
export const DISK_MAX = 6000
const DISK_PER_PPM = 735

/** The scene is scaled so the disk's rim would span the width and the lensed arch fit above the centre, then shrunk to this share of that: a hole in the middle of the screen, not the whole screen. */
const FIT_HALF_WIDTH = R_DISK_OUT
const FIT_HALF_HEIGHT = 13.5
const SCENE_SHARE = 0.6

/* The photon ring: the stacked higher-order images of the whole disk, which pile up just outside b_c.
   It is drawn one dot outside the shadow so it stays a crisp line, brightest on the approaching side. */
const RING_I = 1.1
const RING_T = 1.02

/* Logo infall, in M and seconds. Gravity a = −K/(r² + ε²); a tangential drive toward a sub-Keplerian
   speed, so every orbit decays inward as a spiral; and two points per fragment, so the gravity
   difference between head and tail is the tidal gradient (radial stretch 2K/r³ per unit separation),
   amplified by TIDAL_GAIN so the tear reads within seconds instead of an orbital time. */
/** Grows with the cube of the shrink: the logo is that much further from a smaller hole in M, and a fall from d under K/r² lasts d^1.5 / √K, so this keeps it as long as it was. */
const K_GRAV = 1000 / SCENE_SHARE ** 3
const SOFTENING2 = 1
const SWIRL_RATE = 4
const SWIRL_RAMP_S = 0.6
const SWIRL_SHARE = 0.85
const DRAIN_S = 2
const OUTWARD_DRAG = 3
const TIDAL_GAIN = 12
const BIND_K = 70
const RELEASE_MIN_S = 0.12
const RELEASE_SPAN_S = 2.4
const RELEASE_JITTER_S = 0.35
const SPEED_MAX = 70
const LEN_PER_R = 0.55
const LEN_CAP = 6.5
const SUBSTEP_S = 1 / 120
const MAX_SUBSTEPS = 4
const DT_MAX_S = 0.1
const FLARE_DECAY_S = 0.7
const HEAT_FROM_R = 15
/** A torn dot is fully heated once it has fallen this far, in M, or this long after it was let go. */
const HEAT_FALL = 1.5
const HEAT_AFTER_S = 0.4
const TAIL = 0.5
/** A torn fragment has become its strand once it is this many dots longer than it set off. */
const STRAND_DOTS = 3
/** A strand's light on each of its dots is its cell's dots' worth spread along it, up to this. */
const STRAND_MAX = 1.4
/** How far a cell's dots reach from its middle, in dots: the opening shadow has passed them all once it is this far past the middle. */
const CELL_REACH_DOTS = Math.hypot(1, 2)
const FLARE_PER_FRAGMENT = 1.2
/** A fragment sets off this many dots long, about a cell's size. */
const SEP_DOTS = 2
/** Reforming, a dot drifts in from up to this far, in M, as it fades back in. */
const REFORM_DRIFT = 0.45
const REFORM_DOT_S = 0.7
const REFORM_SPREAD_S = 0.5

/**
 * What the scene is doing, in order. The hole fades in round the logo, tears it apart, and spins
 * until a key, when it fades out as the logo comes back. `hole` is how far the hole has faded in,
 * given the seconds into the phase and how far in it was when the phase began.
 */
export type Phase = "fadeIn" | "tearing" | "steady" | "reform" | "done"
const PHASES: Record<Phase, { seconds: number; then: Phase; hole: (u: number, from: number) => number }> = {
  fadeIn: { seconds: 1.6, then: "tearing", hole: (u) => smooth(u) },
  // Over sooner, once the last of the logo is swallowed.
  tearing: { seconds: 12, then: "steady", hole: () => 1 },
  steady: { seconds: Infinity, then: "steady", hole: () => 1 },
  reform: { seconds: 1.2, then: "done", hole: (u, from) => from * (1 - smooth(u)) },
  done: { seconds: Infinity, then: "done", hole: () => 0 },
}

function smooth(x: number) {
  const t = x < 0 ? 0 : x > 1 ? 1 : x
  return t * t * (3 - 2 * t)
}

// --- the colour ramp -------------------------------------------------------------------------------------

/* Temperature T ∝ r^(−3/4), normalised to about 1 at the ISCO, mapped through the RIFT banner's own inks:
   dim navy at the rim, navy, azure, then pale blue and white at the inner edge. A theme's accent
   recolours the blues exactly as it does the logo, so the hole and the logo are one family. */
const T_STOPS = [0.26, 0.4, 0.54, 0.68, 0.8, 0.9, 0.98, 1.1, 1.3] as const
const LUT_N = 64
const T_MIN = 0.26
const T_MAX = 1.3
const LUT_SCALE = LUT_N / (T_MAX - T_MIN)
const INK_DARKEN = 0.7
/** On a light page the shadow is drawn, a disc of dots in this. */
const SHADOW_INK = [16, 16, 20] as const

const hex = (colour: string) => [parseInt(colour.slice(1, 3), 16), parseInt(colour.slice(3, 5), 16), parseInt(colour.slice(5, 7), 16)]
const mix = (a: number[], b: number[], f: number) => a.map((v, i) => v + (b[i] - v) * f)

/** The ramp, three channels an entry from T_MIN to T_MAX, in the banner's inks. On a light page each entry is darkened by its own brightness: white-hot turns dark grey, so brightness reads as how much ink there is. */
function buildRamp(colours: BannerColours, ink: boolean) {
  const navy = hex(colours.ink.navy)
  const azure = hex(colours.ink.azure)
  const white = hex(colours.ink.white)
  const stops = [
    navy.map((v) => v * 0.4),
    navy,
    mix(navy, azure, 0.55),
    azure,
    mix(azure, white, 0.45),
    mix(azure, white, 0.8),
    white,
    white,
    mix(white, azure, 0.3),
  ]
  const ramp = new Float32Array(LUT_N * 3)
  for (let k = 0; k < LUT_N; k++) {
    const t = T_MIN + (k + 0.5) / LUT_SCALE
    let i = 0
    while (i < T_STOPS.length - 2 && t > T_STOPS[i + 1]) i++
    const f = Math.max(0, Math.min(1, (t - T_STOPS[i]) / (T_STOPS[i + 1] - T_STOPS[i])))
    const c = mix(stops[i], stops[i + 1], f)
    const luminance = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255
    for (let j = 0; j < 3; j++) ramp[k * 3 + j] = ink ? c[j] * (1 - INK_DARKEN * luminance) : c[j]
  }
  return ramp
}

/** The ramp's entry for a temperature. */
export function thermal(t: number) {
  const k = ((t - T_MIN) * LUT_SCALE) | 0
  return (k < 0 ? 0 : k >= LUT_N ? LUT_N - 1 : k) * 3
}

// --- bending, by two cheap tricks ---------------------------------------------------------------------

/* Where the disk's light lands on screen, as a distance b from the centre, is faked in closed form.
   The near image of a particle at angle psi from the line of sight is lifted over the hole by
   cos(a) = 1 - (1 - cos(psi))(1 - 2/r), which is what makes the disk arch above the disc. The far image,
   the dimmer arc under it, hugs the shadow: it sits a hair outside it for particles in front of the hole
   and moves out as they go behind it, further for orbits further out. */
const FAR_BASE = 0.35
const FAR_REACH = 0.65
const FAR_HEAT = 0.8
const FAR_FLOOR = 0.85
/** What `bend` found: the image's distance b from the centre and how fast b grows with r. */
const BEND = new Float64Array(2)

function near(r: number, psi: number) {
  const f = 1 - 2 / r
  const c = 1 - (1 - Math.cos(psi)) * f
  return (r * Math.sqrt(Math.max(0, 1 - c * c))) / Math.sqrt(f)
}

/** The image of a particle at radius r. phi in [0, pi] is the near image at angle phi; above pi it is the far image of angle 2 pi - phi. */
export function bend(r: number, phi: number) {
  if (phi <= Math.PI) {
    BEND[0] = near(r, phi)
    BEND[1] = (near(r + 0.05, phi) - near(r - 0.05, phi)) * 10
  } else {
    const e = (1 - Math.cos(phi)) / 2
    const g = 1 / (1 - FAR_HEAT * e) - FAR_FLOOR
    const k = Math.min(1, Math.max(0, (r - R_ISCO) / (R_DISK_OUT - R_ISCO)))
    BEND[0] = R_SHADOW + (FAR_BASE + FAR_REACH * k) * g
    BEND[1] = (FAR_REACH / (R_DISK_OUT - R_ISCO)) * g
  }
  return BEND
}

// --- drawing ----------------------------------------------------------------------------------------

/** A dot is lit once the light on it passes its threshold, set by a 4x4 ordered (Bayer) matrix, so faint light is a sparse, even scatter of dots. */
const LIT_FLOOR = 0.03
const LIT_SPAN = 0.6
const LIT = new Float32Array([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((rank) => LIT_FLOOR + ((rank + 0.5) / 16) * LIT_SPAN))
/** A cell's colour is dimmed by how faint its dots are, but never below this. */
const TONE_MIN = 0.75
/** Light past full brightness turns a cell towards white, up to this far: the glare of the inner edge. */
const WHITE_MAX = 0.55
const WHITE_RATE = 0.22
/** A line longer than this many dots is a particle flung far off the screen, not worth tracing. */
const MAX_STEPS = 4096
/** Near ψ ≈ π an image moves along an Einstein-ring-like arc; a streak whose chord would sag more than this many dots inside it is drawn as a polyline. */
const ARC_SAG = 0.75
const ARC_MAX_STEPS = 12

export type LogoAt = { logo: Logo; col: number; row: number }

export type Options = {
  cols: number
  rows: number
  seed: number
  /** The logo on the screen, and the cell its top left corner is in. Its dots are what the hole tears apart. */
  logo?: LogoAt
  /** Drawn on a light page: in ink, as `ink` says. */
  ink?: boolean
  /** The banner's inks, in the theme's accent. The hole is drawn in them. */
  colours?: BannerColours
}

export class Singularity {
  cols = 0
  rows = 0
  /** Per cell: the braille dots lit, as the character's bits, 0 for none. */
  bits = new Uint8Array(0)
  /** Per cell: the colour its dots are drawn in, three channels. */
  rgb = new Uint8Array(0)

  phase: Phase = "fadeIn"
  /** Seconds into the phase. */
  phaseT = 0
  /** How far the hole has faded in, 0 to 1. */
  hole = 0
  /** The cell the logo's top left corner is in, while the scene has the logo. The banner is hidden meanwhile. */
  logoAt?: { col: number; row: number }
  /**
   * Whether the page is light. Light cannot be drawn brighter than white paper, so the scene is drawn
   * in ink instead: the shadow as a disc of dark dots, the disk in the darkened ramp, faint light fading
   * towards the paper rather than towards black.
   */
  ink = false
  /** The colour ramp the light is drawn in, and the same darkened for a light page. */
  private ramp = new Float32Array(0)
  private rampInk = new Float32Array(0)

  // The view: dots across and down, the hole's centre in dots, and dots per M.
  private pw = 0
  private ph = 0
  private cx = 0
  private cy = 0
  ppm = 1
  /** Light on each dot, and per cell the light-weighted sum of its colour and the light itself. */
  private acc = new Float32Array(0)
  private cellR = new Float32Array(0)
  private cellG = new Float32Array(0)
  private cellB = new Float32Array(0)
  private cellW = new Float32Array(0)
  /** Each dot's distance from the hole's centre, in dots. */
  private dist = new Float32Array(0)
  /** The dots near enough to the centre to be in the photon ring at some size of the shadow, nearest first, with their distances and brightness. */
  private ringAt = new Int32Array(0)
  private ringD = new Float32Array(0)
  private ringI = new Float32Array(0)
  /** The shadow's radius now, in dots: it opens from the centre as the hole fades in. */
  radius = 0

  // The disk, one entry a particle. r, height off the plane, distance from the hole, angle, angular speed,
  // orbital speed, its Lorentz factor, emission and temperature.
  readonly dR = new Float32Array(DISK_MAX)
  private readonly dH = new Float32Array(DISK_MAX)
  private readonly dR3 = new Float32Array(DISK_MAX)
  readonly dPhi = new Float32Array(DISK_MAX)
  private readonly dOmega = new Float32Array(DISK_MAX)
  private readonly dV = new Float32Array(DISK_MAX)
  private readonly dLum = new Float32Array(DISK_MAX)
  private readonly dTemp = new Float32Array(DISK_MAX)
  diskN = 0

  // The logo, one entry a fragment: a cell of it, which the hole tears off as one strand. Where it rests
  // (its middle, in M from the hole), which of its dots are lit and their colour, and as a strand its head
  // and tail, their velocities, its own pull and swirl, when it is let go, and how far it has faded back
  // in when reforming. A cell rather than a dot: the logo lights two dots in three, and four thousand
  // strands in that space are one solid slab, where seven hundred are a skein you can see through.
  logoN = 0
  private fragCol = new Int16Array(0)
  private fragRow = new Int16Array(0)
  private fragBits = new Uint8Array(0)
  private fragDots = new Uint8Array(0)
  private homeX = new Float32Array(0)
  private homeY = new Float32Array(0)
  private restR = new Uint8Array(0)
  private restG = new Uint8Array(0)
  private restB = new Uint8Array(0)
  lX = new Float32Array(0)
  lY = new Float32Array(0)
  private lVX = new Float32Array(0)
  private lVY = new Float32Array(0)
  private lTX = new Float32Array(0)
  private lTY = new Float32Array(0)
  private lTVX = new Float32Array(0)
  private lTVY = new Float32Array(0)
  private lSeed = new Float32Array(0)
  private lSwirl = new Float32Array(0)
  private lGrav = new Float32Array(0)
  private lDelay = new Float32Array(0)
  private lFade = new Float32Array(0)
  lAlive = new Uint8Array(0)
  logoAlive = 0
  /** A fragment's length as it sets off, in M. */
  private sep = 0

  /** Seconds the logo has been under tidal stress, and what is left over from the last fixed step. */
  private tearT = 0
  private accum = 0
  /** Brightening of the disk as the logo is swallowed. */
  private flare = 0
  /** How far the hole had faded in when the reform began. */
  private holeFrom = 0
  private readonly rng: ReturnType<typeof random>

  constructor(options: Options) {
    this.rng = random(options.seed)
    this.ink = options.ink ?? false
    this.recolour(options.colours ?? bannerColours())
    this.initDisk()
    this.place(options.cols, options.rows, options.logo)
  }

  get done() {
    return this.phase === "done"
  }

  private initDisk() {
    const rng = this.rng
    for (let i = 0; i < DISK_MAX; i++) {
      const r = R_ISCO + (R_DISK_OUT - R_ISCO) * Math.pow(rng.float(), 1.55)
      const h = Math.sqrt(-2 * Math.log(1 - rng.float())) * Math.cos(TAU * rng.float()) * DISK_FLARE * r
      this.dR[i] = r
      this.dH[i] = h
      this.dR3[i] = Math.sqrt(r * r + h * h)
      this.dPhi[i] = rng.float() * TAU
      this.dOmega[i] = OMEGA_ISCO * Math.pow(r / R_ISCO, -1.5)
      // Orbital speed as a fraction of the speed of light, fastest at the inner edge.
      const v = Math.sqrt(1 / (r - 2))
      this.dV[i] = v
      const g = Math.sqrt(1 - 2 / r)
      const t = Math.pow(r / R_ISCO, -0.75)
      const ripple = 0.5 + 0.5 * Math.sin(r * 2.9 + 1.8 * Math.sin(r * 0.71))
      const rings = 0.55 + 0.45 * ripple * ripple
      this.dLum[i] = DISK_EXPOSURE * t * t * t * g * g * g * rings * (0.55 + 0.9 * rng.float())
      this.dTemp[i] = 1.12 * t * g
    }
  }

  /**
   * Fits the scene to a screen `cols` by `rows` and puts the logo where it is now. Called when the
   * scene is made, and again when the terminal is resized, the logo moves, or its colours change: the
   * hole and anything already falling into it carry on where they are.
   */
  /** Draws the hole in these inks from the next frame. */
  recolour(colours: BannerColours) {
    this.ramp = buildRamp(colours, false)
    this.rampInk = buildRamp(colours, true)
  }

  place(cols: number, rows: number, logo?: LogoAt) {
    if (cols !== this.cols || rows !== this.rows) {
      this.cols = cols
      this.rows = rows
      this.pw = cols * 2
      this.ph = rows * 4
      const n = this.pw * this.ph
      this.acc = new Float32Array(n)
      this.dist = new Float32Array(n)
      this.bits = new Uint8Array(cols * rows)
      this.rgb = new Uint8Array(cols * rows * 3)
      this.cellR = new Float32Array(cols * rows)
      this.cellG = new Float32Array(cols * rows)
      this.cellB = new Float32Array(cols * rows)
      this.cellW = new Float32Array(cols * rows)
      this.cx = cols
      this.cy = rows * 2
      this.ppm = SCENE_SHARE * Math.min(this.pw / 2 / FIT_HALF_WIDTH, this.ph / 2 / FIT_HALF_HEIGHT)
      this.diskN = Math.round(Math.max(DISK_MIN, Math.min(DISK_MAX, this.ppm * DISK_PER_PPM)))
      this.layShadow()
    }
    this.placeLogo(logo)
  }

  /** Each dot's distance from the centre, and the dots the photon ring can fall on, nearest first. */
  private layShadow() {
    const { pw, ph, cx, cy } = this
    const reach = R_SHADOW * this.ppm + 1
    const near: number[] = []
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const dx = x + 0.5 - cx
        const dy = y + 0.5 - cy
        const d = Math.sqrt(dx * dx + dy * dy)
        this.dist[y * pw + x] = d
        if (d < reach) near.push(y * pw + x)
      }
    }
    near.sort((a, b) => this.dist[a] - this.dist[b])
    this.ringAt = Int32Array.from(near)
    this.ringD = Float32Array.from(near, (p) => this.dist[p])
    // The approaching side, on the left, is the bright one, as the disk's is; the faint side still lights every dot.
    this.ringI = Float32Array.from(near, (p) => RING_I * (0.85 - (0.25 * ((p % pw) + 0.5 - cx)) / Math.max(0.5, this.dist[p])))
  }

  private placeLogo(logo: LogoAt | undefined) {
    const fits = logo !== undefined && logo.col >= 0 && logo.row >= 0 && logo.col + logo.logo.cols <= this.cols && logo.row + logo.logo.rows <= this.rows
    if (!fits) {
      // A logo that is not (or no longer) wholly on the screen is left to the banner.
      this.logoAt = undefined
      this.logoN = 0
      return
    }
    const { logo: art, col, row } = logo
    const n = art.cells.reduce((count, cell) => count + (cell ? 1 : 0), 0)
    if (n !== this.fragBits.length) this.allocateLogo(n)
    this.logoAt = { col, row }
    this.sep = SEP_DOTS / this.ppm
    let i = 0
    for (let fr = 0; fr < art.rows; fr++) {
      for (let fc = 0; fc < art.cols; fc++) {
        const cell = art.cells[fr * art.cols + fc]
        if (!cell) continue
        this.fragCol[i] = fc
        this.fragRow[i] = fr
        this.fragBits[i] = cell.bits
        let dots = 0
        for (let bits = cell.bits; bits; bits &= bits - 1) dots++
        this.fragDots[i] = dots
        this.homeX[i] = ((col + fc) * 2 + 1 - this.cx) / this.ppm
        this.homeY[i] = (this.cy - (row + fr) * 4 - 2) / this.ppm
        this.restR[i] = Math.round(cell.colour.r)
        this.restG[i] = Math.round(cell.colour.g)
        this.restB[i] = Math.round(cell.colour.b)
        // Before the tearing a fragment sits at home; after, it carries on from where it is.
        if (this.phase === "fadeIn") this.rest(i)
        i++
      }
    }
    this.logoN = n
  }

  private allocateLogo(n: number) {
    this.fragCol = new Int16Array(n)
    this.fragRow = new Int16Array(n)
    this.fragBits = new Uint8Array(n)
    this.fragDots = new Uint8Array(n)
    this.homeX = new Float32Array(n)
    this.homeY = new Float32Array(n)
    this.restR = new Uint8Array(n)
    this.restG = new Uint8Array(n)
    this.restB = new Uint8Array(n)
    this.lX = new Float32Array(n)
    this.lY = new Float32Array(n)
    this.lAlive = new Uint8Array(n).fill(1)
    this.lVX = new Float32Array(n)
    this.lVY = new Float32Array(n)
    this.lTX = new Float32Array(n)
    this.lTY = new Float32Array(n)
    this.lTVX = new Float32Array(n)
    this.lTVY = new Float32Array(n)
    this.lSeed = new Float32Array(n)
    this.lSwirl = new Float32Array(n)
    this.lGrav = new Float32Array(n)
    this.lDelay = new Float32Array(n)
    this.lFade = new Float32Array(n).fill(1)
    // Each fragment gets its own brightness, angular momentum and pull, so neighbours drift onto
    // different spirals and the letters unravel into separate strands instead of falling as one sheet.
    for (let i = 0; i < n; i++) {
      this.lSeed[i] = 0.78 + 0.22 * this.rng.float()
      this.lSwirl[i] = SWIRL_SHARE + 0.24 * this.rng.float()
      this.lGrav[i] = 0.82 + 0.36 * this.rng.float()
    }
    this.logoAlive = n
  }

  /** Puts fragment `i` at home, still. */
  private rest(i: number) {
    const hx = this.homeX[i]
    const hy = this.homeY[i]
    const d = Math.sqrt(hx * hx + hy * hy) + 1e-6
    this.lX[i] = hx
    this.lY[i] = hy
    this.lTX[i] = hx + (hx / d) * this.sep
    this.lTY[i] = hy + (hy / d) * this.sep
    this.lVX[i] = 0
    this.lVY[i] = 0
    this.lTVX[i] = 0
    this.lTVY[i] = 0
  }

  /** A key was pressed: the hole fades out and the logo comes back where it was. */
  leave() {
    if (this.phase === "reform" || this.phase === "done") return
    const keep = this.phase === "fadeIn"
    this.holeFrom = this.hole
    this.phase = "reform"
    this.phaseT = 0
    for (let i = 0; i < this.logoN; i++) {
      // Fragments still at home stay; the rest come back from where they were swallowed, fading in a little apart.
      if (keep) continue
      this.rest(i)
      this.lAlive[i] = 1
      this.lFade[i] = 0
      this.lDelay[i] = this.rng.float() * REFORM_SPREAD_S
      const a = this.rng.float() * TAU
      this.lVX[i] = Math.cos(a)
      this.lVY[i] = Math.sin(a)
    }
    this.logoAlive = this.logoN
  }

  /** Moves the scene on by `dt` seconds. */
  step(dt: number) {
    if (dt > DT_MAX_S) dt = DT_MAX_S
    if (!(dt > 0)) dt = 0
    this.phaseT += dt
    const spec = PHASES[this.phase]
    if (this.phaseT >= spec.seconds) this.enter(spec.then)

    for (let i = 0; i < this.diskN; i++) {
      let p = this.dPhi[i] + this.dOmega[i] * dt
      if (p > TAU) p -= TAU
      this.dPhi[i] = p
    }

    if (this.phase === "tearing") {
      this.accum += dt
      let steps = 0
      while (this.accum >= SUBSTEP_S && steps < MAX_SUBSTEPS) {
        this.tearT += SUBSTEP_S
        this.stepLogo()
        this.accum -= SUBSTEP_S
        steps++
      }
      if (steps === MAX_SUBSTEPS) this.accum = 0
      if (this.logoAlive <= 0) this.enter("steady")
    } else if (this.phase === "reform") {
      for (let i = 0; i < this.logoN; i++) {
        if (this.lFade[i] >= 1) continue
        this.lFade[i] = smooth((this.phaseT - this.lDelay[i]) / REFORM_DOT_S)
      }
    }
    this.flare *= Math.exp(-dt / FLARE_DECAY_S)
    const now = PHASES[this.phase]
    this.hole = now.hole(this.phaseT / now.seconds, this.holeFrom)
    this.radius = R_SHADOW * this.ppm * this.hole
    if (this.phase === "fadeIn") this.swallowUnder(this.radius / this.ppm)
  }

  /** The opening shadow takes a fragment once its edge has passed all of its dots (each is hidden as the edge passes it). */
  private swallowUnder(r: number) {
    const reach = r - CELL_REACH_DOTS / this.ppm
    const r2 = reach > 0 ? reach * reach : 0
    for (let i = 0; i < this.logoN; i++) {
      if (this.lAlive[i] && this.homeX[i] * this.homeX[i] + this.homeY[i] * this.homeY[i] < r2) {
        this.lAlive[i] = 0
        this.logoAlive--
      }
    }
  }

  private enter(phase: Phase) {
    if (phase === this.phase) return
    if (phase === "tearing") this.startTearing()
    if (phase === "steady") {
      // Whatever has not fallen in by now is swallowed with the rest.
      this.lAlive.fill(0)
      this.logoAlive = 0
    }
    if (phase === "done") this.lFade.fill(1)
    this.phase = phase
    this.phaseT = 0
  }

  /** Lets the logo go, nearest first: each fragment is released after a delay that grows with its distance from the hole. */
  private startTearing() {
    let dMin = Infinity
    let dMax = 0
    for (let i = 0; i < this.logoN; i++) {
      if (!this.lAlive[i]) continue
      const d = Math.hypot(this.homeX[i], this.homeY[i])
      if (d < dMin) dMin = d
      if (d > dMax) dMax = d
    }
    const span = Math.max(1e-3, dMax - dMin)
    for (let i = 0; i < this.logoN; i++) {
      const d = Math.hypot(this.homeX[i], this.homeY[i])
      const delay = RELEASE_MIN_S + (RELEASE_SPAN_S * (d - dMin)) / span + (this.rng.float() - 0.5) * RELEASE_JITTER_S
      this.lDelay[i] = delay < RELEASE_MIN_S ? RELEASE_MIN_S : delay
      this.rest(i)
    }
    this.tearT = 0
    this.accum = 0
  }

  /** One fixed step of the fall: gravity, swirl and tidal stretch on each fragment's head and tail. */
  private stepLogo() {
    const h = SUBSTEP_S
    const t = this.tearT
    const rs2 = R_SHADOW * R_SHADOW
    const sep = this.sep
    let eaten = 0
    for (let i = 0; i < this.logoN; i++) {
      if (!this.lAlive[i]) continue
      const u = Math.min(1, t / this.lDelay[i])
      // Held at home by a spring that weakens until the fragment is let go.
      const kb = BIND_K * (1 - u * u * (3 - 2 * u))
      const cb = 2 * Math.sqrt(kb)
      const x = this.lX[i]
      const y = this.lY[i]
      const vx = this.lVX[i]
      const vy = this.lVY[i]
      const tx = this.lTX[i]
      const ty = this.lTY[i]
      const tvx = this.lTVX[i]
      const tvy = this.lTVY[i]
      const swirl = smooth((t - this.lDelay[i]) / SWIRL_RAMP_S)
      // Its angular momentum drains away as it orbits, so every orbit decays and nothing is left circling.
      const share = this.lSwirl[i] * (1 - smooth((t - this.lDelay[i] - SWIRL_RAMP_S) / DRAIN_S))
      const kGrav = K_GRAV * this.lGrav[i]

      accel(x, y, vx, vy, kGrav, share, swirl)
      let ax = ACC[0]
      let ay = ACC[1]
      accel(tx, ty, tvx, tvy, kGrav, share, swirl)
      let bx = ACC[0]
      let by = ACC[1]
      // The tail feels the gravity difference across the fragment, amplified: the tidal stretch.
      bx = bx + (TIDAL_GAIN - 1) * (bx - ax)
      by = by + (TIDAL_GAIN - 1) * (by - ay)

      const hx = this.homeX[i]
      const hy = this.homeY[i]
      const hd = Math.sqrt(hx * hx + hy * hy) + 1e-6
      ax += -kb * (x - hx) - cb * vx
      ay += -kb * (y - hy) - cb * vy
      bx += -kb * (tx - hx - (hx / hd) * sep) - cb * tvx
      by += -kb * (ty - hy - (hy / hd) * sep) - cb * tvy

      let nvx = vx + ax * h
      let nvy = vy + ay * h
      const kh = Math.min(1, SPEED_MAX / Math.sqrt(nvx * nvx + nvy * nvy + 1e-12))
      nvx *= kh
      nvy *= kh
      let ntvx = tvx + bx * h
      let ntvy = tvy + by * h
      const kt = Math.min(1, SPEED_MAX / Math.sqrt(ntvx * ntvx + ntvy * ntvy + 1e-12))
      ntvx *= kt
      ntvy *= kt

      const nx = x + nvx * h
      const ny = y + nvy * h
      const rh = Math.sqrt(nx * nx + ny * ny)
      const lmax = Math.min(LEN_CAP, LEN_PER_R * Math.max(rh, R_SHADOW))
      const sx = tx + ntvx * h - nx
      const sy = ty + ntvy * h - ny
      const kl = Math.min(1, lmax / (Math.sqrt(sx * sx + sy * sy) + 1e-9))

      this.lX[i] = nx
      this.lY[i] = ny
      this.lVX[i] = nvx
      this.lVY[i] = nvy
      this.lTX[i] = nx + sx * kl
      this.lTY[i] = ny + sy * kl
      this.lTVX[i] = ntvx
      this.lTVY[i] = ntvy

      // Swallowed once head and tail are both over the shadow's edge.
      const ntx = this.lTX[i]
      const nty = this.lTY[i]
      if (nx * nx + ny * ny < rs2 && ntx * ntx + nty * nty < rs2) {
        this.lAlive[i] = 0
        eaten++
      }
    }
    this.logoAlive -= eaten
    this.flare += (eaten * FLARE_PER_FRAGMENT) / Math.max(1, this.logoN)
  }

  // --- drawing --------------------------------------------------------------------------------------

  /** Works the scene out into cells: `bits` and `rgb`. */
  render() {
    this.acc.fill(0)
    this.cellR.fill(0)
    this.cellG.fill(0)
    this.cellB.fill(0)
    this.cellW.fill(0)
    if (this.hole > 0) {
      this.drawDisk()
      this.drawRing()
    }
    this.drawLogo()
    this.resolve()
  }

  /** The disk: each particle's primary image (over the shadow if it is in front) and its secondary image under the hole. */
  private drawDisk() {
    const bright = this.hole * (1 + this.flare)
    for (let i = 0; i < this.diskN; i++) {
      const p = this.dPhi[i]
      const r = this.dR[i]
      const hgt = this.dH[i]
      const c = Math.cos(p)
      const s = Math.sin(p)
      const d = this.dOmega[i] * STREAK_S
      const c0 = c + s * d
      const s0 = s - c * d

      const b1 = r * s
      const b0 = r * s0
      const x1 = r * c
      const y1 = b1 * COS_I + hgt * SIN_I
      const z1 = -b1 * SIN_I + hgt * COS_I
      const x0 = r * c0
      const y0 = b0 * COS_I + hgt * SIN_I
      const z0 = -b0 * SIN_I + hgt * COS_I
      const rho1 = Math.sqrt(x1 * x1 + y1 * y1) + 1e-6
      const rho0 = Math.sqrt(x0 * x0 + y0 * y0) + 1e-6
      const ux1 = x1 / rho1
      const uy1 = y1 / rho1
      const ux0 = x0 / rho0
      const uy0 = y0 / rho0
      const psi1 = Math.atan2(rho1, z1)
      const psi0 = Math.atan2(rho0, z0)
      const r3 = this.dR3[i]
      const inv = r3 / rho1

      // Approaching (left) side: β_los > 0. The secondary image leaves the particle heading away from the
      // observer before it wraps around the hole, so its line-of-sight speed flips sign.
      const betaLos = -this.dV[i] * c * SIN_I
      const delta = 1 / (1 - betaLos)
      const deltaBack = 1 / (1 + betaLos)
      const lum = this.dLum[i] * bright

      // Point flux scales with magnification. A streak's drawn length already carries the tangential
      // stretch, so only the radial factor (∂b/∂r)/(∂ρ/∂r) = (∂b/∂r)/sin ψ scales its brightness.
      bend(r3, psi1)
      const pb1 = BEND[0]
      const gain = Math.min(IMAGE_GAIN_MAX, BEND[1] * inv)
      const pb0 = bend(r3, psi0)[0]
      const front = z1 > 0
      this.image(ux0, uy0, pb0, ux1, uy1, pb1, lum * delta * delta * delta * gain, thermal(this.dTemp[i] * Math.pow(delta, COLOR_SHIFT_EXP)), front)

      bend(r3, TAU - psi1)
      const sb1 = BEND[0]
      const gainS = Math.min(IMAGE_GAIN_MAX, BEND[1] * inv)
      const sb0 = bend(r3, TAU - psi0)[0]
      this.image(-ux0, -uy0, sb0, -ux1, -uy1, sb1, lum * deltaBack * deltaBack * deltaBack * gainS, thermal(this.dTemp[i] * Math.pow(deltaBack, COLOR_SHIFT_EXP)), false)
    }
  }

  /** One image of a disk particle: a streak from its tail (direction u0, impact parameter b0) to its head. */
  private image(ux0: number, uy0: number, b0: number, ux1: number, uy1: number, b1: number, light: number, lut: number, front: boolean) {
    if (light < I_FLOOR) return
    const s = this.ppm
    const cx = this.cx
    const cy = this.cy
    const ramp = this.ink ? this.rampInk : this.ramp
    const r = ramp[lut]
    const g = ramp[lut + 1]
    const b = ramp[lut + 2]
    const dot = ux0 * ux1 + uy0 * uy1
    const bpx = (b0 > b1 ? b0 : b1) * s
    if ((1 - dot) * bpx < 4 * ARC_SAG) {
      this.line(cx + ux0 * b0 * s, cy - uy0 * b0 * s, cx + ux1 * b1 * s, cy - uy1 * b1 * s, light * 0.6, light, r, g, b, front)
      return
    }
    const da = Math.atan2(ux0 * uy1 - uy0 * ux1, dot)
    let n = Math.ceil((da < 0 ? -da : da) / Math.sqrt((8 * ARC_SAG) / bpx))
    if (n > ARC_MAX_STEPS) n = ARC_MAX_STEPS
    const step = da / n
    const cs = Math.cos(step)
    const sn = Math.sin(step)
    let ux = ux0
    let uy = uy0
    let px = cx + ux0 * b0 * s
    let py = cy - uy0 * b0 * s
    for (let k = 1; k <= n; k++) {
      const nux = ux * cs - uy * sn
      uy = ux * sn + uy * cs
      ux = nux
      const bk = (b0 + ((b1 - b0) * k) / n) * s
      const qx = cx + ux * bk
      const qy = cy - uy * bk
      this.line(px, py, qx, qy, light * (0.6 + (0.4 * (k - 1)) / n), light * (0.6 + (0.4 * k) / n), r, g, b, front)
      px = qx
      py = qy
    }
  }

  /** The photon ring: the dots just outside the shadow's edge. */
  private drawRing() {
    const lut = thermal(RING_T)
    const ramp = this.ink ? this.rampInk : this.ramp
    const r = ramp[lut]
    const g = ramp[lut + 1]
    const b = ramp[lut + 2]
    const light = this.hole * (1 + this.flare)
    const cols = this.cols
    const pw = this.pw
    const from = this.radius
    for (let k = firstAtLeast(this.ringD, from); k < this.ringAt.length && this.ringD[k] < from + 1; k++) {
      const p = this.ringAt[k]
      const v = this.ringI[k] * light
      this.acc[p] += v
      const c = (((p / pw) | 0) >> 2) * cols + ((p % pw) >> 1)
      this.cellR[c] += v * r
      this.cellG[c] += v * g
      this.cellB[c] += v * b
      this.cellW[c] += v
    }
  }

  /**
   * The logo: each fragment as the cell of dots it was, in its own colour; torn off, it stretches from
   * that block into one strand pointing at the hole, which heats as it falls.
   */
  private drawLogo() {
    const s = this.ppm
    const cx = this.cx
    const cy = this.cy
    const tearing = this.phase === "tearing"
    const reform = this.phase === "reform"
    const span = HEAT_FROM_R - R_SHADOW
    const lut = this.ink ? this.rampInk : this.ramp
    for (let i = 0; i < this.logoN; i++) {
      if (!this.lAlive[i]) continue
      const rr = this.restR[i]
      const rg = this.restG[i]
      const rb = this.restB[i]
      const fade = this.lFade[i]
      let hx = this.lX[i]
      let hy = this.lY[i]
      if (reform && fade < 1) {
        const e = 1 - fade
        const off = REFORM_DRIFT * e * e
        hx = this.homeX[i] + this.lVX[i] * off
        hy = this.homeY[i] + this.lVY[i] * off
      }
      const tx = this.lTX[i]
      const ty = this.lTY[i]
      const sx = tx - hx
      const sy = ty - hy
      const len = Math.sqrt(sx * sx + sy * sy) * s
      // Torn off, the block of dots becomes the strand as it stretches past its own size.
      const strand = tearing && this.tearT > this.lDelay[i] ? smooth((len - SEP_DOTS) / STRAND_DOTS) : 0
      if (strand < 1) this.block(i, Math.round((hx - this.homeX[i]) * s), Math.round((this.homeY[i] - hy) * s), fade * (1 - strand), rr, rg, rb)
      if (strand <= 0) continue

      // It heats as it falls (tidal heating), so a letter keeps its colours until it moves.
      const rh = Math.sqrt(hx * hx + hy * hy)
      const home = Math.sqrt(this.homeX[i] * this.homeX[i] + this.homeY[i] * this.homeY[i])
      const ramp = Math.max(smooth((home - rh) / HEAT_FALL), smooth(this.tearT - this.lDelay[i] - HEAT_AFTER_S))
      const heat = Math.min(1, Math.max(0, (HEAT_FROM_R - rh) / span))
      // Its dots' light spread along its length: a long strand is a faint one, but tidal heating raises
      // its emission as it nears the hole, so it never fades on the way in.
      const light = strand * Math.min(STRAND_MAX, this.fragDots[i] / Math.max(1, len)) * this.lSeed[i] * (1 + 1.1 * heat)
      const thin = Math.min(1, (SEP_DOTS * 2) / Math.max(1, len))
      const cool = 0.72 + 0.28 * thin
      const th = thermal((0.92 + 0.2 * heat) * cool)
      const tt = thermal((0.64 + 0.16 * heat) * cool)
      const mx = 0.5 * (hx + tx)
      const my = 0.5 * (hy + ty)
      // Head white-hot, tail cooler, both blended from the fragment's own colour as it is first pulled.
      this.line(cx + hx * s, cy - hy * s, cx + mx * s, cy - my * s, light, light * 0.85, rr + (lut[th] - rr) * ramp, rg + (lut[th + 1] - rg) * ramp, rb + (lut[th + 2] - rb) * ramp, false)
      this.line(cx + mx * s, cy - my * s, cx + tx * s, cy - ty * s, light * 0.85, light * TAIL, rr + (lut[tt] - rr) * ramp, rg + (lut[tt + 1] - rg) * ramp, rb + (lut[tt + 2] - rb) * ramp, false)
    }
  }

  /** Fragment `i` as the cell of dots it was, moved by (dx, dy) dots. */
  private block(i: number, dx: number, dy: number, light: number, r: number, g: number, b: number) {
    if (light <= 0) return
    const x0 = (this.logoAt!.col + this.fragCol[i]) * 2 + dx
    const y0 = (this.logoAt!.row + this.fragRow[i]) * 4 + dy
    const bits = this.fragBits[i]
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 2; x++) {
        if (bits & DOT_BIT[y][x]) this.line(x0 + x, y0 + y, x0 + x, y0 + y, light, light, r, g, b, false)
      }
    }
  }

  /**
   * Adds light along a line of dots (Bresenham), its brightness running from `i0` to `i1`. Unless the
   * line is `front` (the near side of the disk, which passes over the shadow), the shadow cuts it.
   */
  private line(x0: number, y0: number, x1: number, y1: number, i0: number, i1: number, r: number, g: number, b: number, front: boolean) {
    let x = Math.floor(x0)
    let y = Math.floor(y0)
    const xe = Math.floor(x1)
    const ye = Math.floor(y1)
    const dx = Math.abs(xe - x)
    const dy = -Math.abs(ye - y)
    const n = dx > -dy ? dx : -dy
    // Also refuses a line with no end (NaN), which would never finish.
    if (!(n <= MAX_STEPS)) return
    const sx = x < xe ? 1 : -1
    const sy = y < ye ? 1 : -1
    const di = n > 0 ? (i1 - i0) / n : 0
    const { pw, ph, cols, acc, dist, radius, cellR, cellG, cellB, cellW } = this
    let err = dx + dy
    let light = i0
    for (;;) {
      if (x >= 0 && x < pw && y >= 0 && y < ph) {
        const p = y * pw + x
        const v = light
        if (v > 0 && (front || dist[p] >= radius)) {
          acc[p] += v
          const c = (y >> 2) * cols + (x >> 1)
          cellR[c] += v * r
          cellG[c] += v * g
          cellB[c] += v * b
          cellW[c] += v
        }
      }
      if (x === xe && y === ye) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x += sx
      }
      if (e2 <= dx) {
        err += dx
        y += sy
      }
      light += di
    }
  }

  /** Each cell: the dots whose light passes their threshold, in the light-weighted mean of the colours that fell in it. */
  private resolve() {
    const { cols, rows, pw, acc, dist, radius, ink, bits, rgb, cellR, cellG, cellB, cellW } = this
    // Faint light fades towards the page, and glare towards white light, or on paper towards ink.
    const paper = ink ? 255 : 0
    const glare = ink ? 0 : 255
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const c = row * cols + col
        const base = row * 4 * pw + col * 2
        const odd = (col & 1) * 2
        let lit = 0
        let shadow = 0
        let n = 0
        let sum = 0
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 2; x++) {
            const p = base + y * pw + x
            const a = acc[p]
            if (a > LIT[y * 4 + odd + x]) {
              lit |= DOT_BIT[y][x]
              sum += a
              n++
            } else if (ink && dist[p] < radius) shadow |= DOT_BIT[y][x]
          }
        }
        bits[c] = lit | shadow
        if (!lit) {
          if (shadow) rgb.set(SHADOW_INK, c * 3)
          continue
        }
        const w = cellW[c]
        const mean = sum / n
        const tone = mean >= 1 ? 1 : TONE_MIN + (1 - TONE_MIN) * mean
        const white = mean > 1 ? Math.min(WHITE_MAX, (mean - 1) * WHITE_RATE) : 0
        const r = paper + (cellR[c] / w - paper) * tone
        const g = paper + (cellG[c] / w - paper) * tone
        const b = paper + (cellB[c] / w - paper) * tone
        rgb[c * 3] = Math.round(r + (glare - r) * white)
        rgb[c * 3 + 1] = Math.round(g + (glare - g) * white)
        rgb[c * 3 + 2] = Math.round(b + (glare - b) * white)
      }
    }
  }
}

/** The acceleration `accel` found, x and y. */
const ACC = new Float64Array(2)

/**
 * The acceleration of a point of a fragment at (x, y) moving at (vx, vy): softened gravity, a drive
 * toward its sub-Keplerian tangential speed once released (`swirl`, 0 to 1), and a brake on moving
 * outward.
 */
function accel(x: number, y: number, vx: number, vy: number, kGrav: number, share: number, swirl: number) {
  const r2 = x * x + y * y
  const r = Math.max(1e-3, Math.sqrt(r2))
  const nx = x / r
  const ny = y / r
  const g = kGrav / (r2 + SOFTENING2)
  const tx = -ny
  const ty = nx
  const vt = vx * tx + vy * ty
  const drive = (share * Math.sqrt(kGrav / r) - vt) * SWIRL_RATE * swirl
  const outward = Math.max(0, vx * nx + vy * ny) * OUTWARD_DRAG
  ACC[0] = -g * nx + tx * drive - nx * outward
  ACC[1] = -g * ny + ty * drive - ny * outward
}

export function createSingularity(options: Options) {
  return new Singularity(options)
}

/** The first index of the ascending `sorted` whose value is at least `value`. */
function firstAtLeast(sorted: Float32Array, value: number) {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

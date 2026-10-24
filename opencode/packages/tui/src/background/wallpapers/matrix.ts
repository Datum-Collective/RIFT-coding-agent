import { Canvas } from "../src/canvas"
import { eggWait } from "../src/egg"
import { clamp, lerp, rand, type RGB } from "../src/math"
import type { Activity, AgentEvent, Settings, Wallpaper } from "../src/wallpaper"

// The scene runs slower than real time, which keeps it calm behind text.
const TIME_SCALE = 0.35
// A near glyph is 5x7 pixels in a slot 6 wide and 8 tall, so on terminal cells it covers whole cells: 3 across, 2 down.
// Far glyphs are 3x5 in rows 6 tall, falling slower and dimmer behind.
const PITCH = 6
const ROW = 8
const FAR_ROW = 6
// A glyph lit by a ripple from a click, in screen heights: how fast the ring spreads, how long it lasts, how wide it is.
const RIPPLE_SPEED = 0.55
const RIPPLE_LIFE = 0.9
const RIPPLE_WIDTH = 0.035
// After an error the rain glitches for this many scene seconds, then stays dim until the next event.
const GLITCH = 1.6
// The egg's hidden message holds this many scene seconds once spelled out, then fades over FADE.
const HOLD = 7
const FADE = 1.5

// Glyphs as rows of pixels, '#' lit. The rain's katakana, digits and a few signs are mirrored as in the film.
const RAIN = font(
  5,
  [
    "##### ....# ..#.# ..##. ..#.. ..#.. .#...",
    "....# ...#. ..##. .#.#. ...#. ...#. ...#.",
    "..#.. ##### #...# ....# ...#. ..#.. .#...",
    "..... ##### ..#.. ..#.. ..#.. ##### .....",
    "...#. ##### ...#. ..##. .#.#. #..#. ...#.",
    "..#.. ##### ..#.# ..#.# .#..# .#..# #..#.",
    "..#.. ##### ..#.. ##### ..#.. ..#.. ..#..",
    ".#### .#..# #...# ....# ...#. ..#.. ##...",
    ".#... .#### #..#. ...#. ...#. ..#.. .#...",
    "..... ##### ....# ....# ....# ##### .....",
    ".#.#. ##### .#.#. .#.#. ...#. ..#.. .#...",
    "#.... .#..# #...# .#..# ....# ...#. ###..",
    "..... ##### ....# ...#. ..#.. .#.#. #...#",
    ".#... .#... ##### .#..# .#.#. .#... ..###",
    "#...# #...# .#..# ....# ...#. ..#.. ##...",
    "...#. ###.. ..#.. ##### ..#.. ..#.. .#...",
    "#.#.# #.#.# ....# ....# ...#. ..#.. .#...",
    ".###. ..... ##### ..#.. ..#.. ..#.. .#...",
    ".#... .#... .##.. .#.#. .#... .#... .#...",
    "..#.. ##### ..#.. ..#.. ..#.. .#... #....",
    "..... #####  ....# .#.#. ..#.. .#.#. #....",
    "..#.. ##### ...#. ..#.. .###. #.#.# ..#..",
    "#.... #.... #..## ###.. #.... #.... .####",
    "..#.. ##### ..#.. #.#.# #.#.# ..#.. ..#..",
    "..... ##### ....# .#.#. ..#.. ...#. .....",
    "....# #..#. .##.. ..#.. .#.#. #.... .....",
    ".#... ##### .#..# .#.#. .#... .#... .#...",
    "..... ##### ....# .#### ....# ##### .....",
    "#..#. #..#. #..#. #..#. ...#. ..#.. .#...",
    "..#.. #.#.. #.#.. #.#.# #.#.# #.##. .....",
    "#.... #.... #.... #...# #..#. #.#.. ##...",
    "##### #...# ....# ....# ...#. ..#.. .#...",
    "##### ....# ##### ....# ...#. ..#.. .#...",
    ".###. #...# #..## #.#.# ##..# #...# .###.",
    "..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.",
    "##### ...#. ..#.. ...#. ....# #...# .###.",
    "...#. ..##. .#.#. #..#. ##### ...#. ...#.",
    "##### #.... ####. ....# ....# #...# .###.",
    "##### ....# ...#. ..#.. .#... .#... .#...",
    ".###. #...# #...# .#### ....# ...#. .##..",
    "##### ....# ...#. ..#.. .#... #.... #####",
    "..... ..... ##### ..... ##### ..... .....",
    "..... #.#.# .###. ##### .###. #.#.# .....",
    "..... ..#.. ..#.. ..... ..#.. ..#.. .....",
  ],
  true,
)
const FAR = font(
  3,
  [
    "### ..# .## .#. #..",
    "..# .#. ##. .#. .#.",
    ".#. ### .#. ### .#.",
    "### ..# ..# ..# ###",
    "..# ..# .#. .#. #..",
    "### .#. .#. .#. ###",
    "#.. ##. #.# #.. #..",
    "#.. ### #.# #.. #..",
    "#.# #.# ..# ..# .#.",
    "#.# #.# ..# .#. #..",
    ".#. ### .#. .#. #..",
    ".#. .#. ### .#. .#.",
    "### #.# #.# #.# ###",
    ".#. ##. .#. .#. ###",
    "### ..# .## ..# ###",
    "#.# #.# ### ..# ..#",
    "### ..# .#. .#. .#.",
    "### #.# ### ..# ##.",
    "### ..# .#. #.. ###",
  ],
  true,
)
// What an error turns glyphs into for a moment: broken blocks.
const GLITCHES = font(5, ["##### ##### ..... ##### ##### ..... #####", "#.#.# .#.#. #.#.# .#.#. #.#.# .#.#. #.#.#", "###.. ###.. ###.. ..### ..### ..### ###..", "..... #.### ##### ##.## ##### ###.# ....."], false)
// Blanks the slot under each of the egg's letters, so nothing shows through them.
const SOLID = font(5, ["##### ##### ##### ##### ##### ##### #####"], false)
// The egg's letters, unmirrored, and a white rabbit (drawn mint, like everything else).
const LETTERS: Record<string, number> = {}
const ALPHABET = font(
  5,
  Object.entries({
    A: ".###. #...# #...# ##### #...# #...# #...#",
    B: "####. #...# #...# ####. #...# #...# ####.",
    E: "##### #.... #.... ####. #.... #.... #####",
    F: "##### #.... #.... ####. #.... #.... #....",
    H: "#...# #...# #...# ##### #...# #...# #...#",
    I: ".###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.",
    K: "#...# #..#. #.#.. ##... #.#.. #..#. #...#",
    L: "#.... #.... #.... #.... #.... #.... #####",
    N: "#...# ##..# #.#.# #..## #...# #...# #...#",
    O: ".###. #...# #...# #...# #...# #...# .###.",
    P: "####. #...# #...# ####. #.... #.... #....",
    R: "####. #...# #...# ####. #.#.. #..#. #...#",
    T: "##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..",
    U: "#...# #...# #...# #...# #...# #...# .###.",
    W: "#...# #...# #...# #.#.# #.#.# ##.## #...#",
    "@": "#.#.. #.#.. ###.. #.##. .#### .#### .#.#.",
  }).map(([letter, rows], i) => ((LETTERS[letter] = i), rows)),
  false,
)

// The pale mint head; the text on top is white, so never white.
const HEAD: RGB = [0.17, 1.5, 0.36]
const RED: RGB = [0.9, 0.05, 0.03]

// Per activity: the share of columns with a stream falling, their speed in glyph rows per scene second, their length in
// rows, how often a lit glyph changes (per scene second, at full brightness), the share of streams far behind, and
// whether bright code surges come now and then.
const CAST: Record<Activity, { share: number; speed: [number, number]; length: [number, number]; mutate: number; far: number; surge: boolean }> = {
  calm: { share: 0.3, speed: [1, 1.5], length: [5, 11], mutate: 0.0375, far: 0.4, surge: false },
  lively: { share: 0.8, speed: [1.5, 2.5], length: [6, 14], mutate: 0.075, far: 0.35, surge: false },
  teeming: { share: 1.15, speed: [2.5, 4], length: [7, 16], mutate: 0.1, far: 0.35, surge: true },
}

// A falling stream: its column, the row of its head (the glyph shown is the whole row below), its speed and length in
// rows, brightness, whether it falls far behind, how much of its trail stays mint (code surges), and whether it is an
// extra (a click's, a finished task's or the egg's) that doesn't count toward the activity's share.
interface Stream {
  col: number
  y: number
  speed: number
  length: number
  bright: number
  far: boolean
  mint: number
  extra: boolean
}

class Matrix extends Canvas {
  private readonly activity: Activity
  private readonly cast: (typeof CAST)[Activity]
  private time = 0
  private cols = 0
  private rows = 0
  private farRows = 0
  private ox = 0
  private s = 1
  private streams: Stream[] = []
  // Per column and row: the glyph (any byte; each font takes it modulo its size), and this frame's light and head
  // share, near and far apart. red marks glitched glyphs while it lasts.
  private glyphs = new Uint8Array(0)
  private farGlyphs = new Uint8Array(0)
  private lum = new Float32Array(0)
  private head = new Float32Array(0)
  private farLum = new Float32Array(0)
  private farHead = new Float32Array(0)
  private red = new Float32Array(0)
  private frozen = new Uint8Array(0)
  private ripples: { x: number; y: number; t: number }[] = []
  private glitch = 0
  private surgeWait = rand(4, 10)
  private egg = eggWait() * TIME_SCALE
  private word: { text: string; col: number; row: number; shown: Float32Array; t: number; held: number } | undefined
  private started = false

  constructor(settings: Settings) {
    super()
    this.supersample = 1
    this.activity = settings.activity
    this.cast = CAST[this.activity]
  }

  step(dt: number) {
    dt = clamp(dt, 0, 0.1) * TIME_SCALE
    this.time += dt
    this.stepGloom(dt)
    this.glitch = Math.max(0, this.glitch - dt)
    if (!this.glitch) this.frozen.fill(0)
    this.advance(dt)
    this.ripples = this.ripples.filter((r) => (r.t += dt) < RIPPLE_LIFE)
    for (let i = 0; i < this.red.length; i++) this.red[i] = Math.max(0, this.red[i] - dt * 0.8)
    this.stepEgg(dt)
  }

  private advance(dt: number) {
    const cast = this.cast
    // After an error the rain slows; while it glitches it falls in jerks, and a few columns stop dead.
    const pace = 1 - 0.55 * this.gloom
    const jerk = this.glitch ? (Math.floor(this.time * 9) % 3 === 0 ? 2.2 : 0) : 1
    for (const s of this.streams) {
      if (this.frozen[s.col]) continue
      const before = Math.floor(s.y)
      s.y += s.speed * dt * pace * jerk * (s.far ? 0.55 : 1)
      const now = Math.floor(s.y)
      // Each glyph the head reaches is a fresh one.
      for (let r = before + 1; r <= now; r++) {
        const rows = s.far ? this.farRows : this.rows
        if (r >= 0 && r < rows) (s.far ? this.farGlyphs : this.glyphs)[s.col * this.farRows + r] = (Math.random() * 256) | 0
      }
    }
    this.streams = this.streams.filter((s) => s.y - s.length < (s.far ? this.farRows : this.rows))
    if (!this.cols) return
    const target = Math.round(cast.share * this.cols)
    for (let n = this.streams.filter((s) => !s.extra).length; n < target; n++) this.spawn(-rand(0, this.rows * 0.8))
    if (!cast.surge) return
    this.surgeWait -= dt
    if (this.surgeWait > 0) return
    // A code surge: one long, quick, bright column, its trail glowing mint.
    this.surgeWait = rand(6, 14)
    const s = this.spawn(-rand(0, 3), true)
    if (!s) return
    s.far = false
    s.speed *= 1.8
    s.length = this.rows * rand(0.9, 1.3)
    s.bright = 1.35
    s.mint = 0.45
  }

  // A new stream at the top of a column whose last stream has mostly fallen clear, keeping to that column's depth.
  private spawn(y: number, extra = false, col = -1): Stream | undefined {
    const cast = this.cast
    for (let i = 0; i < (col < 0 ? 20 : 1); i++) {
      const c = col < 0 ? Math.floor(Math.random() * this.cols) : col
      const there = this.streams.filter((s) => s.col === c)
      if (col < 0 && there.some((s) => s.y - s.length < 2)) continue
      const s: Stream = {
        col: c,
        y,
        speed: rand(cast.speed[0], cast.speed[1]),
        length: rand(cast.length[0], cast.length[1]),
        bright: rand(0.8, 1.05),
        far: there.length ? there[0].far : Math.random() < cast.far,
        mint: 0,
        extra,
      }
      this.streams.push(s)
      return s
    }
  }

  render() {
    this.restore()
    const { W, H, cols, rows, farRows, ox, s, glyphs, farGlyphs, lum, head, farLum, farHead, red } = this
    lum.fill(0)
    head.fill(0)
    farLum.fill(0)
    farHead.fill(0)
    const dim = 1 - 0.45 * this.gloom
    for (const st of this.streams) light(st.far ? farLum : lum, st.far ? farHead : head, st.col * farRows, st.far ? farRows : rows, st.y, st.length, st.bright * dim, st.mint)
    this.lightRipples()
    const word = this.word
    const c: RGB = [0, 0, 0]
    for (let col = 0; col < cols; col++) {
      const x = ox + col * PITCH * s
      let y0 = Infinity
      let y1 = -Infinity
      for (let r = 0; r < farRows; r++) {
        const i = col * farRows + r
        const b = farLum[i]
        if (b < 0.02) continue
        tint(c, b * 0.42, farHead[i] * 0.55, 0)
        const g = FAR.glyphs[farGlyphs[i] % FAR.count]
        glyph(this.hdr, W, H, x + s, r * FAR_ROW * s, FAR.rows, g, 3, 5, s, c[0], c[1], c[2])
        y0 = Math.min(y0, r * FAR_ROW * s)
        y1 = Math.max(y1, (r * FAR_ROW + 5) * s - 1)
      }
      for (let r = 0; r < rows; r++) {
        const i = col * farRows + r
        const letter = word && col >= word.col && col < word.col + word.text.length && r === word.row ? word.shown[col - word.col] : 0
        const b = Math.max(lum[i], letter)
        if (b < 0.02) continue
        tint(c, b, letter ? Math.max(head[i], 0.5) : head[i], red[i])
        if (letter) glyph(this.hdr, W, H, x, r * ROW * s, SOLID.rows, 0, 5, 7, s, 0.0004, 0.0018, 0.0008)
        const table = letter ? ALPHABET : red[i] > 0.2 ? GLITCHES : RAIN
        const g = letter ? LETTERS[word!.text[col - word!.col]] : glyphs[i] % table.count
        glyph(this.hdr, W, H, x, r * ROW * s, table.rows, table.glyphs[g], 5, 7, s, c[0], c[1], c[2])
        y0 = Math.min(y0, r * ROW * s)
        y1 = Math.max(y1, (r * ROW + 7) * s - 1)
      }
      if (y1 >= y0) this.touch(x, y0, Math.min(W - 1, x + 5 * s - 1), Math.min(H - 1, y1))
    }
    this.mutate()
    this.finish()
  }

  // Lit glyphs change now and then, brighter ones more often; unlit ones change unseen when a head next reaches them.
  private mutate() {
    const rate = this.cast.mutate * (1 / 15) * TIME_SCALE
    const n = this.lum.length
    for (let i = 0; i < n; i++) {
      if (this.lum[i] > 0.05 && Math.random() < rate * this.lum[i]) this.glyphs[i] = (Math.random() * 256) | 0
      if (this.farLum[i] > 0.05 && Math.random() < rate * this.farLum[i] * 0.5) this.farGlyphs[i] = (Math.random() * 256) | 0
    }
    if (!this.glitch) return
    // While it glitches, lit glyphs here and there turn red and break up.
    for (let k = 0; k < 6; k++) {
      const i = Math.floor(Math.random() * n)
      if (this.lum[i] > 0.1) this.red[i] = 1
    }
  }

  // Spreading rings of bright glyphs from clicks.
  private lightRipples() {
    const { H, cols, rows, farRows, ox, s } = this
    for (const rp of this.ripples) {
      const radius = rp.t * RIPPLE_SPEED * H
      const fade = 1 - rp.t / RIPPLE_LIFE
      const width = RIPPLE_WIDTH * H
      const c0 = Math.max(0, Math.floor((rp.x - radius - width - ox) / (PITCH * s)))
      const c1 = Math.min(cols - 1, Math.ceil((rp.x + radius + width - ox) / (PITCH * s)))
      const r0 = Math.max(0, Math.floor((rp.y - radius - width) / (ROW * s)))
      const r1 = Math.min(rows - 1, Math.ceil((rp.y + radius + width) / (ROW * s)))
      for (let col = c0; col <= c1; col++)
        for (let r = r0; r <= r1; r++) {
          const d = Math.hypot(ox + (col * PITCH + 2.5) * s - rp.x, (r * ROW + 3.5) * s - rp.y)
          const k = Math.exp(-(((d - radius) / width) ** 2)) * fade
          if (k < 0.15) continue
          const i = col * farRows + r
          this.lum[i] = Math.max(this.lum[i], k)
          this.head[i] = Math.max(this.head[i], k)
        }
    }
  }

  // A finished task: a burst of quick streams pours down across the screen.
  protected override visit() {
    for (let col = 0; col < this.cols; col++) {
      if (Math.random() > 0.5) continue
      const s = this.spawn(-rand(0, 6), true, col)
      if (!s) continue
      s.far = false
      s.speed *= 2.6
      s.length = rand(6, 12)
      s.bright = 1.15
    }
  }

  // An error: the rain stutters, a few columns freeze and glyphs glitch red, then it stays dim until the next event.
  override react(event: AgentEvent) {
    super.react(event)
    if (event !== "error" || !this.cols) return
    this.glitch = GLITCH
    for (let k = 0; k < Math.max(2, this.cols / 10); k++) this.frozen[Math.floor(Math.random() * this.cols)] = 1
  }

  // A click: a stream starts falling from the glyph under the pointer, and a ring of bright glyphs spreads from it.
  poke(x: number, y: number) {
    if (!this.cols || this.ripples.length >= 3) return
    const px = x * this.H
    const py = y * this.H
    const col = clamp(Math.floor((px - this.ox) / (PITCH * this.s)), 0, this.cols - 1)
    const s = this.spawn(Math.floor(py / (ROW * this.s)), true, col)
    if (s) {
      s.far = false
      s.bright = 1.2
      s.length = rand(8, 14)
    }
    this.ripples.push({ x: px, y: py, t: 0 })
  }

  // The egg: streams spell out a message near the top, letter by letter as their heads pass, and it lingers.
  private stepEgg(dt: number) {
    const word = this.word
    if (word) {
      word.t += dt
      for (let i = 0; i < word.text.length; i++) {
        if (word.text[i] === " ") continue
        const passed = this.streams.some((s) => s.extra && !s.far && s.col === word.col + i && s.y >= word.row + 1)
        if (passed || word.shown[i]) word.shown[i] = Math.min(1, word.shown[i] + dt * 3)
      }
      if (word.held < 0 && word.shown.every((v, i) => v >= 1 || word.text[i] === " ")) word.held = 0
      if (word.held >= 0) word.held += dt
      const fade = clamp(1 - (word.held - HOLD) / FADE, 0, 1)
      if (fade < 1) word.shown.forEach((v, i) => (word.shown[i] = Math.min(v, fade)))
      // Gives up on letters whose stream never came (a column frozen by an error, say).
      if (fade <= 0 || word.t > HOLD * 3) this.word = undefined
      return
    }
    this.egg -= dt
    if (this.egg > 0 || !this.cols) return
    this.egg = eggWait(true) * TIME_SCALE
    const text = this.cols >= 27 ? "FOLLOW THE WHITE RABBIT @" : "WAKE UP"
    const col = Math.floor((this.cols - text.length) / 2)
    this.word = { text, col, row: 2, shown: new Float32Array(text.length), t: 0, held: -1 }
    for (let i = 0; i < text.length; i++) {
      if (text[i] === " ") continue
      const s = this.spawn(-rand(0, 8), true, col + i)
      if (!s) continue
      s.far = false
      s.speed = rand(5, 7)
      s.length = rand(6, 10)
    }
  }

  protected override layout() {
    const { W, H, hdr } = this
    this.s = this.cells ? 1 : Math.max(1, Math.round(H / 170))
    const s = this.s
    const cols = Math.max(1, Math.floor(W / (PITCH * s)))
    // Centered, on whole cells.
    this.ox = 2 * Math.floor((W - cols * PITCH * s + s) / 4)
    this.rows = Math.ceil(H / (ROW * s))
    this.farRows = Math.ceil(H / (FAR_ROW * s))
    if (cols !== this.cols || this.glyphs.length !== cols * this.farRows) {
      this.cols = cols
      const n = cols * this.farRows
      this.glyphs = Uint8Array.from({ length: n }, () => (Math.random() * 256) | 0)
      this.farGlyphs = Uint8Array.from({ length: n }, () => (Math.random() * 256) | 0)
      this.lum = new Float32Array(n)
      this.head = new Float32Array(n)
      this.farLum = new Float32Array(n)
      this.farHead = new Float32Array(n)
      this.red = new Float32Array(n)
      this.frozen = new Uint8Array(cols)
      this.streams = this.streams.filter((st) => st.col < cols)
    }
    // Let the rain fall a while before the first frame, so it never opens on an empty screen.
    if (!this.started) {
      this.started = true
      for (let t = 0; t < 8; t += 0.05) this.advance(0.05)
    }
    for (let i = 0; i < W * H; i++) {
      hdr[i * 3] = 0.0004
      hdr[i * 3 + 1] = 0.0018
      hdr[i * 3 + 2] = 0.0008
    }
  }
}

// Writes a stream's light into one column of lum and head (rows long, starting at o): the head's row at full light and
// mint, the trail fading behind it as the head moves on, smoothly, though glyphs only ever step a whole row.
function light(lum: Float32Array, head: Float32Array, o: number, rows: number, y: number, length: number, bright: number, mint: number) {
  const top = Math.floor(y)
  const f = y - top
  for (let a = 0; a < length + 1; a++) {
    const r = top - a
    if (r < 0) break
    if (r >= rows) continue
    const b = (1 - (a + f) / length) ** 0.6 * bright
    if (b <= 0) break
    // The last head eases from mint to green over the first part of the step.
    const h = a === 0 ? 1 : a === 1 ? Math.max(0, 1 - f * 3) : mint * b
    const i = o + r
    if (b > lum[i]) lum[i] = b
    if (h > head[i]) head[i] = h
  }
}

// The color of a glyph lit by b with head share h: deep green through saturated green, toward pale mint at the head;
// red where it glitches.
function tint(c: RGB, b: number, h: number, red: number) {
  const k = Math.min(1, b)
  const g = 0.72 * k ** 1.25
  const r = 0.02 * k + 0.05 * k ** 6
  const bl = 0.05 * k + 0.06 * k ** 6
  const m = Math.min(1, b)
  c[0] = lerp(lerp(r, HEAD[0] * m, h), RED[0] * k, red)
  c[1] = lerp(lerp(g, HEAD[1] * m, h), RED[1] * k, red)
  c[2] = lerp(lerp(bl, HEAD[2] * m, h), RED[2] * k, red)
}

// Draws glyph g (offset into rows, w by h, one bit per pixel with the leftmost highest) at (x, y), each pixel s square.
function glyph(hdr: Float32Array, W: number, H: number, x: number, y: number, rows: Uint8Array, g: number, w: number, h: number, s: number, r: number, gr: number, b: number) {
  for (let j = 0; j < h * s; j++) {
    const py = y + j
    if (py < 0 || py >= H) continue
    const bits = rows[g + Math.floor(j / s)]
    for (let i = 0; i < w * s; i++) {
      const px = x + i
      if (px >= W || !(bits & (1 << (w - 1 - Math.floor(i / s))))) continue
      const o = (py * W + px) * 3
      hdr[o] = r
      hdr[o + 1] = gr
      hdr[o + 2] = b
    }
  }
}

// Parses glyphs of rows like "#.#.." into bit rows, mirrored if asked; glyphs holds each glyph's offset into rows.
function font(w: number, list: string[], mirror: boolean) {
  const parsed = list.map((g) => g.split(/\s+/).map((row) => [...(mirror ? [...row].reverse().join("") : row)].reduce((bits, ch) => (bits << 1) | (ch === "#" ? 1 : 0), 0) & ((1 << w) - 1)))
  const h = parsed[0].length
  return { rows: Uint8Array.from(parsed.flat()), glyphs: parsed.map((_, i) => i * h), count: parsed.length }
}

export const matrix: Wallpaper = {
  id: "matrix",
  name: "Matrix",
  description: "The digital rain: streams of mirrored katakana and digits falling down a black screen, pale mint heads trailing green",
  fixedTime: "night",
  activity: {
    calm: "A few slow streams falling through the dark",
    lively: "The classic rain, near streams over dimmer, slower ones behind",
    teeming: "Dense, quicker rain, with now and then a bright code surge",
  },
  scrim: {
    day: [
      [2, 6, 3],
      [1, 5, 2],
      [0, 3, 1],
    ],
    sunset: [
      [2, 6, 3],
      [1, 5, 2],
      [0, 3, 1],
    ],
    night: [
      [1, 7, 3],
      [0, 5, 2],
      [0, 3, 1],
    ],
  },
  create: (settings) => new Matrix(settings),
}

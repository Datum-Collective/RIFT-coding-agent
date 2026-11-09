import { describe, expect, test } from "bun:test"
import { R_DISK_OUT, R_ISCO, R_SHADOW, bend, createSingularity, type Singularity } from "../../src/koi/singularity"
import { DOT_BIT, ditherBanner } from "../../src/koi/logo"
import { banner } from "../../src/banner"

const logo = ditherBanner(banner)

/** The banner where the home screen puts it: centred, a little above the middle. */
const homeLogo = (cols: number, rows: number) => ({ logo, col: Math.floor((cols - logo.cols) / 2), row: Math.floor(rows / 2) - 10 })

function run(scene: Singularity, seconds: number, dt = 1 / 30) {
  for (let t = 0; t < seconds - 1e-9; t += dt) scene.step(dt)
  scene.render()
  return scene
}

/** Whether the dot at (x, y) of the screen's dot grid (two across and four down a cell) is lit. */
const lit = (s: Singularity, x: number, y: number) => {
  if (x < 0 || y < 0 || x >= s.cols * 2 || y >= s.rows * 4) return false
  return (s.bits[(y >> 2) * s.cols + (x >> 1)] & DOT_BIT[y & 3][x & 1]) !== 0
}

/** Lit dots within a box of the dot grid, centred on the hole. */
const count = (s: Singularity, x0: number, x1: number, y0: number, y1: number) => {
  let n = 0
  for (let y = Math.round(s.rows * 2 + y0); y < s.rows * 2 + y1; y++) for (let x = Math.round(s.cols + x0); x < s.cols + x1; x++) if (lit(s, x, y)) n++
  return n
}

/** Lit dots in the upper half of a disc of `radius` dots round the centre, where nothing passes in front of the shadow. */
const above = (s: Singularity, radius: number) => {
  let n = 0
  for (let y = -Math.floor(radius); y < 0; y++) {
    for (let x = -Math.floor(radius); x < radius; x++) {
      if ((x + 0.5) * (x + 0.5) + (y + 0.5) * (y + 0.5) < (radius - 1) * (radius - 1) && lit(s, s.cols + x, s.rows * 2 + y)) n++
    }
  }
  return n
}

/** The cells with dots in them: where, which dots, and their colour. */
const drawn = (s: Singularity) => {
  const out: number[][] = []
  for (let c = 0; c < s.bits.length; c++) if (s.bits[c]) out.push([c, s.bits[c], s.rgb[c * 3], s.rgb[c * 3 + 1], s.rgb[c * 3 + 2]])
  return out
}

/** Distance in dots from the centre to the first lit dot, walking along (dx, dy). */
function reach(s: Singularity, dx: number, dy: number) {
  const cx = s.cols
  const cy = s.rows * 2
  for (let d = 0; d < s.cols * 2; d++) {
    // The four dots round the centre: so a walk sees the same thing in every direction.
    const x = Math.floor(cx + dx * (d + 0.5) - (dx < 0 ? 0 : dx > 0 ? 1 : 0.5) + 0.5)
    const y = Math.floor(cy + dy * (d + 0.5) - (dy < 0 ? 0 : dy > 0 ? 1 : 0.5) + 0.5)
    if (lit(s, x, y)) return d
  }
  return Infinity
}

const luminance = (s: Singularity, c: number) => 0.2126 * s.rgb[c * 3] + 0.7152 * s.rgb[c * 3 + 1] + 0.0722 * s.rgb[c * 3 + 2]
const popcount = (bits: number) => {
  let n = 0
  for (let b = bits; b; b &= b - 1) n++
  return n
}

describe("the hole", () => {
  for (const [cols, rows] of [
    [120, 40],
    [200, 50],
  ]) {
    test(`at ${cols}x${rows} its shadow is an empty disc, as round on screen across as it is down`, () => {
      const s = run(createSingularity({ cols, rows, seed: 1 }), 3)
      const radius = R_SHADOW * s.ppm
      const left = reach(s, -1, 0)
      const right = reach(s, 1, 0)
      const up = reach(s, 0, -1)
      // A dot is square on screen (a cell is twice as tall as wide, and has twice as many dots down),
      // so equal in dots is equal on screen. Within a cell either way: two dots across, four down.
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1)
      expect(Math.abs(left - up)).toBeLessThanOrEqual(2)
      expect(Math.abs(left - radius)).toBeLessThanOrEqual(1.5)
      expect(Math.abs(up - radius)).toBeLessThanOrEqual(1.5)
      // Nothing at all in its upper half, and below the middle only the near side of the disk, which
      // passes in front of it as a thin band.
      for (let y = -radius; y < radius; y++) {
        for (let x = -radius; x < radius; x++) {
          if (x * x + y * y >= (radius - 1) * (radius - 1)) continue
          if (y < 0 || y > radius * 0.8) expect(lit(s, Math.floor(s.cols + x), Math.floor(s.rows * 2 + y))).toBe(false)
        }
      }
    })
  }

  test("a thin photon ring runs round the shadow's edge", () => {
    const s = run(createSingularity({ cols: 120, rows: 40, seed: 1 }), 3)
    const radius = R_SHADOW * s.ppm
    let on = 0
    for (let k = 0; k < 360; k++) {
      const a = (k * Math.PI) / 180
      const x = Math.floor(s.cols + Math.cos(a) * (radius + 0.5))
      const y = Math.floor(s.rows * 2 + Math.sin(a) * (radius + 0.5))
      if (lit(s, x, y)) on++
    }
    expect(on).toBeGreaterThan(340)
  })

  test("lensing lifts the far side of the disk into an arch over the shadow and puts a second image under it", () => {
    const s = run(createSingularity({ cols: 120, rows: 40, seed: 1 }), 3)
    const radius = R_SHADOW * s.ppm
    // Seen almost edge on and unlensed, the disk would not reach above or below the shadow straight
    // over its middle: the whole disk lies within 22 cos 80° ≈ 3.8 M of the plane, inside b_c.
    expect(R_DISK_OUT * Math.cos((80 * Math.PI) / 180)).toBeLessThan(R_SHADOW)
    const arch = count(s, -radius / 2, radius / 2, -radius * 1.8, -radius - 2)
    const under = count(s, -radius / 2, radius / 2, radius + 2, radius * 1.5)
    expect(arch).toBeGreaterThan(40)
    expect(under).toBeGreaterThan(40)
  })

  test("the side turning towards us, the left, is the brighter", () => {
    const s = run(createSingularity({ cols: 120, rows: 40, seed: 1 }), 3)
    let left = 0
    let right = 0
    for (let row = 0; row < s.rows; row++) {
      for (let col = 0; col < s.cols; col++) {
        const c = row * s.cols + col
        const light = popcount(s.bits[c]) * luminance(s, c)
        if (col < s.cols / 2) left += light
        else right += light
      }
    }
    expect(left).toBeGreaterThan(right * 1.3)
  })

  test("the disk is hottest at its inner edge and cools outward: white near the hole, red at the rim", () => {
    const s = run(createSingularity({ cols: 200, rows: 50, seed: 1 }), 3)
    // Along the disk's plane on the approaching side, where all of it is bright enough to see.
    const warmth = (from: number, to: number) => {
      let sum = 0
      let n = 0
      const row = s.rows / 2
      for (let col = Math.round(s.cols / 2 - (to * s.ppm) / 2); col < s.cols / 2 - (from * s.ppm) / 2; col++) {
        for (const r of [row - 1, row, row + 1]) {
          const c = r * s.cols + col
          if (!s.bits[c]) continue
          // Blue and green over red: high for white and blue-white, low for orange and red.
          sum += (s.rgb[c * 3 + 1] + s.rgb[c * 3 + 2]) / (2 * Math.max(1, s.rgb[c * 3]))
          n++
        }
      }
      return sum / Math.max(1, n)
    }
    const inner = warmth(R_ISCO, R_ISCO + 3)
    const middle = warmth(10, 13)
    const outer = warmth(16, R_DISK_OUT)
    expect(inner).toBeGreaterThan(middle)
    expect(middle).toBeGreaterThan(outer)
    expect(inner).toBeGreaterThan(0.7)
    expect(outer).toBeLessThan(0.2)
  })

  test("on a light page it is drawn in ink: the shadow a disc of dark dots, nothing as light as the paper", () => {
    const s = run(createSingularity({ cols: 120, rows: 40, seed: 1, ink: true }), 3)
    const radius = R_SHADOW * s.ppm
    // Every cell wholly inside the shadow's upper half is all eight dots, near black.
    for (let row = Math.ceil((s.rows * 4 - 2 * radius) / 8) + 1; row < s.rows / 2 - 1; row++) {
      for (let col = s.cols / 2 - 3; col < s.cols / 2 + 3; col++) {
        const c = row * s.cols + col
        expect(s.bits[c]).toBe(0xff)
        expect(luminance(s, c)).toBeLessThan(30)
      }
    }
    for (let c = 0; c < s.bits.length; c++) if (s.bits[c]) expect(luminance(s, c)).toBeLessThan(200)
  })

  test("Kepler's law: inner orbits turn faster, by the 3/2 power of radius", () => {
    const s = createSingularity({ cols: 120, rows: 40, seed: 1 })
    const before = Float32Array.from(s.dPhi)
    const dt = 0.05
    s.step(dt)
    const turned = (i: number) => (((s.dPhi[i] - before[i]) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    let inner = -1
    let outer = -1
    for (let i = 0; i < s.diskN; i++) {
      if (inner < 0 || s.dR[i] < s.dR[inner]) inner = i
      if (outer < 0 || s.dR[i] > s.dR[outer]) outer = i
    }
    expect(s.dR[outer] / s.dR[inner]).toBeGreaterThan(3)
    const ratio = turned(inner) / turned(outer)
    expect(ratio).toBeCloseTo(Math.pow(s.dR[outer] / s.dR[inner], 1.5), 1)
  })

  test("the near image arches over the shadow and the far image hugs it from outside", () => {
    for (const r of [6, 10, 22]) {
      expect(bend(r, Math.PI / 2)[0]).toBeGreaterThan(R_SHADOW)
      expect(bend(r, Math.PI / 2)[1]).toBeGreaterThan(0)
      for (const deg of [10, 90, 170]) {
        const b = bend(r, 2 * Math.PI - (deg * Math.PI) / 180)[0]
        expect(b).toBeGreaterThan(R_SHADOW)
        expect(b).toBeLessThan(R_SHADOW * 2)
      }
    }
  })
})

describe("the logo", () => {
  test("its first frame is the logo exactly as the banner draws it, and nothing else", () => {
    const at = homeLogo(120, 40)
    const s = createSingularity({ cols: 120, rows: 40, seed: 1, logo: at })
    s.step(0)
    s.render()
    for (let row = 0; row < s.rows; row++) {
      for (let col = 0; col < s.cols; col++) {
        const own = row >= at.row && row < at.row + logo.rows && col >= at.col && col < at.col + logo.cols ? logo.cells[(row - at.row) * logo.cols + col - at.col] : undefined
        const c = row * s.cols + col
        expect(s.bits[c]).toBe(own?.bits ?? 0)
        if (own) expect([s.rgb[c * 3], s.rgb[c * 3 + 1], s.rgb[c * 3 + 2]]).toEqual([Math.round(own.colour.r), Math.round(own.colour.g), Math.round(own.colour.b)])
      }
    }
  })

  test("it is torn apart and swallowed at the shadow's edge, and nothing of it ever shows inside the shadow", () => {
    const s = createSingularity({ cols: 120, rows: 40, seed: 3, logo: homeLogo(120, 40) })
    const alive = Uint8Array.from(s.lAlive)
    const x = Float32Array.from(s.lX)
    const y = Float32Array.from(s.lY)
    let t = 0
    let tore = 0
    while (s.phase !== "steady") {
      s.step(1 / 30)
      t += 1 / 30
      s.render()
      // Above the middle the shadow has nothing in front of it: no dot there, ever, as it opens or after.
      expect(above(s, s.radius)).toBe(0)
      for (let i = 0; i < s.logoN; i++) {
        if (alive[i] && !s.lAlive[i]) {
          const r = Math.hypot(x[i], y[i])
          if (s.phase === "tearing" || t > 1.6) {
            // Swallowed as it crossed the edge: last seen just outside it, not somewhere out in the open.
            expect(r).toBeLessThan(R_SHADOW + 1.2)
            tore++
          } else {
            // Taken by the shadow as it opened, its dots each hidden as the edge passed them.
            expect(r).toBeLessThan((s.radius / s.ppm) * 1.02)
          }
        }
      }
      alive.set(s.lAlive)
      x.set(s.lX)
      y.set(s.lY)
      expect(t).toBeLessThan(10)
    }
    expect(tore).toBeGreaterThan(s.logoN / 2)
    expect(s.logoAlive).toBe(0)
  })

  test("the nearest of the logo goes first: the inner letters are torn while the outer ones still stand", () => {
    const at = homeLogo(120, 40)
    const s = run(createSingularity({ cols: 120, rows: 40, seed: 3, logo: at }), 2.6)
    const standing = (from: number, to: number) => {
      let same = 0
      let total = 0
      for (let row = at.row; row < at.row + logo.rows; row++) {
        for (let col = at.col + from; col < at.col + to; col++) {
          const own = logo.cells[(row - at.row) * logo.cols + col - at.col]
          if (!own) continue
          total++
          // The disk behind may add dots; the logo's own are what must still be there.
          if ((s.bits[row * s.cols + col] & own.bits) === own.bits) same++
        }
      }
      return same / total
    }
    // R and T at the ends, I and F about the middle, which the shadow opened under.
    expect(standing(0, 8)).toBeGreaterThan(0.6)
    expect(standing(logo.cols - 8, logo.cols)).toBeGreaterThan(0.6)
    expect(standing(28, 44)).toBeLessThan(0.2)
  })

  test("a key brings it back: the hole fades out and the logo is there again, dot for dot", () => {
    const at = homeLogo(120, 40)
    const s = run(createSingularity({ cols: 120, rows: 40, seed: 3, logo: at }), 8)
    expect(s.phase).toBe("steady")
    s.leave()
    let t = 0
    while (!s.done) {
      s.step(1 / 30)
      t += 1 / 30
      expect(t).toBeLessThan(3)
    }
    s.render()
    const first = createSingularity({ cols: 120, rows: 40, seed: 9, logo: at })
    first.step(0)
    first.render()
    expect(drawn(s)).toEqual(drawn(first))
  })

  test("a resize part way through carries on where it was, fitted to the new size", () => {
    const s = run(createSingularity({ cols: 120, rows: 40, seed: 3, logo: homeLogo(120, 40) }), 3)
    expect(s.phase).toBe("tearing")
    const alive = s.logoAlive
    s.place(160, 46, homeLogo(160, 46))
    run(s, 1 / 30)
    expect(s.phase).toBe("tearing")
    expect(s.logoAlive).toBeLessThanOrEqual(alive)
    expect(s.logoAlive).toBeGreaterThan(0)
    expect(s.bits.length).toBe(160 * 46)
    run(s, 8)
    expect(Math.abs(reach(s, -1, 0) - reach(s, 0, -1))).toBeLessThanOrEqual(2)
  })
})

test("the same seed gives the same frames", () => {
  const a = createSingularity({ cols: 120, rows: 40, seed: 5, logo: homeLogo(120, 40) })
  const b = createSingularity({ cols: 120, rows: 40, seed: 5, logo: homeLogo(120, 40) })
  for (const seconds of [0.5, 2, 3.5, 6]) {
    run(a, seconds)
    run(b, seconds)
    expect(drawn(a)).toEqual(drawn(b))
  }
  const c = run(createSingularity({ cols: 120, rows: 40, seed: 6, logo: homeLogo(120, 40) }), 12)
  expect(drawn(c)).not.toEqual(drawn(a))
})

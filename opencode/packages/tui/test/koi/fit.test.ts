import { describe, expect, test } from "bun:test"
import { fit, quadrant, type Pixels } from "../../src/koi/fit"
import { dist2, to8, type Rgb } from "../../src/koi/colour"
import { random } from "../../src/koi/random"

const white: Rgb = { r: 255, g: 255, b: 255 }
const black: Rgb = { r: 0, g: 0, b: 0 }
const azure: Rgb = { r: 40, g: 120, b: 255 }

/** What the terminal would show for a cell: each pixel is the foreground where its bit is set. */
function shown(cell: ReturnType<typeof fit>) {
  return [0, 1, 2, 3].map((index) => (cell.mask & (1 << index) ? cell.fg : cell.bg))
}

describe("quadrant", () => {
  test("blank, full, halves, and every mask has its own character", () => {
    expect(quadrant(0)).toBe(" ")
    expect(quadrant(15)).toBe("█")
    expect(quadrant(5)).toBe("▌")
    expect(quadrant(10)).toBe("▐")
    expect(quadrant(3)).toBe("▀")
    expect(quadrant(12)).toBe("▄")
    expect(new Set(Array.from({ length: 16 }, (_, mask) => quadrant(mask))).size).toBe(16)
  })

  test("the corners are the corners", () => {
    expect(quadrant(1)).toBe("▘")
    expect(quadrant(2)).toBe("▝")
    expect(quadrant(4)).toBe("▖")
    expect(quadrant(8)).toBe("▗")
  })
})

describe("fit", () => {
  test("four of one colour make a flat cell", () => {
    const cell = fit([azure, azure, azure, azure])
    expect(cell.mask).toBe(0)
    expect(cell.fg).toEqual(to8(azure))
    expect(cell.bg).toEqual(to8(azure))
  })

  test("a tiny difference is not worth a stripe: the cell is drawn flat in the average", () => {
    const a = { r: 100, g: 100, b: 100 }
    const b = { r: 102, g: 100, b: 100 }
    const cell = fit([a, b, a, b])
    expect(cell.mask).toBe(0)
    expect(cell.fg).toEqual(cell.bg)
  })

  test("any two colours in any arrangement come back exactly as they went in", () => {
    const next = random(11)
    for (let round = 0; round < 300; round++) {
      const pair = [
        { r: next.int(256), g: next.int(256), b: next.int(256) },
        { r: next.int(256), g: next.int(256), b: next.int(256) },
      ] as const
      if (dist2(pair[0], pair[1]) < 200) continue
      const px = [0, 1, 2, 3].map(() => pair[next.int(2)]!) as unknown as Pixels
      const got = shown(fit(px))
      px.forEach((expected, index) => expect(got[index]).toEqual(to8(expected)))
    }
  })

  test("the left half and the right half of a cell", () => {
    const left = fit([white, black, white, black])
    expect(shown(left)).toEqual([to8(white), to8(black), to8(white), to8(black)])
    const right = fit([black, white, black, white])
    expect(shown(right)).toEqual([to8(black), to8(white), to8(black), to8(white)])
  })

  test("three colours still pick the split that fits best, never worse than one flat colour", () => {
    const px: Pixels = [white, azure, black, black]
    const cell = fit(px)
    const err = (got: ReadonlyArray<readonly number[]>) =>
      px.reduce((sum, c, index) => sum + dist2(c, { r: got[index]![0]!, g: got[index]![1]!, b: got[index]![2]! }), 0)
    const mean = {
      r: px.reduce((s, c) => s + c.r, 0) / 4,
      g: px.reduce((s, c) => s + c.g, 0) / 4,
      b: px.reduce((s, c) => s + c.b, 0) / 4,
    }
    const flat = px.reduce((sum, c) => sum + dist2(c, mean), 0)
    expect(err(shown(cell))).toBeLessThan(flat)
  })

  test("each half is shown in a colour it really has, so a corner where colours meet never turns muddy", () => {
    const cell = fit([white, azure, black, black])
    const real = new Set([white, azure, black].map((c) => to8(c).join(",")))
    expect(real.has(cell.fg.join(","))).toBe(true)
    expect(real.has(cell.bg.join(","))).toBe(true)
  })
})

import { describe, expect, test } from "bun:test"
import { inkMask, letters, shareOut, type Lpx } from "../../src/koi/letters"
import { riftLogo } from "../../src/koi/logo"

/** Draws a bitmap from rows of text: anything but a space is a pixel. */
function bits(...rows: string[]) {
  const w = Math.max(...rows.map((row) => row.length))
  const mask = new Array<boolean>(w * rows.length).fill(false)
  rows.forEach((row, y) => [...row].forEach((char, x) => (mask[y * w + x] = char !== " ")))
  return { mask, w, h: rows.length }
}

const key = (q: Lpx) => `${q.x},${q.y}`
const flat = (parts: Lpx[][]) => parts.flat().map(key).sort()

describe("letters", () => {
  test("two blobs apart are two letters, left to right", () => {
    const { mask, w, h } = bits("##    ####", "##    ####", "##    ####")
    const found = letters(mask, w, h)
    expect(found.length).toBe(2)
    expect(Math.min(...found[0]!.map((q) => q.x))).toBe(0)
    expect(Math.min(...found[1]!.map((q) => q.x))).toBe(6)
  })

  test("every pixel is in exactly one letter", () => {
    const { mask, w, h } = bits("## ## ###", "#  ## # #", "## ## ###")
    const found = letters(mask, w, h)
    const expected = mask.flatMap((on, i) => (on ? [`${i % w},${Math.floor(i / w)}`] : [])).sort()
    expect(flat(found)).toEqual(expected)
  })

  test("a dot over a stem, like the one on an i, is part of its letter", () => {
    const { mask, w, h } = bits(" # ", "   ", " # ", " # ", " # ", " # ")
    expect(letters(mask, w, h).length).toBe(1)
  })

  test("a stray crumb joins the nearest letter and is not a letter of its own", () => {
    const { mask, w, h } = bits("#####   ######   #", "#####   ######   ", "#####   ######   ")
    const found = letters(mask, w, h)
    expect(found.length).toBe(2)
    const rightmost = found.map((part) => Math.max(...part.map((q) => q.x)))
    expect(Math.max(...rightmost)).toBe(17)
  })

  test("one connected shape is one letter", () => {
    const { mask, w, h } = bits("#####", "#    ", "#####", "    #", "#####")
    expect(letters(mask, w, h).length).toBe(1)
  })

  test("nothing drawn means no letters", () => {
    expect(letters([false, false, false, false], 2, 2)).toEqual([])
  })

  test("RIFT's logo comes out as a few letters, every grey pixel in one, left to right", () => {
    const mask = inkMask(riftLogo)
    const found = letters(mask, riftLogo.w, riftLogo.h)
    expect(found.length).toBeGreaterThanOrEqual(1)
    expect(found.length).toBeLessThanOrEqual(8)
    const expected = mask.flatMap((on, i) => (on ? [`${i % riftLogo.w},${Math.floor(i / riftLogo.w)}`] : [])).sort()
    expect(flat(found)).toEqual(expected)
    const lefts = found.map((part) => Math.min(...part.map((q) => q.x)))
    expect(lefts).toEqual([...lefts].sort((a, b) => a - b))
  })
})

describe("sharing the letters out among the koi", () => {
  const four = () => {
    const { mask, w, h } = bits("##  ##  ##  ##", "##  ##  ##  ##", "##  ##  ##  ##")
    return letters(mask, w, h)
  }

  test("a letter to each koi when there are as many as letters", () => {
    const groups = shareOut(four(), 4)
    expect(groups.length).toBe(4)
    expect(groups.map((g) => g.length)).toEqual([6, 6, 6, 6])
  })

  test("with fewer koi than letters, neighbouring letters share a koi, still left to right", () => {
    const groups = shareOut(four(), 2)
    expect(groups.length).toBe(2)
    expect(Math.max(...groups[0]!.map((q) => q.x))).toBeLessThan(Math.min(...groups[1]!.map((q) => q.x)))
    expect(groups[0]!.length + groups[1]!.length).toBe(24)
  })

  test("with more koi than letters, the spare ones go to the biggest letters, which are cut into slices", () => {
    const { mask, w, h } = bits("######  ##", "######  ##", "######  ##", "######  ##")
    const found = letters(mask, w, h)
    expect(found.length).toBe(2)
    const groups = shareOut(found, 3)
    expect(groups.length).toBe(3)
    expect(groups.every((g) => g.length > 0)).toBe(true)
    // The big letter, 24 pixels, was split in two; the small one, 8, was not.
    expect(groups.map((g) => g.length).sort((a, b) => a - b)).toEqual([8, 12, 12])
  })

  test("however it is shared, every pixel goes to exactly one koi", () => {
    for (const n of [1, 2, 3, 4, 5, 7]) {
      const found = four()
      expect(flat(shareOut(found, n))).toEqual(flat(found))
    }
  })
})

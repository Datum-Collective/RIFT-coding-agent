import { describe, expect, test } from "bun:test"
import { OptimizedBuffer, RGBA } from "@opentui/core"
import { paintCells } from "../../src/koi/paint"
import type { Placed } from "../../src/koi/pond"

const PAGE = RGBA.fromInts(0, 0, 0, 255)
const PANEL = RGBA.fromInts(32, 36, 44, 255)
const WHITE = RGBA.fromValues(1, 1, 1, 1)

function screen() {
  const buffer = OptimizedBuffer.create(10, 4, "wcwidth", { respectAlpha: true } as never)
  buffer.clear(PAGE)
  return buffer
}

const cell = (col: number, row: number, mask = 5, fg: [number, number, number] = [47, 129, 247], bg: [number, number, number] = [0, 0, 0]): Placed => ({
  col,
  row,
  mask,
  fg,
  bg,
})

const charAt = (buffer: OptimizedBuffer, x: number, y: number) => String.fromCodePoint(buffer.buffers.char[y * buffer.width + x]!)
const word = (array: Uint16Array, buffer: OptimizedBuffer, x: number, y: number) => Array.from(array.slice((y * buffer.width + x) * 4, (y * buffer.width + x) * 4 + 3))

describe("paintCells", () => {
  test("draws a cell on the empty canvas as its quadrant glyph in its two colours, and counts it", () => {
    const buffer = screen()
    expect(paintCells(buffer, [cell(3, 1, 5, [47, 129, 247], [10, 20, 30])])).toBe(1)
    expect(charAt(buffer, 3, 1)).toBe("▌")
    expect(word(buffer.buffers.fg, buffer, 3, 1)).toEqual([47, 129, 247])
    expect(word(buffer.buffers.bg, buffer, 3, 1)).toEqual([10, 20, 30])
    expect(charAt(buffer, 4, 1)).toBe(" ")
  })

  test("goes behind text: a cell that already has a character is left alone", () => {
    const buffer = screen()
    buffer.setCell(3, 1, "X", WHITE, PAGE)
    expect(paintCells(buffer, [cell(3, 1)])).toBe(0)
    expect(charAt(buffer, 3, 1)).toBe("X")
  })

  test("goes behind panels: a blank cell with another background is left alone", () => {
    const buffer = screen()
    buffer.setCell(3, 1, " ", WHITE, PANEL)
    expect(paintCells(buffer, [cell(3, 1)])).toBe(0)
    expect(charAt(buffer, 3, 1)).toBe(" ")
    expect(word(buffer.buffers.bg, buffer, 3, 1)).toEqual([32, 36, 44])
  })

  test("a koi's cell can sit right beside text, since a body is not a speck that splits a word", () => {
    const buffer = screen()
    buffer.drawText("ab", 0, 1, WHITE)
    expect(paintCells(buffer, [cell(2, 1)])).toBe(1)
    expect(charAt(buffer, 1, 1)).toBe("b")
    expect(charAt(buffer, 2, 1)).toBe("▌")
  })

  test("every cell is judged against the frame as the interface drew it, so order and neighbours do not matter", () => {
    const forward = screen()
    const backward = screen()
    forward.drawText("hi", 2, 1, WHITE)
    backward.drawText("hi", 2, 1, WHITE)
    const cells = [cell(0, 1), cell(1, 1), cell(2, 1), cell(3, 1), cell(4, 1), cell(5, 1)]
    expect(paintCells(forward, cells)).toBe(paintCells(backward, [...cells].reverse()))
    expect(Array.from(forward.buffers.char)).toEqual(Array.from(backward.buffers.char))
  })

  test("cells off the buffer are ignored rather than crashing", () => {
    const buffer = screen()
    expect(paintCells(buffer, [cell(-1, 0), cell(10, 0), cell(0, -1), cell(0, 4), cell(9, 3)])).toBe(1)
    expect(charAt(buffer, 9, 3)).toBe("▌")
  })

  test("a flat cell paints as a solid colour", () => {
    const buffer = screen()
    paintCells(buffer, [cell(2, 2, 0, [20, 30, 40], [20, 30, 40])])
    expect(charAt(buffer, 2, 2)).toBe(" ")
    expect(word(buffer.buffers.bg, buffer, 2, 2)).toEqual([20, 30, 40])
  })

  test("it goes on working through many thousands of different colours, as a long fade-in makes", () => {
    for (let round = 0; round < 60; round++) {
      const buffer = screen()
      const cells = Array.from({ length: 40 }, (_, index) => cell(index % 10, Math.floor(index / 10), 5, [(round * 4 + index) % 256, index * 6 % 256, round], [0, round, index]))
      expect(paintCells(buffer, cells)).toBe(40)
      expect(word(buffer.buffers.fg, buffer, 0, 0)).toEqual([(round * 4) % 256, 0, round])
    }
  })

  test("given the page's colour, that is what counts as empty, wherever the top left cell happens to be", () => {
    const buffer = screen()
    // Something else sits in the top left corner, as a banner row or a toast might.
    buffer.setCell(0, 0, " ", WHITE, PANEL)
    expect(paintCells(buffer, [cell(3, 1)], { r: 0, g: 0, b: 0 })).toBe(1)
    expect(charAt(buffer, 3, 1)).toBe("▌")
  })

  test("a dimming scrim over everything is not the page: nothing is painted through it", () => {
    const buffer = OptimizedBuffer.create(10, 4, "wcwidth", { respectAlpha: true } as never)
    buffer.clear(PANEL)
    expect(paintCells(buffer, [cell(3, 1), cell(0, 0)], { r: 0, g: 0, b: 0 })).toBe(0)
    // Without being told the page's colour it takes the top left cell for it, as before.
    expect(paintCells(buffer, [cell(3, 1)])).toBe(1)
  })
})

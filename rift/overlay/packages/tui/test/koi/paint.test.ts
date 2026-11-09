import { describe, expect, test } from "bun:test"
import { OptimizedBuffer, RGBA, ResourceContext } from "@opentui/core"
import { paintCells, paintDots } from "../../src/koi/paint"
import type { Placed } from "../../src/koi/pond"

const PAGE = RGBA.fromInts(0, 0, 0, 255)
const PANEL = RGBA.fromInts(32, 36, 44, 255)
const WHITE = RGBA.fromValues(1, 1, 1, 1)

function screen() {
  const buffer = OptimizedBuffer.create(10, 4, "wcwidth", { respectAlpha: true, owner: new ResourceContext({ objectCapacity: 8, renderCellsMax: 100_000 }) })
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

/** What the screen shows in a cell: the buffer's real text, since block characters are kept in a pool and not as plain codes. */
const charAt = (buffer: OptimizedBuffer, x: number, y: number) => {
  const lines = new TextDecoder().decode(buffer.getRealCharBytes(true)).split("\n")
  return [...(lines[y] ?? "")][x] ?? " "
}
const word = (array: Uint16Array, buffer: OptimizedBuffer, x: number, y: number) => Array.from(array.slice((y * buffer.width + x) * 4, (y * buffer.width + x) * 4 + 3))

describe("paintCells", () => {
  test("draws a cell on the empty canvas as its quadrant glyph in its two colours, and counts it", () => {
    const buffer = screen()
    expect(paintCells(buffer, [cell(3, 1, 5, [47, 129, 247], [10, 20, 30])])).toBe(1)
    expect(charAt(buffer, 3, 1)).toBe("▌")
    expect(word(buffer.withBuffers((cells) => cells.fg.slice()), buffer, 3, 1)).toEqual([47, 129, 247])
    expect(word(buffer.withBuffers((cells) => cells.bg.slice()), buffer, 3, 1)).toEqual([10, 20, 30])
    expect(charAt(buffer, 4, 1)).toBe(" ")
  })

  test("a cell with a glyph of its own, the logo's dots at rest, is drawn with that glyph in its colours", () => {
    const buffer = screen()
    expect(paintCells(buffer, [{ ...cell(3, 1, 0, [170, 170, 170], [0, 0, 0]), char: "⣿" }])).toBe(1)
    expect(charAt(buffer, 3, 1)).toBe("⣿")
    expect(word(buffer.withBuffers((cells) => cells.fg.slice()), buffer, 3, 1)).toEqual([170, 170, 170])
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
    expect(word(buffer.withBuffers((cells) => cells.bg.slice()), buffer, 3, 1)).toEqual([32, 36, 44])
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
    expect(Array.from(forward.withBuffers((cells) => cells.char.slice()))).toEqual(Array.from(backward.withBuffers((cells) => cells.char.slice())))
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
    expect(word(buffer.withBuffers((cells) => cells.bg.slice()), buffer, 2, 2)).toEqual([20, 30, 40])
  })

  test("it goes on working through many thousands of different colours, as a long fade-in makes", () => {
    for (let round = 0; round < 60; round++) {
      const buffer = screen()
      const cells = Array.from({ length: 40 }, (_, index) => cell(index % 10, Math.floor(index / 10), 5, [(round * 4 + index) % 256, index * 6 % 256, round], [0, round, index]))
      expect(paintCells(buffer, cells)).toBe(40)
      expect(word(buffer.withBuffers((cells) => cells.fg.slice()), buffer, 0, 0)).toEqual([(round * 4) % 256, 0, round])
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
    const buffer = OptimizedBuffer.create(10, 4, "wcwidth", { respectAlpha: true, owner: new ResourceContext({ objectCapacity: 8, renderCellsMax: 100_000 }) })
    buffer.clear(PANEL)
    expect(paintCells(buffer, [cell(3, 1), cell(0, 0)], { r: 0, g: 0, b: 0 })).toBe(0)
    // Without being told the page's colour it takes the top left cell for it, as before.
    expect(paintCells(buffer, [cell(3, 1)])).toBe(1)
  })
})

describe("paintDots", () => {
  /** A screenful of braille the size of the test screen, with dots in the cells given. */
  const dots = (cells: { col: number; row: number; bits: number; rgb: [number, number, number] }[]) => {
    const bits = new Uint8Array(10 * 4)
    const rgb = new Uint8Array(10 * 4 * 3)
    for (const cell of cells) {
      bits[cell.row * 10 + cell.col] = cell.bits
      rgb.set(cell.rgb, (cell.row * 10 + cell.col) * 3)
    }
    return { cols: 10, rows: 4, bits, rgb }
  }

  test("draws each cell's dots as its braille character in its colour, and leaves cells with no dots alone", () => {
    const buffer = screen()
    expect(paintDots(buffer, dots([{ col: 3, row: 1, bits: 0xff, rgb: [255, 127, 30] }, { col: 4, row: 2, bits: 0x01, rgb: [72, 6, 14] }]))).toBe(2)
    expect(charAt(buffer, 3, 1)).toBe("⣿")
    expect(charAt(buffer, 4, 2)).toBe("⠁")
    expect(word(buffer.withBuffers((cells) => cells.fg.slice()), buffer, 3, 1)).toEqual([255, 127, 30])
    expect(word(buffer.withBuffers((cells) => cells.fg.slice()), buffer, 4, 2)).toEqual([72, 6, 14])
    expect(charAt(buffer, 5, 2)).toBe(" ")
    // The page's own background stays: the dots lie on it.
    expect(word(buffer.withBuffers((cells) => cells.bg.slice()), buffer, 3, 1)).toEqual([0, 0, 0])
  })

  test("goes behind text and panels, as the koi do", () => {
    const buffer = screen()
    buffer.setCell(3, 1, "X", WHITE, PAGE)
    buffer.setCell(5, 1, " ", WHITE, PANEL)
    expect(paintDots(buffer, dots([{ col: 3, row: 1, bits: 0xff, rgb: [255, 255, 255] }, { col: 5, row: 1, bits: 0xff, rgb: [255, 255, 255] }]), { r: 0, g: 0, b: 0 })).toBe(0)
    expect(charAt(buffer, 3, 1)).toBe("X")
    expect(charAt(buffer, 5, 1)).toBe(" ")
  })

  test("the space between two words is left alone, so a line of text stays whole", () => {
    const buffer = screen()
    buffer.drawText("ab cd", 2, 1, WHITE)
    const all = dots(Array.from({ length: 10 }, (_, col) => ({ col, row: 1, bits: 0xff, rgb: [255, 255, 255] as [number, number, number] })))
    paintDots(buffer, all)
    expect(charAt(buffer, 4, 1)).toBe(" ")
    // Beside the text, as against inside it, the scene still comes right up to it.
    expect(charAt(buffer, 1, 1)).toBe("⣿")
    expect(charAt(buffer, 7, 1)).toBe("⣿")
  })

  test("a scene bigger than the screen is cut to it", () => {
    const buffer = OptimizedBuffer.create(4, 2, "wcwidth", { respectAlpha: true, owner: new ResourceContext({ objectCapacity: 8, renderCellsMax: 100_000 }) })
    buffer.clear(PAGE)
    const all = dots(Array.from({ length: 40 }, (_, i) => ({ col: i % 10, row: Math.floor(i / 10), bits: 0x40, rgb: [1, 2, 3] as [number, number, number] })))
    expect(paintDots(buffer, all)).toBe(8)
  })
})

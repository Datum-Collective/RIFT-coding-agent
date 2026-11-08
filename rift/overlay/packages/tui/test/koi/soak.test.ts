import { describe, expect, test } from "bun:test"
import { OptimizedBuffer, RGBA, ResourceContext } from "@opentui/core"
import { createPond, type Scene } from "../../src/koi/pond"
import { paintCells } from "../../src/koi/paint"
import { riftPalette } from "../../src/koi/palette"
import { riftLogo } from "../../src/koi/logo"
import { stirStream } from "../../src/koi/stream"

const palette = riftPalette({
  background: { r: 0, g: 0, b: 0 },
  text: { r: 238, g: 238, b: 238 },
  muted: { r: 128, g: 128, b: 138 },
  primary: { r: 47, g: 129, b: 247 },
})

/**
 * CPU time used so far, in milliseconds. A frame's cost is measured in this and not in wall-clock
 * time: on a busy machine the process is paused for other work in the middle of a frame, and that
 * waiting is not what the frame costs.
 */
const cpu = () => {
  const used = process.cpuUsage()
  return (used.user + used.system) / 1000
}

describe("a long idle", () => {
  for (const scene of ["pond", "chase"] as Scene[]) {
    test(`the ${scene} at 60 fps: a frame is cheap and the heap does not grow`, () => {
      const pond = createPond({ cols: 140, rows: 40, aspect: 2, palette, seed: 3, scene })
      const buffer = OptimizedBuffer.create(140, 40, "wcwidth", { respectAlpha: true, owner: new ResourceContext({ objectCapacity: 8, renderCellsMax: 100_000 }) })
      const frame = () => {
        buffer.clear(RGBA.fromInts(0, 0, 0, 255))
        pond.step(1 / 60)
        pond.draw()
        return paintCells(buffer, pond.cells())
      }
      for (let index = 0; index < 300; index++) frame()

      Bun.gc(true)
      const before = process.memoryUsage().heapUsed
      const frames = 1800
      const started = cpu()
      let drawn = 0
      for (let index = 0; index < frames; index++) drawn += frame()
      const perFrame = (cpu() - started) / frames
      Bun.gc(true)
      const grown = process.memoryUsage().heapUsed - before

      expect(drawn / frames).toBeGreaterThan(100)
      // Under half of a 60 fps frame's 16 ms, which leaves room for a slow CI machine.
      expect(perFrame).toBeLessThan(8)
      // Allocation per frame is garbage-collected: after half a minute the heap is where it started.
      expect(grown).toBeLessThan(8 * 1024 * 1024)
      // Whatever is added to the pond stays few: nothing piles up.
      expect(pond.rings.length).toBeLessThanOrEqual(8)
      expect(pond.chase?.swirls.length ?? 0).toBeLessThanOrEqual(4)
      expect(pond.chase?.ripples.length ?? 0).toBeLessThanOrEqual(8)
    }, 60000)
  }

  test("the stream above the composer at 60 fps, typed into all the while: a frame is cheap and the heap does not grow", () => {
    const pond = createPond({ cols: 160, rows: 7, aspect: 2, palette, seed: 3, scene: "stream" })
    const buffer = OptimizedBuffer.create(160, 7, "wcwidth", { respectAlpha: true, owner: new ResourceContext({ objectCapacity: 8, renderCellsMax: 100_000 }) })
    let index = 0
    const frame = () => {
      // Six keys a second.
      if (index++ % 10 === 0) stirStream(pond)
      buffer.clear(RGBA.fromInts(0, 0, 0, 255))
      pond.step(1 / 60)
      pond.draw()
      return paintCells(buffer, pond.cells())
    }
    for (let warm = 0; warm < 300; warm++) frame()

    Bun.gc(true)
    const before = process.memoryUsage().heapUsed
    const frames = 1800
    const started = cpu()
    let drawn = 0
    for (let n = 0; n < frames; n++) drawn += frame()
    const perFrame = (cpu() - started) / frames
    Bun.gc(true)
    const grown = process.memoryUsage().heapUsed - before

    expect(drawn / frames).toBeGreaterThan(20)
    expect(perFrame).toBeLessThan(8)
    expect(grown).toBeLessThan(8 * 1024 * 1024)
    expect(pond.koi.length).toBeLessThanOrEqual(3)
    expect(pond.stream!.runs.size).toBe(pond.koi.length)
    expect(pond.rings.length).toBeLessThanOrEqual(8)
  }, 60000)

  test("the intro, the logo breaking into koi, costs about the same as swimming, all the way through", () => {
    const col = 34
    const row = 8
    const pond = createPond({ cols: 140, rows: 40, aspect: 2, palette, seed: 4, scene: "pond", logo: { logo: riftLogo, col, row } })
    const buffer = OptimizedBuffer.create(140, 40, "wcwidth", { respectAlpha: true, owner: new ResourceContext({ objectCapacity: 8, renderCellsMax: 100_000 }) })
    const white = RGBA.fromValues(1, 1, 1, 1)
    let frames = 0
    const started = cpu()
    while (pond.intro && frames < 60 * 40) {
      buffer.clear(RGBA.fromInts(0, 0, 0, 255))
      riftLogo.glyphs.forEach((line, y) => buffer.drawText(line, col, row + y, white))
      pond.fade = Math.min(1, frames / 180)
      pond.step(1 / 60)
      pond.draw()
      paintCells(buffer, pond.cells(), { r: 0, g: 0, b: 0 })
      frames++
    }
    const perFrame = (cpu() - started) / frames
    // It ends by itself, in well under the forty seconds it was allowed.
    expect(pond.intro).toBeUndefined()
    expect(frames).toBeGreaterThan(60 * 4)
    expect(frames).toBeLessThan(60 * 16)
    expect(perFrame).toBeLessThan(8)
  }, 60000)
})

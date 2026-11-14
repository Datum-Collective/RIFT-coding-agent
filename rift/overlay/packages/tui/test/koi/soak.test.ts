import { describe, expect, test } from "bun:test"
import { OptimizedBuffer, RGBA, ResourceContext } from "@opentui/core"
import { createPond } from "../../src/koi/pond"
import { paintCells, paintDots } from "../../src/koi/paint"
import { riftPalette } from "../../src/koi/palette"
import { banner } from "../../src/banner"
import { ditherBanner } from "../../src/koi/logo"
import { stirStream } from "../../src/koi/stream"
import { createSingularity } from "../../src/koi/singularity"

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

/**
 * Painting into a buffer costs the runtime about 20 MB the first time it is done 900 or so times (compiled
 * code and the native-memory bindings, once), and nothing after: 900 more calls after that grow the heap by
 * under 20 KB. The heap budgets below are for a leak, which grows on every frame, so the warm-up has to be
 * past that one-off cost or they fail on a healthy build, and fail differently depending on what ran first.
 */
const WARM_FRAMES = 1500

describe("a long idle", () => {
  test("the stream above the composer at 60 fps, typed into all the while: a frame is cheap and the heap does not grow", () => {
    const pond = createPond({ cols: 160, rows: 7, aspect: 2, palette, seed: 3 })
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
    for (let warm = 0; warm < WARM_FRAMES; warm++) frame()

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

  for (const [cols, rows] of [
    [120, 40],
    [200, 50],
  ]) {
    test(`the singularity at ${cols}x${rows}, from the logo through the tearing to the spinning hole: a frame is cheap and the heap does not grow`, () => {
      const buffer = OptimizedBuffer.create(cols, rows, "wcwidth", { respectAlpha: true, owner: new ResourceContext({ objectCapacity: 8, renderCellsMax: 100_000 }) })
      const scene = createSingularity({ cols, rows, seed: 3, logo: { logo: ditherBanner(banner), col: Math.floor((cols - 72) / 2), row: Math.floor(rows / 2) - 10 } })
      const frame = () => {
        buffer.clear(RGBA.fromInts(0, 0, 0, 255))
        scene.step(1 / 30)
        scene.render()
        return paintDots(buffer, scene, { r: 0, g: 0, b: 0 })
      }
      for (let index = 0; index < WARM_FRAMES; index++) frame()

      Bun.gc(true)
      const before = process.memoryUsage().heapUsed
      const frames = 900
      const started = cpu()
      let drawn = 0
      for (let index = 0; index < frames; index++) drawn += frame()
      const perFrame = (cpu() - started) / frames
      Bun.gc(true)
      const grown = process.memoryUsage().heapUsed - before

      expect(scene.phase).toBe("steady")
      expect(drawn / frames).toBeGreaterThan(300)
      // The budget is 8 ms a frame at 30 frames a second; it measures under 2 ms, so this leaves room for a slow CI machine.
      expect(perFrame).toBeLessThan(8)
      expect(grown).toBeLessThan(8 * 1024 * 1024)
    }, 60000)
  }
})

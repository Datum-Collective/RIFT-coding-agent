import { describe, expect, test } from "bun:test"
import { createPond, sceneFor } from "../../src/koi/pond"
import { riftPalette } from "../../src/koi/palette"

const palette = riftPalette({
  background: { r: 0, g: 0, b: 0 },
  text: { r: 238, g: 238, b: 238 },
  muted: { r: 128, g: 128, b: 138 },
  primary: { r: 47, g: 129, b: 247 },
})

describe("which scene", () => {
  test("it is the same for a seed every time, and roughly six in ten are the quiet pond", () => {
    expect(sceneFor(41)).toBe(sceneFor(41))
    const ponds = Array.from({ length: 1000 }, (_, seed) => sceneFor(seed)).filter((scene) => scene === "pond").length
    expect(ponds / 1000).toBeGreaterThan(0.54)
    expect(ponds / 1000).toBeLessThan(0.66)
  })

  test("choosing the scene does not tilt how the pond is laid out: both pad layouts turn up about equally", () => {
    // The pond's first random draw decides which of two pad layouts it gets. If the scene is
    // chosen from the very same number, the ponds that are chosen all share that draw's range.
    let left = 0
    let total = 0
    for (let seed = 0; total < 80; seed++) {
      if (sceneFor(seed) !== "pond") continue
      const pond = createPond({ cols: 120, rows: 36, aspect: 2, palette, seed, scene: "pond" })
      total++
      if (pond.pads[0]!.x < pond.w / 2) left++
    }
    expect(left / total).toBeGreaterThan(0.3)
    expect(left / total).toBeLessThan(0.7)
  })
})

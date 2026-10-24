import { describe, expect, test } from "bun:test"
import { WALLPAPERS } from "../../src/background/wallpapers"
import { ACTIVITIES, TIMES } from "../../src/background/src/wallpaper"
import { ACTIVITY_CHOICES, WALLPAPER_CHOICES, next, pick, timeAt } from "../../src/background/catalog"

describe("background catalog", () => {
  test("lists exactly the scenes that ship, in the same order", () => {
    expect(WALLPAPER_CHOICES.map((item): string => item.id)).toEqual(WALLPAPERS.map((item): string => item.id))
    for (const item of WALLPAPER_CHOICES) {
      const scene = WALLPAPERS.find((wallpaper) => wallpaper.id === item.id)!
      expect(scene.name).toBe(item.name)
    }
  })

  test("activity choices are the ones the engine knows", () => {
    expect([...ACTIVITY_CHOICES]).toEqual([...ACTIVITIES])
  })

  test("time of day follows the clock", () => {
    const at = (hour: number, minute = 0) => timeAt(new Date(2026, 9, 24, hour, minute))
    expect(at(3)).toBe("night")
    expect(at(6, 30)).toBe("sunset")
    expect(at(12)).toBe("day")
    expect(at(18)).toBe("sunset")
    expect(at(19, 59)).toBe("sunset")
    expect(at(20)).toBe("night")
    expect(TIMES).toContain(at(15))
  })

  test("pick keeps only known values and next wraps around", () => {
    expect(pick(["a", "b"], "b", "a")).toBe("b")
    expect(pick(["a", "b"], "zzz", "a")).toBe("a")
    expect(pick(["a", "b"], undefined, "b")).toBe("b")
    expect(next(["a", "b", "c"], "c")).toBe("a")
    expect(next(["a", "b", "c"], "a")).toBe("b")
  })
})

describe("wallpaper scenes", () => {
  for (const wallpaper of WALLPAPERS) {
    for (const [time, cells] of [["day", false], ["sunset", true], ["night", true]] as const) {
      test(`${wallpaper.id} draws frames at ${time}${cells ? " on terminal cells" : ""}`, () => {
        const scene = wallpaper.create({ activity: "teeming", time: wallpaper.fixedTime ?? time })
        scene.resize(160, 90, cells)
        expect(scene.W).toBe(160)
        expect(scene.H).toBe(90)
        for (let frame = 0; frame < 5; frame++) {
          scene.step(0.1)
          scene.render()
        }
        // Not blank: some pixel differs from the first one.
        const first = scene.pixels.slice(0, 4)
        let differs = false
        for (let i = 4; i < scene.pixels.length && !differs; i += 4) {
          differs = scene.pixels[i] !== first[0] || scene.pixels[i + 1] !== first[1] || scene.pixels[i + 2] !== first[2]
        }
        expect(differs).toBe(true)
        scene.react?.("busy")
        scene.react?.("done")
        scene.step(0.1)
        scene.render()
      })
    }
  }

  test("every scene has what the menu and the engine need", () => {
    for (const wallpaper of WALLPAPERS) {
      expect(wallpaper.id).toMatch(/^[a-z0-9-]+$/)
      for (const activity of ACTIVITIES) expect(typeof wallpaper.activity[activity]).toBe("string")
      for (const time of TIMES) expect(wallpaper.scrim[time]).toHaveLength(3)
    }
  })
})

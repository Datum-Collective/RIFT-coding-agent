import { describe, expect, test } from "bun:test"
import { Journey } from "../../src/installation/journey"

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function terminal() {
  const out: string[] = []
  return { out, io: { write: (text: string) => void out.push(text), sleep: tick, interval: 0 } }
}

describe("Journey.track", () => {
  test("is the same width at every point and walks the marker from left to right", () => {
    const widths = [0, 0.25, 0.5, 0.99, 1].map((progress) => Journey.track(progress, 20).length)
    expect(new Set(widths).size).toBe(1)
    expect(Journey.track(0, 20).indexOf(Journey.MARKER)).toBe(0)
    expect(Journey.track(1, 20).indexOf(Journey.MARKER)).toBe(19)
    expect(Journey.track(0.5, 20).indexOf(Journey.MARKER)).toBeGreaterThan(5)
  })

  test("clamps progress outside 0 to 1", () => {
    expect(Journey.track(-3, 20)).toBe(Journey.track(0, 20))
    expect(Journey.track(7, 20)).toBe(Journey.track(1, 20))
  })
})

describe("Journey.stopAt", () => {
  test("starts in the Shire, ends at Mount Doom and never goes backwards", () => {
    expect(Journey.stopAt(0)).toBe("The Shire")
    expect(Journey.stopAt(1)).toBe("Mount Doom")
    const seen = Array.from({ length: 101 }, (_, index) => Journey.STOPS.indexOf(Journey.stopAt(index / 100)))
    expect(seen.every((stop) => stop >= 0)).toBe(true)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
    expect(new Set(seen).size).toBe(Journey.STOPS.length)
  })
})

describe("Journey.quote", () => {
  test("is the same for a version every time and varies between versions", () => {
    expect(Journey.quote("0.2.1")).toBe(Journey.quote("0.2.1"))
    const quotes = new Set(Array.from({ length: 30 }, (_, patch) => Journey.quote(`0.2.${patch}`)))
    expect(quotes.size).toBeGreaterThan(4)
    for (const text of quotes) expect(text.length).toBeGreaterThan(10)
  })
})

describe("Journey.interactive", () => {
  const tty = { isTTY: true }
  test("is on for a real terminal", () => {
    expect(Journey.interactive(tty, { TERM: "xterm-256color" })).toBe(true)
  })
  test("is off when output is piped, in CI, on a dumb terminal, or when asked", () => {
    expect(Journey.interactive({ isTTY: false }, {})).toBe(false)
    expect(Journey.interactive(tty, { CI: "true" })).toBe(false)
    expect(Journey.interactive(tty, { TERM: "dumb" })).toBe(false)
    expect(Journey.interactive(tty, { RIFT_NO_ANIMATION: "1" })).toBe(false)
    expect(Journey.interactive(tty, { RIFT_NO_ANIMATION: "true" })).toBe(false)
  })
  test("RIFT_NO_ANIMATION set to 0, false or nothing does not turn it off", () => {
    for (const value of ["0", "false", "", "no"]) expect(Journey.interactive(tty, { RIFT_NO_ANIMATION: value })).toBe(true)
  })
})

describe("Journey.play", () => {
  test("draws nothing when the terminal cannot take it, and still reports the outcome", async () => {
    const { out, io } = terminal()
    expect(await Journey.play(Promise.resolve("ok"), { ...io, interactive: false })).toBe(true)
    expect(await Journey.play(Promise.reject(new Error("no")), { ...io, interactive: false })).toBe(false)
    expect(out).toEqual([])
  })

  test("walks to Mount Doom, then gives the cursor back", async () => {
    const { out, io } = terminal()
    const task = new Promise<void>((resolve) => setTimeout(resolve, 25))
    expect(await Journey.play(task, { ...io, interactive: true })).toBe(true)
    const all = out.join("")
    expect(all.startsWith(Journey.HIDE_CURSOR)).toBe(true)
    expect(all).toContain("The Shire")
    expect(all).toContain("Mount Doom")
    expect(all.trimEnd().endsWith(Journey.SHOW_CURSOR) || all.includes(Journey.SHOW_CURSOR)).toBe(true)
    expect(all.lastIndexOf(Journey.SHOW_CURSOR)).toBeGreaterThan(all.lastIndexOf("Mount Doom"))
  })

  test("a failed task never reaches Mount Doom, and the cursor still comes back", async () => {
    const { out, io } = terminal()
    const task = new Promise<void>((_, reject) => setTimeout(() => reject(new Error("offline")), 25))
    expect(await Journey.play(task, { ...io, interactive: true })).toBe(false)
    const all = out.join("")
    expect(all).not.toContain("Mount Doom")
    expect(all.includes(Journey.SHOW_CURSOR)).toBe(true)
  })

  test("never goes past the stop it has earned while the task is still running", async () => {
    const { out, io } = terminal()
    const task = new Promise<void>((resolve) => setTimeout(resolve, 60))
    await Journey.play(task, { ...io, interactive: true })
    const frames = out.join("").split(Journey.CLEAR_LINE).filter((frame) => frame.includes(Journey.MARKER))
    const beforeFinish = frames.slice(0, Math.max(1, frames.length - 8))
    expect(beforeFinish.some((frame) => frame.includes("Mount Doom"))).toBe(false)
  })
})

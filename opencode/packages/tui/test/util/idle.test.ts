import { describe, expect, test } from "bun:test"
import { createIdle, isTyping } from "../../src/util/idle"
import { fakeClock } from "../fixture/fake-clock"

function watch(delay = 10_000) {
  const fake = fakeClock()
  const events: string[] = []
  const idle = createIdle({
    delay,
    clock: fake.clock,
    onIdle: () => events.push("idle"),
    onWake: () => events.push("wake"),
  })
  return { ...fake, events, idle }
}

describe("createIdle", () => {
  test("goes idle exactly when the delay has passed with no input", () => {
    const { advance, events } = watch(10_000)
    advance(9_999)
    expect(events).toEqual([])
    advance(1)
    expect(events).toEqual(["idle"])
  })

  test("input pushes the deadline back to a full delay after the last input", () => {
    const { advance, events, idle } = watch(10_000)
    advance(6_000)
    idle.poke()
    advance(9_999)
    expect(events).toEqual([])
    advance(1)
    expect(events).toEqual(["idle"])
  })

  test("input while idle wakes at once, only once per wake, and the cycle starts again", () => {
    const { advance, events, idle } = watch(10_000)
    advance(10_000)
    expect(idle.isIdle()).toBe(true)

    idle.poke()
    idle.poke()
    expect(events).toEqual(["idle", "wake"])
    expect(idle.isIdle()).toBe(false)

    advance(10_000)
    expect(events).toEqual(["idle", "wake", "idle"])
  })

  test("a flood of input events costs no timers", () => {
    const { advance, idle, pending, scheduled } = watch(10_000)
    for (let ms = 0; ms < 5_000; ms++) {
      advance(1)
      idle.poke()
      idle.poke()
    }
    expect(pending()).toBe(1)
    expect(scheduled()).toBeLessThan(5)
  })

  test("nothing fires after dispose", () => {
    const { advance, events, idle, pending } = watch(10_000)
    advance(4_000)
    idle.dispose()
    advance(60_000)
    idle.poke()
    expect(events).toEqual([])
    expect(pending()).toBe(0)
  })

  test("dispose also stops a wake from an idle that had already started", () => {
    const { advance, events, idle } = watch(10_000)
    advance(10_000)
    idle.dispose()
    idle.poke()
    expect(events).toEqual(["idle"])
  })
})

describe("isTyping", () => {
  test("keys and pastes are typing", () => {
    for (const sequence of ["a", "\r", "\x1b", "\x1b[A", "\x1bOP", "\x03", "\x7f", "\x1b[200~hi\x1b[201~", "\x1b[97;5u"]) {
      expect(isTyping(sequence)).toBe(true)
    }
  })

  test("the mouse is not: moving, pressing, releasing and scrolling, in either of the encodings", () => {
    for (const sequence of ["\x1b[<35;5;3M", "\x1b[<0;5;3M", "\x1b[<0;5;3m", "\x1b[<64;40;12M", "\x1b[<65;40;12M", "\x1b[M #!"]) {
      expect(isTyping(sequence)).toBe(false)
    }
  })

  test("the terminal talking to RIFT is not: focus changes, cursor and mode reports, colour and capability replies", () => {
    for (const sequence of [
      "\x1b[I",
      "\x1b[O",
      "\x1b[12;40R",
      "\x1b[?2026;2$y",
      "\x1b]11;rgb:0000/0000/0000\x07",
      "\x1b]4;1;rgb:cc/00/00\x1b\\",
      "\x1bP>|kitty(0.35.2)\x1b\\",
      "\x1b[?62;4c",
      "\x1b[?0u",
      "\x1b[?31;1u",
      "\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\",
      "\x1b[?997;1n",
      "\x1b[?997;2n",
    ]) {
      expect(isTyping(sequence)).toBe(false)
    }
  })
})

import { expect, test } from "bun:test"
import { createIdle, type Clock } from "../../src/util/idle"

/** A clock moved by hand: `pass(ms)` runs every timer that falls due. */
function handClock() {
  let now = 0
  let timers: { at: number; run: () => void; id: number }[] = []
  let next = 0
  const clock: Clock = {
    now: () => now,
    setTimeout: (run, ms) => {
      const id = next++
      timers.push({ at: now + ms, run, id })
      return id
    },
    clearTimeout: (id) => {
      timers = timers.filter((timer) => timer.id !== id)
    },
  }
  const pass = (ms: number) => {
    const until = now + ms
    for (;;) {
      const due = timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      timers = timers.filter((timer) => timer !== due)
      now = due.at
      due.run()
    }
    now = until
  }
  return { clock, pass }
}

function watch() {
  const { clock, pass } = handClock()
  const log: string[] = []
  const idle = createIdle({ delay: 10_000, onIdle: () => log.push("idle"), onWake: () => log.push("wake"), clock })
  return { idle, log, pass }
}

test("left alone, it goes idle once the delay has passed, and not before", () => {
  const { log, pass } = watch()
  pass(9_999)
  expect(log).toEqual([])
  pass(1)
  expect(log).toEqual(["idle"])
})

test("ignite goes idle at once, and the delay running out later does not go idle again", () => {
  const { idle, log, pass } = watch()
  pass(2_000)
  idle.ignite()
  expect(log).toEqual(["idle"])
  expect(idle.isIdle()).toBe(true)
  pass(60_000)
  expect(log).toEqual(["idle"])
})

test("ignite while idle does nothing", () => {
  const { idle, log } = watch()
  idle.ignite()
  idle.ignite()
  expect(log).toEqual(["idle"])
})

test("after ignite, the next poke wakes it, and it goes idle again only after a full delay", () => {
  const { idle, log, pass } = watch()
  idle.ignite()
  idle.poke()
  expect(log).toEqual(["idle", "wake"])
  pass(9_999)
  expect(log).toEqual(["idle", "wake"])
  pass(1)
  expect(log).toEqual(["idle", "wake", "idle"])
})

test("once disposed, ignite does nothing", () => {
  const { idle, log } = watch()
  idle.dispose()
  idle.ignite()
  expect(log).toEqual([])
})

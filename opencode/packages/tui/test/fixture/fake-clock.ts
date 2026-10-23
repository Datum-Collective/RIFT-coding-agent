import type { Clock } from "../../src/util/idle"

/** A clock the test drives by hand, so timing is exact rather than slept for. */
export function fakeClock() {
  let now = 0
  let next = 0
  const timers = new Map<number, { at: number; run: () => void }>()
  const clock: Clock = {
    now: () => now,
    setTimeout: (run, ms) => {
      const id = ++next
      timers.set(id, { at: now + ms, run })
      return id
    },
    clearTimeout: (id) => void timers.delete(id as number),
  }
  const advance = (ms: number) => {
    const end = now + ms
    for (;;) {
      const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0])
      now = due[1].at
      due[1].run()
    }
    now = end
  }
  return { clock, advance, pending: () => timers.size, scheduled: () => next }
}

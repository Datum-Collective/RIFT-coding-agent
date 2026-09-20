import { describe, expect, test } from "bun:test"
import { watchForUpdates } from "@/cli/upgrade"

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

describe("watchForUpdates", () => {
  test("checks straight away, keeps checking while open, and never stacks watchers", async () => {
    let checks = 0
    const run = async () => void (checks += 1)

    watchForUpdates(40, run)
    watchForUpdates(40, run) // a second call must not start a second timer
    expect(checks).toBe(1) // the launch check, not left waiting for the first interval

    await sleep(190)
    // One timer at 40ms gives about 4 more. Two stacked timers would give about 9.
    expect(checks).toBeGreaterThanOrEqual(3)
    expect(checks).toBeLessThanOrEqual(6)
  })
})

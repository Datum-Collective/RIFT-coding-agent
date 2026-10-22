import { describe, expect, test } from "bun:test"
import { Hedge } from "../../src/session/llm/hedge"

type Part = { type: "start" | "text" | "error" }

// A fake model request: waits `delay` ms before answering, then streams `parts`.
function request(delay: number, parts: Part["type"][], started: AbortSignal[]) {
  return (signal: AbortSignal) => {
    started.push(signal)
    return Promise.resolve(
      (async function* () {
        yield { type: "start" } as Part
        await Bun.sleep(delay)
        if (signal.aborted) return
        for (const type of parts) yield { type } as Part
      })(),
    )
  }
}

async function collect(input: { delays: number[]; parts?: Part["type"][][]; after: number }) {
  const started: AbortSignal[] = []
  const winners: number[] = []
  const requests = input.delays.map((delay, i) => request(delay, input.parts?.[i] ?? ["text"], started))
  const parts: Part[] = []
  for await (const part of Hedge.race<Part>({
    after: input.after,
    signal: new AbortController().signal,
    start: (signal, index) => requests[index]!(signal),
    ready: (part) => part.type === "text",
    failed: (part) => part.type === "error",
    onWinner: (index) => winners.push(index),
  }))
    parts.push(part)
  return { parts, started, winners }
}

describe("Hedge.race", () => {
  test("a quick answer never sends a second request", async () => {
    const result = await collect({ delays: [10, 10], after: 200 })
    expect(result.started).toHaveLength(1)
    expect(result.parts.map((part) => part.type)).toEqual(["start", "text"])
  })

  test("a late answer is raced, and the faster backup wins", async () => {
    const started = Date.now()
    const result = await collect({ delays: [2_000, 10], after: 50 })
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(result.started).toHaveLength(2)
    expect(result.winners).toEqual([1])
    expect(result.started[0]!.aborted).toBe(true)
    expect(result.parts.map((part) => part.type)).toEqual(["start", "text"])
  })

  test("the original still wins when it answers first after the backup was sent", async () => {
    const result = await collect({ delays: [80, 2_000], after: 50 })
    expect(result.winners).toEqual([0])
    expect(result.started[1]!.aborted).toBe(true)
  })

  test("a backup that fails does not beat an original that answers", async () => {
    const result = await collect({ delays: [150, 10], parts: [["text"], ["error"]], after: 50 })
    expect(result.winners).toEqual([0])
    expect(result.parts.map((part) => part.type)).toEqual(["start", "text"])
  })

  test("off when after is 0", async () => {
    const result = await collect({ delays: [100], after: 0 })
    expect(result.started).toHaveLength(1)
    expect(result.parts.map((part) => part.type)).toEqual(["start", "text"])
  })
})

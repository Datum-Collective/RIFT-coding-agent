import { describe, expect, test } from "bun:test"
import { onMouseActivity } from "../../src/util/mouse-activity"

type Event = { type: string }

/** Stands in for the renderer's root: it just records what reaches it. */
function root() {
  const received: string[] = []
  return {
    received,
    processMouseEvent(event: Event) {
      received.push(event.type)
    },
  }
}

const send = (target: { processMouseEvent: (event: never) => void }, ...types: string[]) => {
  for (const type of types) target.processMouseEvent({ type } as never)
}

describe("onMouseActivity", () => {
  test("hears the pointer moving, dragging, pressing, releasing and scrolling", () => {
    const target = root()
    let heard = 0
    onMouseActivity(target as never, () => heard++)
    send(target, "move", "drag", "drag-end", "down", "up", "drop", "scroll")
    expect(heard).toBe(7)
  })

  test("does not hear the renderer's own over and out, which it sends when the thing under a still pointer changes", () => {
    const target = root()
    let heard = 0
    onMouseActivity(target as never, () => heard++)
    send(target, "over", "out")
    expect(heard).toBe(0)
  })

  test("everything still reaches whatever was there before, heard or not", () => {
    const target = root()
    onMouseActivity(target as never, () => {})
    send(target, "over", "move", "out", "down")
    expect(target.received).toEqual(["over", "move", "out", "down"])
  })

  test("after it lets go it hears nothing, and the root is as it was", () => {
    const target = root()
    const original = target.processMouseEvent
    let heard = 0
    const stop = onMouseActivity(target as never, () => heard++)
    expect(target.processMouseEvent).not.toBe(original)
    stop()
    send(target, "move")
    expect(heard).toBe(0)
    expect(target.processMouseEvent).toBe(original)
  })

  test("two listeners share one hook, and each can leave on its own", () => {
    const target = root()
    const calls: string[] = []
    const stopA = onMouseActivity(target as never, () => calls.push("a"))
    const hooked = target.processMouseEvent
    const stopB = onMouseActivity(target as never, () => calls.push("b"))
    expect(target.processMouseEvent).toBe(hooked)
    send(target, "move")
    expect(calls).toEqual(["a", "b"])
    stopA()
    send(target, "move")
    expect(calls).toEqual(["a", "b", "b"])
    stopB()
  })

  test("leaving twice is harmless", () => {
    const target = root()
    const stop = onMouseActivity(target as never, () => {})
    stop()
    expect(() => stop()).not.toThrow()
  })

  test("if something else wrapped the root in the meantime, theirs is left alone and coming back does not pile up layers", () => {
    const target = root()
    const stop = onMouseActivity(target as never, () => {})
    const inner = target.processMouseEvent
    const theirs = function (this: unknown, event: Event) {
      inner.call(this, event as never)
    }
    target.processMouseEvent = theirs as never
    stop()
    expect(target.processMouseEvent).toBe(theirs)

    let heard = 0
    const again = onMouseActivity(target as never, () => heard++)
    // Nothing new was put on the root: the hook that is already in the chain is reused.
    expect(target.processMouseEvent).toBe(theirs)
    send(target, "move")
    expect(heard).toBe(1)
    expect(target.received).toEqual(["move"])
    again()

    for (let round = 0; round < 5; round++) onMouseActivity(target as never, () => {})()
    target.received.length = 0
    send(target, "move")
    expect(target.received).toEqual(["move"])
  })
})

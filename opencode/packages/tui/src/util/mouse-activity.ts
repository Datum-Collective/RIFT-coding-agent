/**
 * Tells you when the user is using the mouse.
 *
 * Mouse events are handled by whatever is under the pointer first and then bubble up to the root,
 * so the root is the one place that sees them all. `onMouse` on a renderable can be set but not
 * read back, so it cannot be chained or restored; the method the events bubble through can.
 *
 * One hook goes on a root however many listeners there are, and it is only ever put there once:
 * if something else wraps the root after ours, ours cannot be taken off, so it stays, and the next
 * listener reuses it instead of adding another layer.
 */

type Event = { type: string }
type Root = { processMouseEvent: (event: never) => void }

/**
 * The events that mean the user did something. The renderer also sends `over` and `out` of its own
 * accord, after a frame, when what is under a still pointer changes (a toast appears, the layout
 * shifts), and those are not the user.
 */
const USER = new Set(["move", "drag", "drag-end", "down", "up", "drop", "scroll"])

type Hook = { listeners: Set<() => void>; ours: Root["processMouseEvent"]; original: Root["processMouseEvent"] }

const hooks = new WeakMap<Root, Hook>()

/** Calls `listener` for each mouse event that is the user. Returns a function that stops it. */
export function onMouseActivity(root: Root, listener: () => void): () => void {
  let hook = hooks.get(root)
  if (!hook) {
    const original = root.processMouseEvent
    const listeners = new Set<() => void>()
    const ours = function (this: unknown, event: Event) {
      if (USER.has(event.type)) for (const each of [...listeners]) each()
      original.call(this, event as never)
    }
    hook = { listeners, ours: ours as Hook["ours"], original }
    hooks.set(root, hook)
    root.processMouseEvent = hook.ours
  }
  const installed = hook
  installed.listeners.add(listener)

  return () => {
    installed.listeners.delete(listener)
    if (installed.listeners.size > 0) return
    // Give the root back as it was, unless something has wrapped ours since.
    if (root.processMouseEvent === installed.ours) {
      root.processMouseEvent = installed.original
      hooks.delete(root)
    }
  }
}

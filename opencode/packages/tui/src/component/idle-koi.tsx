/**
 * The home screen's idle mode: after ten quiet seconds, a koi pond fades in behind the interface
 * (koi drifting between lily pads, or two koi circling a pad), and the first key, paste or mouse
 * movement sends it away.
 *
 * It draws nothing of its own into the layout. While the pond is out, a hook on the finished frame
 * paints it into cells the interface left empty (see `koi/paint`), so text, the composer and
 * panels are never covered. The renderer only runs continuously while the pond is out; the rest of
 * the time this costs one timer.
 *
 * Mount it and it is on; unmount it and it is gone. It is also off for anyone who turned
 * animations off (the `animations_enabled` setting) or set RIFT_NO_ANIMATION=1.
 */
import { createEffect, onCleanup, untrack } from "solid-js"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { OptimizedBuffer, RGBA } from "@opentui/core"
import { Journey } from "@opencode-ai/core/installation/journey"
import { useKV } from "../context/kv"
import { useTheme } from "../context/theme"
import { createIdle, isUserInput, type Clock } from "../util/idle"
import { riftPalette } from "../koi/palette"
import { createPond, type Pond, type Scene } from "../koi/pond"
import { paintCells } from "../koi/paint"
import { random } from "../koi/random"

/** How long the user must do nothing before the pond appears. */
export const IDLE_MS = 10_000

/** The pond fades in from the canvas over this long, so it surfaces rather than appears. */
const FADE_IN_MS = 3000

/** A frame that took longer than this (a stall, a suspended laptop) does not make the koi jump. */
const LONGEST_STEP_MS = 100

/** A terminal smaller than this has no room for a pond. */
const MIN_COLS = 60
const MIN_ROWS = 14

/** A terminal cell is about twice as tall as it is wide. */
const ASPECT = 2

/** Of every ten times the pond appears, this many are the quiet pond and the rest the chase. */
const POND_IN_TEN = 6

const channels = (colour: RGBA) => ({ r: colour.r * 255, g: colour.g * 255, b: colour.b * 255 })

export function IdleKoi(props: {
  delay?: number
  seed?: number
  /** Which scene to show. Left out, it is chosen at random each time. */
  scene?: Scene
  /** Where time comes from. Tests pass a clock they drive by hand. */
  clock?: Pick<Clock, "now"> & Partial<Clock>
}) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const kv = useKV()
  const { theme } = useTheme()
  const enabled = () => kv.get("animations_enabled", true) !== false && !Journey.animationOff(process.env)

  let pond: Pond | undefined
  /** Set while the watcher is running: fits the pond to a new terminal size. */
  let fit: ((width: number, height: number) => void) | undefined

  createEffect(() => {
    if (!enabled()) return

    const clock = props.clock as Clock | undefined
    const now = () => (clock ?? Date).now()
    let shownAt = 0
    let last = 0
    let seed = 0

    const roomFor = (width: number, height: number) => width >= MIN_COLS && height >= MIN_ROWS

    const build = (width: number, height: number) => {
      const palette = riftPalette({
        background: channels(theme.background),
        text: channels(theme.text),
        muted: channels(theme.textMuted),
        primary: channels(theme.primary),
      })
      const scene = props.scene ?? (random(seed).float() < POND_IN_TEN / 10 ? "pond" : "chase")
      return createPond({ cols: width, rows: height, aspect: ASPECT, palette, seed, scene })
    }

    const draw = (buffer: OptimizedBuffer) => {
      if (!pond) return
      const at = now()
      pond.step(Math.max(0, Math.min(LONGEST_STEP_MS, at - last)) / 1000)
      last = at
      pond.fade = Math.min(1, (at - shownAt) / FADE_IN_MS)
      pond.draw()
      paintCells(buffer, pond.cells())
    }

    const begin = () => {
      const { width, height } = untrack(dimensions)
      // Too small for a pond: stay as it is. If the terminal grows while the user is still away,
      // `fit` starts it then.
      if (!roomFor(width, height)) return
      seed = props.seed ?? Date.now() % 1_000_000
      pond = build(width, height)
      shownAt = last = now()
      renderer.addPostProcessFn(draw)
      renderer.requestLive()
    }

    // Takes effect on the frame after the input, and the frame after has no pond in it.
    const end = () => {
      if (!pond) return
      pond = undefined
      renderer.removePostProcessFn(draw)
      renderer.dropLive()
      renderer.requestRender()
    }

    const idle = createIdle({ delay: props.delay ?? IDLE_MS, onIdle: begin, onWake: end, clock })

    fit = (width, height) => {
      if (pond) {
        // The pond is built for one size, so a new size is a new pond, from the same seed so it
        // is the same pond, and as far into the fade as the last one was.
        if (!roomFor(width, height)) return end()
        const fade = pond.fade
        pond = build(width, height)
        pond.fade = fade
        return
      }
      if (idle.isIdle()) begin()
    }

    // Keys arrive here as raw input. Mouse events are handled by whatever is under the pointer
    // first, so they are caught where they bubble up to, at the root. (The few places that stop a
    // mouse event are clicks and selection; moving the pointer reaches the root.)
    const input = (sequence: string) => {
      if (isUserInput(sequence)) idle.poke()
      return false
    }
    renderer.prependInputHandler(input)
    // A paste goes to the key handler without passing through the raw input handlers.
    const pasted = () => idle.poke()
    renderer.keyInput.on("paste", pasted)
    // `onMouse` can be set but not read back, so it cannot be chained or restored. Wrapping the
    // method the event bubbles through can.
    const root = renderer.root
    const original = root.processMouseEvent
    const ours = function (this: typeof root, event: Parameters<typeof original>[0]) {
      idle.poke()
      original.call(this, event)
    }
    root.processMouseEvent = ours

    onCleanup(() => {
      fit = undefined
      idle.dispose()
      end()
      renderer.removeInputHandler(input)
      renderer.keyInput.off("paste", pasted)
      // Only give back what was there if nobody has wrapped ours since.
      if (root.processMouseEvent === ours) root.processMouseEvent = original
    })
  })

  createEffect(() => {
    const { width, height } = dimensions()
    fit?.(width, height)
  })

  return null
}

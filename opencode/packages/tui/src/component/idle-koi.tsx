/**
 * The home screen's idle mode: after ten seconds without typing, the logo turns into koi in a pond
 * that fades in behind the interface (koi drifting between lily pads, or two koi circling a pad),
 * and the first key or paste sends it away. The mouse does neither: it can be moved, clicked and
 * scrolled while the pond is out and while it is waiting.
 *
 * It draws nothing of its own into the layout. While the pond is out, a hook on the finished frame
 * paints it into cells the interface left empty (see `koi/paint`), so text, the composer and
 * panels are never covered. The renderer only runs continuously while the pond is out, and not at
 * all while the terminal is in the background; the rest of the time this costs one timer.
 *
 * Mount it and it is on; unmount it and it is gone. It is also off for anyone who turned
 * animations off (the `animations_enabled` setting) or set RIFT_NO_ANIMATION.
 */
import { createEffect, on, onCleanup, untrack } from "solid-js"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { OptimizedBuffer, RGBA } from "@opentui/core"
import { Journey } from "@opencode-ai/core/installation/journey"
import { useKV } from "../context/kv"
import { useTheme } from "../context/theme"
import { createIdle, isTyping, type Clock } from "../util/idle"
import { logoAnchor } from "./banner-anchor"
import { logoFromBanner } from "../koi/logo"
import { banner } from "../banner"
import { riftPalette } from "../koi/palette"
import { createPond, sceneFor, type Pond, type Scene } from "../koi/pond"
import { paintCells } from "../koi/paint"

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

/**
 * Dragging a window's edge sends a resize for every step. A new pond costs a few milliseconds, so
 * it is only built once the size has stopped changing for this long; meanwhile the old one swims on.
 */
const RESIZE_SETTLE_MS = 150

const channels = (colour: RGBA) => ({ r: colour.r * 255, g: colour.g * 255, b: colour.b * 255 })

export function IdleKoi(props: {
  delay?: number
  seed?: number
  /** Which scene to show. Left out, it is chosen from the seed, which changes each time. */
  scene?: Scene
  /** Where time comes from. Tests pass a clock they drive by hand. */
  clock?: Pick<Clock, "now"> & Partial<Clock>
}) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const kv = useKV()
  const { theme } = useTheme()
  const enabled = () =>
    kv.get("animations_enabled", true) !== false && kv.get("koi_enabled", true) !== false && !Journey.animationOff(process.env)

  let pond: Pond | undefined
  /** Set while the watcher is running: fits the pond to a new terminal size. */
  let fit: ((width: number, height: number) => void) | undefined
  /** Set while the watcher is running: makes the pond again, as it is now, with the theme's colours. */
  let refresh: (() => void) | undefined

  createEffect(() => {
    if (!enabled()) return

    const clock = props.clock as Clock | undefined
    const now = () => (clock ?? Date).now()
    const later = clock?.setTimeout ?? ((run: () => void, ms: number) => setTimeout(run, ms))
    const cancel = clock?.clearTimeout ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
    let shownAt = 0
    let last = 0
    let seed = 0
    /** Given up on after something went wrong, for as long as this is mounted. */
    let broken = false
    let blurred = false
    /** Whether this holds the renderer in continuous mode. Kept apart from the pond so it is released exactly once. */
    let live = false
    let settling: unknown

    const hold = () => {
      if (live) return
      live = true
      renderer.requestLive()
    }
    const release = () => {
      if (!live) return
      live = false
      renderer.dropLive()
    }

    const roomFor = (width: number, height: number) => width >= MIN_COLS && height >= MIN_ROWS

    /** The banner is the logo the koi are made from, wherever it is on the screen now. */
    const logoAt = (intro: boolean) => {
      const at = logoAnchor.read()
      // Drawn over the page it is on, so the shades blend as the terminal blends them.
      return at ? { logo: logoFromBanner(banner, channels(theme.background)), col: at.col, row: at.row, intro } : undefined
    }

    const build = (width: number, height: number, intro: boolean) => {
      const palette = riftPalette({
        background: channels(theme.background),
        text: channels(theme.text),
        muted: channels(theme.textMuted),
        primary: channels(theme.primary),
      })
      return createPond({ cols: width, rows: height, aspect: ASPECT, palette, seed, scene: props.scene ?? sceneFor(seed), logo: logoAt(intro) })
    }

    /** A theme with a see-through background has no colour to name, so the painter reads the page off the screen instead. */
    const page = () => (theme.background.a === 1 ? channels(theme.background) : undefined)

    // This runs inside the renderer's frame loop, where an error is not shown: the frame is never
    // presented, and every frame after it fails the same way, so the interface would look frozen
    // until a key was pressed. Any failure here ends the pond for good instead.
    const fail = (error: unknown) => {
      broken = true
      console.debug("koi pond stopped", { error })
      end()
    }

    const draw = (buffer: OptimizedBuffer) => {
      if (!pond) return
      try {
        const at = now()
        pond.step(Math.max(0, Math.min(LONGEST_STEP_MS, at - last)) / 1000)
        last = at
        pond.fade = Math.min(1, (at - shownAt) / FADE_IN_MS)
        pond.draw()
        paintCells(buffer, pond.cells(), page())
        // The banner has been moved by the layout, an update notice say: the pond is remade where it is now.
        const banner = logoAnchor.read()
        const moved = pond.logoAt && banner && (banner.col !== pond.logoAt.col || banner.row !== pond.logoAt.row)
        if (moved && settling === undefined) settling = later(remake, RESIZE_SETTLE_MS)
      } catch (error) {
        fail(error)
      }
    }

    const begin = () => {
      if (broken) return
      const { width, height } = untrack(dimensions)
      // Too small for a pond: stay as it is. If the terminal grows while the user is still away,
      // `fit` starts it then.
      if (!roomFor(width, height)) return
      try {
        seed = props.seed ?? Date.now() % 1_000_000
        pond = build(width, height, true)
      } catch (error) {
        return fail(error)
      }
      shownAt = last = now()
      renderer.addPostProcessFn(draw)
      if (!blurred) hold()
      // The logo has become the koi: the banner draws nothing while the pond is out.
      logoAnchor.hide(pond.logoAt !== undefined)
    }

    // Takes effect on the frame after the input, and the frame after has no pond in it.
    const end = () => {
      if (settling !== undefined) cancel(settling)
      settling = undefined
      if (!pond) return
      pond = undefined
      renderer.removePostProcessFn(draw)
      release()
      logoAnchor.hide(false)
      renderer.requestRender()
    }

    const idle = createIdle({ delay: props.delay ?? IDLE_MS, onIdle: begin, onWake: end, clock })

    /** Makes the pond again at the size the terminal is now, as far into the fade as the last one was. */
    const remake = () => {
      settling = undefined
      if (!pond) return
      const { width, height } = untrack(dimensions)
      if (!roomFor(width, height)) return end()
      const fade = pond.fade
      try {
        // Remade at the new size. An intro that was playing plays again from the start, so it is
        // never cut off; one that was over is not played again, the logo having become koi already.
        pond = build(width, height, pond.intro !== undefined)
      } catch (error) {
        return fail(error)
      }
      pond.fade = fade
      logoAnchor.hide(pond.logoAt !== undefined)
    }

    fit = (width, height) => {
      if (!pond) {
        if (idle.isIdle()) begin()
        return
      }
      // Too small is not worth waiting over.
      if (!roomFor(width, height)) return end()
      if (settling !== undefined) cancel(settling)
      settling = later(remake, RESIZE_SETTLE_MS)
    }
    refresh = remake

    // Keys arrive here as raw input. The mouse is left alone: it neither ends the pond nor holds it
    // back. Only typing does.
    const input = (sequence: string) => {
      if (isTyping(sequence)) idle.poke()
      return false
    }
    renderer.prependInputHandler(input)
    // A paste goes to the key handler without passing through the raw input handlers.
    const pasted = () => idle.poke()
    renderer.keyInput.on("paste", pasted)

    // A terminal in the background has nobody looking at it, so the pond stops being redrawn there
    // and carries on where it was when the terminal comes back.
    const onBlur = () => {
      blurred = true
      release()
    }
    const onFocus = () => {
      blurred = false
      if (pond) hold()
    }
    renderer.on("blur", onBlur)
    renderer.on("focus", onFocus)

    onCleanup(() => {
      fit = undefined
      refresh = undefined
      idle.dispose()
      end()
      renderer.removeInputHandler(input)
      renderer.keyInput.off("paste", pasted)
      renderer.off("blur", onBlur)
      renderer.off("focus", onFocus)
    })
  })

  createEffect(() => {
    const { width, height } = dimensions()
    fit?.(width, height)
  })

  // The pond's colours come from the theme when it is made, so a theme that changes while it is out
  // (the terminal went from light to dark) needs a new one.
  const colours = () => [theme.background, theme.text, theme.textMuted, theme.primary].map((c) => `${c.r},${c.g},${c.b}`).join("|")
  createEffect(on(colours, () => refresh?.(), { defer: true }))

  return null
}

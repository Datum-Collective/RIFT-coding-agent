/**
 * The home screen's idle mode: after ten seconds without typing, or at once when the logo is
 * clicked, a black hole opens behind the logo, tears its dots off into strands and swallows them,
 * then spins with its accretion disk (see `koi/singularity`). The first key or paste sends it away:
 * the hole fades out and the logo comes back, dot for dot. Nothing else the mouse does starts or
 * ends it: it can be moved, clicked and scrolled while the hole is out and while it is waiting.
 *
 * It draws nothing of its own into the layout. While the hole is out, a hook on the finished frame
 * paints it into cells the interface left empty (see `koi/paint`), so text, the composer and panels
 * are never covered. The renderer only runs continuously while the hole is out, and not at all while
 * the terminal is in the background, where it waits to start until the terminal comes back; the
 * rest of the time this costs one timer.
 *
 * Mount it and it is on; unmount it and it is gone. It is also off for anyone who turned
 * animations off (the /background toggle or the project's `animations` config) or set RIFT_NO_ANIMATION.
 */
import { createEffect, on, onCleanup, untrack } from "solid-js"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { OptimizedBuffer, RGBA } from "@opentui/core"
import { useKoiEnabled } from "./koi-enabled"
import { useTheme } from "../context/theme"
import { createIdle, isTyping, type Clock } from "../util/idle"
import { logoAnchor } from "./banner-anchor"
import { ditherBanner } from "../koi/logo"
import { banner, bannerColours } from "../banner"
import { createSingularity, type Singularity } from "../koi/singularity"
import { paintDots } from "../koi/paint"

/** How long the user must do nothing before the hole opens. */
export const IDLE_MS = 10_000

/** A frame that took longer than this (a stall, a suspended laptop) does not make the scene jump. */
const LONGEST_STEP_MS = 100

/** Frames per second while the hole is out. Rendering at the app's 60 is what made an idle RIFT use a quarter of a core. */
const SCENE_FPS = 30

/** A terminal smaller than this has no room for the hole. */
const MIN_COLS = 60
const MIN_ROWS = 14

/**
 * Dragging a window's edge sends a resize for every step. Fitting the scene to a new size costs a few
 * milliseconds, so it waits until the size has stopped changing for this long; meanwhile the old fit
 * carries on.
 */
const RESIZE_SETTLE_MS = 150

const channels = (colour: RGBA) => ({ r: colour.r * 255, g: colour.g * 255, b: colour.b * 255 })

export function IdleSingularity(props: {
  delay?: number
  seed?: number
  /** Where time comes from. Tests pass a clock they drive by hand. */
  clock?: Pick<Clock, "now"> & Partial<Clock>
}) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const theme = useTheme()
  const enabled = useKoiEnabled()

  /** Set while the watcher is running: fits the scene to a new terminal size. */
  let fit: ((width: number, height: number) => void) | undefined
  /** Set while the watcher is running: puts the logo in the scene again, where it is now, in the theme's colours. */
  let refresh: (() => void) | undefined

  createEffect(() => {
    if (!enabled()) return

    const clock = props.clock as Clock | undefined
    const now = () => (clock ?? Date).now()
    const later = clock?.setTimeout ?? ((run: () => void, ms: number) => setTimeout(run, ms))
    const cancel = clock?.clearTimeout ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
    let scene: Singularity | undefined
    let last = 0
    /** Given up on after something went wrong, for as long as this is mounted. */
    let broken = false
    let blurred = false
    /** Whether this holds the renderer in continuous mode. Kept apart from the scene so it is released exactly once. */
    let live = false
    let fps: { target: number; max: number } | undefined
    let settling: unknown

    const hold = () => {
      if (live) return
      live = true
      // The hole is out for as long as the user is away, so it gets a calm frame rate.
      fps = { target: renderer.targetFps, max: renderer.maxFps }
      renderer.targetFps = SCENE_FPS
      renderer.maxFps = SCENE_FPS
      renderer.requestLive()
    }
    const release = () => {
      if (!live) return
      live = false
      renderer.dropLive()
      if (fps) {
        renderer.targetFps = fps.target
        renderer.maxFps = fps.max
      }
    }

    const roomFor = (width: number, height: number) => width >= MIN_COLS && height >= MIN_ROWS

    /** The banner is the logo the hole tears apart, wherever it is on the screen now, in the same dots it draws. */
    const colours = () => bannerColours(channels(theme.hue.accent[400]))
    const logoAt = () => {
      const at = logoAnchor.read()
      return at ? { logo: ditherBanner(banner, colours()), col: at.col, row: at.row } : undefined
    }

    /** A theme with a see-through background has no colour to name, so the painter reads the page off the screen instead. */
    const page = () => (theme.background.base.a === 1 ? channels(theme.background.base) : undefined)
    /** Dark text means a light page, where the scene is drawn in ink. Read off the text, which a see-through background does not hide. */
    const ink = () => {
      const text = theme.text.base
      return 0.2126 * text.r + 0.7152 * text.g + 0.0722 * text.b < 0.5
    }

    // This runs inside the renderer's frame loop, where an error is not shown: the frame is never
    // presented, and every frame after it fails the same way, so the interface would look frozen
    // until a key was pressed. Any failure here ends the scene for good instead.
    const fail = (error: unknown) => {
      broken = true
      console.debug("singularity stopped", { error })
      finish()
    }

    const draw = (buffer: OptimizedBuffer) => {
      if (!scene) return
      try {
        const at = now()
        scene.step(Math.max(0, Math.min(LONGEST_STEP_MS, at - last)) / 1000)
        last = at
        scene.render()
        paintDots(buffer, scene, page())
        // Its last frame is the logo back where it was; from the next, the banner draws it again.
        if (scene.done) return finish()
        // The banner has been moved by the layout (an update notice, say): the logo is put back where it is now.
        const banner = logoAnchor.read()
        const moved = scene.logoAt && banner && (banner.col !== scene.logoAt.col || banner.row !== scene.logoAt.row)
        if (moved && settling === undefined) settling = later(refit, RESIZE_SETTLE_MS)
      } catch (error) {
        fail(error)
      }
    }

    const begin = () => {
      // In the background the hole would be one frame that never moves, and the logo would be gone:
      // it starts when the terminal comes back instead.
      if (broken || blurred) return
      const { width, height } = untrack(dimensions)
      // Too small: stay as it is. If the terminal grows while the user is still away, `fit` starts it then.
      if (!roomFor(width, height)) return
      // Called again while the last one is still fading out, it starts over from the logo.
      const running = scene !== undefined
      try {
        scene = createSingularity({ cols: width, rows: height, seed: props.seed ?? Date.now() % 1_000_000, logo: logoAt(), ink: ink(), colours: colours() })
      } catch (error) {
        return fail(error)
      }
      last = now()
      if (!running) renderer.addPostProcessFn(draw)
      hold()
      // The scene draws the logo now: the banner draws nothing while it is out.
      logoAnchor.hide(scene.logoAt !== undefined)
    }

    /** Everything back as it was. Takes effect on the next frame, which has no scene in it. */
    const finish = () => {
      if (settling !== undefined) cancel(settling)
      settling = undefined
      if (!scene) return
      scene = undefined
      renderer.removePostProcessFn(draw)
      release()
      logoAnchor.hide(false)
      renderer.requestRender()
    }

    // A key: the hole fades out and the logo comes back, then `draw` finishes.
    const wake = () => scene?.leave()

    const idle = createIdle({ delay: props.delay ?? IDLE_MS, onIdle: begin, onWake: wake, clock })
    // A click on the logo opens the hole now. Clicked again while it is out, it is idle already.
    const stopClicks = logoAnchor.onClick(idle.ignite)

    /** Fits the scene to the size the terminal is now, with the logo where it is now; the hole carries on. */
    const refit = () => {
      settling = undefined
      if (!scene) return
      const { width, height } = untrack(dimensions)
      if (!roomFor(width, height)) return finish()
      try {
        scene.place(width, height, logoAt())
        scene.ink = ink()
        scene.recolour(colours())
      } catch (error) {
        return fail(error)
      }
      logoAnchor.hide(scene.logoAt !== undefined)
    }

    fit = (width, height) => {
      if (!scene) {
        if (idle.isIdle()) begin()
        return
      }
      // Too small is not worth waiting over.
      if (!roomFor(width, height)) return finish()
      if (settling !== undefined) cancel(settling)
      settling = later(refit, RESIZE_SETTLE_MS)
    }
    refresh = refit

    // Keys arrive here as raw input. The mouse is left alone: it neither ends the scene nor holds it
    // back. Only typing does.
    const input = (sequence: string) => {
      if (isTyping(sequence)) idle.poke()
      return false
    }
    renderer.prependInputHandler(input)
    // A paste goes to the key handler without passing through the raw input handlers.
    const pasted = () => idle.poke()
    renderer.keyInput.on("paste", pasted)

    // A terminal in the background has nobody looking at it, so the scene stops being drawn there and
    // carries on where it was when the terminal comes back.
    const onBlur = () => {
      blurred = true
      release()
    }
    const onFocus = () => {
      blurred = false
      if (scene) {
        last = now()
        hold()
      } else if (idle.isIdle()) begin()
    }
    renderer.on("blur", onBlur)
    renderer.on("focus", onFocus)

    onCleanup(() => {
      fit = undefined
      refresh = undefined
      stopClicks()
      idle.dispose()
      finish()
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

  // The logo's colours, and whether the page is light, come from the theme, so a theme that changes
  // while the hole is out (the terminal went from light to dark) puts them in again.
  const colours = () => [theme.background.base, theme.text.base, theme.hue.accent[400]].map((c) => `${c.r},${c.g},${c.b}`).join("|")
  createEffect(on(colours, () => refresh?.(), { defer: true }))

  return null
}

/**
 * Koi above the composer while the user types: the first character typed on the home screen lets
 * a strip of water open just above the composer, and small koi swim through it, quickening with
 * the typing. A couple of seconds after the typing stops no more come, and the ones still there
 * fade away.
 *
 * Only typing brings them: the mouse neither calls them nor sends them off, and neither do
 * shortcuts, arrows or Enter.
 *
 * Like the idle pond it draws nothing into the layout. A hook on the finished frame paints the
 * strip into cells the interface left empty (see `koi/paint`), so the logo, the tagline and the
 * composer stay on top and the koi pass behind them. The renderer only runs continuously while
 * koi are in the strip. Off for anyone who turned animations off or set RIFT_NO_ANIMATION.
 */
import { createEffect, onCleanup, untrack } from "solid-js"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { BoxRenderable, KeyEvent, OptimizedBuffer, RGBA } from "@opentui/core"
import { Journey } from "@opencode-ai/core/installation/journey"
import { useKV } from "../context/kv"
import { useTheme } from "../context/theme"
import type { Clock } from "../util/idle"
import { riftPalette } from "../koi/palette"
import { createPond, type Pond } from "../koi/pond"
import { stirStream } from "../koi/stream"
import { paintCells } from "../koi/paint"

/** After this long without a keystroke no more koi come in. */
export const LINGER_MS = 2500

/** Then the koi still in the strip fade out over this long. */
export const FADE_OUT_MS = 1200

/** The strip's height in rows, ending on the row just above the composer. */
const BAND = 9

/** A strip squeezed shorter than this at the top of the screen is not worth drawing. */
const MIN_BAND = 6

/** A terminal cell is about twice as tall as it is wide. */
const ASPECT = 2

/** A frame that took longer than this does not make the koi jump. */
const LONGEST_STEP_MS = 100

const channels = (colour: RGBA) => ({ r: colour.r * 255, g: colour.g * 255, b: colour.b * 255 })

/** A key that puts text in the composer, as opposed to a shortcut, an arrow or Enter. */
export function isTyping(key: Pick<KeyEvent, "name" | "ctrl" | "meta" | "super">) {
  if (key.ctrl || key.meta || key.super) return false
  return key.name.length === 1 || key.name === "space" || key.name === "backspace"
}

export function TypingKoi(props: {
  /** The box the composer sits in; the strip runs along its top. */
  composer: () => BoxRenderable | undefined
  seed?: number
  /** Where time comes from. Tests pass a clock they drive by hand. */
  clock?: Pick<Clock, "now">
}) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const kv = useKV()
  const { theme } = useTheme()
  const enabled = () => kv.get("animations_enabled", true) !== false && !Journey.animationOff(process.env)

  createEffect(() => {
    if (!enabled()) return

    const now = () => (props.clock ?? Date).now()
    let pond: Pond | undefined
    let top = 0
    let lastKey = 0
    let last = 0
    let broken = false

    /** The rows the strip takes: up to BAND of them, ending on the row just above the composer. */
    const band = () => {
      const box = props.composer()
      if (!box) return undefined
      // The composer's box starts with a row of padding above the card; the strip ends on it.
      const bottom = Math.round(box.y)
      const rows = Math.min(BAND, bottom + 1)
      return rows < MIN_BAND ? undefined : { top: bottom - rows + 1, rows }
    }

    const page = () => (theme.background.a === 1 ? channels(theme.background) : undefined)

    const draw = (buffer: OptimizedBuffer) => {
      if (!pond) return
      try {
        const at = now()
        const place = band()
        // The layout moved under the strip (a resize, the composer grew): this school is done,
        // and the next keystroke opens a strip where the composer is now.
        if (!place || place.rows !== pond.rows || buffer.width !== pond.cols) return end()
        top = place.top
        pond.step(Math.max(0, Math.min(LONGEST_STEP_MS, at - last)) / 1000)
        last = at
        const quiet = at - lastKey
        if (quiet > LINGER_MS) pond.stream!.open = false
        pond.fade = Math.min(1, Math.max(0, 1 - (quiet - LINGER_MS) / FADE_OUT_MS))
        if (pond.fade <= 0 || (!pond.stream!.open && pond.koi.length === 0)) return end()
        pond.draw()
        paintCells(buffer, pond.cells().map((cell) => ({ ...cell, row: cell.row + top })), page())
      } catch (error) {
        // An error in the frame hook would fail every frame after it; end the koi for good instead.
        broken = true
        console.debug("typing koi stopped", { error })
        end()
      }
    }

    const begin = () => {
      const place = band()
      if (!place) return
      const { width } = untrack(dimensions)
      pond = createPond({
        cols: width,
        rows: place.rows,
        aspect: ASPECT,
        palette: riftPalette({
          background: channels(theme.background),
          text: channels(theme.text),
          muted: channels(theme.textMuted),
          primary: channels(theme.primary),
        }),
        seed: props.seed ?? Date.now() % 1_000_000,
        scene: "stream",
      })
      top = place.top
      last = now()
      renderer.addPostProcessFn(draw)
      renderer.requestLive()
    }

    const end = () => {
      if (!pond) return
      pond = undefined
      renderer.removePostProcessFn(draw)
      renderer.dropLive()
      renderer.requestRender()
    }

    const key = (event: KeyEvent) => {
      if (broken || !isTyping(event)) return
      lastKey = now()
      if (!pond) begin()
      if (pond) stirStream(pond)
    }
    renderer.keyInput.on("keypress", key)

    onCleanup(() => {
      renderer.keyInput.off("keypress", key)
      end()
    })
  })

  return null
}

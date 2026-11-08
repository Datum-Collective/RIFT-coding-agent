/**
 * The composer's bar: one long tinted slab, three rows at rest (a padding row, the prompt row, a padding row), with
 * the prompt glyph in its first cell. A longer draft adds rows between the paddings. No outline: the fill alone sets
 * it off from the page.
 *
 * Home and the session draw the same bar, so it is the same size in both at the same terminal size. While the
 * session works, a crest runs along its bottom padding row in place of a spinner; it only runs while busy, and
 * not at all with animations off.
 */
import { CliRenderEvents, RGBA, TextAttributes, type BoxRenderable, type Renderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from "solid-js"
import { tint } from "../../theme/color"
import { animationOff } from "../koi-enabled"

/** Columns between the bar and the edge of the column it sits in, on each side. */
const BAR_MARGIN = 1

/** Where text starts inside the bar: the glyph and a space. The rows under the bar and the slash list start there too. */
export const TEXT_INSET = 2

/**
 * How far the composer reaches out of its column's padding to keep BAR_MARGIN. Home and the session column both pad
 * their content by 2 columns, 1 under 44.
 */
export function barOutset(width: number) {
  return (width < 44 ? 1 : 2) - BAR_MARGIN
}

const CREST = "▂▃▄▃▂"
const CREST_STEP_MS = 45
/** Cells of calm water between one crest leaving and the next arriving. */
const CREST_GAP = 24

/** Whether the bar may move: the `animations` config and RIFT_NO_ANIMATION both stop it. */
export function crestAllowed(animations: boolean) {
  return animations && !animationOff(process.env)
}

/** What the bar says: input is elsewhere, nobody is at it, waiting for a draft, holding one, or running shell commands. */
export type BarTone = "quiet" | "idle" | "focused" | "draft" | "shell"

export function barTone(state: { quiet: boolean; focused: boolean; shell: boolean; draft: boolean }): BarTone {
  if (state.quiet) return "quiet"
  if (state.shell) return "shell"
  if (state.draft) return "draft"
  return state.focused ? "focused" : "idle"
}

/** `agent` is whoever answers; `raised` is the theme's raised surfaces, from the one nearest the page outward. */
export type BarColours = { agent: RGBA; shell: RGBA; muted: RGBA; raised: { base: RGBA; high: RGBA; max: RGBA } }

export type BarLook = { fill: RGBA; glyph: RGBA; mark: string }

/** How far a focused bar lifts from `raised.high` toward `raised.max`: on black, about the reference's lift off its page. */
const LIFT = 0.2

const TONE: Record<BarTone, (c: BarColours) => BarLook> = {
  quiet: (c) => ({ fill: c.raised.base, glyph: c.muted, mark: "›" }),
  idle: (c) => ({ fill: c.raised.high, glyph: c.agent, mark: "›" }),
  focused: (c) => ({ fill: tint(c.raised.high, c.raised.max, LIFT), glyph: c.agent, mark: "›" }),
  draft: (c) => TONE.focused(c),
  shell: (c) => ({ ...TONE.focused(c), glyph: c.shell, mark: "$" }),
}

export function barLook(tone: BarTone, colours: BarColours) {
  return TONE[tone](colours)
}

/** Whether keyboard focus is inside `box` while the terminal window has it. */
export function useBarFocus(box: () => Renderable | undefined) {
  const renderer = useRenderer()
  const [inside, setInside] = createSignal(false)
  const [window, setWindow] = createSignal(true)
  const check = () => {
    const root = box()
    let node: Renderable | null | undefined = renderer.currentFocusedRenderable
    while (node && node !== root) node = node.parent
    setInside(!!root && node === root)
  }
  const focus = () => setWindow(true)
  const blur = () => setWindow(false)
  renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, check)
  renderer.on("focus", focus)
  renderer.on("blur", blur)
  onCleanup(() => {
    renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, check)
    renderer.off("focus", focus)
    renderer.off("blur", blur)
  })
  createEffect(check)
  return () => inside() && window()
}

export function ComposerBar(props: { look: BarLook; busy: boolean; animations: boolean; children: JSX.Element }) {
  const [swell, setSwell] = createSignal<BoxRenderable>()
  const [crest, setCrest] = createSignal<number>()

  createEffect(() => {
    if (!props.busy || !crestAllowed(props.animations)) return setCrest(undefined)
    let at = -CREST.length
    const timer = setInterval(() => {
      const width = swell()?.width ?? 0
      at = at > width + CREST_GAP ? -CREST.length : at + 1
      setCrest(at)
    }, CREST_STEP_MS)
    onCleanup(() => clearInterval(timer))
  })

  const visibleCrest = createMemo(() => {
    const at = crest()
    const width = swell()?.width ?? 0
    if (at === undefined || at >= width || at + CREST.length <= 0) return
    const from = Math.max(0, -at)
    return { left: Math.max(0, at), text: CREST.slice(from, Math.min(CREST.length, width - at)) }
  })

  return (
    <box width="100%" flexShrink={0} backgroundColor={props.look.fill} paddingTop={1}>
      <box flexDirection="row" paddingRight={1}>
        <text width={TEXT_INSET} flexShrink={0} fg={props.look.glyph} attributes={TextAttributes.BOLD} selectable={false}>
          {props.look.mark}
        </text>
        <box flexGrow={1} flexShrink={1} minWidth={0}>
          {props.children}
        </box>
      </box>
      <box ref={setSwell} height={1} flexShrink={0}>
        <Show when={visibleCrest()}>
          {(wave) => (
            <text position="absolute" top={0} left={wave().left} fg={props.look.glyph} wrapMode="none" selectable={false}>
              {wave().text}
            </text>
          )}
        </Show>
      </box>
    </box>
  )
}

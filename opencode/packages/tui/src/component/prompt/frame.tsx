/**
 * The composer's field: a hairline ring drawn with eighth blocks round a tinted fill.
 *
 * The lines sit on the cell edges that touch the fill (▁ at the foot of the row above, ▕ at the right
 * of the column before), so the field reads as one outlined rectangle rather than a box-drawing frame
 * with half a cell of air inside it. The corners stay empty, which gives it its chamfer.
 *
 * The top edge is the waterline the typing koi swim down to. While the session works, a crest runs
 * along it in place of a spinner; it only runs while busy, and not at all with animations off. The
 * slash and file list stands on the same edge with the same sides, so it grows out of the field.
 */
import { BoxRenderable, RGBA, TextAttributes } from "@opentui/core"
import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from "solid-js"
import { EmptyBorder } from "../../ui/border"
import { tint } from "../../theme/color"
import { animationOff } from "../koi-enabled"

/**
 * The field's width wherever it sits, home or session: the banner's 72 columns and four either side, so on
 * home the draft starts on the banner's left edge. A narrower column gets all of its width.
 */
export const FIELD_WIDTH = 80

/** The text rows the field keeps when the draft is shorter: the draft's first row and room under it to write on. */
export const FIELD_ROWS = 3

const ABOVE = "▁"
const BELOW = "▔"
const LEFT = "▕"
const RIGHT = "▏"

const CREST = "▂▃▄▃▂"
const CREST_STEP_MS = 45
/** Cells of calm water between one crest leaving and the next arriving. */
const CREST_GAP = 24

/** Whether the waterline may move: the `animations` config and RIFT_NO_ANIMATION both stop it. */
export function crestAllowed(animations: boolean) {
  return animations && !animationOff(process.env)
}

/** What the ring says: input is elsewhere, waiting for a draft, holding one, or running shell commands. */
export type FieldTone = "quiet" | "empty" | "draft" | "shell"

export function fieldTone(state: { quiet: boolean; shell: boolean; draft: boolean }): FieldTone {
  if (state.quiet) return "quiet"
  if (state.shell) return "shell"
  return state.draft ? "draft" : "empty"
}

/** `accent` is whoever answers: the agent's colour, or the shell's. `page` is what the field sits on. */
export type RingColours = { accent: RGBA; border: RGBA; page: RGBA }

const RING: Record<FieldTone, (colours: RingColours) => RGBA> = {
  quiet: (c) => tint(c.border, c.page, 0.5),
  empty: (c) => tint(c.border, c.accent, 0.55),
  draft: (c) => c.accent,
  shell: (c) => c.accent,
}

export function ringColour(tone: FieldTone, colours: RingColours) {
  return RING[tone](colours)
}

export function ComposerFrame(props: {
  /** From `ringColour`; the list standing on the field takes the same one. */
  ring: RGBA
  /** The crest's colour while the session works. */
  accent: RGBA
  fill: RGBA
  busy: boolean
  animations: boolean
  /** The list stands on the top edge: the sides run on through its corners and its fill comes down to the line. */
  joined?: RGBA
  /** Drawn in the gutter before the draft: the shell's `$`. Blank otherwise. */
  glyph?: string
  children: JSX.Element
}) {
  const [edge, setEdge] = createSignal<BoxRenderable>()
  const [crest, setCrest] = createSignal<number>()

  createEffect(() => {
    if (!props.busy || !crestAllowed(props.animations)) return setCrest(undefined)
    let at = -CREST.length
    const timer = setInterval(() => {
      const width = edge()?.width ?? 0
      at = at > width + CREST_GAP ? -CREST.length : at + 1
      setCrest(at)
    }, CREST_STEP_MS)
    onCleanup(() => clearInterval(timer))
  })

  const visibleCrest = createMemo(() => {
    const at = crest()
    const width = edge()?.width ?? 0
    if (at === undefined || at >= width || at + CREST.length <= 0) return
    const from = Math.max(0, -at)
    return { left: Math.max(0, at), text: CREST.slice(from, Math.min(CREST.length, width - at)) }
  })

  return (
    <box width="100%" flexShrink={0}>
      <box height={1} flexShrink={0} flexDirection="row">
        <Corner glyph={props.joined ? LEFT : " "} color={props.ring} />
        <box ref={setEdge} height={1} flexGrow={1}>
          <Line glyph={ABOVE} color={props.ring} fill={props.joined} />
          <Show when={visibleCrest()}>
            {(wave) => (
              <text position="absolute" top={0} left={wave().left} fg={props.accent} wrapMode="none" selectable={false}>
                {wave().text}
              </text>
            )}
          </Show>
        </box>
        <Corner glyph={props.joined ? RIGHT : " "} color={props.ring} />
      </box>
      <Sides color={props.ring} left={true}>
        <box width="100%" backgroundColor={props.fill} paddingLeft={1} paddingRight={1} flexDirection="row" gap={1}>
          <text width={1} flexShrink={0} fg={props.ring} attributes={TextAttributes.BOLD} selectable={false}>
            {props.glyph ?? " "}
          </text>
          <box flexGrow={1} flexShrink={1} minWidth={0}>
            {props.children}
          </box>
        </box>
      </Sides>
      <box height={1} flexShrink={0} flexDirection="row">
        <Corner glyph=" " color={props.ring} />
        <Line glyph={BELOW} color={props.ring} />
        <Corner glyph=" " color={props.ring} />
      </box>
    </box>
  )
}

/**
 * The slash and file list, standing on the field: its own top line over the rows and the field's sides, so
 * the field's top edge becomes the line between them. `top` is where its first row goes.
 */
export function FieldList(props: {
  visible: boolean
  top: number
  left: number
  width: number
  ring: RGBA
  /** Its rows draw their own left side (upstream's new designs, where the selected row's side is the selection bar). */
  rowSides: boolean
  children: JSX.Element
}) {
  return (
    <box visible={props.visible} position="absolute" top={props.top - 1} left={props.left} width={props.width} zIndex={100}>
      <box height={1} flexShrink={0} flexDirection="row">
        <Corner glyph=" " color={props.ring} />
        <Line glyph={ABOVE} color={props.ring} />
        <Corner glyph=" " color={props.ring} />
      </box>
      <Sides color={props.ring} left={!props.rowSides}>
        {props.children}
      </Sides>
    </box>
  )
}

function Sides(props: { color: RGBA; left: boolean; children: JSX.Element }) {
  return (
    <box
      width="100%"
      border={props.left ? ["left"] : []}
      borderColor={props.color}
      customBorderChars={{ ...EmptyBorder, vertical: LEFT }}
    >
      <box width="100%" border={["right"]} borderColor={props.color} customBorderChars={{ ...EmptyBorder, vertical: RIGHT }}>
        {props.children}
      </box>
    </box>
  )
}

function Line(props: { glyph: string; color: RGBA; fill?: RGBA }) {
  return (
    <box
      height={1}
      flexGrow={1}
      border={["bottom"]}
      borderColor={props.color}
      backgroundColor={props.fill}
      customBorderChars={{ ...EmptyBorder, horizontal: props.glyph }}
    />
  )
}

function Corner(props: { glyph: string; color: RGBA }) {
  return (
    <text width={1} flexShrink={0} fg={props.color} selectable={false}>
      {props.glyph}
    </text>
  )
}

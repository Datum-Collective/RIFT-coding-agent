/**
 * The composer's field: a hairline ring drawn with eighth blocks round a tinted fill.
 *
 * The lines sit on the cell edges that touch the fill (▁ at the foot of the row above, ▕ at the right
 * of the column before), so the field reads as one outlined rectangle rather than a box-drawing frame
 * with half a cell of air inside it. The corners stay empty, which gives it its chamfer.
 *
 * The top edge is the waterline the typing koi swim down to. While the session works, a crest runs
 * along it in place of a spinner; it only runs while busy, and not at all with animations off.
 */
import { BoxRenderable, RGBA, TextAttributes } from "@opentui/core"
import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from "solid-js"
import { EmptyBorder } from "../../ui/border"
import { tint } from "../../theme/color"
import { animationOff } from "../koi-enabled"

/** The home field's width: the banner's 72 columns and four either side, so the draft starts on the banner's left edge. */
export const FIELD_WIDTH = 80

const CREST = "▂▃▄▃▂"
const CREST_STEP_MS = 45
/** Cells of calm water between one crest leaving and the next arriving. */
const CREST_GAP = 24

/** Whether the waterline may move: the `animations` config and RIFT_NO_ANIMATION both stop it. */
export function crestAllowed(animations: boolean) {
  return animations && !animationOff(process.env)
}

/** The ring's colour for what the composer is doing: quiet when it cannot take input, brighter once there is a draft. */
export function ringColour(input: { accent: RGBA; border: RGBA; quiet: boolean; draft: boolean }) {
  if (input.quiet) return input.border
  return input.draft ? input.accent : tint(input.border, input.accent, 0.55)
}

export function ComposerFrame(props: {
  accent: RGBA
  /** The theme's border colour: the ring when the composer cannot take input. */
  border: RGBA
  fill: RGBA
  /** It cannot take input: a dialog, a side panel or the leader key has it. */
  quiet: boolean
  draft: boolean
  busy: boolean
  animations: boolean
  /** Drawn in the gutter before the draft: the shell's `$`. Blank otherwise. */
  glyph?: string
  children: JSX.Element
}) {
  const ring = createMemo(() =>
    ringColour({ accent: props.accent, border: props.border, quiet: props.quiet, draft: props.draft }),
  )
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
      <box ref={setEdge} height={1} marginLeft={1} marginRight={1} flexShrink={0}>
        <box
          height={1}
          width="100%"
          border={["bottom"]}
          borderColor={ring()}
          customBorderChars={{ ...EmptyBorder, horizontal: "▁" }}
        />
        <Show when={visibleCrest()}>
          {(wave) => (
            <text position="absolute" top={0} left={wave().left} fg={props.accent} wrapMode="none" selectable={false}>
              {wave().text}
            </text>
          )}
        </Show>
      </box>
      <box width="100%" border={["left"]} borderColor={ring()} customBorderChars={{ ...EmptyBorder, vertical: "▕" }}>
        <box width="100%" border={["right"]} borderColor={ring()} customBorderChars={{ ...EmptyBorder, vertical: "▏" }}>
          <box width="100%" backgroundColor={props.fill} paddingLeft={1} paddingRight={1} flexDirection="row" gap={1}>
            <text width={1} flexShrink={0} fg={props.accent} attributes={TextAttributes.BOLD} selectable={false}>
              {props.glyph ?? " "}
            </text>
            <box flexGrow={1} flexShrink={1} minWidth={0}>
              {props.children}
            </box>
          </box>
        </box>
      </box>
      <box
        height={1}
        marginLeft={1}
        marginRight={1}
        flexShrink={0}
        border={["bottom"]}
        borderColor={ring()}
        customBorderChars={{ ...EmptyBorder, horizontal: "▔" }}
      />
    </box>
  )
}

/**
 * The right of the row under the composer: what needs the user first. A permission request waiting in any session,
 * else how this session's newest verification stands. On a short row it drops its key, then itself, so the hint on its
 * left always reads whole.
 */
import { Plugin } from "@opencode/plugin/tui"
import type { BoxRenderable } from "@opentui/core"
import { createMemo, createSignal, Show } from "solid-js"
import { stringWidth } from "../../util/string-width"
import { paint } from "../sidebar/rift"
import { brief } from "../sidebar/rift-run"
import { createRiftState } from "./state"

export function ComposerStatus(props: { context: Plugin.Context; sessionID?: string }) {
  const theme = props.context.theme
  const state = createRiftState(props.context, () => props.sessionID)
  const permissions = createMemo(() =>
    props.context.data.session
      .list()
      .reduce((total, session) => total + (props.context.data.session.permission.list(session.id)?.length ?? 0), 0),
  )
  // Its box takes whatever the row leaves, so its width never depends on what it shows.
  const [room, setRoom] = createSignal(0)
  const line = createMemo(() => {
    const each = brief({ permissions: permissions(), state: state() })
    if (!each) return
    const head = stringWidth(`${each.glyph} ${each.text}`)
    if (each.key && head + stringWidth(` · ${each.key}`) <= room()) return each
    if (head <= room()) return { ...each, key: undefined }
  })
  return (
    <box
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
      minWidth={0}
      flexDirection="row"
      justifyContent="flex-end"
      onSizeChange={function (this: BoxRenderable) {
        const width = this.width
        queueMicrotask(() => setRoom(width))
      }}
    >
      <Show when={line()}>
        {(line) => (
          <text id="prompt.footer.rift" fg={paint(theme, line().tone)} wrapMode="none" flexShrink={0}>
            {line().glyph} {line().text}
            <Show when={line().key}>
              {(key) => (
                <>
                  <span style={{ fg: theme.text.muted }}> · </span>
                  <b style={{ fg: theme.text.base }}>{key()}</b>
                </>
              )}
            </Show>
          </text>
        )}
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "rift.composer.status",
  setup(context) {
    context.ui.slot({
      append: "prompt.footer",
      render: (props) => <ComposerStatus context={context} sessionID={props.sessionID} />,
    })
  },
})

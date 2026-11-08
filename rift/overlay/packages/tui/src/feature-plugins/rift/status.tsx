/**
 * The status in the row under the composer: what needs the user first. A permission request waiting in any session,
 * else how this session's newest verification stands. It keeps its colour only while it is a problem; a verified
 * run reads as quietly as a running one. The row drops it whole when space runs out.
 */
import { Plugin } from "@opencode/plugin/tui"
import { createMemo, Show } from "solid-js"
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
  const line = createMemo(() => brief({ permissions: permissions(), state: state() }))
  return (
    <Show when={line()}>
      {(line) => (
        <text
          id="prompt.footer.rift"
          fg={line().tone === "success" ? theme.text.muted : paint(theme, line().tone)}
          wrapMode="none"
          flexShrink={0}
        >
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
  )
}

export default Plugin.define({
  id: "rift.composer.status",
  setup(context) {
    context.ui.slot({
      append: "prompt.footer.status",
      render: (props) => <ComposerStatus context={context} sessionID={props.sessionID} />,
    })
  },
})

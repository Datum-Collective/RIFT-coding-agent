import { Plugin } from "@opencode/plugin/tui"
import type { Context, PanelInput } from "@opencode/plugin/tui/context"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { createMemo, Index, onMount, Show } from "solid-js"
import { logEntries, type LogEntry, type LogLevel } from "./log-entries"

const ROUTE = "rift.log"

const MARK: Record<LogLevel, string> = { ok: "✓", running: "●", error: "✗" }

const clock = (time: number) => new Date(time).toTimeString().slice(0, 8)

export function LogView(props: {
  theme: Context["theme"]
  entries: readonly LogEntry[]
  scrollRef?: (scroll: ScrollBoxRenderable) => void
}) {
  const tone = (level: LogLevel) =>
    level === "error"
      ? props.theme.text.feedback.error.base
      : level === "ok"
        ? props.theme.text.feedback.success.base
        : props.theme.text.feedback.warning.base
  return (
    <box width="100%" height="100%" paddingLeft={2} paddingRight={2} paddingTop={1}>
      <text fg={props.theme.text.base} flexShrink={0}>
        <b>Log</b>
        <span style={{ fg: props.theme.text.muted }}> {props.entries.length} events</span>
      </text>
      <Show when={props.entries.length > 0} fallback={<text fg={props.theme.text.muted}>Nothing yet</text>}>
        <scrollbox ref={props.scrollRef} flexGrow={1} minHeight={0} stickyScroll stickyStart="bottom">
          {/* Index, not For: every update rebuilds the entries, and rows should not remount for it. */}
          <Index each={props.entries}>
            {(entry) => (
              <text fg={props.theme.text.muted} wrapMode="none" truncate>
                {clock(entry().time)} <span style={{ fg: tone(entry().level) }}>{MARK[entry().level]}</span>{" "}
                <span style={{ fg: props.theme.text.base }}>{entry().text}</span>
              </text>
            )}
          </Index>
        </scrollbox>
      </Show>
    </box>
  )
}

function SessionLog(props: { context: Plugin.Context; panel: PanelInput }) {
  let scroll: ScrollBoxRenderable | undefined
  const entries = createMemo(() =>
    logEntries(
      props.context.data.session.message.list(props.panel.sessionID),
      props.context.data.session.get(props.panel.sessionID)?.revert?.messageID,
    ),
  )
  onMount(() => props.panel.focus())
  useKeyboard((event) => {
    if (!props.panel.focused) return
    if (event.name === "escape") props.panel.close()
    else if (event.name === "up") scroll?.scrollBy(-1)
    else if (event.name === "down") scroll?.scrollBy(1)
    else if (event.name === "pageup") scroll?.scrollBy(-(scroll.height || 1))
    else if (event.name === "pagedown") scroll?.scrollBy(scroll.height || 1)
  })
  return <LogView theme={props.context.theme} entries={entries()} scrollRef={(item) => (scroll = item)} />
}

function Commands(props: { context: Plugin.Context }) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "rift.log",
        title: "Toggle log",
        slash: { name: "log" },
        group: "Session",
        palette: true,
        run() {
          const panel = props.context.ui.panel
          const route = props.context.ui.router.current()
          const current = panel.current()
          // A log left open in another session is hidden here, so this opens one rather than closing that.
          const shown = route.type === "session" && current?.name === ROUTE && current.sessionID === route.sessionID
          if (shown) panel.close()
          else panel.open(ROUTE)
        },
      },
    ],
  }))
  return null
}

export default Plugin.define({
  id: "rift.log",
  setup(context) {
    context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === ROUTE}>
          <SessionLog context={context} panel={panel} />
        </Show>
      ),
    })
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
  },
})

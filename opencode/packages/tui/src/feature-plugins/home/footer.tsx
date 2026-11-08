import { Plugin } from "@opencode/plugin/tui"
import { createMemo, Match, Show, Switch } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { usePlugin } from "../../plugin/context"

export function homeFooterVisibility(width: number) {
  return {
    mcpCommand: width >= 64,
    pluginCommand: width >= 80,
    version: width >= 64,
  }
}

function Mcp(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const visibility = createMemo(() => homeFooterVisibility(dimensions().width))
  const list = createMemo(() => props.context.data.location.mcp.server.list(props.context.location) ?? [])
  const failed = createMemo(() => list().filter((item) => item.status.status === "failed").length)
  const count = createMemo(() => list().filter((item) => item.status.status === "connected").length)

  return (
    <Show when={list().length}>
      <box gap={1} flexDirection="row" flexShrink={0} onMouseUp={() => props.context.keymap.dispatch("mcp.list")}>
        <text fg={props.context.theme.text.base}>
          <Switch>
            <Match when={failed()}>
              <span style={{ fg: props.context.theme.text.feedback.error.base }}>⊙ </span>
              {failed()} MCP failed
            </Match>
            <Match when={true}>
              <span style={{ fg: props.context.theme.text.muted }}>⊙ {count()} MCP</span>
            </Match>
          </Switch>
        </text>
        <Show when={visibility().mcpCommand}>
          <text fg={props.context.theme.text.muted}>/mcps</text>
        </Show>
      </box>
    </Show>
  )
}

function Plugins(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const visibility = createMemo(() => homeFooterVisibility(dimensions().width))
  const plugins = usePlugin()
  const failed = createMemo(
    () =>
      plugins.list().filter((item) => item.status === "failed").length +
      plugins.server().filter((item) => item.state.status === "failed").length,
  )

  return (
    <Show when={failed()}>
      <box gap={1} flexDirection="row" flexShrink={0} onMouseUp={() => props.context.keymap.dispatch("plugins.list")}>
        <text fg={props.context.theme.text.base}>
          <span style={{ fg: props.context.theme.text.feedback.error.base }}>⊙ </span>
          {failed()} plugin{failed() === 1 ? "" : "s"} failed
        </text>
        <Show when={visibility().pluginCommand}>
          <text fg={props.context.theme.text.muted}>/plugins</text>
        </Show>
      </box>
    </Show>
  )
}

// RIFT: these sit in the row under the composer, after its status; the composer's row shows the version.
function View(props: { context: Plugin.Context }) {
  return (
    <>
      <Mcp context={props.context} />
      <Plugins context={props.context} />
    </>
  )
}

export default Plugin.define({
  id: "opencode.home.footer",
  setup(context) {
    // RIFT: home.footer.status is the status end of the composer's row on home; home.footer stays free for plugins.
    context.ui.slot({ append: "home.footer.status", render: () => <View context={context} /> })
  },
})

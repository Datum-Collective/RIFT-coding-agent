import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show, createSignal } from "solid-js"

const id = "internal:sidebar-lsp"

function View(props: { api: TuiPluginApi }) {
  const [open, setOpen] = createSignal(true)
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.lsp())
  const off = createMemo(() => !props.api.state.config.lsp)

  return (
    <box>
      <box flexDirection="row" justifyContent="space-between" onMouseDown={() => list().length > 2 && setOpen((x) => !x)}>
        <text fg={theme().textMuted}>lsp</text>
        <text fg={theme().border}>{off() ? "off" : list().length === 0 ? "on first read" : list().length > 2 && !open() ? `${list().length} ▸` : ""}</text>
      </box>
      <Show when={list().length <= 2 || open()}>
        <For each={list()}>
          {(item) => (
            <text fg={theme().textMuted} wrapMode="none">
              <span style={{ fg: item.status === "connected" ? theme().success : theme().error }}>{item.status === "connected" ? "✓" : "✕"} </span>
              {item.id}
            </text>
          )}
        </For>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 300,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin

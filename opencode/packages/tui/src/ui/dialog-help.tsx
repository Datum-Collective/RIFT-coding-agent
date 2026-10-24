import { For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { useDialog } from "./dialog"
import { useBindings, useCommandShortcut } from "../keymap"

type Entry = { key: () => string; label: string }

/** A key that is not rebindable, shown as written. */
const fixed = (key: string, label: string): Entry => ({ key: () => key, label })

/**
 * The shortcut sheet: what you can press, in three columns. Keys come from the live keymap, so a
 * rebinding shows up here; a command with no key in this context is left out.
 */
export function DialogHelp() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const bound = (command: string, label: string): Entry => ({ key: useCommandShortcut(command), label })

  const columns: { title: string; entries: Entry[] }[] = [
    {
      title: "compose",
      entries: [
        fixed("/", "commands"),
        fixed("@", "attach a file"),
        fixed("!", "shell command"),
        bound("input.newline", "new line"),
        bound("prompt.editor", "external editor"),
        bound("prompt.history.previous", "previous prompt"),
      ],
    },
    {
      title: "session",
      entries: [
        bound("command.palette.show", "all commands"),
        bound("agent.cycle", "switch agent"),
        bound("permission.cycle", "permission mode"),
        bound("model.list", "switch model"),
        bound("session.new", "new session"),
        bound("session.list", "sessions"),
        bound("session.interrupt", "stop the agent"),
        bound("session.undo", "undo last turn"),
        bound("session.compact", "compact context"),
      ],
    },
    {
      title: "view",
      entries: [
        bound("session.view.toggle", "task view"),
        bound("session.sidebar.toggle", "context rail"),
        bound("diff.open", "review changes"),
        bound("session.toggle.thinking", "show thinking"),
        bound("session.toggle.actions", "tool details"),
        bound("session.timeline", "jump to a turn"),
        bound("session.page.up", "scroll up"),
        bound("session.last", "latest"),
      ],
    },
  ]

  const commands: Entry[] = [
    fixed("/cad", "design a part, verified by measuring"),
    fixed("/background", "wallpapers and fish behind the text"),
    fixed("/disable fish", "turn the fish off (/enable fish)"),
    fixed("/deep-research", "cited report on a topic"),
    fixed("/help", "this sheet"),
  ]

  useBindings(() => ({
    bindings: [
      { key: "return", desc: "Close cheat sheet", group: "Dialog", cmd: () => dialog.clear() },
      { key: "escape", desc: "Close cheat sheet", group: "Dialog", cmd: () => dialog.clear() },
      { key: "?", desc: "Close cheat sheet", group: "Dialog", cmd: () => dialog.clear() },
    ],
  }))

  const stacked = () => dimensions().width < 90

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Cheat sheet
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          <span style={{ fg: theme.text }}>esc</span> close
        </text>
      </box>
      <box flexDirection={stacked() ? "column" : "row"} gap={stacked() ? 1 : 4}>
        <For each={columns}>
          {(column) => (
            <box flexShrink={0}>
              <text fg={theme.textMuted}>{column.title}</text>
              <For each={column.entries}>
                {(entry) => (
                  <Show when={entry.key()}>
                    <box flexDirection="row">
                      <text width={14} flexShrink={0} fg={theme.primary} wrapMode="none">
                        {entry.key()}
                      </text>
                      <text fg={theme.text}>{entry.label}</text>
                    </box>
                  </Show>
                )}
              </For>
            </box>
          )}
        </For>
      </box>
      <box>
        <text fg={theme.textMuted}>commands</text>
        <For each={commands}>
          {(entry) => (
            <box flexDirection="row">
              <text width={16} flexShrink={0} fg={theme.primary} wrapMode="none">
                {entry.key()}
              </text>
              <text fg={theme.text}>{entry.label}</text>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}

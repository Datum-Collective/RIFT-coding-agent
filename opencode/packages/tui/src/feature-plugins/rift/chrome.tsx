import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { TextAttributes, type BoxRenderable } from "@opentui/core"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useInteractivity } from "../../context/interactivity"
import { contextUsage } from "../../util/session"
import { fitShortcuts, tokenBudget, type Shortcut } from "./format"

/** One line above the scrollback: where you are on the left, how much of the model's context is used on the right. */
export function HeaderRow(props: { theme: Context["theme"]; path: string; budget?: string }) {
  return (
    <box flexDirection="row" width="100%" height={1} flexShrink={0} justifyContent="space-between" gap={2}>
      <text fg={props.theme.text.muted} wrapMode="none" truncate flexShrink={1} minWidth={0}>
        {props.path}
      </text>
      <Show when={props.budget}>
        <text fg={props.theme.text.base} wrapMode="none" flexShrink={0}>
          {props.budget}
        </text>
      </Show>
    </box>
  )
}

export function ShortcutRow(props: {
  theme: Context["theme"]
  shortcuts: readonly Shortcut[]
  width: number
  /** Dimmed while something else, such as a side panel, owns the keyboard. */
  inactive?: boolean
}) {
  const fitted = createMemo(() => fitShortcuts(props.shortcuts, props.width))
  return (
    <text
      fg={props.theme.text.muted}
      attributes={props.inactive ? TextAttributes.DIM : 0}
      wrapMode="none"
      flexShrink={0}
    >
      <For each={fitted()}>
        {(item, index) => (
          <>
            <Show when={index() > 0}> │ </Show>
            <span style={props.inactive ? {} : { fg: props.theme.text.base }}>{item.key}</span>:{item.label}
          </>
        )}
      </For>
    </text>
  )
}

function SessionHeader(props: { context: Plugin.Context; sessionID: string }) {
  const session = () => props.context.data.session.get(props.sessionID)
  const budget = createMemo(() => {
    const current = session()
    if (!current) return undefined
    const models = props.context.data.location.model.list(current.location)
    const usage = contextUsage(props.context.data.session.message.list(props.sessionID), models, current.revert?.messageID)
    return usage ? tokenBudget(usage.tokens, usage.limit) : undefined
  })
  const path = () => {
    const directory = session()?.location.directory
    return directory ? props.context.ui.format.path(directory) : ""
  }
  return <HeaderRow theme={props.context.theme} path={path()} budget={budget()} />
}

/**
 * The row at its natural width, so the location beside it is what truncates, and never wider than the row it sits in.
 * That is read each frame because an open side panel makes the pane narrower than the window, and the box's own size
 * cannot tell: it only ever follows its content.
 */
export function FittedShortcuts(props: { theme: Context["theme"]; shortcuts: readonly Shortcut[]; inactive?: boolean }) {
  const [width, setWidth] = createSignal(Number.POSITIVE_INFINITY)
  return (
    <box
      flexShrink={0}
      renderBefore={function (this: BoxRenderable) {
        const available = this.parent?.width
        if (available === undefined || available === width()) return
        queueMicrotask(() => setWidth(available))
      }}
    >
      <ShortcutRow theme={props.theme} shortcuts={props.shortcuts} width={width()} inactive={props.inactive} />
    </box>
  )
}

export function PromptShortcuts(props: { context: Plugin.Context; sessionID?: string }) {
  const interactive = useInteractivity()
  const entry = (command: string, label: string) => {
    const key = props.context.keymap.shortcuts(command)[0]
    return key ? [{ key, label }] : []
  }
  const shortcuts = createMemo(() => [
    ...entry("agent.cycle", "agents"),
    ...entry("command.palette.show", "commands"),
    // The log belongs to a session, so outside one the key would do nothing.
    ...(props.sessionID ? entry("rift.log", "log") : []),
    ...entry("session.sidebar.toggle", "sidebar"),
  ])
  return <FittedShortcuts theme={props.context.theme} shortcuts={shortcuts()} inactive={!interactive()} />
}

export default Plugin.define({
  id: "rift.chrome",
  setup(context) {
    context.ui.slot({
      append: "session.header",
      render: (props) => <SessionHeader context={context} sessionID={props.sessionID} />,
    })
  },
})

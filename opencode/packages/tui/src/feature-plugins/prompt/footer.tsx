import { Plugin } from "@opencode/plugin/tui"
import { createMemo, createSignal, Match, Show, Switch } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { stringWidth } from "../../util/string-width"
import { PromptShortcuts } from "../rift/chrome"
import { createGoal, GoalStatus } from "./goal"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export function PromptFooter(props: {
  context: Plugin.Context
  sessionID?: string
  mode: "normal" | "shell"
  showDetails: boolean
}) {
  const dimensions = useTerminalDimensions()
  const [liveHovered, setLiveHovered] = createSignal(false)
  const subagents = createMemo(() => {
    if (!props.sessionID) return 0
    const count = props.context.data.session
      .family(props.sessionID)
      .filter((id) => id !== props.sessionID && props.context.data.session.status(id) === "running").length
    return count ? `${count} subagent${count === 1 ? "" : "s"}` : undefined
  })
  const shells = createMemo(() => {
    if (!props.sessionID) return 0
    const count = props.context.data.shell
      .list(props.context.location)
      .filter((shell) => shell.metadata.sessionID === props.sessionID).length
    return count ? `${count} shell${count === 1 ? "" : "s"}` : undefined
  })
  const status = createMemo(() => {
    if (!props.sessionID) return []
    const session = props.context.data.session.get(props.sessionID)
    if (!session) return []
    const cost = props.context.data.session.cost(props.sessionID)
    return [
      cost > 0 ? money.format(cost) : undefined,
    ].filter((item): item is string => Boolean(item))
  })
  const live = createMemo(() => Boolean(subagents() || shells()))
  const goal = createGoal(props.context, () => props.sessionID)
  const shortcut = (id: string) => props.context.keymap.shortcuts(id)[0]
  const layout = createMemo(() => {
    const command = shortcut("command.palette.show")
    if (status().length === 0) return { usage: false, shortcuts: dimensions().width >= 44 }
    return promptFooterLayout({
      width: Math.max(0, dimensions().width - 8),
      usage: status(),
      shortcuts: command ? [`${command} commands`] : [],
    })
  })

  return (
    <Switch>
      <Match when={props.mode === "normal"}>
        <Switch>
          <Match when={goal() || live() || status().length > 0}>
            <box flexDirection="row" flexShrink={props.showDetails && layout().usage ? 0 : 1} minWidth={0}>
              <Show when={live()}>
                <box
                  flexShrink={0}
                  onMouseOver={() => setLiveHovered(true)}
                  onMouseOut={() => setLiveHovered(false)}
                  onMouseUp={() => props.context.keymap.dispatch("session.child.first")}
                >
                  <text
                    fg={liveHovered() ? props.context.theme.text.base : props.context.theme.text.muted}
                    wrapMode="none"
                  >
                    <Show when={shortcut("session.child.first")}>
                      {(value) => <span style={{ fg: props.context.theme.text.base }}>{value()} </span>}
                    </Show>
                    <Show when={subagents()}>{(value) => <>{value()}</>}</Show>
                    <Show when={subagents() && shells()}> · </Show>
                    <Show when={shells()}>{(value) => <>{value()}</>}</Show>
                  </text>
                </box>
              </Show>
              <Show when={props.sessionID && goal()}>
                <Show when={live()}>
                  <text fg={props.context.theme.text.muted} wrapMode="none" flexShrink={0}>
                    {" · "}
                  </text>
                </Show>
                <GoalStatus context={props.context} sessionID={props.sessionID ?? ""} goal={goal} />
              </Show>
              <Show when={props.showDetails && layout().usage && status().length > 0}>
                <text fg={props.context.theme.text.muted} wrapMode="none" flexShrink={0}>
                  <Show when={live() || goal()}> · </Show>
                  {status().join(" · ")}
                </text>
              </Show>
            </box>
          </Match>
        </Switch>
        <Show when={props.showDetails && layout().shortcuts}>
          <PromptShortcuts context={props.context} sessionID={props.sessionID} />
        </Show>
      </Match>
      <Match when={props.mode === "shell"}>
        <text fg={props.context.theme.text.base} flexShrink={0}>
          esc{" "}
          <span style={{ fg: props.context.theme.text.muted }}>
            {dimensions().width < 44 ? "shell" : "exit shell mode"}
          </span>
        </text>
      </Match>
    </Switch>
  )
}

export default Plugin.define({
  id: "opencode.prompt.footer",
  setup(context) {
    context.ui.slot({
      append: "prompt.footer",
      render: (props) => (
        <PromptFooter context={context} sessionID={props.sessionID} mode={props.mode} showDetails={props.showDetails} />
      ),
    })
  },
})

function promptFooterLayout(input: { width: number; usage: string[]; shortcuts: string[] }) {
  const usage = input.usage.join(" · ")
  const shortcuts = input.shortcuts.join(" · ")
  const available = Math.max(0, input.width - Math.min(28, Math.floor(input.width / 2)))
  if (usage && shortcuts && stringWidth(`${usage} · ${shortcuts}`) <= available) {
    return { usage: true, shortcuts: true }
  }
  if (usage && stringWidth(usage) <= available) return { usage: true, shortcuts: false }
  if (!usage && shortcuts && stringWidth(shortcuts) <= available) return { usage: false, shortcuts: true }
  return { usage: false, shortcuts: false }
}

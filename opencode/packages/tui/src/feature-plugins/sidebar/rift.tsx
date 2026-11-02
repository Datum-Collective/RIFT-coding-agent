import { Plugin } from "@opencode/plugin/tui"
import { Rift } from "@opencode/schema/rift"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type Accessor } from "solid-js"
import { bar, count, layout } from "./rift-graph"

type Tone = "success" | "error" | "warning" | "muted"

const CHECK: Record<Rift.Check["status"], { glyph: string; tone: Tone }> = {
  passed: { glyph: "✓", tone: "success" },
  failed: { glyph: "✗", tone: "error" },
  timed_out: { glyph: "✗", tone: "error" },
  not_run: { glyph: "○", tone: "warning" },
}

const VERDICT: Record<Rift.Node["verdict"], { glyph: string; tone: Tone; label: string }> = {
  proven: { glyph: "✓", tone: "success", label: "proven" },
  failed: { glyph: "✗", tone: "error", label: "failed" },
  stale: { glyph: "⟳", tone: "warning", label: "stale" },
  unproven: { glyph: "○", tone: "muted", label: "unproven" },
  at_risk: { glyph: "⚠", tone: "warning", label: "at risk" },
}

export { tree } from "./rift-graph"

function createState(context: Plugin.Context, sessionID: Accessor<string>) {
  const [state, setState] = createSignal<Rift.State>()
  const rpc = context.client.rpc(Rift.Definition)
  // A change that arrives while a fetch is in flight is newer than its reply.
  const turn = { value: 0 }
  const load = (id: string) => {
    const current = ++turn.value
    const directory = context.data.session.get(id)?.location.directory
    void rpc.get({ sessionID: id }, directory ? { location: { directory } } : undefined).then(
      (next) => {
        if (current === turn.value && sessionID() === id) setState(next ?? undefined)
      },
      () => undefined,
    )
  }
  onCleanup(
    rpc.events.on("changed", (event) => {
      if (event.data.sessionID !== sessionID()) return
      turn.value++
      setState(event.data.state)
    }),
  )
  onCleanup(context.data.on("server.connected", () => load(sessionID())))
  createEffect(
    on(sessionID, (id) => {
      setState(undefined)
      load(id)
    }),
  )
  return state
}

export function SidebarRift(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  const state = createState(props.context, () => props.sessionID)
  const counts = createMemo(() => count(state()?.graph ?? []))
  const lines = createMemo(() => layout(state()?.graph ?? []))
  const colour = (tone: Tone) =>
    tone === "muted"
      ? theme.text.muted
      : tone === "success"
        ? theme.text.feedback.success.base
        : tone === "error"
          ? theme.text.feedback.error.base
          : theme.text.feedback.warning.base

  return (
    <Show when={state()}>
      {(current) => (
        <box>
          <text fg={theme.text.base}>
            <b>Verification</b>
            <Show when={current().running}>
              <span style={{ fg: theme.text.muted }}> running</span>
            </Show>
            <Show when={current().round > 0}>
              <span style={{ fg: theme.text.muted }}> round {current().round}</span>
            </Show>
          </text>
          <For each={current().checks}>
            {(check) => (
              <text fg={theme.text.muted} wrapMode="none">
                <span style={{ fg: colour(CHECK[check.status].tone) }}>{CHECK[check.status].glyph}</span> {check.command}
                <Show when={check.reason}> ({check.reason})</Show>
              </text>
            )}
          </For>
          <Show when={current().graph.length > 0}>
            <text fg={theme.text.base}>
              <b>Engineering graph</b>
              <span style={{ fg: theme.text.muted }}>
                {" "}
                {counts().proven}/{counts().total} proven
              </span>
            </text>
            <text fg={theme.text.muted} wrapMode="none">
              <span style={{ fg: colour(counts().failed + counts().at_risk + counts().stale > 0 ? "warning" : "success") }}>
                {bar(counts())}
              </span>
              <Show when={counts().failed > 0}>
                <span style={{ fg: colour("error") }}> ✗{counts().failed}</span>
              </Show>
              <Show when={counts().stale > 0}>
                <span style={{ fg: colour("warning") }}> ⟳{counts().stale}</span>
              </Show>
              <Show when={counts().at_risk > 0}>
                <span style={{ fg: colour("warning") }}> ⚠{counts().at_risk}</span>
              </Show>
            </text>
            <For each={lines()}>
              {(line) => (
                <>
                  <text fg={theme.text.muted} wrapMode="none">
                    {line.prefix}
                    <span style={{ fg: colour(VERDICT[line.node.verdict].tone) }}>{VERDICT[line.node.verdict].glyph}</span>{" "}
                    <span style={{ fg: line.node.verdict === "proven" ? theme.text.muted : theme.text.base }}>{line.node.title}</span>
                    <Show when={line.node.verdict !== "proven"}> · {VERDICT[line.node.verdict].label}</Show>
                    <Show when={line.folded > 0}> (+{line.folded} proven)</Show>
                  </text>
                  <Show when={line.waiting.length > 0}>
                    <text fg={theme.text.muted} wrapMode="none">
                      {line.prefix.replace(/[├└]─ $/, (m) => (m.startsWith("├") ? "│  " : "   "))}
                      {"  ↳ waiting on "}
                      {line.waiting.join(", ")}
                    </text>
                  </Show>
                </>
              )}
            </For>
          </Show>
        </box>
      )}
    </Show>
  )
}

export default Plugin.define({
  id: "rift.sidebar.verification",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarRift context={context} sessionID={props.sessionID} />,
    })
  },
})

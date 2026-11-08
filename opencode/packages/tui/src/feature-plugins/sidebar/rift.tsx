import { Plugin } from "@opencode/plugin/tui"
import { Rift } from "@opencode/schema/rift"
import { createMemo, For, Show } from "solid-js"
import { createRiftState } from "../rift/state"
import { bar, count, layout } from "./rift-graph"
import { stages, status, type Tone } from "./rift-run"

const VERDICT: Record<Rift.Node["verdict"], { glyph: string; tone: Tone; label: string }> = {
  proven: { glyph: "✓", tone: "success", label: "proven" },
  failed: { glyph: "✗", tone: "error", label: "failed" },
  stale: { glyph: "⟳", tone: "warning", label: "stale" },
  unproven: { glyph: "○", tone: "muted", label: "unproven" },
  at_risk: { glyph: "⚠", tone: "warning", label: "at risk" },
}

export { tree } from "./rift-graph"

export const paint = (theme: Plugin.Context["theme"], tone: Tone) =>
  tone === "muted"
    ? theme.text.muted
    : tone === "success"
      ? theme.text.feedback.success.base
      : tone === "error"
        ? theme.text.feedback.error.base
        : theme.text.feedback.warning.base

function RunView(props: { context: Plugin.Context; title: string; run: Rift.Run; round?: number }) {
  const theme = props.context.theme
  const header = () => status(props.run)
  return (
    <>
      <text fg={theme.text.base}>
        <b>{props.title}</b>
        <span style={{ fg: paint(theme, header().tone) }}> {header().text}</span>
        <Show when={(props.round ?? 0) > 0}>
          <span style={{ fg: theme.text.muted }}> round {props.round}</span>
        </Show>
      </text>
      <For each={stages(props.run)}>
        {(line) => (
          <text fg={theme.text.muted} wrapMode="none">
            <span style={{ fg: paint(theme, line.tone) }}>{line.glyph}</span> {line.text}
          </text>
        )}
      </For>
    </>
  )
}

export function SidebarRift(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  const state = createRiftState(props.context, () => props.sessionID)
  const counts = createMemo(() => count(state()?.graph ?? []))
  const lines = createMemo(() => layout(state()?.graph ?? []))
  const colour = (tone: Tone) => paint(theme, tone)

  return (
    <Show when={state()}>
      {(current) => (
        <box>
          <Show when={current().change}>
            {(change) => <RunView context={props.context} title="Verification" run={change().run} round={change().round} />}
          </Show>
          <Show when={current().project}>
            {(project) => <RunView context={props.context} title="Full verify" run={project()} />}
          </Show>
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

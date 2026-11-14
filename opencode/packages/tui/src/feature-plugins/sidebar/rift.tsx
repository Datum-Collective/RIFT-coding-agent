import { Plugin } from "@opencode/plugin/tui"
import { Rift } from "@opencode/schema/rift"
import { createMemo, createSignal, For, Show } from "solid-js"
import { createRiftState } from "../rift/state"
import { bar, count, layout } from "./rift-graph"
import { details, disputes, entries, notes, place, status, strays, type Tone } from "./rift-run"

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

function Rows(props: { context: Plugin.Context; rows: readonly { glyph: string; tone: Tone; text: string }[] }) {
  const theme = props.context.theme
  return (
    <For each={props.rows}>
      {(row) => (
        <text fg={row.tone === "muted" ? theme.text.muted : paint(theme, row.tone)} wrapMode="none">
          {/* Padding on a text element does not move it, so the indent is part of the text. */}
          {row.glyph === " " ? `  ${row.text}` : `${row.glyph} ${row.text}`}
        </text>
      )}
    </For>
  )
}

function RunView(props: {
  context: Plugin.Context
  title: string
  run: Rift.Run
  round?: number
  open: boolean
  toggle: () => void
  width: number
  folder?: string
}) {
  const theme = props.context.theme
  const header = () => status(props.run)
  return (
    <>
      <text fg={theme.text.base} wrapMode="none" onMouseDown={props.toggle}>
        <b>{props.title}</b>
        <span style={{ fg: paint(theme, header().tone) }}> {header().text}</span>
        <Show when={(props.round ?? 0) > 0}>
          <span style={{ fg: theme.text.muted }}> · round {props.round}</span>
        </Show>
        <span style={{ fg: theme.text.muted }}> {props.open ? "▾" : "▸"}</span>
      </text>
      <Show when={props.folder}>
        <text fg={theme.text.muted} wrapMode="none">
          in {place(props.folder!)}
        </text>
      </Show>
      <Show when={notes(props.run, props.width).length > 0}>
        <Rows context={props.context} rows={notes(props.run, props.width)} />
      </Show>
      <For each={entries(props.run)}>
        {(item) => {
          const rows = () => (item.stage ? details(item.stage, props.open, props.width - 2) : [])
          return (
            <>
              <text fg={theme.text.muted} wrapMode="none">
                <span style={{ fg: paint(theme, item.line.tone) }}>{item.line.glyph}</span> {item.line.text}
              </text>
              <Show when={rows().length > 0}>
                <Rows context={props.context} rows={rows()} />
                <text> </text>
              </Show>
            </>
          )
        }}
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

  const changeRun = createMemo(() => state()?.change)
  const projectRun = createMemo(() => state()?.project)
  const graph = createMemo(() => state()?.graph ?? [])
  // The sidebar's own width, so rows are wrapped to fit it with their indent kept.
  const [width, setWidth] = createSignal(36)
  const disagreements = createMemo(() => disputes(state()?.disputes, width() - 2))
  const stray = createMemo(() => strays(state()?.outside, width() - 2))
  // Clicking a run's title opens every check in it; a failed check is always open.
  const [open, setOpen] = createSignal(false)

  return (
    <box
      width="100%"
      flexDirection="column"
      onSizeChange={function () {
        if (this.width > 0) setWidth(this.width)
      }}
    >
      <Show when={stray().length > 0}>
        <Rows context={props.context} rows={stray()} />
        <text> </text>
      </Show>
      <Show when={changeRun()}>
        {(change) => <RunView context={props.context} title="Verification" run={change().run} round={change().round} open={open()} toggle={() => setOpen(!open())} width={width()} folder={state()?.root} />}
      </Show>
      <Show when={projectRun()}>
        {(project) => <RunView context={props.context} title="Full verify" run={project()} open={open()} toggle={() => setOpen(!open())} width={width()} folder={state()?.root} />}
      </Show>
      <Show when={!changeRun() && !projectRun()}>
        <text fg={theme.text.muted} wrapMode="none">
          No verification yet. Edit a file to start continuous checks, or run <b>/verify</b> for a full check.
        </text>
      </Show>
      <Show when={disagreements().length > 0}>
        <text> </text>
        <text fg={theme.text.base}>
          <b>Verifier vs agent</b>
        </text>
        <Rows context={props.context} rows={disagreements()} />
      </Show>
      <Show when={graph().length > 0}>
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

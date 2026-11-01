import { Plugin } from "@opencode/plugin/tui"
import { Rift } from "@opencode/schema/rift"
import { createEffect, createSignal, For, on, onCleanup, Show, type Accessor } from "solid-js"

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

/** The graph as lines of a tree, parents above children. A node whose parent is unknown is a root. */
export function tree(nodes: readonly Rift.Node[]) {
  const known = new Set(nodes.map((node) => node.id))
  const lines: { node: Rift.Node; depth: number }[] = []
  const seen = new Set<string>()
  const visit = (node: Rift.Node, depth: number) => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    lines.push({ node, depth })
    nodes.filter((child) => child.parent === node.id).forEach((child) => visit(child, depth + 1))
  }
  nodes.filter((node) => node.parent === undefined || !known.has(node.parent)).forEach((node) => visit(node, 0))
  // A cycle has no root, and must still be shown.
  nodes.forEach((node) => visit(node, 0))
  return lines
}

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
            </text>
            <For each={tree(current().graph)}>
              {(line) => (
                <text fg={theme.text.muted} wrapMode="none">
                  {"  ".repeat(line.depth)}
                  <span style={{ fg: colour(VERDICT[line.node.verdict].tone) }}>{VERDICT[line.node.verdict].glyph}</span>{" "}
                  {line.node.title} · {VERDICT[line.node.verdict].label}
                </text>
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

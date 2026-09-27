/**
 * The side panel: a live graph of the software being built, not the conversation about it.
 *
 * Every node the agent declares via `graphwrite` (product → features → subtasks) shows up here
 * with its status and owning agent, and under it the evidence RIFT gathered itself: every check
 * shown as passed, failed or not run, with the reason. The agent never writes evidence. This
 * replaces the old token/cost readout, which now lives as a single line in the sidebar footer.
 *
 * Rendered as a `tree`-style ASCII graph (├── / └── / │) rather than an indented list, so
 * structure reads from the branch lines instead of a separate glyph gutter. Status is a single
 * small indicator on the node's own line; everything under a node (files, decisions, unmet
 * dependencies, evidence) continues that node's branch, plain and muted, so it stays secondary.
 */
import type { TuiPlugin, TuiPluginApi, TuiSidebarGraphItem } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { GLYPH, signalColor, shortenPath } from "../../component/control/primitives"
import { useTask } from "../../component/control/use-task"
import { deriveGraph, evidenceFor } from "../../util/engineering-graph"
import type { Evidence, Signal } from "../../util/task"

const id = "internal:sidebar-engineering-graph"

const MAX_LIST = 4

const SIGNAL: Record<TuiSidebarGraphItem["status"], Signal> = {
  not_started: "pending",
  in_progress: "active",
  blocked: "warn",
  testing: "active",
  done: "done",
  failed: "failed",
}

type Branch = { node: TuiSidebarGraphItem; prefix: string; isLast: boolean }

/** Lays declared nodes out as a tree: each row's own branch prefix, plus the prefix its children continue with. */
function layout(nodes: readonly TuiSidebarGraphItem[]): Branch[] {
  const byParent = new Map<string | undefined, TuiSidebarGraphItem[]>()
  for (const node of nodes) {
    const list = byParent.get(node.parent_id) ?? []
    list.push(node)
    byParent.set(node.parent_id, list)
  }
  function walk(parent_id: string | undefined, prefix: string): Branch[] {
    const siblings = byParent.get(parent_id) ?? []
    return siblings.flatMap((node, index) => {
      const isLast = index === siblings.length - 1
      const childPrefix = prefix + (isLast ? "    " : "│   ")
      return [{ node, prefix, isLast }, ...walk(node.id, childPrefix)]
    })
  }
  return walk(undefined, "")
}

function branchPrefix(branch: Branch) {
  return branch.prefix + (branch.isLast ? "└── " : "├── ")
}

/** Where a node's own detail lines continue its branch: same rule as a child, minus the connector. */
function detailPrefix(branch: Branch) {
  return branch.prefix + (branch.isLast ? "    " : "│   ")
}

function List(props: { label: string; items: readonly string[]; prefix: string }) {
  const { theme } = useTheme()
  return (
    <Show when={props.items.length > 0}>
      <text fg={theme.textMuted} wrapMode="none">
        {props.prefix}
        {props.label}: {props.items.slice(0, MAX_LIST).join(", ")}
        {props.items.length > MAX_LIST ? ` +${props.items.length - MAX_LIST} more` : ""}
      </text>
    </Show>
  )
}

const EVIDENCE_SIGNAL: Record<Evidence["status"], Signal> = {
  passed: "done",
  failed: "failed",
  not_run: "pending",
  queued: "active",
}

/** One line of evidence: ✓ passed, ✗ failed, ○ not run, ● running. The detail says why. */
function EvidenceRow(props: { item: Evidence; prefix: string }) {
  const { theme } = useTheme()
  const signal = () => EVIDENCE_SIGNAL[props.item.status]
  return (
    <text wrapMode="none">
      <span style={{ fg: theme.borderSubtle }}>{props.prefix}</span>
      <span style={{ fg: signalColor(theme, signal()) }}>{GLYPH[signal()]} </span>
      <span style={{ fg: props.item.status === "failed" ? theme.text : theme.textMuted }}>
        {props.item.label}
        <Show when={props.item.detail}> · {props.item.detail}</Show>
      </span>
    </text>
  )
}

function NodeRow(props: { branch: Branch; byID: Map<string, TuiSidebarGraphItem>; evidence: readonly Evidence[] }) {
  const { theme } = useTheme()
  const node = () => props.branch.node
  const signal = () => SIGNAL[node().status]
  const detail = () => detailPrefix(props.branch)
  const unmetDeps = createMemo(() =>
    node()
      .dependencies.map((depID) => props.byID.get(depID))
      .filter((dep): dep is TuiSidebarGraphItem => dep !== undefined && dep.status !== "done"),
  )

  return (
    <box>
      <text wrapMode="none">
        <span style={{ fg: theme.borderSubtle }}>{branchPrefix(props.branch)}</span>
        <span style={{ fg: signalColor(theme, signal()) }}>{GLYPH[signal()]} </span>
        <span style={{ fg: node().status === "in_progress" ? theme.text : theme.textMuted }}>
          {node().title}
          <Show when={node().owner}> · {node().owner}</Show>
        </span>
      </text>
      <Show when={unmetDeps().length > 0}>
        <text fg={theme.warning} wrapMode="none">
          {detail()}waiting on: {unmetDeps().map((dep) => dep.title).join(", ")}
        </text>
      </Show>
      <List label="files" items={node().files.map((file) => shortenPath(file, 30))} prefix={detail()} />
      <List label="decisions" items={node().decisions} prefix={detail()} />
      <For each={props.evidence}>{(item) => <EvidenceRow item={item} prefix={detail()} />}</For>
    </box>
  )
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const task = useTask(() => props.session_id)
  const owner = createMemo(() => {
    const last = props.api.state.session.messages(props.session_id).findLast((item) => item.role === "assistant")
    return last && "agent" in last && typeof last.agent === "string" ? last.agent : "agent"
  })
  const declared = createMemo(() => props.api.state.session.graph(props.session_id))
  const nodes = createMemo(() => (declared().length > 0 ? declared() : deriveGraph(task(), owner())))
  return <GraphPanel nodes={nodes()} evidence={evidenceFor(nodes(), task().verification)} />
}

/**
 * The graph for a list of nodes, with the evidence RIFT gathered under each one. Takes both as
 * data so it can be rendered without a live session.
 */
export function GraphPanel(props: {
  nodes: readonly TuiSidebarGraphItem[]
  evidence?: ReadonlyMap<string, readonly Evidence[]>
}) {
  const { theme } = useTheme()
  const branches = createMemo(() => layout(props.nodes))
  const byID = createMemo(() => new Map(props.nodes.map((node) => [node.id, node])))

  return (
    <Show
      when={branches().length > 0}
      fallback={
        <box>
          <text fg={theme.text}>
            <b>Engineering graph</b>
          </text>
          <text fg={theme.textMuted}>No nodes yet — the agent builds this out as it works.</text>
        </box>
      }
    >
      <box gap={0}>
        <text fg={theme.text}>
          <b>Engineering graph</b>
        </text>
        <For each={branches()}>
          {(branch) => <NodeRow branch={branch} byID={byID()} evidence={props.evidence?.get(branch.node.id) ?? []} />}
        </For>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    // Where the token/context readout used to sit.
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin

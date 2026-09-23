/**
 * The side panel: a live graph of the software being built, not the conversation about it.
 *
 * Every node the agent declares via `graphwrite` (product → features → subtasks) shows up here
 * with its status and owning agent, and under it the evidence RIFT gathered itself: every check
 * shown as passed, failed or not run, with the reason. The agent never writes evidence. This
 * replaces the old token/cost readout, which now lives as a single line in the sidebar footer.
 */
import type { TuiPlugin, TuiPluginApi, TuiSidebarGraphItem } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Row, shortenPath } from "../../component/control/primitives"
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

const STATUS_LABEL: Record<TuiSidebarGraphItem["status"], string> = {
  not_started: "not started",
  in_progress: "in progress",
  blocked: "blocked",
  testing: "testing",
  done: "done",
  failed: "failed",
}

type TreeNode = TuiSidebarGraphItem & { children: TreeNode[]; depth: number }

function buildTree(nodes: readonly TuiSidebarGraphItem[]): TreeNode[] {
  const byParent = new Map<string | undefined, TuiSidebarGraphItem[]>()
  for (const node of nodes) {
    const key = node.parent_id
    const list = byParent.get(key) ?? []
    list.push(node)
    byParent.set(key, list)
  }
  function attach(parent_id: string | undefined, depth: number): TreeNode[] {
    return (byParent.get(parent_id) ?? []).map((node) => ({
      ...node,
      depth,
      children: attach(node.id, depth + 1),
    }))
  }
  return attach(undefined, 0)
}

function flatten(tree: TreeNode[]): TreeNode[] {
  return tree.flatMap((node) => [node, ...flatten(node.children)])
}

function List(props: { label: string; items: readonly string[] }) {
  const { theme } = useTheme()
  return (
    <Show when={props.items.length > 0}>
      <text fg={theme.textMuted}>
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
function EvidenceRow(props: { item: Evidence; indent: number }) {
  const { theme } = useTheme()
  return (
    <Row signal={EVIDENCE_SIGNAL[props.item.status]} indent={props.indent}>
      <text fg={props.item.status === "failed" ? theme.text : theme.textMuted} wrapMode="none">
        {props.item.label}
        <Show when={props.item.detail}>
          <span style={{ fg: theme.textMuted }}> · {props.item.detail}</span>
        </Show>
      </text>
    </Row>
  )
}

function NodeRow(props: { node: TreeNode; byID: Map<string, TuiSidebarGraphItem>; evidence: readonly Evidence[] }) {
  const { theme } = useTheme()
  const node = () => props.node
  const unmetDeps = createMemo(() =>
    node()
      .dependencies.map((depID) => props.byID.get(depID))
      .filter((dep): dep is TuiSidebarGraphItem => dep !== undefined && dep.status !== "done"),
  )

  return (
    <Row signal={SIGNAL[node().status]} indent={node().depth * 2} dim={node().status === "done"}>
      <box>
        <text fg={node().status === "in_progress" ? theme.text : theme.textMuted} wrapMode="none">
          {node().title}
          <span style={{ fg: theme.textMuted }}> · {STATUS_LABEL[node().status]}</span>
          <Show when={node().owner}>
            <span style={{ fg: theme.textMuted }}> · {node().owner}</span>
          </Show>
        </text>
        <Show when={unmetDeps().length > 0}>
          <text fg={theme.warning}>waiting on: {unmetDeps().map((dep) => dep.title).join(", ")}</text>
        </Show>
        <List label="files" items={node().files.map((file) => shortenPath(file, 30))} />
        <List label="decisions" items={node().decisions} />
        <For each={props.evidence}>{(item) => <EvidenceRow item={item} indent={0} />}</For>
      </box>
    </Row>
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
  const tree = createMemo(() => buildTree(props.nodes))
  const rows = createMemo(() => flatten(tree()))
  const byID = createMemo(() => new Map(props.nodes.map((node) => [node.id, node])))

  return (
    <Show
      when={rows().length > 0}
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
        <For each={rows()}>
          {(node) => <NodeRow node={node} byID={byID()} evidence={props.evidence?.get(node.id) ?? []} />}
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

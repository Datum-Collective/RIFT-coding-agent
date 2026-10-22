/**
 * Engineering graph data for the side panel.
 *
 * `deriveGraph` builds a graph when the agent hasn't declared one with `graphwrite`: the task as
 * the root and its plan steps beneath it, so the panel never sits empty just because a model
 * didn't call a tool. `evidenceFor` attaches what RIFT itself verified to each node. Evidence only
 * ever comes from RIFT's verification record, never from anything the agent wrote.
 */
import type { EngineeringGraphNode } from "@opencode-ai/sdk/v2"
import { sameFile, type Evidence, type Signal, type Task, type TaskState, type Verification } from "./task"

const ROOT = "task"

const FROM_SIGNAL: Record<Signal, EngineeringGraphNode["status"]> = {
  done: "done",
  active: "in_progress",
  pending: "not_started",
  failed: "failed",
  warn: "blocked",
}

const FROM_STATE: Record<TaskState, EngineeringGraphNode["status"]> = {
  idle: "not_started",
  planning: "in_progress",
  executing: "in_progress",
  verifying: "testing",
  blocked: "blocked",
  failed: "failed",
  done: "done",
}

export function deriveGraph(task: Task, owner: string): EngineeringGraphNode[] {
  // Only an idle task with nothing recorded has nothing to show. Once the agent is working the
  // root is there at once, and the plan and files fill in as they happen.
  if (
    task.state === "idle" &&
    task.plan.steps.length === 0 &&
    task.changes.files.length === 0 &&
    task.verification.checks.length === 0
  )
    return []
  const root: EngineeringGraphNode = {
    id: ROOT,
    title: task.title || "This task",
    status: FROM_STATE[task.state],
    owner,
    dependencies: [],
    files: task.changes.files.map((item) => item.file),
    checks: [],
    decisions: [],
  }
  const steps = task.plan.steps.map(
    (step): EngineeringGraphNode => ({
      id: `${ROOT}.${step.n}`,
      parent_id: ROOT,
      title: step.text,
      status: FROM_SIGNAL[step.signal],
      owner,
      dependencies: [],
      files: step.files,
      checks: [],
      decisions: [],
    }),
  )
  return [root, ...(steps.length > 0 ? steps : areas(task))]
}

/**
 * Without a plan, the files edited so far are grouped by directory so the panel still has a
 * shape. Directories are named relative to the one every edited file shares; the group holding
 * the newest edit is the one being worked in.
 */
function areas(task: Task): EngineeringGraphNode[] {
  const files = task.changes.files.map((item) => item.file)
  const dirs = files.map((file) => file.split("/").slice(0, -1))
  const shared = dirs.reduce((common, dir) => {
    const end = common.findIndex((segment, index) => dir[index] !== segment)
    return end === -1 ? common.slice(0, Math.min(common.length, dir.length)) : common.slice(0, end)
  }, dirs[0] ?? [])
  const nameOf = (index: number) => dirs[index].slice(shared.length).join("/") || "Project files"
  const groups = new Map<string, string[]>()
  files.forEach((file, index) => groups.set(nameOf(index), [...(groups.get(nameOf(index)) ?? []), file]))
  if (groups.size < 2) return []
  const newest = nameOf(files.length - 1)
  const working = task.state === "executing" || task.state === "planning"
  return [...groups].map(
    ([name, list], index): EngineeringGraphNode => ({
      id: `${ROOT}.area.${index + 1}`,
      parent_id: ROOT,
      title: name,
      status: working && name === newest ? "in_progress" : "done",
      owner: "rift",
      dependencies: [],
      files: list,
      checks: [],
      decisions: [],
    }),
  )
}

/**
 * An agent-declared graph is only as current as the agent's last `graphwrite`, and models call it
 * rarely. Edits made this turn that no declared node lists are shown under the root, so the panel
 * keeps moving between updates without overriding what the agent declared.
 */
export function withLiveEdits(
  declared: readonly EngineeringGraphNode[],
  task: Task,
): readonly EngineeringGraphNode[] {
  const claimed = declared.flatMap((node) => node.files)
  const unclaimed = (task.changes.live ?? []).filter((file) => !claimed.some((other) => sameFile(other, file)))
  if (unclaimed.length === 0) return declared
  return [
    ...declared,
    {
      id: `${ROOT}.live`,
      parent_id: declared.find((node) => !node.parent_id)?.id,
      title: "Edited since the last graph update",
      status: task.state === "executing" || task.state === "planning" ? "in_progress" : "done",
      owner: "rift",
      dependencies: [],
      files: unclaimed,
      checks: [],
      decisions: [],
    },
  ]
}

/**
 * The evidence rows to show under each node: RIFT's records for that node, then any check the
 * node declared that hasn't been run yet. Root nodes also carry the project-wide checks.
 */
export function evidenceFor(nodes: readonly EngineeringGraphNode[], verification: Verification) {
  const rows = new Map<string, Evidence[]>()
  for (const node of nodes) {
    const recorded = (verification.evidence ?? []).filter((item) => item.node === node.id)
    const declared = node.checks
      .filter((check) => !recorded.some((item) => item.label === (check.label ?? LABEL[check.kind])))
      .map(
        (check): Evidence => ({
          node: node.id,
          label: check.label ?? LABEL[check.kind],
          status: "not_run",
          detail: "not run yet",
        }),
      )
    rows.set(node.id, [...(node.parent_id ? [] : project(node.id, verification)), ...recorded, ...declared])
  }
  return rows
}

function project(node: string, verification: Verification): Evidence[] {
  const checks = verification.checks.map(
    (check): Evidence => ({
      node,
      label: check.command,
      status: check.status === "timed_out" ? "failed" : check.status,
      detail: [check.where, check.status === "timed_out" ? "timed out" : check.reason].filter(Boolean).join(" · "),
    }),
  )
  const browser = verification.browser
  if (!browser) return checks
  const detail =
    browser.status === "passed"
      ? `${browser.url} rendered`
      : (browser.reason ?? `${browser.url}: ${browser.errors[0] ?? `HTTP ${browser.httpStatus}`}`)
  return [...checks, { node, label: "Browser test", status: browser.status, detail }]
}

// Mirrors the server's labels so a declared check lines up with its recorded result.
const LABEL: Record<EngineeringGraphNode["checks"][number]["kind"], string> = {
  typecheck: "Type check",
  unit: "Unit tests",
  integration: "Integration tests",
  browser: "Browser test",
  http: "HTTP check",
  screenshot: "Screenshot",
  static: "Static analysis",
  security: "Security check",
  load: "Load test",
  production: "Production check",
}

/**
 * Engineering graph data for the side panel.
 *
 * `deriveGraph` builds a graph when the agent hasn't declared one with `graphwrite`: the task as
 * the root and its plan steps beneath it, so the panel never sits empty just because a model
 * didn't call a tool. `evidenceFor` attaches what RIFT itself verified to each node. Evidence only
 * ever comes from RIFT's verification record, never from anything the agent wrote.
 */
import type { EngineeringGraphNode } from "@opencode-ai/sdk/v2"
import type { Evidence, Signal, Task, TaskState, Verification } from "./task"

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
  if (task.plan.steps.length === 0 && task.changes.files.length === 0 && task.verification.checks.length === 0) return []
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
  return [root, ...steps]
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

/**
 * The engineering graph shown when the agent hasn't declared one with `graphwrite`: the task itself
 * as the root, its plan steps as children, with the files, checks and results RIFT already tracks.
 * The panel should never sit empty just because a model didn't call a tool.
 */
import type { EngineeringGraphNode } from "@opencode-ai/sdk/v2"
import type { Signal, Task, TaskState, VerifyCheck } from "./task"

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
  const checks = task.verification.checks
  const root: EngineeringGraphNode = {
    id: ROOT,
    title: task.title || "This task",
    status: FROM_STATE[task.state],
    owner,
    dependencies: [],
    files: task.changes.files.map((item) => item.file),
    tests: checks.map((check) => check.command),
    decisions: [],
    evidence: checks.filter((check) => check.status !== "queued").map(evidence),
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
      tests: [],
      decisions: [],
      evidence: [],
    }),
  )
  return [root, ...steps]
}

function evidence(check: VerifyCheck) {
  const where = check.where ? ` (${check.where})` : ""
  return `${check.command}${where}: ${check.status.replace("_", " ")}`
}

/**
 * Row model for Mission Control: one line per session, ordered so the sessions that need a
 * human come first. Pure so the ordering and summaries can be tested as data.
 */
import type { Signal, Task } from "./task"

export type MissionState = "blocked" | "failed" | "running" | "verifying" | "done" | "idle"

export type MissionRow = {
  sessionID: string
  title: string
  state: MissionState
  signal: Signal
  /** One line describing where the session got to. */
  summary: string
  current: boolean
  attention: boolean
}

const RANK: Record<MissionState, number> = {
  blocked: 0,
  failed: 1,
  running: 2,
  verifying: 3,
  done: 4,
  idle: 5,
}

export const MISSION_SIGNAL: Record<MissionState, Signal> = {
  blocked: "warn",
  failed: "failed",
  running: "active",
  verifying: "active",
  done: "done",
  idle: "pending",
}

export const MISSION_LABEL: Record<MissionState, string> = {
  blocked: "needs you",
  failed: "failed",
  running: "running",
  verifying: "verifying",
  done: "done",
  idle: "idle",
}

export function missionState(task: Task): MissionState {
  switch (task.state) {
    case "blocked":
      return "blocked"
    case "failed":
      return "failed"
    case "verifying":
      return "verifying"
    case "planning":
    case "executing":
      return "running"
    case "done":
      return "done"
    case "idle":
      return "idle"
  }
}

/** The one line that says where a session got to, preferring whatever needs a human. */
export function missionSummary(task: Task): string {
  if (task.blocked.permissions > 0) {
    return `${task.blocked.permissions} permission ${task.blocked.permissions === 1 ? "request" : "requests"} waiting`
  }
  if (task.blocked.questions > 0) {
    return `${task.blocked.questions} ${task.blocked.questions === 1 ? "question" : "questions"} waiting`
  }

  const verification = task.verification
  if (verification.state === "failed") {
    const failed = verification.checks.filter((check) => check.status === "failed" || check.status === "timed_out")
    if (failed.length > 0) {
      return `${failed.length} ${failed.length === 1 ? "check" : "checks"} failed — ${failed[0]!.command}`
    }
    if (verification.claims?.status === "mismatch") return "summary does not match the diff"
  }
  if (verification.state === "running") return "verifying changes"
  if (verification.state === "incomplete") return "some checks did not run"

  const active = task.execution.find((phase) => phase.signal === "active")
  if (active) return active.label.toLowerCase()

  const failedPhase = task.execution.find((phase) => phase.signal === "failed")
  if (failedPhase) return `${failedPhase.label.toLowerCase()} failed`

  if (verification.state === "passed") {
    const count = verification.checks.length
    return `${count} ${count === 1 ? "check" : "checks"} passed`
  }

  const { files, added, removed } = task.changes
  if (files.length > 0) return `${files.length} ${files.length === 1 ? "file" : "files"} · +${added} −${removed}`

  const last = task.execution[task.execution.length - 1]
  if (last) return last.label.toLowerCase()
  return "no activity"
}

export function missionRow(input: { sessionID: string; task: Task; current: boolean }): MissionRow {
  const state = missionState(input.task)
  return {
    sessionID: input.sessionID,
    title: input.task.title,
    state,
    signal: MISSION_SIGNAL[state],
    summary: missionSummary(input.task),
    current: input.current,
    attention: state === "blocked" || state === "failed",
  }
}

/** Needs-you first, then failures, then work in flight. Stable within a rank. */
export function orderRows(rows: readonly MissionRow[]): MissionRow[] {
  return [...rows].sort((a, b) => RANK[a.state] - RANK[b.state])
}

export function missionCounts(rows: readonly MissionRow[]) {
  return {
    blocked: rows.filter((row) => row.state === "blocked").length,
    failed: rows.filter((row) => row.state === "failed").length,
    running: rows.filter((row) => row.state === "running" || row.state === "verifying").length,
    total: rows.length,
  }
}

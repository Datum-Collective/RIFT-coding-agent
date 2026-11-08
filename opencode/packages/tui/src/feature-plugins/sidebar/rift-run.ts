/**
 * How a verification run reads in the sidebar: what it is doing or how it ended, then one line per stage, with
 * passes folded once the list is long so what needs attention stays on screen. Under the composer it reads as one
 * short line (`brief`).
 */
import type { Rift } from "@opencode/schema/rift"

export type Tone = "success" | "error" | "warning" | "muted"

export type Line = { glyph: string; tone: Tone; text: string }

const STAGE: Record<Rift.Stage["status"], { glyph: string; tone: Tone }> = {
  pending: { glyph: "·", tone: "muted" },
  running: { glyph: "◌", tone: "warning" },
  passed: { glyph: "✓", tone: "success" },
  flaky: { glyph: "~", tone: "warning" },
  failed: { glyph: "✗", tone: "error" },
  timed_out: { glyph: "✗", tone: "error" },
  skipped: { glyph: "⊘", tone: "muted" },
  not_run: { glyph: "○", tone: "warning" },
}

const VERDICT: Record<Rift.RunVerdict, Tone> = {
  verified: "success",
  regressed: "error",
  failing: "error",
  tampered: "error",
  unproven: "warning",
}

const settled = (stage: Rift.Stage) => stage.status !== "pending" && stage.status !== "running"

/** What the run is doing, or how it ended. */
export function status(run: Rift.Run): { text: string; tone: Tone } {
  switch (run.phase) {
    case "preparing":
      return { text: "preparing", tone: "muted" }
    case "asking":
      return { text: "waiting for permission", tone: "warning" }
    case "running":
      return { text: `running ${run.stages.filter(settled).length}/${run.stages.length}`, tone: "muted" }
    case "comparing":
      return { text: "comparing with the baseline", tone: "muted" }
    case "mutating":
      return { text: `mutating ${run.mutants?.done ?? 0}/${run.mutants?.total ?? 0}`, tone: "muted" }
    case "done":
      return { text: run.verdict, tone: VERDICT[run.verdict] }
    case "cancelled":
      return { text: `stopped: ${run.reason}`, tone: "warning" }
  }
}

const detail = (stage: Rift.Stage) => {
  if (stage.status === "failed" || stage.status === "timed_out") {
    const parts = [
      stage.status === "timed_out" ? "timed out" : "",
      stage.introduced ? `${stage.introduced} new` : "",
      stage.preexisting ? `${stage.preexisting} already failing` : "",
    ].filter(Boolean)
    return parts.length > 0 ? ` (${parts.join(", ")})` : ""
  }
  if (stage.status === "running" && (stage.attempt ?? 1) > 1) return ` (attempt ${stage.attempt})`
  if (stage.status === "flaky") return " (flaky)"
  if (stage.status === "not_run" && stage.reason) return ` (${stage.reason})`
  return ""
}

/** One line per stage, in order. Past `limit` stages, the passes fold into a single count. */
export function stages(run: Rift.Run, limit = 6): Line[] {
  const line = (stage: Rift.Stage): Line => ({
    ...STAGE[stage.status],
    text: `${stage.unit === "." ? "" : `${stage.unit} `}${stage.command}${detail(stage)}`,
  })
  if (run.stages.length <= limit) return run.stages.map(line)
  const passed = run.stages.filter((stage) => stage.status === "passed").length
  return [
    ...run.stages.filter((stage) => stage.status !== "passed").map(line),
    ...(passed > 0 ? [{ glyph: "✓", tone: "success" as const, text: `${passed} passed` }] : []),
  ]
}

/** A line under the composer: a glyph and words in one tone, then the key or command that acts on it. */
export type Brief = { glyph: string; tone: Tone; text: string; key?: string }

const failing = (run: Rift.Run) =>
  run.stages.filter((stage) => stage.status === "failed" || stage.status === "timed_out").length

/** The session's newest run: the per-turn one or the latest /verify, whichever started last. */
function latest(state: Rift.State | undefined) {
  const runs = [state?.change?.run, state?.project].filter((run): run is Rift.Run => run !== undefined)
  return runs.sort((a, b) => b.started - a.started)[0]
}

/** What needs attention first: permission requests waiting on the user, else how the newest run stands. */
export function brief(input: { permissions: number; state?: Rift.State }): Brief | undefined {
  if (input.permissions > 0) {
    const plural = input.permissions === 1 ? "" : "s"
    return { glyph: "⚠", tone: "warning", text: `${input.permissions} permission${plural} waiting` }
  }
  const run = latest(input.state)
  if (!run) return
  const now = status(run)
  if (run.phase === "asking") return { glyph: "⚠", tone: "warning", text: now.text }
  if (run.phase === "cancelled") return { glyph: "○", tone: "warning", text: "stopped" }
  if (run.phase !== "done") return { glyph: "◌", tone: "muted", text: now.text }
  if (run.verdict === "verified") return { glyph: "✓", tone: "success", text: "verified" }
  if (run.verdict === "unproven") return { glyph: "○", tone: "warning", text: "unproven" }
  const count = failing(run)
  const text = count > 0 && run.verdict !== "tampered" ? `${count} failing` : run.verdict
  return { glyph: "✗", tone: "error", text, key: "/verify" }
}

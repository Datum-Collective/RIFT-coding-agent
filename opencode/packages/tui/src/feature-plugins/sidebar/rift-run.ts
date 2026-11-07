/**
 * How a verification run reads in the sidebar: what it is doing or how it ended, then one line per stage, with
 * passes folded once the list is long so what needs attention stays on screen.
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

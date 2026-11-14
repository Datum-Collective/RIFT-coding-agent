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

/** One line per stage, in order, each with the stage it came from. Past `limit` stages, the passes fold into a count. */
export function entries(run: Rift.Run, limit = 6): { line: Line; stage?: Rift.Stage }[] {
  const entry = (stage: Rift.Stage) => ({
    stage,
    line: { ...STAGE[stage.status], text: `${stage.unit === "." ? "" : `${stage.unit} `}${stage.command}${detail(stage)}` },
  })
  if (run.stages.length <= limit) return run.stages.map(entry)
  const passed = run.stages.filter((stage) => stage.status === "passed").length
  return [
    ...run.stages.filter((stage) => stage.status !== "passed").map(entry),
    ...(passed > 0 ? [{ line: { glyph: "✓", tone: "success" as const, text: `${passed} passed` } }] : []),
  ]
}

/** One line per stage, in order. Past `limit` stages, the passes fold into a single count. */
export const stages = (run: Rift.Run, limit = 6): Line[] => entries(run, limit).map((item) => item.line)

const seconds = (ms: number | undefined) => (ms === undefined ? "" : ` in ${(ms / 1000).toFixed(1)}s`)

/** How a check ended, in words: the result line of a check's detail. */
const result = (stage: Rift.Stage) => {
  switch (stage.status) {
    case "passed":
      return `passed${seconds(stage.ms)}`
    case "flaky":
      return `flaky: failed, then passed on the same code${seconds(stage.ms)}`
    case "failed":
    case "timed_out":
      return `${stage.status === "timed_out" ? "timed out" : "failed"}${detail(stage)}${seconds(stage.ms)}`
    case "skipped":
    case "not_run":
      return `not run: ${stage.reason ?? "no reason recorded"}`
    case "running":
      return "running now"
    case "pending":
      return "waiting its turn"
  }
}

/** A check needs reading when it failed or could not run. One skipped only because an earlier check failed says nothing the failure above does not. */
export const needsAttention = (stage: Rift.Stage) =>
  stage.status !== "passed" && stage.status !== "pending" && stage.status !== "running" && stage.status !== "skipped"

const EVIDENCE_SHOWN = 6
/** Room for a label such as `verifier` and a space, so wrapped text hangs under the first word, not under the label. */
const LABEL = 9

/** Breaks text into rows of at most `width` columns at spaces; a word longer than a row is cut. */
export function wrap(text: string, width: number): string[] {
  const room = Math.max(8, width)
  const rows: string[] = []
  let row = ""
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = word
    while (rest.length > room) {
      if (row) rows.push(row)
      rows.push(rest.slice(0, room))
      rest = rest.slice(room)
      row = ""
    }
    if (row && row.length + 1 + rest.length > room) {
      rows.push(row)
      row = rest
    } else row = row ? `${row} ${rest}` : rest
  }
  if (row) rows.push(row)
  return rows
}

/** A label, then text wrapped so every later row is indented to start under the first row's text. */
function field(label: string, text: string, width: number, tone: Tone): Line[] {
  return wrap(text, width - LABEL).map((row, index) => ({ glyph: " ", tone, text: `${(index === 0 ? label : "").padEnd(LABEL)}${row}` }))
}

/**
 * What a check says about itself, for the user to judge: why it ran, what ran, how it ended, and the output it
 * ended on. A check that failed is always spelled out; the others only when the user opens them. Rows are already
 * wrapped to `width`, so a long sentence keeps its indent.
 */
export function details(stage: Rift.Stage, open: boolean, width = 36): Line[] {
  if (!open && !needsAttention(stage)) return []
  const tone = STAGE[stage.status].tone
  const evidence = (stage.evidence ?? "").split("\n").filter((row) => row.trim().length > 0)
  const shown = stage.status === "passed" ? evidence : evidence.slice(-EVIDENCE_SHOWN)
  return [
    ...(stage.why ? field("why", stage.why, width, "muted") : []),
    ...field("ran", stage.command, width, "muted"),
    ...field("result", result(stage), width, tone),
    ...shown.flatMap((row, index) => field(index === 0 ? "output" : "", row, width, "muted")),
  ]
}

const DISPUTE: Record<Rift.Dispute["status"], { glyph: string; tone: Tone; label: string }> = {
  open: { glyph: "≠", tone: "error", label: "open" },
  resolved: { glyph: "✓", tone: "success", label: "resolved" },
  unresolved: { glyph: "✗", tone: "error", label: "unresolved" },
}

/** Where the verifier and the agent disagreed, and how that ended. Empty when they never did. */
export function disputes(list: readonly Rift.Dispute[] | undefined, width = 36): Line[] {
  return (list ?? []).flatMap((item) => {
    const style = DISPUTE[item.status]
    return [
      { glyph: style.glyph, tone: style.tone, text: `${item.check} · ${style.label}` },
      ...field("verifier", `${item.claim}. Sent back in round ${item.round}.`, width, "muted"),
      ...(item.resolution ? field("outcome", item.resolution, width, style.tone) : field("outcome", "not fixed yet", width, "warning")),
    ]
  })
}

/**
 * What the run could not vouch for, one row each, in the words the integrity review used. Shown under the header, so
 * a run with every check passing and a verdict of unproven says why.
 */
export function notes(run: Rift.Run, width = 36): Line[] {
  if (run.phase !== "done" || !run.notes || run.notes.length === 0) return []
  const tone: Tone = run.verdict === "tampered" ? "error" : "warning"
  return run.notes.flatMap((note) => wrap(note, width - 2).map((row, index) => ({ glyph: index === 0 ? "!" : " ", tone, text: row })))
}

/** A folder for a person: the last two parts, and a mark where the rest was left out. */
export function place(folder: string): string {
  const parts = folder.split("/").filter(Boolean)
  return parts.length <= 2 ? folder : `…/${parts.slice(-2).join("/")}`
}

/** The warning for edits outside the verified folder, or nothing when there were none. */
export function strays(files: readonly string[] | undefined, width = 36): Line[] {
  if (!files || files.length === 0) return []
  return [
    { glyph: "⚠", tone: "warning", text: `${files.length === 1 ? "1 file" : `${files.length} files`} edited outside this folder` },
    ...files.flatMap((file) => wrap(place(file), width).map((row) => ({ glyph: " ", tone: "muted" as const, text: row }))),
    { glyph: " ", tone: "warning", text: "No check covers them." },
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

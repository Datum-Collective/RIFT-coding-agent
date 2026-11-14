export * as RiftDisputes from "./disputes.js"

import type { Rift } from "@opencode/schema/rift"

const failing = (stage: Rift.Stage) => stage.status === "failed" || stage.status === "timed_out"

/**
 * Opens a dispute for every failing check of a finished run that has none open. Called when the agent ended its
 * turn and was sent back, so the failure is something the verifier says and the agent has not yet answered.
 */
export function raise(disputes: readonly Rift.Dispute[], run: Rift.Run, round: number, now: number): Rift.Dispute[] {
  if (run.phase !== "done") return [...disputes]
  const open = new Set(disputes.filter((item) => item.status === "open").map((item) => item.stage))
  const added = run.stages
    .filter((stage) => failing(stage) && !open.has(stage.id))
    .map(
      (stage): Rift.Dispute => ({
        stage: stage.id,
        check: stage.command,
        raised: now,
        round,
        claim: `${stage.command} ${stage.status === "timed_out" ? "timed out" : "fails"} on the agent's change`,
        evidence: stage.evidence,
        status: "open",
      }),
    )
  return [...disputes, ...added]
}

/** Closes as resolved the open disputes whose check passed in a finished run. Nothing else closes one early. */
export function settle(disputes: readonly Rift.Dispute[], run: Rift.Run, now: number): Rift.Dispute[] {
  if (run.phase !== "done") return [...disputes]
  const passed = new Set(run.stages.filter((stage) => stage.status === "passed").map((stage) => stage.id))
  return disputes.map((item) =>
    item.status === "open" && passed.has(item.stage)
      ? { ...item, status: "resolved" as const, closed: now, resolution: `passed in a later run (receipt ${run.receipt.slice(0, 12)})` }
      : item,
  )
}

/** The fix rounds ran out: what is still open stays a disagreement, and the user is told so. */
export function giveUp(disputes: readonly Rift.Dispute[], rounds: number, now: number): Rift.Dispute[] {
  return disputes.map((item) =>
    item.status === "open" ? { ...item, status: "unresolved" as const, closed: now, resolution: `still failing after ${rounds} fix rounds` } : item,
  )
}

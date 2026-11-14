export * as RiftRepair from "./repair.js"

import { createHash } from "node:crypto"
import type { Rift } from "@opencode/schema/rift"

/**
 * What a fix did to a failure. Sending the same report back three times is not repair: if the agent's change left
 * the failure as it was, the next instruction has to say so and ask for a different idea, and a third time the
 * loop stops and tells the user, instead of spending rounds on a guess that is not working.
 */

/** The failure with its noise taken out: which checks failed and what they said, minus numbers and timings. */
export function signature(run: Rift.Run): string {
  const failing = run.stages
    .filter((stage) => stage.status === "failed" || stage.status === "timed_out")
    .map((stage) => `${stage.id}\n${(stage.evidence ?? "").replace(/\[?\d+(?:\.\d+)?\s*(?:ms|s)\]?/g, "").replace(/\d+/g, "#").replace(/\s+/g, " ").trim()}`)
    .sort()
  return createHash("sha256").update(failing.join("\n--\n")).digest("hex").slice(0, 16)
}

/** How many fixes in a row, ending now, left the failure unchanged. */
export function repeats(history: readonly string[]): number {
  let count = 0
  for (let index = history.length - 1; index > 0 && history[index] === history[index - 1]; index--) count++
  return count
}

const RULE = "Fix the code, never the checks or what the tests expect."

export type Step =
  | { readonly type: "diagnose"; readonly text: string }
  | { readonly type: "rethink"; readonly text: string }
  | { readonly type: "stop" }

/** What the agent is told, given how many fixes in a row changed nothing. */
export function next(unchanged: number): Step {
  if (unchanged >= 2) return { type: "stop" }
  if (unchanged === 1)
    return {
      type: "rethink",
      text: `Your last change left this failure exactly as it was, so your diagnosis was wrong. Do not repeat it. In one sentence, say what you now think is wrong and which line of the output shows it, then try a different fix. ${RULE}`,
    }
  return {
    type: "diagnose",
    text: `First, in one sentence, say what you think is wrong and which line of the output above shows it. Then fix it. ${RULE}`,
  }
}

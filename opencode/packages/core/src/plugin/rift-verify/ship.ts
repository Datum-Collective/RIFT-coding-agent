export * as RiftShip from "./ship.js"

import type { Rift } from "@opencode/schema/rift"

export interface Identity {
  readonly name: string
  readonly email: string
}

/**
 * Who RIFT is on a commit, from `Name <email>`. GitHub credits a co-author as a contributor only when the email
 * belongs to an account, so this is never guessed or defaulted: no identity, no trailer.
 */
export function identity(text: string | undefined): Identity | undefined {
  const found = /^([^<>\r\n]+?)\s*<([^<>\s@\r\n]+@[^<>\s@\r\n]+\.[^<>\s@\r\n]+)>$/.exec((text ?? "").trim())
  return found ? { name: found[1]!.trim(), email: found[2]! } : undefined
}

const TRAILER = /^[A-Za-z][A-Za-z0-9-]*:\s+\S/

/** The message with RIFT's co-author trailer in its trailer block. Added once; nothing without an identity. */
export function withTrailer(message: string, who: Identity | undefined): string {
  if (!who || message.trim().length === 0) return message
  const line = `Co-Authored-By: ${who.name} <${who.email}>`
  if (message.toLowerCase().includes(line.toLowerCase())) return message
  const body = message.trimEnd()
  const last = body.split(/\n\s*\n/).at(-1)!.split("\n")
  // A last paragraph made only of `Key: value` lines is the trailer block; join it. Otherwise open one.
  const block = body.includes("\n\n") && last.every((row) => TRAILER.test(row))
  return `${body}${block ? "\n" : "\n\n"}${line}\n`
}

export interface Gate {
  readonly ready: boolean
  /** Why not, in words for the user. Empty when ready. */
  readonly reasons: readonly string[]
}

/**
 * Ready to ship means the checks said so about this very tree: a finished run, verified, of the tree as it is now,
 * with no disagreement between the verifier and the agent left open. Anything less is a reason, not a pass.
 */
export function gate(input: { run: Rift.Run | undefined; tree: string; disputes: readonly Rift.Dispute[] }): Gate {
  const reasons: string[] = []
  const { run } = input
  if (!run) reasons.push("nothing has been verified yet")
  else if (run.phase !== "done") reasons.push("verification is still running")
  else {
    if (run.verdict !== "verified") reasons.push(`the last verification said ${run.verdict}`)
    if (run.tree !== input.tree) reasons.push("the code has changed since it was verified")
  }
  const unsettled = input.disputes.filter((item) => item.status !== "resolved").length
  if (unsettled > 0) reasons.push(`${unsettled} disagreement${unsettled === 1 ? "" : "s"} between the verifier and the agent ${unsettled === 1 ? "is" : "are"} not resolved`)
  return { ready: reasons.length === 0, reasons }
}

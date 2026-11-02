export * as RiftReceipt from "./receipt.js"

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import type { RiftChecks } from "./checks.js"
import type { RiftIntegrity } from "./integrity.js"

/**
 * A proof receipt: what was checked, on exactly which files, with what result, written down so it can be
 * audited later and shows if it was altered. Each receipt carries the digest of the one before it, so a
 * removed or rewritten receipt breaks the chain. It records evidence, it is not a signature: anyone who can
 * rewrite the whole chain can forge one, so keep the receipts out of the agent's reach (RIFT stores them in
 * plugin storage, not in the project).
 */

export type Verdict =
  /** Every check passed on these files and nothing in the integrity review blocked. */
  | "verified"
  | "failed"
  /** A check could not run, or there was none. Never reported as verified. */
  | "unproven"
  /** The checks passed, but the change tampered with the tests or checks. */
  | "tampered"

export interface Receipt {
  readonly version: 1
  readonly session: string
  readonly time: string
  /** The commit the work started from. */
  readonly head?: string
  readonly files: readonly { readonly path: string; readonly sha256: string }[]
  readonly checks: readonly {
    readonly name: string
    readonly command: string
    readonly status: RiftChecks.Status
    readonly reason?: string
    readonly ms: number
    /** Hash of the output the check produced, so the output can be matched to the receipt later. */
    readonly output: string
  }[]
  readonly integrity: readonly RiftIntegrity.Finding[]
  readonly verdict: Verdict
  /** Digest of the receipt before this one in the session, or none for the first. */
  readonly prev?: string
}

export type Sealed = Receipt & { readonly digest: string }

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex")

/** Keys sorted at every level, so the same receipt always hashes the same. */
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`
  return JSON.stringify(value) ?? "null"
}

export const digest = (receipt: Receipt) => sha(canonical(receipt))

export const verdict = (results: readonly RiftChecks.Result[], findings: readonly RiftIntegrity.Finding[]): Verdict => {
  if (results.some((result) => result.status === "failed" || result.status === "timed_out")) return "failed"
  if (findings.some((finding) => finding.severity === "block")) return "tampered"
  if (results.length === 0 || results.some((result) => result.status === "not_run")) return "unproven"
  return "verified"
}

const hashFile = (root: string, file: string) => {
  try {
    return sha(readFileSync(path.resolve(root, file)))
  } catch {
    return "missing"
  }
}

export const seal = (input: {
  session: string
  root: string
  head?: string
  files: readonly string[]
  results: readonly RiftChecks.Result[]
  findings: readonly RiftIntegrity.Finding[]
  prev?: string
  now?: Date
}): Sealed => {
  const receipt: Receipt = {
    version: 1,
    session: input.session,
    time: (input.now ?? new Date()).toISOString(),
    head: input.head,
    files: [...input.files].sort().map((file) => ({ path: file, sha256: hashFile(input.root, file) })),
    checks: input.results.map((result) => ({
      name: result.name,
      command: result.command,
      status: result.status,
      reason: result.reason,
      ms: result.ms,
      output: sha(result.output),
    })),
    integrity: input.findings,
    verdict: verdict(input.results, input.findings),
    prev: input.prev,
  }
  return { ...receipt, digest: digest(receipt) }
}

/** The first problem in a chain of receipts, or undefined when every digest matches and every link holds. */
export const audit = (chain: readonly Sealed[]): string | undefined => {
  for (const [index, sealed] of chain.entries()) {
    const { digest: claimed, ...receipt } = sealed
    if (digest(receipt as Receipt) !== claimed) return `receipt ${index + 1} does not match its digest`
    // The first receipt kept may follow older ones that were trimmed, so only the links after it are checked.
    if (index > 0 && receipt.prev !== chain[index - 1]!.digest) return `receipt ${index + 1} does not follow receipt ${index}`
  }
  return undefined
}

export const format = (sealed: Sealed) => `Receipt ${sealed.digest.slice(0, 12)}: ${sealed.verdict}`

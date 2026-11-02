export * as RiftGraph from "./graph.js"

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { Schema } from "effect"

export const Status = Schema.Literals(["not_started", "in_progress", "blocked", "testing", "done", "failed"])

export const Check = Schema.Struct({
  label: Schema.String.annotate({ description: "What this check proves, e.g. 'upload accepts 500MB'" }),
  command: Schema.String.annotate({ description: "Shell command that exits 0 when the check passes" }),
  cwd: Schema.optional(Schema.String).annotate({ description: "Directory to run in. Defaults to the project root" }),
})
export type Check = typeof Check.Type

export const Node = Schema.Struct({
  id: Schema.String.annotate({ description: "Stable id, e.g. 'auth.api'" }),
  // Models often send null for the root's parent rather than leaving it out.
  parent_id: Schema.optional(Schema.NullOr(Schema.String)).annotate({ description: "Parent id; omit only for the root" }),
  title: Schema.String.annotate({ description: "Short name" }),
  status: Status,
  dependencies: Schema.Array(Schema.String).annotate({ description: "Ids this node depends on" }),
  files: Schema.Array(Schema.String).annotate({ description: "Files this node's behaviour depends on" }),
  checks: Schema.Array(Check).annotate({ description: "How RIFT proves this node" }),
  decisions: Schema.Array(Schema.String).annotate({ description: "Key decisions" }),
})
export type Node = typeof Node.Type

/** One check RIFT ran, tied to the exact inputs it saw. */
export const Proof = Schema.Struct({
  node: Schema.String,
  label: Schema.String,
  command: Schema.String,
  status: Schema.Literals(["passed", "failed", "timed_out", "not_run"]),
  inputs: Schema.String,
  detail: Schema.optional(Schema.String),
})
export type Proof = typeof Proof.Type

/**
 * - `proven`: every check passed on the current inputs, and everything this node rests on is proven.
 * - `failed`: a check failed on the current inputs.
 * - `stale`: a proof exists, but the code it tested has changed.
 * - `unproven`: there is no evidence yet, or a check could not run.
 * - `at_risk`: this node's own proof holds, but something it rests on is not proven.
 */
export type Verdict = "proven" | "failed" | "stale" | "unproven" | "at_risk"

export interface Assessment {
  readonly node: string
  readonly verdict: Verdict
  /** The nodes that keep an `at_risk` node from being proven. */
  readonly because: readonly string[]
}

const byID = (nodes: readonly Node[]) => new Map(nodes.map((node) => [node.id, node]))

/** What a node rests on: its dependencies and its children, since a parent is proven only through them. */
export const supports = (nodes: readonly Node[], node: Node) => [
  ...node.dependencies,
  ...nodes.filter((other) => other.parent_id === node.id).map((other) => other.id),
]

/** A node's files plus those of everything it depends on, so a change below it invalidates its proof. */
export const inputFiles = (nodes: readonly Node[], node: Node) => {
  const index = byID(nodes)
  const seen = new Set<string>()
  const files = new Set<string>()
  const visit = (current: Node | undefined) => {
    if (!current || seen.has(current.id)) return
    seen.add(current.id)
    current.files.forEach((file) => files.add(file))
    current.dependencies.forEach((id) => visit(index.get(id)))
  }
  visit(node)
  return [...files].sort()
}

/** Hashes content rather than timestamps: undoing an edit makes a proof valid again. */
export const hash = (root: string, nodes: readonly Node[], node: Node) => {
  const digest = createHash("sha256")
  for (const file of inputFiles(nodes, node)) {
    digest.update(file).update("\0")
    try {
      digest.update(readFileSync(path.resolve(root, file)))
    } catch {
      digest.update("missing")
    }
    digest.update("\0")
  }
  return digest.digest("hex")
}

const own = (node: Node, proofs: readonly Proof[], inputs: string): Verdict => {
  if (node.checks.length === 0) return "unproven"
  const latest = node.checks.map((check) =>
    proofs.find((proof) => proof.node === node.id && proof.command === check.command && proof.label === check.label),
  )
  if (latest.some((proof) => !proof)) return latest.some((proof) => proof) ? "stale" : "unproven"
  const current = latest as Proof[]
  if (current.some((proof) => proof.inputs !== inputs)) return "stale"
  if (current.some((proof) => proof.status === "failed" || proof.status === "timed_out")) return "failed"
  if (current.some((proof) => proof.status === "not_run")) return "unproven"
  return "proven"
}

/** Whether this check must run: it has no proof for the node's current inputs. */
export const due = (node: Node, check: Check, proofs: readonly Proof[], inputs: string) => {
  const proof = proofs.find((item) => item.node === node.id && item.command === check.command && item.label === check.label)
  return !proof || proof.inputs !== inputs || proof.status === "not_run"
}

export const assess = (
  nodes: readonly Node[],
  proofs: readonly Proof[],
  inputs: (node: Node) => string,
): Assessment[] => {
  const index = byID(nodes)
  const memo = new Map<string, Assessment>()
  const visit = (node: Node, path: ReadonlySet<string>): Assessment => {
    const cached = memo.get(node.id)
    if (cached) return cached
    const verdict = own(node, proofs, inputs(node))
    const rests = supports(nodes, node)
    // A parent with no checks of its own is proven by its children alone.
    const base = verdict === "unproven" && node.checks.length === 0 && rests.length > 0 ? "proven" : verdict
    const because: string[] = []
    for (const id of rests) {
      const target = index.get(id)
      // A dependency that does not exist, or a cycle, can never be proven.
      if (!target || path.has(id)) because.push(id)
      else if (visit(target, new Set([...path, id])).verdict !== "proven") because.push(id)
    }
    const result: Assessment =
      base === "proven" && because.length > 0
        ? { node: node.id, verdict: "at_risk", because }
        : { node: node.id, verdict: base, because: base === "proven" ? [] : because }
    memo.set(node.id, result)
    return result
  }
  return nodes.map((node) => visit(node, new Set([node.id])))
}

export const format = (nodes: readonly Node[], assessments: readonly Assessment[]) =>
  [
    "Engineering graph",
    ...assessments.map((item) => {
      const node = nodes.find((candidate) => candidate.id === item.node)
      const reason = item.because.length > 0 ? ` (rests on: ${item.because.join(", ")})` : ""
      return `- ${item.verdict}: ${node?.title ?? item.node}${reason}`
    }),
  ].join("\n")

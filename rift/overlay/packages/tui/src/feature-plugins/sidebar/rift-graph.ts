/**
 * How the engineering graph reads in the sidebar: a tree with connectors, a one-line summary, the
 * reason a node is not proven in words (titles, not ids), and proven branches folded away once the
 * graph is long, so what needs attention is what is on screen.
 */
import type { Rift } from "@opencode/schema/rift"

export type Line = {
  node: Rift.Node
  depth: number
  /** The connectors in front of the node: "│  ├─ " and so on. */
  prefix: string
  /** How many proven nodes are folded under this one. */
  folded: number
  /** Titles of what this node is waiting on, shortened. */
  waiting: string[]
}

/** The graph as lines of a tree, parents above children. A node whose parent is unknown is a root. */
export function tree(nodes: readonly Rift.Node[]) {
  const known = new Set(nodes.map((node) => node.id))
  const lines: { node: Rift.Node; depth: number }[] = []
  const seen = new Set<string>()
  const visit = (node: Rift.Node, depth: number) => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    lines.push({ node, depth })
    nodes.filter((child) => child.parent === node.id).forEach((child) => visit(child, depth + 1))
  }
  nodes.filter((node) => node.parent === undefined || !known.has(node.parent)).forEach((node) => visit(node, 0))
  // A cycle has no root, and must still be shown.
  nodes.forEach((node) => visit(node, 0))
  return lines
}

export type Counts = Record<Rift.Node["verdict"], number> & { total: number }

export function count(nodes: readonly Rift.Node[]): Counts {
  const counts: Counts = { proven: 0, failed: 0, stale: 0, unproven: 0, at_risk: 0, total: nodes.length }
  for (const node of nodes) counts[node.verdict]++
  return counts
}

/** A bar `width` cells wide, filled in proportion to the proven nodes. */
export function bar(counts: Counts, width = 10) {
  const filled = counts.total === 0 ? 0 : Math.round((counts.proven / counts.total) * width)
  return "█".repeat(filled) + "░".repeat(width - filled)
}

/** Everything under `id` (children, grandchildren) that the tree shows, not including `id`. */
function below(children: Map<string, Rift.Node[]>, id: string, seen = new Set<string>()): Rift.Node[] {
  const out: Rift.Node[] = []
  for (const child of children.get(id) ?? []) {
    if (seen.has(child.id)) continue
    seen.add(child.id)
    out.push(child, ...below(children, child.id, seen))
  }
  return out
}

/**
 * The lines to draw. Past `limit` lines, a node whose whole subtree is proven is drawn alone with a
 * count of what it folds. Roots are never folded.
 */
export function layout(nodes: readonly Rift.Node[], limit = 14): Line[] {
  const titles = new Map(nodes.map((node) => [node.id, node.title]))
  const known = new Set(nodes.map((node) => node.id))
  const children = new Map<string, Rift.Node[]>()
  for (const node of nodes) {
    if (node.parent === undefined || !known.has(node.parent)) continue
    children.set(node.parent, [...(children.get(node.parent) ?? []), node])
  }
  const long = tree(nodes).length > limit
  const lines: Line[] = []
  const seen = new Set<string>()

  const waitingOn = (node: Rift.Node) => {
    if (node.verdict === "proven" || node.because.length === 0) return []
    const names = node.because.map((id) => titles.get(id) ?? id)
    return names.length > 2 ? [...names.slice(0, 2), `+${names.length - 2}`] : names
  }

  const visit = (node: Rift.Node, depth: number, lead: string, last: boolean) => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    const prefix = depth === 0 ? "" : lead + (last ? "└─ " : "├─ ")
    const rest = below(children, node.id)
    const foldable = long && depth > 0 && rest.length > 0 && node.verdict === "proven" && rest.every((item) => item.verdict === "proven")
    lines.push({ node, depth, prefix, folded: foldable ? rest.length : 0, waiting: waitingOn(node) })
    if (foldable) {
      rest.forEach((item) => seen.add(item.id))
      return
    }
    const kids = children.get(node.id) ?? []
    const next = depth === 0 ? "" : lead + (last ? "   " : "│  ")
    kids.forEach((kid, index) => visit(kid, depth + 1, next, index === kids.length - 1))
  }

  const roots = nodes.filter((node) => node.parent === undefined || !known.has(node.parent))
  roots.forEach((root) => visit(root, 0, "", true))
  // A cycle has no root, and must still be shown.
  nodes.forEach((node) => visit(node, 0, "", true))
  return lines
}

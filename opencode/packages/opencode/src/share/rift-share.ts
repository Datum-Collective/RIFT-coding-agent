import type { Message, Model, Part, Session, SnapshotFileDiff } from "@opencode-ai/sdk/v2"
import { GITHUB_REPO } from "@opencode-ai/core/brand"

// A shared session is one JSON file in a secret GitHub Gist. The viewer on GitHub Pages reads the
// gist id from the URL fragment, so the id never reaches the Pages server's logs.
const [owner, repo] = GITHUB_REPO.split("/")
export const VIEWER = `https://${owner.toLowerCase()}.github.io/${repo}/s/`
export const FILE = "rift-session.json"
export const GITHUB_API = "https://api.github.com"
const RAW = "https://gist.githubusercontent.com/"
const GIST_ID = "[0-9a-f]{20,40}"

// Gists truncate files over 1 MB in API responses; long tool outputs are the usual culprit.
const MAX_OUTPUT = 20_000

export type Snapshot = {
  format: "rift-share"
  version: 1
  session: Session
  messages: Array<{ info: Message; parts: Part[] }>
  diffs: SnapshotFileDiff[]
  models: Model[]
}

export function snapshot(input: Omit<Snapshot, "format" | "version">): Snapshot {
  return {
    format: "rift-share",
    version: 1,
    session: { ...input.session, directory: "", path: undefined, share: undefined },
    messages: input.messages.map((message) => ({
      info: message.info.role === "assistant" ? { ...message.info, path: { cwd: ".", root: "." } } : message.info,
      parts: message.parts.map(trim),
    })),
    diffs: input.diffs,
    models: input.models,
  }
}

export function url(gistID: string) {
  return `${VIEWER}#${gistID}`
}

/** The gist id from a RIFT share link, a gist.github.com link, or a bare id. */
export function parse(link: string): string | undefined {
  const bare = new RegExp(`^${GIST_ID}$`, "i")
  if (bare.test(link)) return link
  if (link.toLowerCase().startsWith(VIEWER.toLowerCase())) {
    const fragment = link.slice(link.indexOf("#") + 1)
    return link.includes("#") && bare.test(fragment) ? fragment : undefined
  }
  return link.match(new RegExp(`^https://gist\\.github\\.com/(?:[\\w-]+/)?(${GIST_ID})/?$`, "i"))?.[1]
}

/** The first RIFT share link in some text, such as a pull request description. */
export function find(text: string): string | undefined {
  const escaped = VIEWER.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
  return text.match(new RegExp(`${escaped}#${GIST_ID}`, "i"))?.[0]
}

/** Where the share file sits in a gist API response: inline, or at a raw URL when GitHub truncated it. */
export function fromGist(gist: unknown): { content: string } | { raw: string } | undefined {
  const entry = (gist as { files?: Record<string, { content?: string; truncated?: boolean; raw_url?: string }> })
    ?.files?.[FILE]
  if (!entry) return
  if (entry.truncated) return entry.raw_url?.startsWith(RAW) ? { raw: entry.raw_url } : undefined
  if (typeof entry.content === "string") return { content: entry.content }
}

/** A downloaded share, checked and back in the shape `rift import` writes to the database. */
export function toSession(value: unknown): { info: Session; messages: Snapshot["messages"] } | undefined {
  if (!value || typeof value !== "object") return
  const snap = value as Partial<Snapshot>
  if (snap.format !== "rift-share" || snap.version !== 1 || !snap.session || !Array.isArray(snap.messages)) return
  return { info: snap.session, messages: snap.messages }
}

function trim(part: Part): Part {
  if (part.type !== "tool" || part.state.status !== "completed") return part
  const output = part.state.output
  if (output.length <= MAX_OUTPUT) return part
  const cut = `${output.slice(0, MAX_OUTPUT)}\n… ${output.length - MAX_OUTPUT} more characters`
  return { ...part, state: { ...part.state, output: cut } }
}

export * as RiftShare from "./rift-share"

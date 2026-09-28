import type * as SDK from "@opencode-ai/sdk/v2"
import { GITHUB_REPO } from "@opencode-ai/core/brand"

// A shared session is one JSON file in a secret GitHub Gist. The viewer on GitHub Pages reads the
// gist id from the URL fragment, so the id never reaches the Pages server's logs.
const [owner, repo] = GITHUB_REPO.split("/")
export const VIEWER = `https://${owner.toLowerCase()}.github.io/${repo}/s/`
export const FILE = "rift-session.json"

// Gists truncate files over 1 MB in API responses; long tool outputs are the usual culprit.
const MAX_OUTPUT = 20_000

export type Snapshot = {
  format: "rift-share"
  version: 1
  session: SDK.Session
  messages: Array<{ info: SDK.Message; parts: SDK.Part[] }>
  diffs: SDK.SnapshotFileDiff[]
  models: SDK.Model[]
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
  const id = /^[0-9a-f]{20,40}$/i
  if (id.test(link)) return link
  if (link.startsWith(VIEWER)) {
    const fragment = link.slice(link.indexOf("#") + 1)
    return link.includes("#") && id.test(fragment) ? fragment : undefined
  }
  const gist = link.match(/^https:\/\/gist\.github\.com\/(?:[\w-]+\/)?([0-9a-f]{20,40})\/?$/i)
  return gist?.[1]
}

/** The first RIFT share link in some text, such as a pull request description. */
export function find(text: string): string | undefined {
  const escaped = VIEWER.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
  return text.match(new RegExp(`${escaped}#[0-9a-f]{20,40}`, "i"))?.[0]
}

/** The share file in a GitHub gist API response: its text, or the raw URL when GitHub truncated it. */
export function file(gist: unknown): { content: string } | { raw: string } | undefined {
  const entry = (gist as { files?: Record<string, { content?: string; truncated?: boolean; raw_url?: string }> })
    ?.files?.[FILE]
  if (!entry) return
  if (entry.truncated && entry.raw_url) return { raw: entry.raw_url }
  if (typeof entry.content === "string") return { content: entry.content }
}

/** A downloaded share, back in the shape `rift import` writes to the database. */
export function read(value: unknown): { info: SDK.Session; messages: Snapshot["messages"] } | undefined {
  if (!value || typeof value !== "object") return
  const snap = value as Partial<Snapshot>
  if (snap.format !== "rift-share" || snap.version !== 1 || !snap.session || !Array.isArray(snap.messages)) return
  return { info: snap.session, messages: snap.messages }
}

function trim(part: SDK.Part): SDK.Part {
  if (part.type !== "tool" || part.state.status !== "completed") return part
  const output = part.state.output
  if (output.length <= MAX_OUTPUT) return part
  const cut = `${output.slice(0, MAX_OUTPUT)}\n… ${output.length - MAX_OUTPUT} more characters`
  return { ...part, state: { ...part.state, output: cut } }
}

export * as RiftShare from "./rift-share"

import type { Message, Model, Part, Session, SnapshotFileDiff } from "@opencode-ai/sdk/v2"
import { GITHUB_REPO } from "@opencode-ai/core/brand"

/**
 * The privacy model a shared session relies on, in one place, so every caller upholds it:
 *
 * - A share is a secret Gist: unlisted (excluded from search, profiles and GitHub's own
 *   search), not encrypted, readable by anyone who has the id. The id is 128 bits of random
 *   hex from GitHub, not brute-forceable, so having the link is the only way in.
 * - The URL fragment (`#<id>`) carries the id. Browsers never send a fragment to a server, so
 *   it never reaches GitHub Pages' logs, any CDN in front of it, or a Referer header — that is
 *   the whole reason the id lives after `#` and not in the path or a query string.
 * - `snapshot()` below scrubs recognisable secrets and the home folder before anything leaves
 *   the machine, but it only catches what it recognises; the rest of the session is legible to
 *   whoever holds the link.
 * - The link itself is the only access control there is, so nothing in RIFT may hand it to
 *   someone the sharer didn't choose: no auto-posting it somewhere that notifies people (see
 *   `shouldShareSession` in `cli/cmd/github.shared.ts`), no server-side logging of it, no
 *   third-party script on the viewer page that could read the fragment and phone home.
 */
const [owner, repo] = GITHUB_REPO.split("/")
export const VIEWER = `https://${owner.toLowerCase()}.github.io/${repo}/s/`
export const FILE = "rift-session.json"
export const GITHUB_API = "https://api.github.com"
const RAW = "https://gist.githubusercontent.com/"
const GIST_ID = "[0-9a-f]{20,40}"

// Gists truncate files over 1 MB in API responses; long tool outputs are the usual culprit.
const MAX_OUTPUT = 20_000
// Tool inputs the viewer shows are short (a command, a path); a long one is file content.
const MAX_INPUT = 4_000

export type Snapshot = {
  format: "rift-share"
  version: 1
  session: Session
  messages: Array<{ info: Message; parts: Part[] }>
  diffs: SnapshotFileDiff[]
  models: Model[]
  /** Set while the full session is still uploading; the viewer waits and import refuses it. */
  pending?: true
}

// Share links are readable by anyone who has them, so recognisable secrets never leave the machine.
// Each pattern replaces only the secret itself, keeping enough context to read the output.
const SECRETS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted private key]"],
  [/\bsk-ant-[A-Za-z0-9_-]{16,}/g, "[redacted Anthropic key]"],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, "[redacted API key]"],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g, "[redacted GitHub token]"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[redacted AWS key]"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, "[redacted Slack token]"],
  [/\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g, "[redacted Stripe key]"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, "[redacted Google key]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[redacted token]"],
  // NAME=value where the name says it's secret, as in .env files and exports.
  [
    /(\b[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY|ACCESS_KEY)[A-Za-z0-9_]*["']?\s*[=:]\s*["']?)(?!\[redacted)[^\s"'`,;]{6,}/gi,
    "$1[redacted]",
  ],
  // The password in scheme://user:password@host.
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]{3,}(@)/gi, "$1[redacted]$2"],
]

export function scrub(text: string, home?: string) {
  const redacted = SECRETS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text)
  return home && home.length > 1 ? redacted.replaceAll(home, "~") : redacted
}

export function snapshot(input: Omit<Snapshot, "format" | "version">, options: { home?: string } = {}): Snapshot {
  return clean(
    {
      format: "rift-share",
      version: 1,
      session: { ...input.session, directory: "", path: undefined, share: undefined },
      messages: input.messages.map((message) => ({
        info: message.info.role === "assistant" ? { ...message.info, path: { cwd: ".", root: "." } } : message.info,
        parts: message.parts.map(trim),
      })),
      diffs: input.diffs,
      models: input.models,
    },
    options.home,
  )
}

/**
 * What the gist starts as. GitHub takes seconds to create a gist and longer the bigger it is, so
 * the link is made from this tiny version first and the full session follows as an update.
 */
export function placeholder(session: Session, options: { home?: string } = {}): Snapshot {
  return { ...snapshot({ session, messages: [], diffs: [], models: [] }, options), pending: true }
}

function clean<T>(value: T, home?: string): T {
  if (typeof value === "string") return scrub(value, home) as T
  if (Array.isArray(value)) return value.map((item) => clean(item, home)) as T
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item, home)])) as T
  }
  return value
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
  if (snap.pending) return
  return { info: snap.session, messages: snap.messages }
}

// A share is a readable record, not a backup. What a reader never sees stays on the machine:
// image attachments (base64 screenshots and frames, often hundreds of KB each), tool metadata
// other than the diff, and the full bodies of huge inputs and outputs. That keeps even a long
// session to a small upload, and keeps screenshots of someone's work out of the link.
function trim(part: Part): Part {
  if (part.type === "file") return part.url.startsWith("data:") ? { ...part, url: "" } : part
  if (part.type === "reasoning") return { ...part, text: cut(part.text) }
  if (part.type !== "tool") return part
  const state = part.state
  const input = Object.fromEntries(
    Object.entries(state.input ?? {}).map(([key, value]) => [key, typeof value === "string" ? cut(value, MAX_INPUT) : value]),
  )
  const diff = state.status !== "pending" && typeof state.metadata?.diff === "string" ? cut(state.metadata.diff) : undefined
  const metadata = diff === undefined ? {} : { diff }
  if (state.status === "completed") {
    const { attachments: _, ...rest } = state
    return { ...part, state: { ...rest, input, output: cut(state.output), metadata } }
  }
  if (state.status === "error") return { ...part, state: { ...state, input, error: cut(state.error), metadata } }
  if (state.status === "running") return { ...part, state: { ...state, input, metadata } }
  return { ...part, state: { ...state, input, raw: cut(state.raw, MAX_INPUT) } }
}

function cut(text: string, max = MAX_OUTPUT) {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n… ${text.length - max} more characters`
}

export * as RiftShare from "./rift-share"

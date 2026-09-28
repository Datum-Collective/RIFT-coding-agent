// Renders a RIFT share snapshot to an HTML string. Anyone can create a gist and send a viewer link,
// so every value from the snapshot is escaped before any markup is added around it, and the page
// says plainly who shared it.

// Direction overrides and zero-width characters can make shared text read differently than it is.
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g

export function escape(value) {
  return String(value ?? "")
    .replace(INVISIBLE, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

// RIFT's CGA pixel-art logo, and its R on its own for the avatar.
export const LOGO = `<img class="logo" src="../logo.png" alt="RIFT" width="536" height="184" />`
const AVATAR = `<img class="avatar" src="../logo-r.png" alt="" width="174" height="184" />`

const GLYPH = { passed: "✓", failed: "✗", timed_out: "✗", not_run: "○", queued: "●" }
const TOOL_GLYPH = { completed: "✓", error: "✗", running: "●", pending: "○" }
const HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO = "https://github.com/Datum-Collective/RIFT-coding-agent"

// Counts come from the gist too; coercing them to numbers keeps them from carrying markup.
const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
const stat = (d) => `<span class="add">+${count(d.additions)}</span> <span class="del">−${count(d.deletions)}</span>`

/**
 * @param snap the rift-share snapshot from the gist
 * @param meta what GitHub says about the gist, which the sharer can't forge: owner, gist URL, link
 */
export function render(snap, meta = {}) {
  const messages = snap.messages ?? []
  const diffs = snap.diffs ?? []
  const checks = messages.flatMap((m) =>
    m.parts.flatMap((p) => (Array.isArray(p.metadata?.rift_verification?.checks) ? p.metadata.rift_verification.checks : [])),
  )
  const title = escape(snap.session.title || "Untitled session")
  return `
${topbar(title, meta)}
<main class="thread">
  <section class="intro">
    <h1>${title}</h1>
    <div class="facts">${proof(checks)}${details(snap, messages, diffs)}</div>
    ${provenance(meta)}
  </section>
  <div class="messages">
${messages.map(turn).filter(Boolean).join("\n")}
  </div>
  ${diffs.length ? changes(diffs) : ""}
</main>
${footer()}`
}

function topbar(title, meta) {
  const copy = meta.link
    ? `<button class="button" type="button" data-copy="rift import ${escape(meta.link)}">Copy import command</button>`
    : ""
  return `<header class="top">
  <a class="brand" href="${REPO}">${LOGO}</a>
  <span class="crumb">${title}</span>
  <nav>${copy}<a class="button ghost" href="${REPO}">Get RIFT</a></nav>
</header>`
}

function details(snap, messages, diffs) {
  const modelID = messages.findLast((m) => m.info.role === "assistant")?.info.modelID
  const model = (snap.models ?? []).find((m) => m?.id === modelID)?.name ?? modelID
  const version = snap.session.version && snap.session.version !== "local" ? `rift v${snap.session.version}` : ""
  const total = {
    additions: diffs.reduce((sum, d) => sum + count(d.additions), 0),
    deletions: diffs.reduce((sum, d) => sum + count(d.deletions), 0),
  }
  const items = [
    model ? escape(model) : "",
    snap.session.time?.created ? escape(date(snap.session.time.created)) : "",
    escape(duration(snap.session.time)),
    diffs.length ? `${diffs.length} ${diffs.length === 1 ? "file" : "files"} ${stat(total)}` : "",
    version ? escape(version) : "",
  ].filter(Boolean)
  return items.length ? `<p class="meta">${items.map((item) => `<span>${item}</span>`).join("")}</p>` : ""
}

// A small status pill; the sentence behind it is a tooltip, not a banner.
function proof(checks) {
  if (!checks.length) {
    return `<span class="proof none" title="RIFT didn't run tests or type checks in this session.">○ No checks ran</span>`
  }
  const failed = checks.filter((c) => c.status === "failed" || c.status === "timed_out").length
  const tone = failed ? "fail" : "pass"
  const label = failed ? `${failed} of ${checks.length} checks failed` : `${checks.length} of ${checks.length} checks passed`
  return `<span class="proof ${tone}" title="RIFT ran these checks itself instead of taking the agent's word for it.">${failed ? "✗" : "✓"} ${label}</span>`
}

function provenance(meta) {
  const owner = HANDLE.test(meta.owner ?? "") ? meta.owner : undefined
  const gist = String(meta.gist ?? "").startsWith("https://gist.github.com/") ? meta.gist : undefined
  const who = owner
    ? `Shared by <a href="https://github.com/${owner}" rel="nofollow noopener noreferrer">@${owner}</a>`
    : "Shared from RIFT"
  const source = gist ? ` · <a href="${escape(gist)}" rel="nofollow noopener noreferrer">view the gist</a>` : ""
  return `<p class="provenance">${who}${source}. Written by the sharer and their agent; RIFT didn't write or review it.</p>`
}

function turn(m) {
  if (m.info.role === "user") {
    const body = m.parts.map(part).filter(Boolean).join("\n")
    return body ? `<div class="msg user"><div class="bubble">${body}</div></div>` : ""
  }
  const body = blocks(m.parts)
  if (!body) return ""
  const agent = m.info.agent ? `<span class="agent">${escape(m.info.agent)}</span>` : ""
  return `<div class="msg rift">${AVATAR}<div class="content"><div class="who">RIFT ${agent}</div>${body}</div></div>`
}

// A run of tool calls reads as one card of steps, the way the work actually happened.
function blocks(parts) {
  const out = []
  let steps = []
  const flush = () => {
    if (steps.length) out.push(`<div class="steps">${steps.join("")}</div>`)
    steps = []
  }
  for (const p of parts) {
    if (p.type === "tool") {
      steps.push(tool(p))
      continue
    }
    const html = part(p)
    if (!html) continue
    flush()
    out.push(html)
  }
  flush()
  return out.join("\n")
}

function part(p) {
  if (p.type === "text") {
    if (p.synthetic || p.ignored) return ""
    const text = p.text?.trim() ? `<div class="text">${markdown(p.text)}</div>` : ""
    const checks = p.metadata?.rift_verification?.checks
    return text + (Array.isArray(checks) && checks.length ? verification(checks) : "")
  }
  if (p.type === "reasoning" && p.text?.trim()) {
    return `<details class="thinking"><summary>Thought it through</summary><div class="text">${markdown(p.text)}</div></details>`
  }
  if (p.type === "file") return `<p class="note">Attached ${escape(p.filename ?? p.url)}</p>`
  if (p.type === "subtask") return `<p class="note">Handed to @${escape(p.agent)}: ${escape(p.description)}</p>`
  return ""
}

function tool(p) {
  const state = p.state ?? {}
  const input = state.input ?? {}
  const target = state.title || input.command || input.filePath || input.path || input.pattern || input.url || ""
  const glyph = TOOL_GLYPH[state.status] ?? "○"
  const tone = state.status === "error" ? "del" : state.status === "completed" ? "add" : "muted"
  const failed = state.status === "error" ? `<span class="del flag">failed</span>` : ""
  const diff = typeof state.metadata?.diff === "string" ? patch(state.metadata.diff) : ""
  const output = state.status === "error" ? state.error : state.output
  const body = diff || (output ? `<pre>${escape(output)}</pre>` : "")
  const summary = `<span class="${tone} status">${glyph}</span><span class="tool">${escape(p.tool)}</span><span class="target">${escape(target)}</span>${failed}`
  if (!body) return `<div class="call">${summary}</div>`
  return `<details class="call"><summary>${summary}</summary>${body}</details>`
}

function verification(checks) {
  const rows = checks
    .map((c) => {
      const glyph = GLYPH[c.status] ?? "○"
      const tone = c.status === "passed" ? "add" : c.status === "failed" || c.status === "timed_out" ? "del" : "muted"
      const reason = c.reason ? ` <span class="muted">· ${escape(c.reason)}</span>` : ""
      return `<li><span class="${tone}">${glyph}</span> <code>${escape(c.command)}</code>${reason}</li>`
    })
    .join("")
  return `<div class="verified"><div class="label">Checked by RIFT</div><ul>${rows}</ul></div>`
}

function changes(diffs) {
  const files = diffs
    .map((d) => {
      const head = `<span class="target">${escape(d.file)}</span><span class="stat">${stat(d)}</span>`
      return d.patch ? `<details class="call"><summary>${head}</summary>${patch(d.patch)}</details>` : `<div class="call">${head}</div>`
    })
    .join("\n")
  return `<section class="changes"><h2>Files changed</h2><div class="steps">${files}</div></section>`
}

function footer() {
  return `<footer>
  <a class="brand" href="${REPO}">${LOGO}</a>
  <p class="tagline">Agents that prove it.</p>
  <p class="muted">An open-source coding agent that runs the checks before it says done.</p>
  <a class="button" href="${REPO}">Get RIFT</a>
</footer>`
}

function patch(text) {
  const lines = String(text)
    .split("\n")
    .filter((line) => !/^(Index:|={5,}|\\ No newline)/.test(line))
    .map((line) => {
      if (/^(\+\+\+|---)/.test(line)) return `<span class="muted">${escape(line)}</span>`
      if (line.startsWith("@@")) return `<span class="hunk">${escape(line)}</span>`
      if (line.startsWith("+")) return `<span class="add">${escape(line)}</span>`
      if (line.startsWith("-")) return `<span class="del">${escape(line)}</span>`
      return escape(line)
    })
  return `<pre class="diff">${lines.join("\n")}</pre>`
}

function date(ms) {
  const d = new Date(Number(ms))
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

function duration(time) {
  const ms = (time?.updated ?? 0) - (time?.created ?? 0)
  if (!(ms > 0)) return ""
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return "under a minute"
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

// A small Markdown subset: fences, headings, lists, quotes, paragraphs, inline code, bold, italics
// and links. Text is escaped first; the only markup added is ours.
export function markdown(source) {
  const blocks = String(source ?? "").split(/^```[^\n]*\n([\s\S]*?)^```[ \t]*$/m)
  return blocks
    .map((block, i) => (i % 2 === 1 ? `<pre><code>${escape(block.replace(/\n$/, ""))}</code></pre>` : prose(block)))
    .join("")
}

function prose(text) {
  return text
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split("\n")
      const heading = chunk.match(/^(#{1,3})\s+(.*)$/)
      if (heading && lines.length === 1) return `<h${heading[1].length + 2}>${inline(heading[2])}</h${heading[1].length + 2}>`
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ""))}</li>`).join("")}</ul>`
      if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>`).join("")}</ol>`
      if (lines.every((l) => l.startsWith(">"))) return `<blockquote>${inline(lines.map((l) => l.replace(/^>\s?/, "")).join(" "))}</blockquote>`
      return `<p>${lines.map(inline).join("<br>")}</p>`
    })
    .join("")
}

function inline(text) {
  const parts = escape(text).split(/(`[^`]+`)/)
  return parts
    .map((piece, i) => {
      if (i % 2 === 1) return `<code>${piece.slice(1, -1)}</code>`
      return piece
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) => link(label, href))
    })
    .join("")
}

// Shared text can dress a link up as anything, so every link shows where it really goes.
function link(label, href) {
  if (!/^(https?:|mailto:)/i.test(href)) return label
  const host = /^https?:/i.test(href) ? URL.parse(href.replaceAll("&amp;", "&"))?.hostname : href.replace(/^mailto:/i, "")
  if (!host) return label
  const hint = label.includes(host) ? "" : ` <span class="host">${escape(host)}</span>`
  return `<a href="${href}" rel="nofollow noopener noreferrer ugc" target="_blank" title="${href}">${label}</a>${hint}`
}

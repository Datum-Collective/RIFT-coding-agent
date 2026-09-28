// Renders a RIFT share snapshot to an HTML string. Anyone can create a gist and send a viewer link,
// so every value from the snapshot is escaped before any markup is added around it.

export function escape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

const GLYPH = { passed: "✓", failed: "✗", timed_out: "✗", not_run: "○", queued: "●" }

// Counts come from the gist too; coercing them to numbers keeps them from carrying markup.
const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
const stat = (d) => `<span class="add">+${count(d.additions)}</span> <span class="del">−${count(d.deletions)}</span>`

export function render(snap) {
  const messages = snap.messages ?? []
  const model = messages.findLast((m) => m.info.role === "assistant")?.info.modelID
  const diffs = snap.diffs ?? []
  const total = {
    additions: diffs.reduce((sum, d) => sum + count(d.additions), 0),
    deletions: diffs.reduce((sum, d) => sum + count(d.deletions), 0),
  }
  const meta = [
    model ? escape(model) : "",
    escape(duration(snap.session.time)),
    diffs.length ? `${diffs.length} ${diffs.length === 1 ? "file" : "files"} ${stat(total)}` : "",
  ]
    .filter(Boolean)
    .join(" · ")

  return `
<header>
  <div class="brand"><span class="mark"></span>RIFT</div>
  <h1>${escape(snap.session.title || "Untitled session")}</h1>
  <p class="meta">${meta}</p>
</header>
<main>
${messages.map(message).join("\n")}
${diffs.length ? changes(diffs) : ""}
</main>
<footer>
  <p>Shared from <a href="https://github.com/Datum-Collective/RIFT-coding-agent">RIFT</a> · agents that prove it</p>
  <p class="muted">Continue it locally: <code>rift import ${escape(snap.link ?? "<this link>")}</code></p>
</footer>`
}

function message(m) {
  const who = m.info.role === "user" ? "you" : "rift"
  const detail = m.info.role === "assistant" && m.info.agent ? `<span class="muted">${escape(m.info.agent)}</span>` : ""
  const body = m.parts.map(part).filter(Boolean).join("\n")
  if (!body) return ""
  return `<section class="msg ${who}"><div class="who">${who} ${detail}</div>${body}</section>`
}

function part(p) {
  if (p.type === "text") {
    if (p.synthetic || p.ignored) return ""
    const text = p.text?.trim() ? `<div class="text">${markdown(p.text)}</div>` : ""
    const checks = p.metadata?.rift_verification?.checks
    return text + (Array.isArray(checks) && checks.length ? verification(checks) : "")
  }
  if (p.type === "reasoning" && p.text?.trim()) {
    return `<details class="thinking"><summary>thinking</summary><div class="text">${markdown(p.text)}</div></details>`
  }
  if (p.type === "tool") return tool(p)
  if (p.type === "file") return `<p class="muted">attached ${escape(p.filename ?? p.url)}</p>`
  if (p.type === "subtask") return `<p class="muted">handed to @${escape(p.agent)}: ${escape(p.description)}</p>`
  return ""
}

function tool(p) {
  const state = p.state ?? {}
  const input = state.input ?? {}
  const target = state.title || input.command || input.filePath || input.path || input.pattern || input.url || ""
  const status =
    state.status === "error" ? `<span class="del">failed</span>` : state.status === "completed" ? "" : `<span class="muted">${escape(state.status)}</span>`
  const diff = typeof state.metadata?.diff === "string" ? patch(state.metadata.diff) : ""
  const output = state.status === "error" ? state.error : state.output
  const body = diff || (output ? `<pre>${escape(output)}</pre>` : "")
  const summary = `<span class="tool">${escape(p.tool)}</span> <span class="target">${escape(target)}</span> ${status}`
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
  return `<div class="verified"><div class="label">checked by RIFT</div><ul>${rows}</ul></div>`
}

function changes(diffs) {
  const files = diffs
    .map((d) => {
      const head = `<span class="target">${escape(d.file)}</span> ${stat(d)}`
      return d.patch ? `<details class="call"><summary>${head}</summary>${patch(d.patch)}</details>` : `<div class="call">${head}</div>`
    })
    .join("\n")
  return `<section class="changes"><div class="who">changes</div>${files}</section>`
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
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) =>
          /^(https?:|mailto:)/i.test(href) ? `<a href="${href}" rel="noopener noreferrer">${label}</a>` : label,
        )
    })
    .join("")
}

import { escape, render } from "./render.js"

const FILE = "rift-session.json"
const root = document.getElementById("app")

function fail(title, detail) {
  document.title = `${title} · RIFT`
  root.innerHTML = `<div class="empty"><div class="brand"><span class="mark"></span>RIFT</div><h1>${escape(title)}</h1><p class="muted">${escape(detail)}</p></div>`
}

async function load() {
  const id = location.hash.slice(1)
  if (!/^[0-9a-f]{20,40}$/i.test(id)) {
    return fail("No session here", "A RIFT share link ends in # and a gist id. Check the link you were sent.")
  }

  const res = await fetch(`https://api.github.com/gists/${id}`, { headers: { accept: "application/vnd.github+json" } })
  if (res.status === 404) return fail("This share is gone", "It was unshared, or the link is wrong.")
  if (res.status === 403 || res.status === 429) {
    return fail("GitHub is rate-limiting this page", "Try again in a few minutes.")
  }
  if (!res.ok) return fail("Couldn't load this share", `GitHub answered HTTP ${res.status}.`)

  const file = (await res.json()).files?.[FILE]
  if (!file) return fail("Not a RIFT session", "That gist exists, but RIFT didn't make it.")

  // GitHub truncates large files in the API response; the full copy lives at the raw URL.
  if (file.truncated && !String(file.raw_url).startsWith("https://gist.githubusercontent.com/")) {
    return fail("Couldn't load this share", "GitHub didn't return the full session.")
  }
  const raw = file.truncated ? await fetch(file.raw_url) : undefined
  if (raw && !raw.ok) return fail("Couldn't load this share", `GitHub answered HTTP ${raw.status}.`)
  const snap = JSON.parse(raw ? await raw.text() : file.content)
  if (snap.format !== "rift-share" || snap.version !== 1) {
    return fail("Not a RIFT session", "That gist exists, but RIFT didn't make it.")
  }

  document.title = `${snap.session.title || "Session"} · RIFT`
  root.innerHTML = render({ ...snap, link: location.href })
}

load().catch(() => fail("Couldn't load this share", "Check your connection and reload."))
window.addEventListener("hashchange", () => load().catch(() => fail("Couldn't load this share", "Reload the page.")))

import { escape, render } from "./render.js"

const FILE = "rift-session.json"
const MAX_BYTES = 8_000_000
const root = document.getElementById("app")

// Browsers with Trusted Types only allow HTML through this one policy, so nothing else on the
// page can write markup. Everything it receives has already been escaped by render.js.
const policy = window.trustedTypes?.createPolicy("rift-share", { createHTML: (html) => html })
const show = (html) => {
  root.innerHTML = policy ? policy.createHTML(html) : html
}

function fail(title, detail) {
  document.title = `${title} · RIFT`
  show(
    `<div class="empty"><a class="wordmark" href="https://github.com/Datum-Collective/RIFT-coding-agent"><span class="mark"></span>RIFT</a><h1>${escape(title)}</h1><p class="muted">${escape(detail)}</p></div>`,
  )
}

async function load() {
  // GitHub Pages can't send frame-ancestors, so refuse to draw inside someone else's frame.
  if (window.top !== window.self) {
    return fail("Open this share directly", "It can't be shown inside another page.")
  }

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

  const gist = await res.json()
  const file = gist.files?.[FILE]
  if (!file) return fail("Not a RIFT session", "That gist exists, but RIFT didn't make it.")
  if (file.size > MAX_BYTES) return fail("This share is too large to show", "Import it with rift instead.")

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
  show(render(snap, { owner: gist.owner?.login, gist: gist.html_url, link: location.href }))
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest?.("[data-copy]")
  if (!button) return
  await navigator.clipboard.writeText(button.dataset.copy)
  button.textContent = "Copied"
  setTimeout(() => (button.textContent = "Copy import command"), 1600)
})

load().catch(() => fail("Couldn't load this share", "Check your connection and reload."))
window.addEventListener("hashchange", () => load().catch(() => fail("Couldn't load this share", "Reload the page.")))

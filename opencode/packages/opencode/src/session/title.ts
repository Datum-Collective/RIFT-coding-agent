const MAX_LENGTH = 60

/**
 * A title made from what the user typed, for when the model could not name the session: it errored,
 * was rate limited, returned nothing, or no small model is configured. Any real title beats
 * "New session - 2026-09-20T17:05:53.903Z" in the session list, and a person recognises their own
 * words.
 */
export function fallbackTitle(text: string) {
  const line = text
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0)
  if (!line) return undefined

  // A leading slash command or file reference says little about the task; keep the words after it.
  const words = line
    .replace(/^\/\S+\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!words) return undefined

  if (words.length <= MAX_LENGTH) return words.charAt(0).toUpperCase() + words.slice(1)
  // Cut at a word boundary so the title does not end mid-word.
  const cut = words.slice(0, MAX_LENGTH - 1)
  const boundary = cut.lastIndexOf(" ")
  const head = boundary > MAX_LENGTH / 2 ? cut.slice(0, boundary) : cut
  return head.charAt(0).toUpperCase() + head.slice(1) + "…"
}

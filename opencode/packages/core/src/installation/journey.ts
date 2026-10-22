/**
 * An update is a journey. While it installs, the marker walks from the Shire towards Mount Doom,
 * and when the install finishes it makes the last stretch and arrives. Each release gets a line
 * from the books to leave with, picked from its version so it is the same every time for the same
 * release and different from the next one.
 *
 * Only a real terminal gets the animation: piped output, CI, `TERM=dumb` and `RIFT_NO_ANIMATION`
 * all fall back to plain output, so scripts that run `rift upgrade` see what they always did.
 */

export const MARKER = "◆"
const DONE = "━"
const AHEAD = "─"

export const HIDE_CURSOR = "\x1b[?25l"
export const SHOW_CURSOR = "\x1b[?25h"
export const CLEAR_LINE = "\r\x1b[2K"

/** Places on the way, in order. The last is only shown on arrival, never while the install runs. */
export const STOPS = ["The Shire", "Bree", "Rivendell", "Moria", "Lothlorien", "Rauros", "Mount Doom"] as const

/** How far the marker may walk before the install has actually finished. */
const CAP = 0.9

const QUOTES = [
  "The road goes ever on and on.",
  "A wizard is never late, nor is he early. He arrives precisely when he means to.",
  "All we have to decide is what to do with the time that is given us.",
  "Not all those who wander are lost.",
  "It's a dangerous business, going out your door.",
  "Even the smallest person can change the course of the future.",
  "Short cuts make long delays.",
  "There and back again.",
  "One does not simply walk into Mordor.",
  "Home is behind, the world ahead.",
] as const

const clamp = (progress: number) => Math.min(1, Math.max(0, progress))

/** A line with the marker at `progress` (0 to 1): travelled ground solid, the rest thin. */
export function track(progress: number, width = 32) {
  const at = Math.round(clamp(progress) * (width - 1))
  return Array.from({ length: width }, (_, index) => (index < at ? DONE : index === at ? MARKER : AHEAD)).join("")
}

/** The place the marker is at. Mount Doom is reserved for arriving. */
export function stopAt(progress: number) {
  const last = STOPS.length - 1
  const value = clamp(progress)
  if (value >= 1) return STOPS[last]
  return STOPS[Math.min(last - 1, Math.floor(value * last))]
}

/** A line from the books for this release. */
export function quote(version: string) {
  const hash = [...version].reduce((total, char) => (total * 31 + char.charCodeAt(0)) >>> 0, 7)
  return QUOTES[hash % QUOTES.length]
}

/** Whether to animate: a real terminal, not CI, not a dumb terminal, and the user hasn't opted out. */
export function interactive(stream: { isTTY?: boolean }, env: Record<string, string | undefined>) {
  return Boolean(stream.isTTY) && !env["CI"] && env["TERM"] !== "dumb" && !env["RIFT_NO_ANIMATION"]
}

export type IO = {
  write: (text: string) => void
  interactive: boolean
  /** Milliseconds between frames. */
  interval?: number
  sleep?: (ms: number) => Promise<void>
}

const frame = (progress: number) => `  ${track(progress)}  ${stopAt(progress)}`

/**
 * Plays the journey while `task` runs. Resolves true when the task succeeded and false when it
 * failed, never throwing, so the caller reads the error from the task itself. A failed task shows
 * no arrival.
 */
export async function play(task: Promise<unknown>, io: IO) {
  const outcome = task.then(
    () => true,
    () => false,
  )
  if (!io.interactive) return outcome

  const sleep = io.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const interval = io.interval ?? 80
  let result: boolean | undefined
  void outcome.then((ok) => {
    result = ok
  })

  let progress = 0
  io.write(HIDE_CURSOR)
  while (result === undefined) {
    io.write(CLEAR_LINE + frame(progress))
    progress += (CAP - progress) * 0.08
    await sleep(interval)
  }
  if (!result) {
    io.write(CLEAR_LINE + SHOW_CURSOR)
    return false
  }
  while (progress < 1) {
    progress = Math.min(1, progress + Math.max(0.05, (1 - progress) * 0.25))
    io.write(CLEAR_LINE + frame(progress))
    await sleep(interval / 2)
  }
  io.write("\n" + SHOW_CURSOR)
  return true
}

export * as Journey from "./journey"

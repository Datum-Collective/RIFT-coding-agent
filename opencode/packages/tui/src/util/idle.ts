/**
 * Notices when the user has stopped doing anything.
 *
 * `poke()` is called for every key and mouse event, and a mouse can send hundreds a second, so it
 * only records the time. One timer is armed at a time, and when it fires it checks how long it
 * has really been quiet and re-arms for the rest if input came in meanwhile. That keeps the cost
 * of an event at one assignment instead of a cancelled and a new timer.
 */

export type Clock = {
  now: () => number
  setTimeout: (run: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export type Idle = {
  /** The user did something. */
  poke: () => void
  /** Stop watching. Nothing fires afterwards. */
  dispose: () => void
  /** True between `onIdle` and the next `poke`. */
  isIdle: () => boolean
}

export function createIdle(input: { delay: number; onIdle: () => void; onWake: () => void; clock?: Clock }): Idle {
  const clock = input.clock ?? realClock
  let last = clock.now()
  let idle = false
  let disposed = false
  let handle: unknown

  const arm = (ms: number) => {
    handle = clock.setTimeout(check, ms)
  }

  const check = () => {
    handle = undefined
    if (disposed) return
    const quiet = clock.now() - last
    if (quiet < input.delay) return arm(input.delay - quiet)
    idle = true
    input.onIdle()
  }

  arm(input.delay)

  return {
    poke() {
      if (disposed) return
      last = clock.now()
      if (!idle) return
      idle = false
      arm(input.delay)
      input.onWake()
    },
    dispose() {
      disposed = true
      if (handle !== undefined) clock.clearTimeout(handle)
      handle = undefined
    },
    isIdle: () => idle,
  }
}

/**
 * The raw input stream also carries the terminal's own replies to questions RIFT asked it and its
 * focus reports. None of those are the user, and counting them would keep a quiet terminal from
 * ever going idle.
 */
const FROM_TERMINAL = [
  /^\x1b\[[IO]$/, // focus in, focus out
  /^\x1b\[\d+;\d+R$/, // cursor position
  /^\x1b\[\?[\d;]*\$y$/, // mode report
  /^\x1b\[\?[\d;]*c$/, // device attributes
  /^\x1b\][\s\S]*(\x07|\x1b\\)$/, // colour and other OSC replies
  /^\x1bP[\s\S]*\x1b\\$/, // DCS replies
  /^\x1b_G[\s\S]*\x1b\\$/, // kitty graphics replies
  /^\x1b\[\?\d+(;\d+)?u$/, // kitty keyboard protocol flags
  /^\x1b\[\?997;[12]n$/, // light or dark mode, sent when the OS switches
]

export function isUserInput(sequence: string) {
  return !FROM_TERMINAL.some((pattern) => pattern.test(sequence))
}

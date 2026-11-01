import { stringWidth } from "../../util/string-width"

const short = (value: number) => {
  const scaled = (amount: number, unit: string) => `${Number((value / amount).toFixed(1))}${unit}`
  // 999,950 would otherwise round to 1000K.
  if (value >= 999_950) return scaled(1_000_000, "M")
  if (value >= 1_000) return scaled(1_000, "K")
  return String(value)
}

/** Context used against the model's window, as the header shows it. */
export const tokenBudget = (tokens: number, limit: number | undefined) =>
  limit ? `${short(tokens)} / ${short(limit)}` : short(tokens)

export interface Shortcut {
  readonly key: string
  readonly label: string
}

const SEPARATOR = 3

/** The shortcuts that fit in `width`, leaving out the later ones rather than cutting one in half. */
export const fitShortcuts = (shortcuts: readonly Shortcut[], width: number) => {
  const fitted: Shortcut[] = []
  let used = 0
  for (const shortcut of shortcuts) {
    const size = stringWidth(`${shortcut.key}:${shortcut.label}`) + (fitted.length > 0 ? SEPARATOR : 0)
    if (used + size > width) break
    fitted.push(shortcut)
    used += size
  }
  return fitted
}

/** What sits in the prompt's border: the model, its effort, the agent, and whether approvals are off. */
export const promptTitle = (input: {
  model?: string
  variant?: string
  agent: string
  auto?: boolean
  limit?: string
  /** A shell command uses no model, so nothing about one applies. */
  shell?: boolean
}) => {
  if (input.shell) return input.agent
  return [
    input.model && (input.variant ? `${input.model} (${input.variant})` : input.model),
    input.agent,
    input.auto ? "auto" : undefined,
    input.limit,
  ]
    .filter(Boolean)
    .join(" · ")
}

const TITLE_PADDING = 2
const BORDER_ROOM = 4

/**
 * The renderer draws no title at all when it does not fit, which would hide the model and mode, so it is cut to fit.
 * Returns undefined when there is nothing to show or no room to show it.
 */
export const fitTitle = (title: string, width: number) => {
  const room = width - BORDER_ROOM
  if (!title || room < TITLE_PADDING + 1) return undefined
  if (stringWidth(title) <= room) return ` ${title} `
  let cut = ""
  for (const character of title) {
    if (stringWidth(`${cut}${character}…`) > room) break
    cut += character
  }
  return ` ${cut.trimEnd()}… `
}

/**
 * Visual primitives for the RIFT control plane.
 *
 * The look is a systems monitor, not a chat: a fixed status gutter on the left so glyphs stack
 * into one scannable column, rules instead of boxes, and metrics flushed right.
 */
import { Show, type JSX } from "solid-js"
import { useTheme } from "../../context/theme"
import type { Signal } from "../../util/task"

export const GLYPH: Record<Signal, string> = {
  done: "✓",
  active: "●",
  pending: "○",
  failed: "✗",
  warn: "⚠",
}

type ThemeColors = ReturnType<typeof useTheme>["theme"]

export function signalColor(theme: ThemeColors, signal: Signal) {
  switch (signal) {
    case "done":
      return theme.success
    case "active":
      return theme.accent
    case "failed":
      return theme.error
    case "warn":
      return theme.warning
    default:
      return theme.textMuted
  }
}

/** `LABEL ─────────────` — the section marker the whole UI is built from. */
export function Rule(props: { label: string; width: number; accent?: boolean }) {
  const { theme } = useTheme()
  const fill = () => Math.max(0, props.width - props.label.length - 3)
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <text fg={props.accent ? theme.accent : theme.textMuted}>
        <b>{props.label}</b>
      </text>
      <text fg={theme.borderSubtle}>{"─".repeat(fill())}</text>
    </box>
  )
}

/**
 * One line in the control plane: glyph gutter, label, then an optional right-flushed metric.
 * Everything in the UI uses this so the columns line up across sections.
 */
export function Row(props: {
  signal: Signal
  children: JSX.Element
  right?: JSX.Element
  dim?: boolean
  indent?: number
}) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" flexShrink={0} paddingLeft={props.indent ?? 0}>
      <text fg={signalColor(theme, props.signal)}>{GLYPH[props.signal]} </text>
      <box flexGrow={1} flexShrink={1} overflow="hidden">
        {props.children}
      </box>
      <Show when={props.right}>
        <box paddingLeft={2} flexShrink={0}>
          {props.right}
        </box>
      </Show>
    </box>
  )
}

/** Compact "key value" pair used in the task header. */
export function Meta(props: { children: JSX.Element }) {
  const { theme } = useTheme()
  return <text fg={theme.textMuted}>{props.children}</text>
}

export function formatDuration(ms: number) {
  if (ms <= 0) return ""
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m${seconds.toString().padStart(2, "0")}s`
}

/** Shortens a path from the left so the filename always survives a narrow terminal. */
export function shortenPath(file: string, max: number) {
  if (file.length <= max) return file
  const parts = file.split("/")
  const name = parts[parts.length - 1] ?? file
  // Not even "…/name" fits: clip the name itself from the left.
  if (name.length + 2 > max) return `…${name.slice(Math.max(0, name.length - (max - 1)))}`
  let out = name
  for (let index = parts.length - 2; index >= 0; index--) {
    const next = `${parts[index]}/${out}`
    if (next.length + 2 > max) break
    out = next
  }
  return `…/${out}`
}

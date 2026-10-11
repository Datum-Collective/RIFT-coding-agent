/**
 * Visual primitives for the RIFT control plane.
 *
 * The look is a systems monitor, not a chat: a fixed status gutter on the left so glyphs stack
 * into one scannable column, rules instead of boxes, and metrics flushed right.
 */
import { Show, type JSX } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import type { Signal } from "../../util/task"

export const GLYPH: Record<Signal, string> = {
  done: "✓",
  active: "▸",
  pending: "·",
  failed: "✕",
  warn: "!",
}

type ThemeColors = ReturnType<typeof useTheme>["theme"]

export function signalColor(theme: ThemeColors, signal: Signal) {
  switch (signal) {
    case "done":
      return theme.success
    case "active":
      return theme.primary
    case "failed":
      return theme.error
    case "warn":
      return theme.warning
    default:
      return theme.border
  }
}

/** `Label ─────────` — a section marker: a bold word, then a faint rule to the edge. */
export function Rule(props: { label: string; width: number; accent?: boolean }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <text flexShrink={0} wrapMode="none" fg={props.accent ? theme.primary : theme.text} attributes={TextAttributes.BOLD}>
        {props.label.charAt(0).toUpperCase() + props.label.slice(1).toLowerCase()}
      </text>
      <text flexGrow={1} flexShrink={1} wrapMode="none" overflow="hidden" fg={theme.borderSubtle}>
        {"─".repeat(Math.max(0, props.width))}
      </text>
    </box>
  )
}

/** A section heading in the side panel: a bold title with a quiet count on the right. */
export function Label(props: { children: string; count?: string }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
      <text fg={theme.text}>
        <b>{props.children.charAt(0).toUpperCase() + props.children.slice(1)}</b>
      </text>
      <Show when={props.count}>
        <text fg={theme.textMuted}>{props.count}</text>
      </Show>
    </box>
  )
}

/** A thin progress bar: filled in the accent (or a status colour), the rest in the faint ink. */
export function Bar(props: { value: number; width: number; color?: ReturnType<typeof useTheme>["theme"]["primary"] }) {
  const { theme } = useTheme()
  const filled = () => Math.round(Math.max(0, Math.min(1, props.value)) * props.width)
  return (
    <text wrapMode="none" flexShrink={0}>
      <span style={{ fg: props.color ?? theme.primary }}>{"━".repeat(filled())}</span>
      <span style={{ fg: theme.borderSubtle }}>{"━".repeat(Math.max(0, props.width - filled()))}</span>
    </text>
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
      <text width={2} flexShrink={0} fg={signalColor(theme, props.signal)}>
        {GLYPH[props.signal]}
      </text>
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

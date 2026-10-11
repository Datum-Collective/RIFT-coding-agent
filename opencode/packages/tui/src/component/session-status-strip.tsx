import { For, Show, createMemo } from "solid-js"
import type { Message, Part, Session, SessionStatus } from "@opencode-ai/sdk/v2"
import { useRoute } from "../context/route"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { isDefaultTitle } from "../util/session"

export type SessionStripStatus = "idle" | "thinking" | "tool_running" | "blocked_waiting_for_input"

export type SessionStatusStripData = {
  session_status: Record<string, SessionStatus>
  permission: Record<string, readonly unknown[]>
  question: Record<string, readonly unknown[]>
  message: Record<string, readonly Pick<Message, "id">[]>
  part: Record<string, readonly Part[]>
}

export function getSessionStripStatus(data: SessionStatusStripData, sessionID: string): SessionStripStatus {
  if ((data.permission[sessionID]?.length ?? 0) > 0 || (data.question[sessionID]?.length ?? 0) > 0) {
    return "blocked_waiting_for_input"
  }

  const hasRunningTool = (data.message[sessionID] ?? []).some((message) =>
    (data.part[message.id] ?? []).some((part) => part.type === "tool" && part.state.status === "running"),
  )
  if (hasRunningTool) return "tool_running"

  const status = data.session_status[sessionID]
  if (status?.type === "busy" || status?.type === "retry") return "thinking"
  return "idle"
}

export type SessionStripItem = {
  id: string
  label: string
  status: SessionStripStatus
  current: boolean
}

function sessionLabel(session: Session | undefined, sessionID: string) {
  if (session && !isDefaultTitle(session.title)) return session.title
  return sessionID.slice(-8)
}

export function getSessionStripItems(
  data: SessionStatusStripData,
  sessions: Session[],
  currentSessionID: string | undefined,
): SessionStripItem[] {
  const ids = new Set<string>()
  if (currentSessionID) ids.add(currentSessionID)

  for (const sessionID of Object.keys(data.session_status)) ids.add(sessionID)
  for (const [sessionID, requests] of Object.entries(data.permission)) {
    if (requests.length > 0) ids.add(sessionID)
  }
  for (const [sessionID, requests] of Object.entries(data.question)) {
    if (requests.length > 0) ids.add(sessionID)
  }

  return [...ids]
    .map((sessionID) => ({
      id: sessionID,
      label: sessionLabel(sessions.find((session) => session.id === sessionID), sessionID),
      status: getSessionStripStatus(data, sessionID),
      current: sessionID === currentSessionID,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || a.label.localeCompare(b.label))
}

const statusGlyph = {
  idle: "·",
  thinking: "▸",
  tool_running: "▸",
  blocked_waiting_for_input: "?",
} as const

/** With more than one live session: one quiet line naming each, with what it is doing. */
export function SessionStatusStrip() {
  const sync = useSync()
  const route = useRoute()
  const { theme } = useTheme()

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const sessions = createMemo(() => getSessionStripItems(sync.data, sync.data.session, currentSessionID()))
  const color = (status: SessionStripStatus) =>
    status === "blocked_waiting_for_input" ? theme.warning : status === "idle" ? theme.border : theme.primary

  return (
    <Show when={sessions().length > 1}>
      <box height={1} flexShrink={0} flexDirection="row" gap={3} paddingLeft={1} paddingRight={1} overflow="hidden">
        <For each={sessions()}>
          {(session) => (
            <text fg={session.current ? theme.text : theme.textMuted} wrapMode="none" flexShrink={0}>
              <span style={{ fg: color(session.status) }}>{statusGlyph[session.status]} </span>
              {session.current ? <b>{session.label}</b> : session.label}
            </text>
          )}
        </For>
      </box>
    </Show>
  )
}

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

const statusColor = {
  idle: "textMuted",
  thinking: "accent",
  tool_running: "warning",
  blocked_waiting_for_input: "error",
} as const

const statusLabel = {
  idle: "idle",
  thinking: "thinking",
  tool_running: "tool_running",
  blocked_waiting_for_input: "blocked_waiting_for_input",
} as const

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

export function SessionStatusStrip() {
  const sync = useSync()
  const route = useRoute()
  const { theme } = useTheme()

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const sessions = createMemo(() => getSessionStripItems(sync.data, sync.data.session, currentSessionID()))

  return (
    <Show when={sessions().length > 1}>
      <box
        height={1}
        flexShrink={0}
        flexDirection="row"
        gap={1}
        paddingLeft={1}
        paddingRight={1}
        border={["bottom"]}
        borderColor={theme.borderSubtle}
      >
        <text fg={theme.textMuted}>sessions:</text>
        <For each={sessions()}>
          {(session, index) => (
            <>
              <Show when={index() > 0}>
                <text fg={theme.textMuted}>|</text>
              </Show>
              <text fg={theme[statusColor[session.status]]} wrapMode="none">
                {session.current ? "*" : " "} {session.label} [{statusLabel[session.status]}]
              </text>
            </>
          )}
        </For>
      </box>
    </Show>
  )
}

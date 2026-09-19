/**
 * Mission Control: every session on one board, ordered so whatever needs a human is on top.
 *
 * Built on the shared DialogSelect so filtering, keyboard navigation and actions behave exactly
 * like every other picker in the app.
 */
import { createMemo, onMount } from "solid-js"
import { DialogSelect } from "../../ui/dialog-select"
import { useDialog } from "../../ui/dialog"
import { useRoute } from "../../context/route"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { task as deriveTask } from "../../util/task"
import { MISSION_LABEL, missionCounts, missionRow, orderRows, type MissionRow } from "../../util/mission"
import { GLYPH, signalColor } from "./primitives"
import { taskInput } from "./use-task"

/**
 * Presentation only. Note that DialogSelect renders `titleView` and `footer` inside a <text>,
 * so everything here must be a string or a span — a box throws at runtime.
 */
export function MissionBoard(props: { rows: readonly MissionRow[]; onOpen: (row: MissionRow) => void }) {
  const { theme } = useTheme()
  const counts = createMemo(() => missionCounts(props.rows))

  return (
    <DialogSelect
      title="Mission Control"
      flat
      emptyView={<text fg={theme.textMuted}>No sessions yet.</text>}
      current={props.rows.find((row) => row.current)?.sessionID}
      footer={
        <box flexDirection="row" gap={2}>
          <text fg={counts().blocked > 0 ? theme.warning : theme.textMuted}>{counts().blocked} need you</text>
          <text fg={counts().failed > 0 ? theme.error : theme.textMuted}>{counts().failed} failed</text>
          <text fg={counts().running > 0 ? theme.accent : theme.textMuted}>{counts().running} running</text>
          <text fg={theme.textMuted}>{counts().total} total</text>
        </box>
      }
      options={props.rows.map((row) => ({
        value: row.sessionID,
        title: row.title,
        // Filtering matches what the row shows, so typing "failed" finds failed sessions.
        description: `${MISSION_LABEL[row.state]} ${row.summary}`,
        gutter: () => <text fg={signalColor(theme, row.signal)}>{GLYPH[row.signal]}</text>,
        titleView: (
          <>
            <span style={{ fg: row.current ? theme.accent : theme.text }}>{row.title}</span>
            <span style={{ fg: signalColor(theme, row.signal) }}> · {MISSION_LABEL[row.state]}</span>
          </>
        ),
        footer: row.summary,
      }))}
      onSelect={(option) => {
        const row = props.rows.find((item) => item.sessionID === option.value)
        if (row) props.onOpen(row)
      }}
    />
  )
}

/** How many sessions the board pulls detail for when it opens. */
const SYNC_LIMIT = 25

export function MissionControl() {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()

  const sessions = createMemo(() => sync.data.session.filter((session) => !session.parentID))

  // Messages, diffs and todos load per session. Without this the board would report every
  // session the user has not opened this run as idle with nothing to show.
  onMount(() => {
    for (const session of sessions().slice(0, SYNC_LIMIT)) void sync.session.sync(session.id)
  })

  const rows = createMemo(() => {
    const current = route.data.type === "session" ? route.data.sessionID : undefined
    return orderRows(
      sessions().map((session) =>
        missionRow({
          sessionID: session.id,
          current: session.id === current,
          task: deriveTask(taskInput(sync, session.id)),
          loaded: (sync.data.message[session.id]?.length ?? 0) > 0,
        }),
      ),
    )
  })

  return (
    <MissionBoard
      rows={rows()}
      onOpen={(row) => {
        route.navigate({ type: "session", sessionID: row.sessionID })
        dialog.clear()
      }}
    />
  )
}

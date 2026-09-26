/**
 * /replay: every edit RIFT made in this codebase on a GitHub-style grid. Pick a day, pick a
 * turn, and travel the codebase back to before it. Travel is the existing session revert, so
 * /redo brings everything back.
 */
import { RGBA } from "@opentui/core"
import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { useDialog } from "../../ui/dialog"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { DialogSelect } from "../../ui/dialog-select"
import { useRoute } from "../../context/route"
import { useSDK } from "../../context/sdk"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { useBindings } from "../../keymap"
import { activity, dayKey, monthLabels, replay, type Day, type ReplayPart, type ReplayTurn } from "../../util/replay"

export type TurnRow = {
  sessionID: string
  session: string
  turn: ReplayTurn
  files: number
  tests: { passed: number; failed: number }
  repairs: number
}

const WEEKS = 26
const LABELS = ["   ", "Mon", "   ", "Wed", "   ", "Fri", "   "]
const MAX_ROWS = 8

/** Presentation only, so it can be rendered and tested without a server. */
export function ReplayBoard(props: {
  weeks: Day[][]
  selected: string
  rows: readonly TurnRow[]
  cursor: number
  totals: { edits: number; sessions: number }
  loading: boolean
}) {
  const { theme } = useTheme()

  function shade(level: Day["level"]) {
    if (level === 0) return theme.borderSubtle
    const t = [0, 0.35, 0.55, 0.78, 1][level]
    const bg = theme.backgroundPanel
    const fg = theme.success
    return RGBA.fromValues(bg.r + (fg.r - bg.r) * t, bg.g + (fg.g - bg.g) * t, bg.b + (fg.b - bg.b) * t, 1)
  }

  const months = createMemo(() => monthLabels(props.weeks))
  const selectedDay = createMemo(() => props.weeks.flat().find((day) => day.date === props.selected))
  const visible = createMemo(() => {
    const start = Math.max(0, Math.min(props.cursor - MAX_ROWS + 1, props.rows.length - MAX_ROWS))
    return props.rows.slice(start, start + MAX_ROWS).map((row, index) => ({ row, index: start + index }))
  })

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text}>
          <b>Replay</b>
        </text>
        <text fg={theme.textMuted}>
          {props.loading ? "loading history… · " : ""}
          {props.totals.edits} file edits · {props.totals.sessions} sessions
        </text>
      </box>

      <box flexDirection="column">
        <text fg={theme.textMuted}>
          {"    "}
          {months()}
        </text>
        <For each={LABELS}>
          {(label, weekday) => (
            <text>
              <span style={{ fg: theme.textMuted }}>{label} </span>
              <For each={props.weeks}>
                {(week) => {
                  const day = week[weekday()]
                  const selected = day.date === props.selected
                  return (
                    <span style={{ fg: selected ? theme.accent : shade(day.level) }}>
                      {selected ? "◆" : day.level === 0 ? "·" : "■"}{" "}
                    </span>
                  )
                }}
              </For>
            </text>
          )}
        </For>
        <text>
          <span style={{ fg: theme.textMuted }}>{"    less "}</span>
          <For each={[0, 1, 2, 3, 4] as const}>
            {(level) => <span style={{ fg: shade(level) }}>{level === 0 ? "· " : "■ "}</span>}
          </For>
          <span style={{ fg: theme.textMuted }}>more</span>
        </text>
      </box>

      <box flexDirection="column">
        <text fg={theme.text}>
          <b>{formatDate(props.selected)}</b>
          <span style={{ fg: theme.textMuted }}>
            {" "}
            · {selectedDay()?.edits ?? 0} file edits · {props.rows.length} {props.rows.length === 1 ? "turn" : "turns"}
          </span>
        </text>
        <Show
          when={props.rows.length > 0}
          fallback={<text fg={theme.textMuted}>Nothing RIFT did on this day. ←/→ to move between days.</text>}
        >
          <For each={visible()}>
            {(item) => {
              const active = () => item.index === props.cursor
              return (
                <box flexDirection="row" backgroundColor={active() ? theme.backgroundElement : undefined}>
                  <text fg={active() ? theme.accent : theme.textMuted}>{active() ? "› " : "  "}</text>
                  <text fg={theme.textMuted}>{clock(item.row.turn.time)} </text>
                  <box flexGrow={1} flexShrink={1} overflow="hidden">
                    <text fg={theme.text} wrapMode="none">
                      {item.row.turn.prompt}
                      <span style={{ fg: theme.textMuted }}> · {item.row.session}</span>
                    </text>
                  </box>
                  <text fg={theme.textMuted} flexShrink={0}>
                    {" "}
                    {item.row.files} {item.row.files === 1 ? "file" : "files"}
                    <Show when={item.row.tests.passed + item.row.tests.failed > 0}>
                      <span style={{ fg: item.row.tests.failed > 0 ? theme.error : theme.success }}>
                        {" "}
                        {item.row.tests.failed > 0 ? `✗ ${item.row.tests.failed}` : `✓ ${item.row.tests.passed}`}
                      </span>
                    </Show>
                    <Show when={item.row.repairs > 0}>
                      <span style={{ fg: theme.success }}> ↺ {item.row.repairs}</span>
                    </Show>
                  </text>
                </box>
              )
            }}
          </For>
        </Show>
      </box>

      <text fg={theme.textMuted}>←/→ day · shift+←/→ week · ↑/↓ turn · enter to open or travel back · esc</text>
    </box>
  )
}

/** How many sessions the grid pulls history for when it opens. */
const SYNC_LIMIT = 60

export function ReplayDialog() {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const route = useRoute()

  const sessions = createMemo(() => sync.data.session.toSorted((a, b) => b.time.updated - a.time.updated))
  const [loading, setLoading] = createSignal(true)

  onMount(() => {
    dialog.setSize("large")
    void Promise.allSettled(
      sessions()
        .slice(0, SYNC_LIMIT)
        .map((session) => sync.session.sync(session.id)),
    ).then(() => setLoading(false))
  })

  const replays = createMemo(() =>
    sessions().map((session) => ({
      session,
      result: replay({
        messages: (sync.data.message[session.id] ?? []).map((message) => ({
          id: message.id,
          role: message.role,
          agent: "agent" in message ? message.agent : undefined,
          time: { created: message.time.created },
        })),
        // One documented boundary cast: SDK parts carry more than the replay reads.
        parts: (messageID) => (sync.data.part[messageID] ?? []) as unknown as readonly ReplayPart[],
      }),
    })),
  )

  const edits = createMemo(() =>
    replays().flatMap((item) =>
      item.result.turns.flatMap((turn) =>
        turn.steps
          .filter((step) => step.files.length > 0)
          .map((step) => ({
            time: step.time,
            files: step.files.length,
            sessionID: item.session.id,
            turnID: turn.messageID,
          })),
      ),
    ),
  )
  const weeks = createMemo(() => activity(edits(), Date.now(), WEEKS))
  const days = createMemo(() => weeks().flat())

  const [selected, setSelected] = createSignal<string>()
  const date = createMemo(() => selected() ?? days().findLast((day) => day.edits > 0)?.date ?? dayKey(Date.now()))
  const [cursor, setCursor] = createSignal(0)

  const rows = createMemo(() =>
    replays()
      .flatMap((item) =>
        item.result.turns
          .filter(
            (turn) =>
              dayKey(turn.time) === date() ||
              turn.steps.some((step) => step.files.length > 0 && dayKey(step.time) === date()),
          )
          .map(
            (turn): TurnRow => ({
              sessionID: item.session.id,
              session: item.session.title,
              turn,
              files: new Set(turn.steps.flatMap((step) => step.files)).size,
              tests: {
                passed: turn.steps.flatMap((step) => step.tests).filter((test) => test.passed).length,
                failed: turn.steps.flatMap((step) => step.tests).filter((test) => !test.passed).length,
              },
              repairs: turn.steps.reduce((total, step) => total + step.repairs.length, 0),
            }),
          ),
      )
      .toSorted((a, b) => b.turn.time - a.turn.time),
  )

  function move(offset: number) {
    const list = days()
    const index = list.findIndex((day) => day.date === date())
    const next = list[Math.max(0, Math.min(list.length - 1, index + offset))]
    if (!next) return
    setSelected(next.date)
    setCursor(0)
  }

  function open(row: TurnRow) {
    dialog.replace(() => (
      <DialogSelect
        title={row.turn.prompt}
        options={[
          {
            title: "Open session",
            value: "open",
            description: row.session,
            onSelect: () => {
              route.navigate({ type: "session", sessionID: row.sessionID })
              dialog.clear()
            },
          },
          {
            title: "Travel back to before this turn",
            value: "travel",
            description: "restore the files this session changed from here on · /redo undoes it",
            onSelect: async () => {
              const confirmed = await DialogConfirm.show(
                dialog,
                "Travel back in time?",
                `Files that "${row.session}" changed from this turn onward go back to how they were before it. Later edits to those files from other sessions or by hand are overwritten too. /redo in that session brings everything back.`,
                "Stay here",
                "Travel back",
              )
              if (!confirmed) return
              await sdk.client.session.revert({ sessionID: row.sessionID, messageID: row.turn.messageID })
              route.navigate({ type: "session", sessionID: row.sessionID })
            },
          },
        ]}
      />
    ))
  }

  useBindings(() => ({
    bindings: [
      { key: "left", desc: "Previous day", group: "Replay", cmd: () => move(-1) },
      { key: "right", desc: "Next day", group: "Replay", cmd: () => move(1) },
      { key: "shift+left", desc: "Previous week", group: "Replay", cmd: () => move(-7) },
      { key: "shift+right", desc: "Next week", group: "Replay", cmd: () => move(7) },
      { key: "up", desc: "Previous turn", group: "Replay", cmd: () => setCursor((value) => Math.max(0, value - 1)) },
      {
        key: "down",
        desc: "Next turn",
        group: "Replay",
        cmd: () => setCursor((value) => Math.min(Math.max(0, rows().length - 1), value + 1)),
      },
      {
        key: "return",
        desc: "Open or travel back",
        group: "Replay",
        cmd: () => {
          const row = rows()[cursor()]
          if (row) open(row)
        },
      },
    ],
  }))

  return (
    <ReplayBoard
      weeks={weeks()}
      selected={date()}
      rows={rows()}
      cursor={cursor()}
      totals={{ edits: edits().reduce((total, edit) => total + edit.files, 0), sessions: sessions().length }}
      loading={loading()}
    />
  )
}

function formatDate(date: string) {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(year, month - 1, day).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
}

function clock(time: number) {
  return new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

import { Session } from "@/session/session"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { activity, monthLabels, replay, type Day, type Replay, type ReplayPart } from "@opencode-ai/tui/util/replay"
import { SessionID } from "../../session/schema"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import { EOL } from "os"
import path from "path"
import { Effect } from "effect"

export const ReplayCommand = effectCmd({
  command: "replay [sessionID]",
  describe: "replay what RIFT did: every step, tool call, file, test, failure and repair",
  builder: (yargs) =>
    yargs
      .positional("sessionID", { describe: "session to replay; omit for this codebase's activity", type: "string" })
      .option("json", { describe: "print the replay as JSON", type: "boolean" }),
  handler: Effect.fn("Cli.replay")(function* (args) {
    const svc = yield* Session.Service
    if (!args.sessionID) return yield* overview(svc)
    const sessionID = SessionID.make(args.sessionID)
    return yield* Effect.gen(function* () {
      const info = yield* svc.get(sessionID)
      const result = replay(toInput(yield* svc.messages({ sessionID: info.id })))
      if (args.json) {
        process.stdout.write(JSON.stringify({ session: { id: info.id, title: info.title }, ...result }, null, 2) + EOL)
        return
      }
      print(info.title, info.id, info.directory, result)
    }).pipe(Effect.catchCause(() => fail(`Session not found: ${sessionID}`)))
  }),
})

const overview = Effect.fn("Cli.replay.overview")(function* (svc: Session.Interface) {
  const sessions = (yield* svc.list()).toSorted((a, b) => b.time.updated - a.time.updated)
  const replays = yield* Effect.forEach(
    sessions,
    (session) =>
      svc.messages({ sessionID: session.id }).pipe(
        Effect.orElseSucceed(() => []),
        Effect.map((messages) => ({ session, result: replay(toInput(messages)) })),
      ),
    { concurrency: 4 },
  )
  const edits = replays.flatMap((item) =>
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
  )
  UI.empty()
  UI.println(UI.Style.TEXT_NORMAL_BOLD + "RIFT activity in this codebase" + UI.Style.TEXT_NORMAL)
  UI.println(
    UI.Style.TEXT_DIM +
      `${edits.reduce((total, edit) => total + edit.files, 0)} file edits across ${sessions.length} sessions` +
      UI.Style.TEXT_NORMAL,
  )
  UI.empty()
  grid(activity(edits, Date.now(), 26))
  UI.empty()
  for (const item of replays.slice(0, 10)) {
    const totals = item.result.totals
    UI.println(
      `  ${UI.Style.TEXT_HIGHLIGHT}${item.session.id}${UI.Style.TEXT_NORMAL}  ${item.session.title}` +
        UI.Style.TEXT_DIM +
        `  ${plural(totals.steps, "step")} · ${plural(totals.files, "file")} · ${plural(totals.tests, "test")}` +
        UI.Style.TEXT_NORMAL,
    )
  }
  UI.empty()
  UI.println(
    UI.Style.TEXT_DIM +
      "rift replay <session> for the full replay · /replay in the TUI to travel back" +
      UI.Style.TEXT_NORMAL,
  )
})

const SHADES = ["\x1b[90m·", "\x1b[38;5;22m■", "\x1b[38;5;28m■", "\x1b[38;5;34m■", "\x1b[38;5;46m■"]

function grid(weeks: Day[][]) {
  const months = monthLabels(weeks)
  UI.println(UI.Style.TEXT_DIM + "      " + months + UI.Style.TEXT_NORMAL)
  const labels = ["   ", "Mon", "   ", "Wed", "   ", "Fri", "   "]
  labels.forEach((label, weekday) => {
    UI.println(
      UI.Style.TEXT_DIM +
        `  ${label} ` +
        weeks.map((week) => SHADES[week[weekday].level] + " ").join("") +
        UI.Style.TEXT_NORMAL,
    )
  })
  UI.println(UI.Style.TEXT_DIM + "      less " + SHADES.join(" ") + UI.Style.TEXT_DIM + " more" + UI.Style.TEXT_NORMAL)
}

function print(title: string, id: string, directory: string, result: Replay) {
  const S = UI.Style
  const t = result.totals
  UI.empty()
  UI.println(`${S.TEXT_NORMAL_BOLD}REPLAY${S.TEXT_NORMAL}  ${title}  ${S.TEXT_DIM}${id}${S.TEXT_NORMAL}`)
  UI.println(
    S.TEXT_DIM +
      `  ${plural(t.steps, "step")} · ${plural(t.tools, "tool call")} · ${plural(t.files, "file")} · ${plural(t.tests, "test")} · ` +
      S.TEXT_NORMAL +
      (t.failures ? S.TEXT_DANGER : S.TEXT_DIM) +
      plural(t.failures, "failure") +
      S.TEXT_DIM +
      " · " +
      (t.repairs ? S.TEXT_SUCCESS : S.TEXT_DIM) +
      plural(t.repairs, "repair") +
      S.TEXT_NORMAL,
  )
  result.turns.forEach((turn, index) => {
    UI.empty()
    UI.println(
      `${S.TEXT_HIGHLIGHT_BOLD}▸ ${index + 1}${S.TEXT_NORMAL} ${S.TEXT_DIM}${clock(turn.time)}${S.TEXT_NORMAL}  ${turn.prompt}`,
    )
    turn.steps.forEach((step, n) => {
      const head = `    ${S.TEXT_DIM}${String(n + 1).padStart(2)}${S.TEXT_NORMAL}`
      UI.println(
        head +
          (step.agent ? ` ${S.TEXT_INFO}${step.agent}${S.TEXT_NORMAL}` : "") +
          (step.decision
            ? ` ${S.TEXT_NORMAL}"${step.decision}"`
            : ` ${S.TEXT_DIM}${toolSummary(step.tools)}${S.TEXT_NORMAL}`),
      )
      for (const file of step.files)
        UI.println(`       ${S.TEXT_WARNING}~${S.TEXT_NORMAL} ${relative(directory, file)}`)
      for (const test of step.tests) {
        const mark = test.passed ? `${S.TEXT_SUCCESS}✓` : `${S.TEXT_DANGER}✗`
        const exit = test.exit !== undefined && !test.passed ? ` (exit ${test.exit})` : ""
        const repaired = step.repairs.includes(test.command) && test.passed ? `  ${S.TEXT_SUCCESS}↺ repaired` : ""
        UI.println(`       ${mark} ${test.command}${exit}${repaired}${S.TEXT_NORMAL}`)
      }
      for (const failure of step.failures.filter((item) => !step.tests.some((test) => item.endsWith(test.command))))
        UI.println(`       ${S.TEXT_DANGER}✗ ${failure}${S.TEXT_NORMAL}`)
    })
  })
  UI.empty()
  UI.println(`${S.TEXT_NORMAL_BOLD}EVIDENCE${S.TEXT_NORMAL}  ${evidenceLabel(result)}`)
  for (const check of result.evidence.checks) {
    const ok = check.status === "passed"
    UI.println(
      `  ${ok ? S.TEXT_SUCCESS + "✓" : S.TEXT_DANGER + "✗"} ${check.command}${S.TEXT_DIM} ${ok ? "" : check.status}${S.TEXT_NORMAL}`,
    )
  }
  UI.empty()
}

function evidenceLabel(result: Replay) {
  if (result.evidence.state === "none") return `${UI.Style.TEXT_DIM}no verification ran${UI.Style.TEXT_NORMAL}`
  if (result.evidence.state === "passed") return `${UI.Style.TEXT_SUCCESS}verified${UI.Style.TEXT_NORMAL}`
  if (result.evidence.state === "failed") return `${UI.Style.TEXT_DANGER}failed verification${UI.Style.TEXT_NORMAL}`
  return `${UI.Style.TEXT_WARNING}${result.evidence.state}${UI.Style.TEXT_NORMAL}`
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

function toolSummary(tools: Replay["turns"][number]["steps"][number]["tools"]) {
  if (tools.length === 0) return "thinking"
  const counts = Map.groupBy(tools, (tool) => tool.name)
  return [...counts].map(([name, items]) => (items.length > 1 ? `${name} ×${items.length}` : name)).join(", ")
}

function relative(directory: string, file: string) {
  const rel = path.relative(directory, file)
  return rel.startsWith("..") || path.isAbsolute(rel) ? file : rel
}

function clock(time: number) {
  return time
    ? new Date(time).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : ""
}

function toInput(messages: SessionV1.WithParts[]) {
  const byID = new Map<string, SessionV1.WithParts["parts"]>(
    messages.map((message) => [message.info.id, message.parts]),
  )
  return {
    messages: messages.map((message) => ({
      id: message.info.id,
      role: message.info.role,
      agent: message.info.agent,
      time: { created: message.info.time.created },
    })),
    // One documented boundary cast: stored parts carry more than the replay reads.
    parts: (messageID: string) => (byID.get(messageID) ?? []) as unknown as readonly ReplayPart[],
  }
}

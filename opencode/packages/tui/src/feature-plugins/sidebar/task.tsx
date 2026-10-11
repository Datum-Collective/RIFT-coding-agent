/**
 * The side panel: what the agent is doing right now, in one glance.
 *
 * It reads the same task model as the full task view, so the two never disagree, and answers the
 * questions a person keeps a panel open for: is it working or waiting on me, where is it in the plan,
 * what has it changed, and did the checks pass. Session bookkeeping (context, MCP, LSP) sits below.
 */
import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTask } from "../../component/control/use-task"
import { Bar, GLYPH, Label, Row, formatDuration, shortenPath, signalColor } from "../../component/control/primitives"
import type { Signal, Task } from "../../util/task"

const id = "internal:sidebar-task"

// Long plans and change lists would push everything else off a small terminal.
const MAX_STEPS = 8
const MAX_FILES = 8

const STATE: Record<Task["state"], { label: string; signal: Signal }> = {
  idle: { label: "Idle", signal: "pending" },
  planning: { label: "Planning", signal: "active" },
  executing: { label: "Working", signal: "active" },
  verifying: { label: "Checking the work", signal: "active" },
  blocked: { label: "Waiting on you", signal: "warn" },
  failed: { label: "Something failed", signal: "failed" },
  done: { label: "Done", signal: "done" },
}

const BAR_WIDTH = 32

/** The panel for one task. Takes the task as data so it can be rendered without a live session. */
export function TaskPanel(props: { task: Task }) {
  const { theme } = useTheme()
  const task = () => props.task

  const state = createMemo(() => STATE[task().state])
  const steps = createMemo(() => task().plan.steps)
  const stepsDone = createMemo(() => steps().filter((step) => step.signal === "done").length)
  // What the agent is on right now: the newest phase still in flight.
  const now = createMemo(() => task().execution.findLast((phase) => phase.signal === "active"))
  const blocked = createMemo(() => task().blocked.permissions + task().blocked.questions)
  const files = createMemo(() => task().changes.files)
  const checks = createMemo(() => task().verification.checks)
  const context = createMemo(() => task().context)
  const money = (value: number) => `$${value.toFixed(2)}`

  return (
    <box gap={1}>
      <box>
        <text fg={signalColor(theme, state().signal)}>
          {GLYPH[state().signal]} <b>{state().label}</b>
        </text>
        <Show when={now() && task().state !== "blocked"}>
          <text fg={theme.textMuted} wrapMode="none">
            {"  "}
            {shortenPath(now()!.label, 34)}
          </text>
        </Show>
        <Show when={blocked() > 0}>
          <text fg={theme.warning}>
            {"  "}
            {blocked()} {blocked() === 1 ? "request needs" : "requests need"} your answer
          </text>
        </Show>
      </box>

      <Show when={context().tokens > 0}>
        <box>
          <Label count={[context().percent !== null ? `${context().percent}%` : "", task().cost > 0 ? money(task().cost) : ""].filter(Boolean).join(" · ")}>
            Context
          </Label>
          <Show when={context().percent !== null}>
            <Bar
              value={(context().percent ?? 0) / 100}
              width={BAR_WIDTH}
              color={(context().percent ?? 0) >= 80 ? theme.warning : theme.primary}
            />
          </Show>
          <text fg={theme.textMuted}>{context().tokens.toLocaleString()} tokens</text>
        </box>
      </Show>

      <Show when={steps().length > 0}>
        <box>
          <Label count={`${stepsDone()}/${steps().length}`}>Plan</Label>
          <Bar value={steps().length ? stepsDone() / steps().length : 0} width={BAR_WIDTH} color={theme.success} />
          <For each={steps().slice(0, MAX_STEPS)}>
            {(step) => (
              <Row signal={step.signal} dim={step.signal === "done"}>
                <text fg={step.signal === "active" ? theme.text : theme.textMuted} wrapMode="none">
                  {step.text}
                </text>
              </Row>
            )}
          </For>
          <Show when={steps().length > MAX_STEPS}>
            <text fg={theme.textMuted}>+{steps().length - MAX_STEPS} more</text>
          </Show>
        </box>
      </Show>

      <Show when={files().length > 0}>
        <box>
          <Label count={`${files().length} ${files().length === 1 ? "file" : "files"} · +${task().changes.added} −${task().changes.removed}`}>
            Changes
          </Label>
          <For each={files().slice(0, MAX_FILES)}>
            {(item) => (
              <box flexDirection="row" justifyContent="space-between" gap={1}>
                <text fg={theme.textMuted} wrapMode="none">
                  {shortenPath(item.file, 26)}
                </text>
                <box flexDirection="row" gap={1} flexShrink={0}>
                  <Show when={item.added}>
                    <text fg={theme.diffAdded}>+{item.added}</text>
                  </Show>
                  <Show when={item.removed}>
                    <text fg={theme.diffRemoved}>−{item.removed}</text>
                  </Show>
                </box>
              </box>
            )}
          </For>
          <Show when={files().length > MAX_FILES}>
            <text fg={theme.textMuted}>+{files().length - MAX_FILES} more</text>
          </Show>
        </box>
      </Show>

      <Show when={checks().length > 0}>
        <box>
          <Label count={`${checks().filter((check) => check.status === "passed").length}/${checks().length} passed`}>Checks</Label>
          <For each={checks()}>
            {(check) => {
              const signal: Signal =
                check.status === "passed"
                  ? "done"
                  : check.status === "failed" || check.status === "timed_out"
                    ? "failed"
                    : "pending"
              return (
                <Row signal={signal} right={<text fg={theme.textMuted}>{formatDuration(check.ms)}</text>}>
                  <text fg={theme.textMuted} wrapMode="none">
                    {check.command}
                  </text>
                </Row>
              )
            }}
          </For>
        </box>
      </Show>
    </box>
  )
}

function View(props: { session_id: string }) {
  const task = useTask(() => props.session_id)
  return <TaskPanel task={task()} />
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    // Above everything else in the panel; context, MCP and LSP follow.
    order: 50,
    slots: {
      sidebar_content(_ctx, props) {
        return <View session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin

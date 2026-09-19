/**
 * The task panel: the primary view of the RIFT control plane.
 *
 * Reads the derived task model and answers, top to bottom, what the agent is doing, what it
 * changed, whether it needs the user, and whether the work actually held up.
 */
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useCommandShortcut } from "../../keymap"
import { Meta, Row, Rule, formatDuration, shortenPath, signalColor } from "./primitives"
import type { Claims, Signal, Task, VerifyCheck } from "../../util/task"

const STATE_LABEL: Record<Task["state"], string> = {
  idle: "idle",
  planning: "planning",
  executing: "executing",
  verifying: "verifying",
  blocked: "needs you",
  failed: "failed",
  done: "done",
}

const STATE_SIGNAL: Record<Task["state"], Signal> = {
  idle: "pending",
  planning: "active",
  executing: "active",
  verifying: "active",
  blocked: "warn",
  failed: "failed",
  done: "done",
}

function checkSignal(check: VerifyCheck): Signal {
  if (check.status === "passed") return "done"
  if (check.status === "failed" || check.status === "timed_out") return "failed"
  return "pending"
}

function checkRight(check: VerifyCheck) {
  if (check.status === "passed") return formatDuration(check.ms) || "passed"
  if (check.status === "timed_out") return "timed out"
  if (check.status === "failed") return "failed"
  if (check.status === "queued") return "queued"
  return check.reason ?? "not run"
}

function claimsSignal(claims: Claims): Signal {
  switch (claims.status) {
    case "ok":
      return "done"
    case "mismatch":
      return "warn"
    case "pending":
      return "active"
    default:
      return "pending"
  }
}

function claimsLabel(claims: Claims) {
  switch (claims.status) {
    case "ok":
      return "summary matches the diff"
    case "mismatch":
      return `summary does not match the diff (${claims.items.length})`
    case "pending":
      return "checking summary against the diff"
    case "not_run":
      return `summary vs diff — not run (${claims.reason})`
    default:
      return "summary vs diff"
  }
}

export function TaskView(props: { task: Task; width: number; compact?: boolean }) {
  const { theme } = useTheme()
  // Review reuses the existing diff viewer rather than adding a second diff UI.
  const reviewKey = useCommandShortcut("diff.open")
  const logKey = useCommandShortcut("session.view.toggle")
  const width = () => Math.max(24, props.width)
  const nameWidth = () => Math.max(12, Math.floor(width() * 0.55))
  const task = () => props.task

  const models = createMemo(() => {
    const { planner, executor, current } = task().models
    if (planner && executor) return `${planner} → ${executor}`
    return current ?? planner ?? executor
  })

  const changes = createMemo(() => task().changes)
  // Context pressure is worth seeing before it forces a compaction.
  const contextColor = createMemo(() => {
    const percent = task().context.percent ?? 0
    if (percent >= 90) return theme.error
    if (percent >= 70) return theme.warning
    return theme.textMuted
  })
  const verification = createMemo(() => task().verification)

  return (
    <box flexDirection="column" gap={1} flexShrink={0}>
      {/* --- header ------------------------------------------------------------------ */}
      <box flexDirection="column" flexShrink={0}>
        <Rule label="TASK" width={width()} accent />
        <box paddingLeft={2} paddingTop={1} flexDirection="column">
          <text fg={theme.text}>
            <b>{task().title}</b>
          </text>
          <box flexDirection="row" gap={1} flexWrap="wrap">
            <text fg={signalColor(theme, STATE_SIGNAL[task().state])}>
              {STATE_SIGNAL[task().state] === "active" ? "●" : STATE_SIGNAL[task().state] === "done" ? "✓" : "▸"}{" "}
              {STATE_LABEL[task().state]}
            </text>
            <Show when={models()}>
              <Meta>· {models()}</Meta>
            </Show>
            <Show when={changes().files.length > 0}>
              <Meta>
                · {changes().files.length} {changes().files.length === 1 ? "file" : "files"}
              </Meta>
              <text fg={theme.diffAdded}>+{changes().added}</text>
              <text fg={theme.diffRemoved}>−{changes().removed}</text>
            </Show>
            <Show when={task().context.percent !== null}>
              <Meta>·</Meta>
              <text fg={contextColor()}>{task().context.percent}% context</text>
            </Show>
          </box>
        </box>
      </box>

      {/* --- needs you ---------------------------------------------------------------- */}
      <Show when={task().blocked.permissions + task().blocked.questions > 0}>
        <box flexDirection="column" flexShrink={0}>
          <Rule label="NEEDS YOU" width={width()} />
          <box paddingLeft={2} paddingTop={1}>
            <Show when={task().blocked.permissions > 0}>
              <Row signal="warn">
                <text fg={theme.warning}>
                  {task().blocked.permissions} permission {task().blocked.permissions === 1 ? "request" : "requests"}
                </text>
              </Row>
            </Show>
            <Show when={task().blocked.questions > 0}>
              <Row signal="warn">
                <text fg={theme.warning}>
                  {task().blocked.questions} {task().blocked.questions === 1 ? "question" : "questions"}
                </text>
              </Row>
            </Show>
          </box>
        </box>
      </Show>

      {/* --- plan --------------------------------------------------------------------- */}
      <Show when={task().plan.steps.length > 0}>
        <box flexDirection="column" flexShrink={0}>
          <Rule label="PLAN" width={width()} />
          <box paddingLeft={2} paddingTop={1} flexDirection="column">
            <For each={task().plan.steps}>
              {(step) => (
                <Row
                  signal={step.signal}
                  right={
                    <Show when={step.files.length > 0 && !props.compact}>
                      <text fg={theme.textMuted}>{shortenPath(step.files.join(" "), Math.floor(width() * 0.35))}</text>
                    </Show>
                  }
                >
                  <text fg={step.signal === "pending" ? theme.textMuted : theme.text}>
                    {step.n}. {step.text}
                  </text>
                </Row>
              )}
            </For>
          </box>
        </box>
      </Show>

      {/* --- execution ---------------------------------------------------------------- */}
      <Show when={task().execution.length > 0}>
        <box flexDirection="column" flexShrink={0}>
          <Rule label="EXECUTION" width={width()} />
          <box paddingLeft={2} paddingTop={1} flexDirection="column">
            <For each={task().execution}>
              {(phase) => (
                <Row
                  signal={phase.signal}
                  right={
                    <text fg={phase.signal === "failed" ? theme.error : theme.textMuted}>
                      {phase.detail ?? formatDuration(phase.ms ?? 0)}
                    </text>
                  }
                >
                  <text fg={phase.signal === "pending" ? theme.textMuted : theme.text}>{phase.label}</text>
                </Row>
              )}
            </For>
          </box>
        </box>
      </Show>

      {/* --- changes ------------------------------------------------------------------ */}
      <Show when={changes().files.length > 0}>
        <box flexDirection="column" flexShrink={0}>
          <Rule label="CHANGES" width={width()} />
          <box paddingLeft={2} paddingTop={1} flexDirection="column">
            <For each={changes().files.slice(0, props.compact ? 3 : 12)}>
              {(file) => (
                <box flexDirection="row" flexShrink={0}>
                  <text fg={theme.textMuted}>~ </text>
                  <box flexGrow={1} flexShrink={1} overflow="hidden">
                    <text fg={theme.text}>{shortenPath(file.file, nameWidth())}</text>
                  </box>
                  <box flexDirection="row" gap={1} paddingLeft={2} flexShrink={0}>
                    <text fg={theme.diffAdded}>+{file.added}</text>
                    <text fg={theme.diffRemoved}>−{file.removed}</text>
                  </box>
                </box>
              )}
            </For>
            <Show when={changes().files.length > (props.compact ? 3 : 12)}>
              <text fg={theme.textMuted}> … {changes().files.length - (props.compact ? 3 : 12)} more</text>
            </Show>
          </box>
        </box>
      </Show>

      {/* --- verification -------------------------------------------------------------- */}
      <Show when={verification().state !== "none"}>
        <box flexDirection="column" flexShrink={0}>
          <Rule label="VERIFICATION" width={width()} />
          <box paddingLeft={2} paddingTop={1} flexDirection="column">
            <For each={verification().checks}>
              {(check) => (
                <Row
                  signal={checkSignal(check)}
                  right={
                    <text fg={checkSignal(check) === "failed" ? theme.error : theme.textMuted}>
                      {checkRight(check)}
                    </text>
                  }
                >
                  <text fg={theme.text}>
                    {check.command}
                    <Show when={check.where}>
                      <span style={{ fg: theme.textMuted }}> in {check.where}</span>
                    </Show>
                  </text>
                </Row>
              )}
            </For>
            <Show when={verification().browser}>
              {(browser) => (
                <Row
                  signal={browser().status === "passed" ? "done" : browser().status === "failed" ? "failed" : "pending"}
                  right={
                    <text fg={browser().status === "failed" ? theme.error : theme.textMuted}>
                      {browser().status === "passed"
                        ? "rendered"
                        : browser().status === "not_run"
                          ? (browser().reason ?? "not checked")
                          : browser().errors.length > 0
                            ? `${browser().errors.length} console ${browser().errors.length === 1 ? "error" : "errors"}`
                            : (browser().reason ?? `HTTP ${browser().httpStatus}`)}
                    </text>
                  }
                >
                  <text fg={theme.text}>{browser().url}</text>
                </Row>
              )}
            </Show>
            <Show when={verification().claims && verification().claims!.status !== "off"}>
              <Row signal={claimsSignal(verification().claims!)}>
                <text fg={theme.text}>{claimsLabel(verification().claims!)}</text>
              </Row>
            </Show>
            <Show when={verification().scope}>
              {(scope) => (
                <Row signal="warn">
                  <text fg={theme.warning}>{scope().files} files changed — larger than expected for one task</text>
                </Row>
              )}
            </Show>
          </box>
        </box>
      </Show>

      {/* --- review -------------------------------------------------------------------- */}
      <Show when={changes().files.length > 0}>
        <box flexDirection="column" flexShrink={0}>
          <Rule label="REVIEW" width={width()} />
          <box paddingLeft={2} paddingTop={1} flexDirection="column">
            <Row signal={verification().state === "passed" ? "done" : "pending"}>
              <text fg={theme.text}>
                {changes().files.length} {changes().files.length === 1 ? "file" : "files"} to review
                <Show when={reviewKey()}>
                  <span style={{ fg: theme.textMuted }}> — {reviewKey()} to open the diff</span>
                </Show>
              </text>
            </Row>
          </box>
        </box>
      </Show>

      {/* --- nothing yet ---------------------------------------------------------------- */}
      <Show when={task().execution.length === 0 && task().plan.steps.length === 0 && changes().files.length === 0}>
        <box paddingLeft={2}>
          <text fg={theme.textMuted}>No activity yet. Describe a task below to begin.</text>
        </box>
      </Show>

      <Show when={logKey() && task().execution.length > 0}>
        <box paddingLeft={2} flexShrink={0}>
          <text fg={theme.textMuted}>{logKey()} for the full log</text>
        </box>
      </Show>
    </box>
  )
}

/**
 * RIFT Forge: the pipeline as a live system rather than a transcript.
 *
 * The forge line at the top shows all eleven stages at a glance. Below it, each stage is one row,
 * and only the stage that matters right now is expanded. Stale stages stay visible, dimmed, so
 * the person can see exactly what their last steer will rebuild.
 */
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useCommandShortcut } from "../../keymap"
import { GLYPH, Meta, Row, Rule, signalColor } from "./primitives"
import { STAGES, type Counter, type Forge, type ForgeState, type Stage, type StageState } from "../../util/forge"
import type { Signal } from "../../util/task"

const NODE: Record<StageState, string> = {
  pending: "○",
  active: "◉",
  done: "■",
  failed: "✗",
  skipped: "·",
  stale: "◌",
  waiting: "◈",
}

const STATE_LABEL: Record<ForgeState, string> = {
  forging: "forging",
  waiting: "needs you",
  paused: "paused",
  failed: "stopped",
  shipped: "shipped",
}

const STATE_SIGNAL: Record<ForgeState, Signal> = {
  forging: "active",
  waiting: "warn",
  paused: "pending",
  failed: "failed",
  shipped: "done",
}

function rowSignal(state: StageState): Signal {
  if (state === "done") return "done"
  if (state === "active") return "active"
  if (state === "failed") return "failed"
  if (state === "waiting" || state === "stale") return "warn"
  return "pending"
}

const LABEL_WIDTH = Math.max(...STAGES.map((stage) => stage.label.length)) + 2
const MAX_ITEMS = 8

export function ForgeView(props: { forge: Forge; width: number }) {
  const { theme } = useTheme()
  const logKey = useCommandShortcut("session.view.toggle")
  const width = () => Math.max(32, props.width)
  const forge = () => props.forge
  const position = createMemo(() => STAGES.findIndex((stage) => stage.id === forge().focus) + 1)

  function nodeColor(state: StageState) {
    if (state === "stale") return theme.warning
    if (state === "skipped") return theme.textMuted
    return signalColor(theme, rowSignal(state))
  }

  function bar(count: Counter) {
    const cells = 10
    const done = count.total === 0 ? 0 : Math.round(((count.total - count.running) / count.total) * cells)
    return "█".repeat(done) + "░".repeat(cells - done)
  }

  function metric(stage: Stage) {
    if (stage.state === "stale") {
      const by = STAGES.find((item) => item.id === stage.staleBy)?.label
      return <text fg={theme.warning}>stale{by ? ` · rebuilds after ${by}` : ""}</text>
    }
    if (stage.state === "skipped") return <text fg={theme.textMuted}>skipped</text>
    if (stage.state === "waiting") return <text fg={theme.warning}>waiting for you</text>
    if (stage.agents.total > 0) {
      return (
        <box flexDirection="row" gap={1}>
          <text fg={theme.accent}>{bar(stage.agents)}</text>
          <text fg={theme.textMuted}>
            {stage.agents.total - stage.agents.running}/{stage.agents.total}
          </text>
          <Show when={stage.agents.failed > 0}>
            <text fg={theme.error}>{stage.agents.failed} failed</text>
          </Show>
        </box>
      )
    }
    if (stage.commands.total > 0) {
      return (
        <box flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>
            {stage.commands.total} {stage.commands.total === 1 ? "cmd" : "cmds"}
          </text>
          <Show when={stage.commands.failed > 0}>
            <text fg={theme.error}>{stage.commands.failed} failed</text>
          </Show>
        </box>
      )
    }
    if (stage.revisions > 0) return <text fg={theme.textMuted}>↺ {stage.revisions}</text>
    return undefined
  }

  return (
    <box flexDirection="column" gap={1} flexShrink={0}>
      {/* --- header ------------------------------------------------------------------ */}
      <box flexDirection="column" flexShrink={0}>
        <Rule label="FORGE" width={width()} accent />
        <box paddingLeft={2} paddingTop={1} flexDirection="column">
          <text fg={theme.text}>
            <b>{forge().goal}</b>
          </text>
          <box flexDirection="row" gap={1} flexWrap="wrap">
            <text fg={signalColor(theme, STATE_SIGNAL[forge().state])}>
              {forge().state === "shipped" ? "✓" : forge().state === "forging" ? "●" : "▸"} {STATE_LABEL[forge().state]}
            </text>
            <Show when={forge().state !== "shipped"}>
              <Meta>
                · stage {position()}/{STAGES.length} {STAGES[position() - 1]?.label}
              </Meta>
            </Show>
            <Show when={forge().steers > 0}>
              <Meta>
                · ↺ {forge().steers} {forge().steers === 1 ? "steer" : "steers"}
              </Meta>
            </Show>
            <Show when={forge().commands.total > 0}>
              <Meta>· {forge().commands.total} commands run</Meta>
              <Show when={forge().commands.failed > 0}>
                <text fg={theme.error}>{forge().commands.failed} failed</text>
              </Show>
            </Show>
          </box>
        </box>
        {/* The forge line: every stage as one glyph, solid where the work holds, dotted ahead. */}
        <box paddingLeft={2} paddingTop={1} flexDirection="row" flexShrink={0}>
          <For each={forge().stages}>
            {(stage, index) => (
              <>
                <Show when={index() > 0}>
                  <text fg={stage.state === "done" ? theme.success : theme.borderSubtle}>
                    {stage.state === "done" || stage.state === "active" || stage.state === "waiting" ? "━━" : "┄┄"}
                  </text>
                </Show>
                <text fg={nodeColor(stage.state)}>{NODE[stage.state]}</text>
              </>
            )}
          </For>
        </box>
      </box>

      {/* --- needs you ---------------------------------------------------------------- */}
      <Show when={forge().state === "waiting"}>
        <box flexDirection="column" flexShrink={0}>
          <Rule label="NEEDS YOU" width={width()} />
          <box paddingLeft={2} paddingTop={1}>
            <Row signal="warn">
              <text fg={theme.warning}>The evidence is in. Ship it, ask for changes, or stop.</text>
            </Row>
          </box>
        </box>
      </Show>

      {/* --- pipeline ----------------------------------------------------------------- */}
      <box flexDirection="column" flexShrink={0}>
        <Rule label="PIPELINE" width={width()} />
        <box paddingLeft={2} paddingTop={1} flexDirection="column">
          <For each={forge().stages}>
            {(stage) => {
              const focused = () => stage.id === forge().focus
              const quiet = () => stage.state === "pending" || stage.state === "skipped" || stage.state === "stale"
              return (
                <box flexDirection="column" flexShrink={0}>
                  <Row signal={rowSignal(stage.state)} right={metric(stage)}>
                    <box flexDirection="row">
                      <box width={LABEL_WIDTH} flexShrink={0}>
                        <text fg={quiet() ? theme.textMuted : theme.text}>
                          {focused() ? <b>{stage.label}</b> : stage.label}
                        </text>
                      </box>
                      <Show when={stage.summary}>
                        <text fg={theme.textMuted}>
                          {shortenSummary(stage.summary!, Math.max(8, width() - LABEL_WIDTH - 30))}
                        </text>
                      </Show>
                    </box>
                  </Row>
                  <Show when={focused() && stage.items.length > 0}>
                    <box flexDirection="column" paddingBottom={1}>
                      <For each={stage.items.slice(0, MAX_ITEMS)}>
                        {(item) => (
                          <box flexDirection="row" flexShrink={0}>
                            <text fg={theme.borderSubtle}>│ </text>
                            <text fg={signalColor(theme, item.signal)}>{GLYPH[item.signal]} </text>
                            <box flexGrow={1} flexShrink={1} overflow="hidden">
                              <text fg={item.signal === "pending" ? theme.textMuted : theme.text}>
                                {shortenSummary(item.text, Math.max(12, width() - 8))}
                              </text>
                            </box>
                          </box>
                        )}
                      </For>
                      <Show when={stage.items.length > MAX_ITEMS}>
                        <text fg={theme.textMuted}>│ … {stage.items.length - MAX_ITEMS} more</text>
                      </Show>
                    </box>
                  </Show>
                </box>
              )
            }}
          </For>
        </box>
      </box>

      <box paddingLeft={2} flexDirection="column" flexShrink={0}>
        <text fg={theme.textMuted}>Steer any stage by typing, e.g. "architecture: use Postgres instead".</text>
        <Show when={logKey()}>
          <text fg={theme.textMuted}>{logKey()} for the full chat</text>
        </Show>
      </box>
    </box>
  )
}

function shortenSummary(text: string, max: number) {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(1, max - 1))}…`
}

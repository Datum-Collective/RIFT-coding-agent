/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { OpencodeKeymapProvider } from "../../src/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { KVProvider } from "../../src/context/kv"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"
import { ReplayBoard, type TurnRow } from "../../src/component/control/replay-view"
import { activity } from "../../src/util/replay"

const now = new Date(2026, 8, 26, 15).getTime()
const at = (day: number, hour: number) => new Date(2026, 8, day, hour).getTime()

const rows: TurnRow[] = [
  {
    sessionID: "ses_a",
    session: "Rate limiter",
    turn: { messageID: "msg_1", time: at(24, 21), prompt: "Implement the rate limiter", steps: [] },
    files: 2,
    tests: { passed: 1, failed: 1 },
    repairs: 1,
  },
  {
    sessionID: "ses_b",
    session: "Docs",
    turn: { messageID: "msg_2", time: at(24, 9), prompt: "Document the API", steps: [] },
    files: 1,
    tests: { passed: 0, failed: 0 },
    repairs: 0,
  },
]

export async function frame(width = 90, height = 30) {
  const weeks = activity(
    [
      { time: at(24, 21), files: 6, sessionID: "ses_a", turnID: "msg_1" },
      { time: at(10, 12), files: 2, sessionID: "ses_c", turnID: "msg_3" },
    ],
    now,
    26,
  )
  function Harness() {
    const keymap = createDefaultOpenTuiKeymap(useRenderer())
    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <ReplayBoard
                weeks={weeks}
                selected="2026-09-24"
                rows={rows}
                cursor={1}
                totals={{ edits: 8, sessions: 3 }}
                loading={false}
              />
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </OpencodeKeymapProvider>
    )
  }
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <Harness />
      </TestTuiContexts>
    ),
    { width, height },
  )
  try {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      await app.renderOnce()
      if (app.captureCharFrame().trim().length > 0) break
    }
    return app.captureCharFrame()
  } finally {
    app.renderer.destroy()
  }
}

test("draws the activity grid, the selected day and its turns", async () => {
  const out = await frame()
  expect(out).toContain("8 file edits · 3 sessions")
  expect(out).toContain("Sep")
  expect(out).toContain("Mon")
  expect(out).toContain("◆")
  expect(out).toContain("■")
  expect(out).toContain("2 turns")
  expect(out).toContain("Implement the rate limiter")
  expect(out).toContain("✗ 1")
  expect(out).toContain("↺ 1")
  // The cursor sits on the second turn.
  expect(out).toMatch(/› .*Document the API/)
})

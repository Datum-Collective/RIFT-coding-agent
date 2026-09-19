/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { OpencodeKeymapProvider, createOpencodeModeStack } from "../../src/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { KVProvider } from "../../src/context/kv"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { ClipboardProvider } from "../../src/context/clipboard"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"
import { MissionBoard } from "../../src/component/control/mission-control"
import type { MissionRow } from "../../src/util/mission"

const rows: MissionRow[] = [
  {
    sessionID: "s1",
    title: "Add retry logic",
    state: "blocked",
    signal: "warn",
    summary: "2 permission requests waiting",
    current: false,
    attention: true,
  },
  {
    sessionID: "s2",
    title: "Refactor the parser",
    state: "failed",
    signal: "failed",
    summary: "1 check failed — bun test",
    current: true,
    attention: true,
  },
  {
    sessionID: "s3",
    title: "Update the docs",
    state: "running",
    signal: "active",
    summary: "editing 3 files",
    current: false,
    attention: false,
  },
]

function Harness(props: { rows: MissionRow[] }) {
  const keymap = createDefaultOpenTuiKeymap(useRenderer())
  createOpencodeModeStack(keymap)
  return (
    <OpencodeKeymapProvider keymap={keymap}>
      <TuiConfigProvider config={createTuiResolvedConfig()}>
        <KVProvider>
          <ThemeProvider mode="dark">
            <ClipboardProvider>
              <ToastProvider>
                <DialogProvider>
                  <MissionBoard rows={props.rows} onOpen={() => {}} />
                </DialogProvider>
              </ToastProvider>
            </ClipboardProvider>
          </ThemeProvider>
        </KVProvider>
      </TuiConfigProvider>
    </OpencodeKeymapProvider>
  )
}

async function frame(items: MissionRow[], width = 110, height = 30) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <Harness rows={items} />
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

// This mounts the exact JSX that once crashed the real TUI: DialogSelect renders titleView and
// footer inside a <text>, which rejects box children.
test("renders every session row with its state and summary", async () => {
  const out = await frame(rows)
  expect(out).toContain("Mission Control")
  expect(out).toContain("Add retry logic")
  expect(out).toContain("needs you")
  expect(out).toContain("2 permission requests waiting")
  expect(out).toContain("Refactor the parser")
  expect(out).toContain("failed")
  expect(out).toContain("Update the docs")
  expect(out).toContain("running")
})

test("summarises the board in the footer", async () => {
  const out = await frame(rows)
  expect(out).toContain("1 need you")
  expect(out).toContain("1 failed")
  expect(out).toContain("1 running")
  expect(out).toContain("3 total")
})

test("renders an empty board without crashing", async () => {
  const out = await frame([])
  expect(out).toContain("Mission Control")
  expect(out).toContain("0 total")
})

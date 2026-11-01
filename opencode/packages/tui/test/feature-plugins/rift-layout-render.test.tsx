/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import type { JSX } from "solid-js"
import { LogView } from "../../src/feature-plugins/rift/log"
import { FittedShortcuts, HeaderRow, ShortcutRow } from "../../src/feature-plugins/rift/chrome"

const color = RGBA.fromInts(200, 200, 200)
const theme = {
  text: {
    base: color,
    muted: color,
    feedback: { success: { base: color }, error: { base: color }, warning: { base: color } },
  },
  border: { base: color },
} as unknown as Context["theme"]

async function frame(view: () => JSX.Element, width = 60, height = 8) {
  const app = await testRender(view, { width, height })
  try {
    await app.renderOnce()
    // Rows that measure themselves settle on the next frame.
    await new Promise((resolve) => setTimeout(resolve, 5))
    await app.renderOnce()
    return app.captureCharFrame()
  } finally {
    app.renderer.destroy()
  }
}

test("the header puts the folder on the left and the budget on the right edge", async () => {
  const line = (await frame(() => <HeaderRow theme={theme} path="~/Documents" budget="9.5K / 500K" />)).split("\n")[0]!
  expect(line.startsWith("~/Documents")).toBe(true)
  expect(line.trimEnd().endsWith("9.5K / 500K")).toBe(true)
  expect(line.trimEnd()).toHaveLength(60)
})

test("a long path gives way to the budget instead of pushing it off", async () => {
  const line = (await frame(() => <HeaderRow theme={theme} path={"/very/long".repeat(20)} budget="9.5K" />, 40)).split("\n")[0]!
  expect(line).toContain("9.5K")
})

test("shortcuts are separated, and drop rather than wrap on a narrow row", async () => {
  const shortcuts = [
    { key: "tab", label: "agents" },
    { key: "ctrl+p", label: "commands" },
    { key: "ctrl+x j", label: "log" },
  ]
  expect(await frame(() => <ShortcutRow theme={theme} shortcuts={shortcuts} width={60} />)).toContain(
    "tab:agents │ ctrl+p:commands │ ctrl+x j:log",
  )
  const narrow = await frame(() => <ShortcutRow theme={theme} shortcuts={shortcuts} width={12} />)
  expect(narrow).toContain("tab:agents")
  expect(narrow).not.toContain("commands")
})

test("the shortcuts win the row beside a long path", async () => {
  const shortcuts = [
    { key: "tab", label: "agents" },
    { key: "ctrl+p", label: "commands" },
    { key: "ctrl+x j", label: "log" },
  ]
  const text = await frame(
    () => (
      <box width="100%" flexDirection="row" gap={2}>
        <box flexGrow={1} flexShrink={1} minWidth={0}>
          <text wrapMode="none" truncate>
            {"/a/long/path".repeat(5)}
          </text>
        </box>
        <FittedShortcuts theme={theme} shortcuts={shortcuts} />
      </box>
    ),
    100,
  )
  expect(text).toContain("ctrl+x j:log")
})

test("the shortcuts still drop when the whole row is too narrow for them", async () => {
  const shortcuts = [
    { key: "tab", label: "agents" },
    { key: "ctrl+p", label: "commands" },
    { key: "ctrl+x j", label: "log" },
  ]
  const text = await frame(
    () => (
      <box width="100%" flexDirection="row">
        <FittedShortcuts theme={theme} shortcuts={shortcuts} />
      </box>
    ),
    30,
  )
  expect(text).toContain("ctrl+p:commands")
  expect(text).not.toContain("log")
})

test("the log shows a count and each event with its time", async () => {
  const entries = [
    { id: "1", time: new Date(2026, 0, 1, 8, 19, 5).getTime(), level: "ok" as const, text: "read src/a.ts" },
    { id: "2", time: new Date(2026, 0, 1, 8, 19, 9).getTime(), level: "error" as const, text: "edit a.ts: no match" },
  ]
  const text = await frame(() => <LogView theme={theme} entries={entries} />)
  expect(text).toContain("Log")
  expect(text).toContain("2 events")
  expect(text).toContain("08:19:05 ✓ read src/a.ts")
  expect(text).toContain("08:19:09 ✗ edit a.ts: no match")
})

test("an empty log says so", async () => {
  expect(await frame(() => <LogView theme={theme} entries={[]} />)).toContain("Nothing yet")
})

/** @jsxImportSource @opentui/solid */
import { afterEach, describe, expect, test } from "bun:test"
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import type { BoxRenderable } from "@opentui/core"
import { createSignal, onMount } from "solid-js"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { OpencodeKeymapProvider } from "../../src/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { KVProvider, useKV } from "../../src/context/kv"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"
import { fakeClock } from "../fixture/fake-clock"
import { FADE_OUT_MS, LINGER_MS, TypingKoi, isTyping } from "../../src/component/typing-koi"

/** The composer's box starts on this row, so the strip is the nine rows ending on it. */
const COMPOSER = 19
const STRIP = { top: COMPOSER - 8, bottom: COMPOSER }

let open: Array<{ destroy: () => void }> = []
afterEach(() => {
  for (const renderer of open) renderer.destroy()
  open = []
})

function Screen(props: { clock: ReturnType<typeof fakeClock>["clock"]; animations?: boolean
  fish?: boolean }) {
  const kv = useKV()
  const [composer, setComposer] = createSignal<BoxRenderable>()
  onMount(() => {
    if (props.animations === false) kv.set("animations_enabled", false)
    if (props.fish === false) kv.set("koi_enabled", false)
  })
  return (
    <box width={100} height={30}>
      <text>hello</text>
      <box height={COMPOSER - 1} />
      <box ref={setComposer} height={3}>
        <text>composer</text>
      </box>
      <TypingKoi composer={composer} seed={4} clock={props.clock} />
    </box>
  )
}

async function mount(options: { fish?: boolean; animations?: boolean } = {}) {
  const fake = fakeClock()
  const state = mkdtempSync(path.join(tmpdir(), "rift-typing-koi-"))
  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state }}>
        <Harness clock={fake.clock} animations={options.animations} fish={options.fish} />
      </TestTuiContexts>
    ),
    { width: 100, height: 30 },
  )
  open.push(app.renderer)
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    await app.renderOnce()
    if (app.captureCharFrame().includes("composer")) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return { app, ...fake }
}

function Harness(props: { clock: ReturnType<typeof fakeClock>["clock"]; animations?: boolean
  fish?: boolean }) {
  const keymap = createDefaultOpenTuiKeymap(useRenderer())
  return (
    <OpencodeKeymapProvider keymap={keymap}>
      <TuiConfigProvider config={createTuiResolvedConfig()}>
        <KVProvider>
          <ThemeProvider mode="dark">
            <Screen clock={props.clock} animations={props.animations} fish={props.fish} />
          </ThemeProvider>
        </KVProvider>
      </TuiConfigProvider>
    </OpencodeKeymapProvider>
  )
}

type Mounted = Awaited<ReturnType<typeof mount>>

/** Lets `ms` pass a frame at a time, as the renderer would. */
async function swim(screen: Mounted, ms: number) {
  for (let t = 0; t < ms; t += 50) {
    screen.advance(50)
    await screen.app.renderOnce()
  }
}

const BLOCKS = /[▘▝▀▖▌▞▛▗▚▐▜▄▙▟█]/

/** The rows with koi in them. */
function koiRows(screen: Mounted) {
  return screen.app
    .captureCharFrame()
    .split("\n")
    .flatMap((line, row) => (BLOCKS.test(line) ? [row] : []))
}

describe("koi above the composer while typing", () => {
  test("nothing swims until the user types; then koi come into the strip just above the composer", async () => {
    const screen = await mount()
    await swim(screen, 3000)
    expect(koiRows(screen)).toEqual([])

    screen.app.mockInput.pressKey("h")
    await swim(screen, 1500)
    const rows = koiRows(screen)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row).toBeGreaterThanOrEqual(STRIP.top)
      expect(row).toBeLessThanOrEqual(STRIP.bottom)
    }
    // The interface stays on top of them.
    expect(screen.app.captureCharFrame()).toContain("composer")
    expect(screen.app.captureCharFrame()).toContain("hello")
  })

  test("the mouse does not call them", async () => {
    const screen = await mount()
    await screen.app.mockMouse.moveTo(40, 15)
    await screen.app.mockMouse.click(40, 15)
    await swim(screen, 1500)
    expect(koiRows(screen)).toEqual([])
  })

  test("and does not send them off", async () => {
    const screen = await mount()
    screen.app.mockInput.pressKey("h")
    await swim(screen, 1200)
    await screen.app.mockMouse.moveTo(40, 15)
    await swim(screen, 100)
    expect(koiRows(screen).length).toBeGreaterThan(0)
  })

  test("shortcuts, arrows and Enter are not typing", async () => {
    const screen = await mount()
    screen.app.mockInput.pressKey("k", { ctrl: true })
    screen.app.mockInput.pressArrow("up")
    screen.app.mockInput.pressEnter()
    await swim(screen, 1500)
    expect(koiRows(screen)).toEqual([])
  })

  test("they stay while the typing goes on, and fade away once it stops", async () => {
    const screen = await mount()
    for (let i = 0; i < 12; i++) {
      screen.app.mockInput.pressKey("a")
      await swim(screen, 500)
    }
    expect(koiRows(screen).length).toBeGreaterThan(0)
    await swim(screen, LINGER_MS + FADE_OUT_MS + 200)
    expect(koiRows(screen)).toEqual([])
    // And the next keystroke brings them back.
    screen.app.mockInput.pressKey("a")
    await swim(screen, 1500)
    expect(koiRows(screen).length).toBeGreaterThan(0)
  })

  test("with animations turned off they never come", async () => {
    const screen = await mount({ animations: false })
    screen.app.mockInput.pressKey("h")
    await swim(screen, 1500)
    expect(koiRows(screen)).toEqual([])
  })

  test("with fish turned off they never come", async () => {
    const screen = await mount({ fish: false })
    screen.app.mockInput.pressKey("h")
    await swim(screen, 1500)
    expect(koiRows(screen)).toEqual([])
  })

  test("what counts as typing", () => {
    const key = (name: string, mods: { ctrl?: boolean; meta?: boolean; super?: boolean } = {}) =>
      isTyping({ name, ctrl: false, meta: false, super: false, ...mods })
    expect(key("a")).toBe(true)
    expect(key("space")).toBe(true)
    expect(key("backspace")).toBe(true)
    expect(key("a", { ctrl: true })).toBe(false)
    expect(key("a", { meta: true })).toBe(false)
    expect(key("return")).toBe(false)
    expect(key("up")).toBe(false)
    expect(key("escape")).toBe(false)
  })
})

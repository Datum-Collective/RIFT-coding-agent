/** @jsxImportSource @opentui/solid */
import { afterEach, describe, expect, test } from "bun:test"
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { OpencodeKeymapProvider } from "../../src/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { KVProvider } from "../../src/context/kv"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createSignal, Show } from "solid-js"
import { Banner } from "../../src/component/banner"
import { logoAnchor } from "../../src/component/banner-anchor"
import { riftLogo } from "../../src/koi/logo"

let open: Array<{ destroy: () => void }> = []
afterEach(() => {
  for (const renderer of open) renderer.destroy()
  open = []
})

function Screen(props: { shown?: () => boolean }) {
  const keymap = createDefaultOpenTuiKeymap(useRenderer())
  return (
    <OpencodeKeymapProvider keymap={keymap}>
      <TuiConfigProvider config={createTuiResolvedConfig()}>
        <KVProvider>
          <ThemeProvider mode="dark">
            <box paddingLeft={7} paddingTop={3}>
              <Show when={props.shown ? props.shown() : true}>
                <Banner />
              </Show>
              <text>after the banner</text>
            </box>
          </ThemeProvider>
        </KVProvider>
      </TuiConfigProvider>
    </OpencodeKeymapProvider>
  )
}

async function mount(width: number, shown?: () => boolean) {
  const state = mkdtempSync(path.join(tmpdir(), "rift-anchor-"))
  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state }}>
        <Screen shown={shown} />
      </TestTuiContexts>
    ),
    { width, height: 24 },
  )
  open.push(app.renderer)
  // The theme loads a moment after the first frame.
  for (let i = 0; i < 100; i++) {
    await app.renderOnce()
    if (app.captureCharFrame().trim().length > 0) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  await app.renderOnce()
  return app
}

/** Where the banner's first row really is on the screen: its first four characters are "░░░▀". */
function whereItIs(frame: string) {
  const lines = frame.split("\n")
  const row = lines.findIndex((line) => line.includes(riftLogo.glyphs[0]!.slice(0, 4)))
  return { row, col: row < 0 ? -1 : lines[row]!.indexOf(riftLogo.glyphs[0]!.slice(0, 4)) }
}

describe("the logo's anchor", () => {
  test("says which cell the banner's top left corner is in, wherever the layout puts it", async () => {
    const app = await mount(100)
    const real = whereItIs(app.captureCharFrame())
    expect(real).toEqual({ row: 3, col: 7 })
    expect(logoAnchor.read()).toEqual({ col: real.col, row: real.row })
  })

  test("is nothing on a terminal too narrow for the banner, which shows the small logo instead", async () => {
    await mount(60)
    expect(logoAnchor.read()).toBeUndefined()
  })

  test("is gone when the banner goes, and back when it comes back", async () => {
    const [shown, setShown] = createSignal(true)
    const app = await mount(100, shown)
    expect(logoAnchor.read()).toBeDefined()
    setShown(false)
    await app.renderOnce()
    expect(logoAnchor.read()).toBeUndefined()
    setShown(true)
    await app.renderOnce()
    await app.renderOnce()
    expect(logoAnchor.read()).toEqual({ col: 7, row: 3 })
  })

describe("hiding the banner", () => {
  afterEach(() => logoAnchor.hide(false))

  const rowOf = (frame: string, needle: string) => frame.split("\n").findIndex((line) => line.includes(needle))

  test("while it is hidden it draws nothing, but it keeps its size, so nothing round it moves", async () => {
    const app = await mount(100)
    const before = app.captureCharFrame()
    expect(rowOf(before, riftLogo.glyphs[0]!.slice(0, 4))).toBe(3)
    const after = rowOf(before, "after the banner")

    logoAnchor.hide(true)
    await app.renderOnce()
    const hidden = app.captureCharFrame()
    expect(rowOf(hidden, riftLogo.glyphs[0]!.slice(0, 4))).toBe(-1)
    for (const glyphs of riftLogo.glyphs) expect(hidden).not.toContain(glyphs.slice(0, 6))
    expect(rowOf(hidden, "after the banner")).toBe(after)
  })

  test("it leaves nothing of itself behind, not even the blank cells that carry a fill colour", async () => {
    const app = await mount(100)
    const silver = (frame: ReturnType<typeof app.captureSpans>) =>
      frame.lines.flatMap((line) => line.spans).filter((span) => span.bg.buffer[0] === 0xaa && span.bg.buffer[1] === 0xaa && span.bg.buffer[2] === 0xaa).length
    // The banner has cells of blank space on a silver fill; they are there to begin with.
    expect(silver(app.captureSpans())).toBeGreaterThan(0)
    logoAnchor.hide(true)
    await app.renderOnce()
    expect(silver(app.captureSpans())).toBe(0)
  })

  test("its anchor is still there while it is hidden, so the logo can be redrawn where it was", async () => {
    const app = await mount(100)
    logoAnchor.hide(true)
    await app.renderOnce()
    expect(logoAnchor.read()).toEqual({ col: 7, row: 3 })
  })

  test("showing it again brings back exactly what was there", async () => {
    const app = await mount(100)
    const before = app.captureCharFrame()
    logoAnchor.hide(true)
    await app.renderOnce()
    logoAnchor.hide(false)
    await app.renderOnce()
    expect(app.captureCharFrame()).toBe(before)
  })

  test("hidden or not can be asked of it", () => {
    expect(logoAnchor.hidden()).toBe(false)
    logoAnchor.hide(true)
    expect(logoAnchor.hidden()).toBe(true)
  })
})
})

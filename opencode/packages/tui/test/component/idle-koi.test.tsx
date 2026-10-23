/** @jsxImportSource @opentui/solid */
import { afterEach, describe, expect, test } from "bun:test"
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createSignal, onMount, Show } from "solid-js"
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
import { IdleKoi } from "../../src/component/idle-koi"

const DELAY = 10_000
/** Long enough for the fade-in to finish. */
const FADE = 3_500

let open: Array<{ destroy: () => void }> = []
afterEach(() => {
  for (const renderer of open) renderer.destroy()
  open = []
  delete process.env["RIFT_NO_ANIMATION"]
})

function Screen(props: { show: () => boolean; clock: ReturnType<typeof fakeClock>["clock"]; animations?: boolean; scene?: "pond" | "chase" }) {
  const kv = useKV()
  onMount(() => {
    if (props.animations === false) kv.set("animations_enabled", false)
  })
  return (
    <box width={100} height={30}>
      <text>hello</text>
      <Show when={props.show()}>
        <IdleKoi delay={DELAY} seed={9} clock={props.clock} scene={props.scene} />
      </Show>
    </box>
  )
}

function Harness(props: { show: () => boolean; clock: ReturnType<typeof fakeClock>["clock"]; animations?: boolean; scene?: "pond" | "chase" }) {
  const keymap = createDefaultOpenTuiKeymap(useRenderer())
  return (
    <OpencodeKeymapProvider keymap={keymap}>
      <TuiConfigProvider config={createTuiResolvedConfig()}>
        <KVProvider>
          <ThemeProvider mode="dark">
            <Screen show={props.show} clock={props.clock} animations={props.animations} scene={props.scene} />
          </ThemeProvider>
        </KVProvider>
      </TuiConfigProvider>
    </OpencodeKeymapProvider>
  )
}

async function mount(options: { animations?: boolean; width?: number; height?: number; scene?: "pond" | "chase" } = {}) {
  const [show, setShow] = createSignal(true)
  const fake = fakeClock()
  const state = mkdtempSync(path.join(tmpdir(), "rift-koi-"))
  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state }}>
        <Harness show={show} clock={fake.clock} animations={options.animations} scene={options.scene} />
      </TestTuiContexts>
    ),
    { width: options.width ?? 100, height: options.height ?? 30 },
  )
  open.push(app.renderer)
  // The theme loads a moment after the first frame. The fake clock does not move while we wait, so
  // however slow the machine is, the pond cannot have started.
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    await app.renderOnce()
    if (app.captureCharFrame().includes("hello")) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return { app, setShow, ...fake }
}

type Mounted = Awaited<ReturnType<typeof mount>>

/** Characters on screen that are not blank. Just "hello" when nothing else is being drawn. */
async function drawn(app: Mounted["app"]) {
  await app.renderOnce()
  return [...app.captureCharFrame()].filter((char) => char !== " " && char !== "\n").length
}

/** Goes quiet for the whole delay and lets the fade-in finish. */
async function goQuiet(screen: Mounted) {
  screen.advance(DELAY)
  screen.advance(FADE)
  await screen.app.renderOnce()
}

describe("the idle koi pond on the home screen", () => {
  test("nothing is drawn until the user has been idle for the whole delay, then the pond appears and the text stays", async () => {
    const screen = await mount()
    expect(await drawn(screen.app)).toBe(5)
    screen.advance(DELAY - 1)
    expect(await drawn(screen.app)).toBe(5)

    screen.advance(1)
    screen.advance(FADE)
    expect(await drawn(screen.app)).toBeGreaterThan(20)
    expect(screen.app.captureCharFrame().split("\n")[0]).toMatch(/^hello/)
  })

  test("a keypress takes them away by the very next frame", async () => {
    const screen = await mount()
    await goQuiet(screen)
    expect(await drawn(screen.app)).toBeGreaterThan(20)
    screen.app.mockInput.pressKey("a")
    expect(await drawn(screen.app)).toBe(5)
  })

  test("so does moving the mouse", async () => {
    const screen = await mount()
    await goQuiet(screen)
    expect(await drawn(screen.app)).toBeGreaterThan(20)
    await screen.app.mockMouse.moveTo(40, 12)
    expect(await drawn(screen.app)).toBe(5)
  })

  test("and a click", async () => {
    const screen = await mount()
    await goQuiet(screen)
    await screen.app.mockMouse.click(40, 12)
    expect(await drawn(screen.app)).toBe(5)
  })

  test("and pasting text", async () => {
    const screen = await mount()
    await goQuiet(screen)
    await screen.app.mockInput.pasteBracketedText("npm install")
    expect(await drawn(screen.app)).toBe(5)
  })

  test("after input they stay away for a full delay, then come back", async () => {
    const screen = await mount()
    await goQuiet(screen)
    screen.app.mockInput.pressKey("a")
    expect(await drawn(screen.app)).toBe(5)
    screen.advance(DELAY - 1)
    expect(await drawn(screen.app)).toBe(5)
    screen.advance(1)
    screen.advance(FADE)
    expect(await drawn(screen.app)).toBeGreaterThan(20)
  })

  test("steady input keeps them away", async () => {
    const screen = await mount()
    for (let step = 0; step < 30; step++) {
      screen.advance(DELAY / 2)
      screen.app.mockInput.pressKey("a")
      expect(await drawn(screen.app)).toBe(5)
    }
  })

  test("with animations turned off they never appear", async () => {
    const screen = await mount({ animations: false })
    screen.advance(DELAY * 3)
    expect(await drawn(screen.app)).toBe(5)
  })

  test("RIFT_NO_ANIMATION=1 turns them off too, but 0 does not", async () => {
    process.env["RIFT_NO_ANIMATION"] = "1"
    const off = await mount()
    off.advance(DELAY * 3)
    expect(await drawn(off.app)).toBe(5)

    process.env["RIFT_NO_ANIMATION"] = "0"
    const on = await mount()
    await goQuiet(on)
    expect(await drawn(on.app)).toBeGreaterThan(20)
  })

  test("leaving the home screen clears them and nothing comes back", async () => {
    const screen = await mount()
    await goQuiet(screen)
    expect(await drawn(screen.app)).toBeGreaterThan(20)
    screen.setShow(false)
    expect(await drawn(screen.app)).toBe(5)
    screen.advance(DELAY * 3)
    expect(await drawn(screen.app)).toBe(5)
  })

  test("a terminal too small for a pond when the time comes gets one as soon as it is made bigger", async () => {
    const screen = await mount({ width: 50, height: 10 })
    await goQuiet(screen)
    expect(await drawn(screen.app)).toBe(5)

    screen.app.resize(100, 30)
    screen.advance(FADE)
    expect(await drawn(screen.app)).toBeGreaterThan(20)
  })

  test("shrinking below what a pond needs stops the render loop instead of leaving it running", async () => {
    const screen = await mount()
    let live = 0
    const { requestLive, dropLive } = screen.app.renderer
    screen.app.renderer.requestLive = () => {
      live++
      requestLive.call(screen.app.renderer)
    }
    screen.app.renderer.dropLive = () => {
      live--
      dropLive.call(screen.app.renderer)
    }

    await goQuiet(screen)
    expect(live).toBe(1)

    screen.app.resize(50, 10)
    expect(await drawn(screen.app)).toBe(5)
    expect(live).toBe(0)

    screen.app.resize(100, 30)
    screen.advance(FADE)
    expect(await drawn(screen.app)).toBeGreaterThan(20)
    expect(live).toBe(1)
  })

  test("either scene shows: the quiet pond, and the chase", async () => {
    for (const scene of ["pond", "chase"] as const) {
      const screen = await mount({ scene })
      await goQuiet(screen)
      expect(await drawn(screen.app)).toBeGreaterThan(20)
      screen.app.mockInput.pressKey("a")
      expect(await drawn(screen.app)).toBe(5)
    }
  })

  test("making the terminal bigger or smaller while the pond is out keeps it swimming, with no input needed", async () => {
    const screen = await mount()
    await goQuiet(screen)
    expect(await drawn(screen.app)).toBeGreaterThan(20)
    screen.app.resize(140, 40)
    screen.advance(100)
    expect(await drawn(screen.app)).toBeGreaterThan(20)
    screen.app.resize(80, 24)
    screen.advance(100)
    expect(await drawn(screen.app)).toBeGreaterThan(20)
  })

  test("it keeps swimming as time goes on: the picture changes from one moment to the next", async () => {
    const screen = await mount({ scene: "pond" })
    await goQuiet(screen)
    await screen.app.renderOnce()
    const before = screen.app.captureCharFrame()
    // Four seconds of frames, thirty a second.
    for (let frame = 0; frame < 120; frame++) {
      screen.advance(33)
      await screen.app.renderOnce()
    }
    expect(screen.app.captureCharFrame()).not.toBe(before)
  })

  test("leaving gives the root's mouse handling back as it was, unless someone else has wrapped it since", async () => {
    const before = await mount()
    const original = Object.getPrototypeOf(before.app.renderer.root).processMouseEvent
    expect(before.app.renderer.root.processMouseEvent).not.toBe(original)
    before.setShow(false)
    await before.app.renderOnce()
    expect(before.app.renderer.root.processMouseEvent).toBe(original)

    const other = await mount()
    const root = other.app.renderer.root
    const ours = root.processMouseEvent
    const theirs = function (this: typeof root, event: Parameters<typeof ours>[0]) {
      ours.call(this, event)
    }
    root.processMouseEvent = theirs
    other.setShow(false)
    await other.app.renderOnce()
    expect(root.processMouseEvent).toBe(theirs)
  })
})

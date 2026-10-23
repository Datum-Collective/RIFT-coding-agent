/** @jsxImportSource @opentui/solid */
import { afterEach, describe, expect, test } from "bun:test"
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createSignal, onMount, Show } from "solid-js"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { OpencodeKeymapProvider } from "../../src/keymap"
import { ThemeProvider, useTheme } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { KVProvider, useKV } from "../../src/context/kv"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"
import { fakeClock } from "../fixture/fake-clock"
import { IdleKoi } from "../../src/component/idle-koi"
import { Banner } from "../../src/component/banner"
import { riftLogo } from "../../src/koi/logo"

/** How far in from the left the banner is laid out, so a test can move it. */
const [bannerPad, setBannerPad] = createSignal(10)

const DELAY = 10_000
/** Long enough for the fade-in to finish. */
const FADE = 3_500

let open: Array<{ destroy: () => void }> = []
afterEach(() => {
  for (const renderer of open) renderer.destroy()
  open = []
  setBannerPad(10)
  delete process.env["RIFT_NO_ANIMATION"]
})

function Screen(props: {
  show: () => boolean
  clock: ReturnType<typeof fakeClock>["clock"]
  animations?: boolean
  scene?: "pond" | "chase"
  expose?: (theme: ReturnType<typeof useTheme>) => void
  banner?: boolean
}) {
  const kv = useKV()
  const theme = useTheme()
  onMount(() => {
    props.expose?.(theme)
    if (props.animations === false) kv.set("animations_enabled", false)
  })
  return (
    <box width={props.banner ? undefined : 100} height={30}>
      <text>hello</text>
      <Show when={props.banner}>
        <box paddingLeft={bannerPad()}>
          <Banner />
        </box>
      </Show>
      <Show when={props.show()}>
        <IdleKoi delay={DELAY} seed={9} clock={props.clock} scene={props.scene} />
      </Show>
    </box>
  )
}

function Harness(props: {
  show: () => boolean
  clock: ReturnType<typeof fakeClock>["clock"]
  animations?: boolean
  scene?: "pond" | "chase"
  expose?: (theme: ReturnType<typeof useTheme>) => void
  banner?: boolean
}) {
  const keymap = createDefaultOpenTuiKeymap(useRenderer())
  return (
    <OpencodeKeymapProvider keymap={keymap}>
      <TuiConfigProvider config={createTuiResolvedConfig()}>
        <KVProvider>
          <ThemeProvider mode="dark">
            <Screen show={props.show} clock={props.clock} animations={props.animations} scene={props.scene} expose={props.expose} banner={props.banner} />
          </ThemeProvider>
        </KVProvider>
      </TuiConfigProvider>
    </OpencodeKeymapProvider>
  )
}

async function mount(options: { animations?: boolean; width?: number; height?: number; scene?: "pond" | "chase"; banner?: boolean } = {}) {
  const [show, setShow] = createSignal(true)
  const fake = fakeClock()
  let theme!: ReturnType<typeof useTheme>
  const state = mkdtempSync(path.join(tmpdir(), "rift-koi-"))
  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state }}>
        <Harness show={show} clock={fake.clock} animations={options.animations} scene={options.scene} expose={(value) => (theme = value)} banner={options.banner} />
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
  return { app, setShow, get theme() { return theme }, ...fake }
}

type Mounted = Awaited<ReturnType<typeof mount>>

/** Characters on screen that are not blank. Just "hello" when nothing else is being drawn. */
async function drawn(app: Mounted["app"]) {
  await app.renderOnce()
  return [...app.captureCharFrame()].filter((char) => char !== " " && char !== "\n").length
}

const BLOCKS = /[▘▝▀▖▌▞▛▗▚▐▜▄▙▟█]/

/** Every colour the pond's cells are drawn in, as "r,g,b". */
function pondColours(app: Mounted["app"]) {
  const found = new Set<string>()
  for (const line of app.captureSpans().lines) {
    for (const span of line.spans) {
      if (!BLOCKS.test(span.text)) continue
      for (const colour of [span.fg, span.bg]) found.add(`${colour.buffer[0]},${colour.buffer[1]},${colour.buffer[2]}`)
    }
  }
  return found
}

/** A theme colour as the pond sees it. */
const asKey = (colour: { r: number; g: number; b: number }) => `${Math.round(colour.r * 255)},${Math.round(colour.g * 255)},${Math.round(colour.b * 255)}`

/** Characters on screen from this row down. */
const below = (app: Mounted["app"], row: number) =>
  app
    .captureCharFrame()
    .split("\n")
    .slice(row)
    .join("")
    .replace(/\s/g, "").length

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

  test("the renderer's own hover events, sent when what is under a still pointer changes, are not the user", async () => {
    const screen = await mount()
    await goQuiet(screen)
    expect(await drawn(screen.app)).toBeGreaterThan(20)
    const root = screen.app.renderer.root
    root.processMouseEvent({ type: "over", x: 3, y: 3, button: 0, modifiers: {} } as never)
    root.processMouseEvent({ type: "out", x: 3, y: 3, button: 0, modifiers: {} } as never)
    expect(await drawn(screen.app)).toBeGreaterThan(20)
    root.processMouseEvent({ type: "move", x: 4, y: 3, button: 0, modifiers: {} } as never)
    expect(await drawn(screen.app)).toBe(5)
  })

  test("if something goes wrong while drawing, the pond ends and the screen is left alone, instead of every frame failing", async () => {
    const screen = await mount()
    let draw: ((buffer: unknown) => void) | undefined
    const { addPostProcessFn, removePostProcessFn } = screen.app.renderer
    let removed = 0
    screen.app.renderer.addPostProcessFn = (fn) => {
      draw = fn as never
      addPostProcessFn.call(screen.app.renderer, fn)
    }
    screen.app.renderer.removePostProcessFn = (fn) => {
      removed++
      removePostProcessFn.call(screen.app.renderer, fn)
    }
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
    expect(draw).toBeDefined()
    expect(live).toBe(1)

    // A buffer that is not one: whatever goes wrong inside, the frame loop must not see it.
    expect(() => draw!({})).not.toThrow()
    expect(removed).toBe(1)
    expect(live).toBe(0)
    expect(await drawn(screen.app)).toBe(5)

    // And it does not try again for as long as this screen is up.
    screen.advance(DELAY * 3)
    expect(await drawn(screen.app)).toBe(5)
    expect(live).toBe(0)
  })

  test("in the background the renderer is let go of, and picked up again on coming back, exactly once each way", async () => {
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

    screen.app.renderer.emit("blur")
    screen.app.renderer.emit("blur")
    expect(live).toBe(0)
    screen.app.renderer.emit("focus")
    screen.app.renderer.emit("focus")
    expect(live).toBe(1)

    // Input while it is in the background lets go once, not twice.
    screen.app.renderer.emit("blur")
    expect(live).toBe(0)
    screen.app.mockInput.pressKey("a")
    expect(live).toBe(0)
    screen.app.renderer.emit("focus")
    expect(live).toBe(0)
  })

  test("a pond that comes up while the terminal is in the background does not hold the renderer", async () => {
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
    screen.app.renderer.emit("blur")
    await goQuiet(screen)
    expect(live).toBe(0)
    screen.app.renderer.emit("focus")
    expect(live).toBe(1)
  })

  test("when the theme changes while the pond is out, the pond changes colour with it", async () => {
    const screen = await mount({ scene: "pond" })
    await goQuiet(screen)
    const before = asKey(screen.theme.theme.text)
    expect(pondColours(screen.app).has(before)).toBe(true)

    screen.theme.setMode(screen.theme.mode() === "dark" ? "light" : "dark")
    await screen.app.renderOnce()
    const after = asKey(screen.theme.theme.text)
    expect(after).not.toBe(before)
    screen.advance(100)
    await screen.app.renderOnce()
    expect(pondColours(screen.app).has(after)).toBe(true)
    expect(pondColours(screen.app).has(before)).toBe(false)
  })

  test("a window dragged bigger gets one new pond once it stops, while the old one swims on in the meantime", async () => {
    const screen = await mount({ scene: "pond" })
    await goQuiet(screen)
    expect(await drawn(screen.app)).toBeGreaterThan(20)

    for (const width of [104, 110, 118, 126, 140]) {
      screen.app.resize(width, 40)
      screen.advance(20)
    }
    // Still the old pond, drawn for 30 rows: nothing yet in the new rows.
    await screen.app.renderOnce()
    expect(below(screen.app, 30)).toBe(0)
    expect(await drawn(screen.app)).toBeGreaterThan(20)

    screen.advance(200)
    await screen.app.renderOnce()
    expect(below(screen.app, 30)).toBeGreaterThan(0)
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

  describe("with the real banner on the screen", () => {
    const BANNER_ROW = riftLogo.glyphs[0]!.slice(0, 4)
    const rowsOf = (app: Mounted["app"]) => app.captureCharFrame().split("\n")
    const hasBanner = (app: Mounted["app"]) => rowsOf(app).some((line) => line.includes(BANNER_ROW))

    test("the banner is on the screen until the pond comes, then it is taken over and the logo's pixels stand in for it", async () => {
      const screen = await mount({ banner: true, width: 100, height: 30 })
      await screen.app.renderOnce()
      expect(hasBanner(screen.app)).toBe(true)
      screen.advance(DELAY)
      await screen.app.renderOnce()
      expect(hasBanner(screen.app)).toBe(false)
      // Something is still drawn where it was: the logo, as blocks.
      const where = rowsOf(screen.app).slice(2, 16).join("")
      expect(where.replace(/\s/g, "").length).toBeGreaterThan(100)
    })

    test("the first input brings the banner back exactly as it was, by the very next frame", async () => {
      const screen = await mount({ banner: true, width: 100, height: 30 })
      await screen.app.renderOnce()
      const before = screen.app.captureCharFrame()
      await goQuiet(screen)
      expect(screen.app.captureCharFrame()).not.toBe(before)
      screen.app.mockInput.pressKey("a")
      await screen.app.renderOnce()
      expect(screen.app.captureCharFrame()).toBe(before)
    })

    test("once the logo has become koi, the banner does not come back while they swim", async () => {
      const screen = await mount({ banner: true, width: 100, height: 30, scene: "pond" })
      await screen.app.renderOnce()
      const before = screen.app.captureCharFrame()
      screen.advance(DELAY)
      for (let frame = 0; frame < 30 * 16; frame++) {
        screen.advance(33)
        await screen.app.renderOnce()
        if (frame % 60 === 0) expect(hasBanner(screen.app)).toBe(false)
      }
      expect(hasBanner(screen.app)).toBe(false)
      screen.app.mockInput.pressKey("a")
      await screen.app.renderOnce()
      expect(screen.app.captureCharFrame()).toBe(before)
    })

    test("the intro plays in either scene", async () => {
      for (const scene of ["pond", "chase"] as const) {
        const screen = await mount({ banner: true, width: 100, height: 30, scene })
        screen.advance(DELAY)
        // Midway through the letters breaking up: there are specks of the logo in the air, and no banner.
        for (let frame = 0; frame < 30 * 4.5; frame++) {
          screen.advance(33)
          await screen.app.renderOnce()
        }
        expect(hasBanner(screen.app)).toBe(false)
        expect(await drawn(screen.app)).toBeGreaterThan(40)
        screen.app.mockInput.pressKey("a")
        await screen.app.renderOnce()
        expect(hasBanner(screen.app)).toBe(true)
      }
    })

    test("a window dragged to a new size does not play the intro again, and the logo stays gone", async () => {
      const screen = await mount({ banner: true, width: 100, height: 30, scene: "pond" })
      screen.advance(DELAY)
      for (let frame = 0; frame < 30 * 14; frame++) {
        screen.advance(33)
        await screen.app.renderOnce()
      }
      screen.app.resize(110, 34)
      screen.advance(300)
      for (let frame = 0; frame < 20; frame++) {
        screen.advance(33)
        await screen.app.renderOnce()
      }
      expect(hasBanner(screen.app)).toBe(false)
    })

    test("a window dragged to a new size in the middle of the intro does not cut it short: the logo is still there to break up", async () => {
      const screen = await mount({ banner: true, width: 100, height: 30, scene: "pond" })
      screen.advance(DELAY)
      for (let frame = 0; frame < 30 * 1.5; frame++) {
        screen.advance(33)
        await screen.app.renderOnce()
      }
      // The logo is up, as blocks, about a third of the way into its rest.
      const logoRows = () => rowsOf(screen.app).slice(1, 14).join("").replace(/\s/g, "").length
      expect(logoRows()).toBeGreaterThan(250)

      screen.app.resize(110, 34)
      screen.advance(300)
      for (let frame = 0; frame < 20; frame++) {
        screen.advance(33)
        await screen.app.renderOnce()
      }
      // A pond with the intro cut off would have only koi here, well under this; this is still the logo.
      expect(hasBanner(screen.app)).toBe(false)
      expect(logoRows()).toBeGreaterThan(250)
    })

    test("if the banner is moved while the pond is out, the logo is redrawn where the banner now is", async () => {
      const screen = await mount({ banner: true, width: 120, height: 30, scene: "pond" })
      screen.advance(DELAY)
      for (let frame = 0; frame < 30 * 1.5; frame++) {
        screen.advance(33)
        await screen.app.renderOnce()
      }
      // The leftmost block of the logo, in the rows it is in.
      const leftmost = () =>
        Math.min(
          ...rowsOf(screen.app)
            .slice(1, 14)
            .map((line) => line.search(/\S/))
            .filter((column) => column >= 0),
        )
      const before = leftmost()
      expect(before).toBeGreaterThanOrEqual(10)
      expect(before).toBeLessThan(14)

      setBannerPad(22)
      for (let frame = 0; frame < 30; frame++) {
        screen.advance(33)
        await screen.app.renderOnce()
      }
      expect(hasBanner(screen.app)).toBe(false)
      expect(leftmost()).toBeGreaterThanOrEqual(22)
    })

    test("on a terminal too narrow for the banner there is no intro and no cover, just the pond", async () => {
      const screen = await mount({ banner: true, width: 70, height: 30 })
      await goQuiet(screen)
      expect(await drawn(screen.app)).toBeGreaterThan(20)
    })
  })
})

import { createEffect, createSignal, onCleanup, untrack } from "solid-js"
import { useRenderer } from "@opentui/solid"
import { Journey } from "@opencode-ai/core/installation/journey"
import { useKV } from "../context/kv"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import type { Context } from "../background/host"
import type { Engine } from "../background/src/engine"
import type { Wallpaper } from "../background/src/wallpaper"
import { ACTIVITY_CHOICES, BRIGHTNESS_CHOICES, KEYS, TIME_CHOICES, pick, timeAt } from "../background/catalog"

// Seconds the scene takes to fade into the next time of day when the clock crosses into it.
const CLOCK_FADE = 45

/**
 * Draws the chosen /background wallpaper behind everything. Renders nothing itself. The engine and the scenes load
 * the first time a wallpaper is chosen, so RIFT starts as fast as it did without them.
 */
export function BackgroundHost() {
  const renderer = useRenderer()
  const kv = useKV()
  const sync = useSync()
  const theme = useTheme()
  const toast = useToast()

  const [now, setNow] = createSignal(new Date())
  const clock = setInterval(() => setNow(new Date()), 60_000)
  onCleanup(() => clearInterval(clock))

  const wakers = new Set<() => void>()
  const context: Context = {
    renderer,
    get themeMode() {
      return theme.mode()
    },
    data: {
      listen(wake) {
        wakers.add(wake)
        return () => void wakers.delete(wake)
      },
    },
  }

  let loaded: Promise<{ engine: Engine; wallpapers: readonly Wallpaper[] }> | undefined
  const load = () =>
    (loaded ??= Promise.all([import("../background/src/engine"), import("../background/wallpapers")]).then(
      ([{ createEngine }, { WALLPAPERS }]) => ({ engine: createEngine(context), wallpapers: WALLPAPERS }),
    ))
  // The engine, only once one has been made: stopping must not be what loads it.
  let engine: Engine | undefined
  let version = 0

  const allowed = () => kv.get("animations_enabled", true) !== false && !Journey.animationOff(process.env)

  let chosen = ""
  createEffect(() => {
    const id = allowed() ? String(kv.get(KEYS.wallpaper, "") ?? "") : ""
    const activity = pick(ACTIVITY_CHOICES, kv.get(KEYS.activity), "calm")
    const time = pick(TIME_CHOICES, kv.get(KEYS.time), "auto")
    const brightness = pick(BRIGHTNESS_CHOICES, kv.get(KEYS.brightness), "normal")
    const clockTime = timeAt(now())
    // With the same choices as last time only the clock can have changed the look, and that fades slowly.
    const key = `${id} ${activity} ${time}`
    const slow = key === chosen
    chosen = key
    const mine = ++version
    if (!id) {
      engine?.stop()
      return
    }
    void load()
      .then((ready) => {
        if (mine !== version) return
        engine = ready.engine
        const wallpaper = ready.wallpapers.find((item) => item.id === id)
        if (!wallpaper) {
          engine.stop()
          return
        }
        engine.start(wallpaper, { activity, time: time === "auto" ? clockTime : time, brightness }, slow ? CLOCK_FADE : undefined)
      })
      .catch((error: unknown) => {
        if (mine !== version) return
        loaded = undefined
        kv.set(KEYS.wallpaper, "")
        toast.show({
          message: `The ${id} background failed to start: ${error instanceof Error ? error.message : String(error)}`,
          variant: "error",
        })
      })
  })

  // The scene follows the agent: busy while any session runs, a visitor when it finishes.
  const busy = () => Object.values(sync.data.session_status).some((status) => status?.type === "busy")
  let was = false
  createEffect(() => {
    const working = busy()
    if (working === was) return
    was = working
    untrack(() => {
      engine?.react(working ? "busy" : "done")
      for (const wake of wakers) wake()
    })
  })

  onCleanup(() => {
    version++
    engine?.stop()
  })

  return null
}

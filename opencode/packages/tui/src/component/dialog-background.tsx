import { createMemo } from "solid-js"
import { useKV } from "../context/kv"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import {
  ACTIVITY_CHOICES,
  BRIGHTNESS_CHOICES,
  KEYS,
  TIME_CHOICES,
  WALLPAPER_CHOICES,
  next,
  pick,
} from "../background/catalog"

type Value = { kind: "fish" } | { kind: "wallpaper"; id: string } | { kind: "setting"; key: "activity" | "time" | "brightness" }

const cap = (text: string) => text.slice(0, 1).toUpperCase() + text.slice(1)

/** /background: the fish, the wallpapers and how the wallpaper looks, in one list. */
export function DialogBackground() {
  const kv = useKV()
  const dialog = useDialog()

  const wallpaper = () => String(kv.get(KEYS.wallpaper, "") ?? "")
  const fish = () => kv.get(KEYS.fish, true) !== false
  const activity = () => pick(ACTIVITY_CHOICES, kv.get(KEYS.activity), "calm")
  const time = () => pick(TIME_CHOICES, kv.get(KEYS.time), "auto")
  const brightness = () => pick(BRIGHTNESS_CHOICES, kv.get(KEYS.brightness), "normal")

  const options = createMemo<DialogSelectOption<Value>[]>(() => [
    {
      title: `Fish: ${fish() ? "on" : "off"}`,
      value: { kind: "fish" },
      description: "the koi pond when you go quiet, and the koi that swim while you type",
      category: "Animations",
    },
    {
      title: "None",
      value: { kind: "wallpaper", id: "" },
      description: "no wallpaper behind the text",
      category: "Wallpaper",
    },
    ...WALLPAPER_CHOICES.map((item) => ({
      title: item.name,
      value: { kind: "wallpaper", id: item.id } as Value,
      description: item.description,
      category: "Wallpaper",
    })),
    { title: `Activity: ${activity()}`, value: { kind: "setting", key: "activity" }, description: "how much happens in the scene", category: "Wallpaper settings" },
    { title: `Time of day: ${cap(time())}`, value: { kind: "setting", key: "time" }, description: "auto follows your clock", category: "Wallpaper settings" },
    { title: `Brightness: ${brightness()}`, value: { kind: "setting", key: "brightness" }, description: "how strongly the scene shows", category: "Wallpaper settings" },
  ])

  return (
    <DialogSelect<Value>
      title="Background"
      placeholder="Search"
      options={options()}
      current={{ kind: "wallpaper", id: wallpaper() }}
      onSelect={(option) => {
        const value = option.value
        if (value.kind === "fish") {
          kv.set(KEYS.fish, !fish())
          return
        }
        if (value.kind === "wallpaper") {
          kv.set(KEYS.wallpaper, value.id)
          dialog.clear()
          return
        }
        if (value.key === "activity") kv.set(KEYS.activity, next(ACTIVITY_CHOICES, activity()))
        if (value.key === "time") kv.set(KEYS.time, next(TIME_CHOICES, time()))
        if (value.key === "brightness") kv.set(KEYS.brightness, next(BRIGHTNESS_CHOICES, brightness()))
      }}
    />
  )
}

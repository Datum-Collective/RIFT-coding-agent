import type { Activity, Brightness, Time } from "./src/wallpaper"

// What /background lists, kept apart from the scenes so the menu opens without loading the engine. A test checks
// that it matches the scenes.
export const WALLPAPER_CHOICES = [
  { id: "rift", name: "Rift", description: "RIFT's own: a seam of azure light that widens while it works" },
  { id: "matrix", name: "Matrix", description: "digital rain: mirrored katakana falling down a black screen" },
  { id: "city", name: "City", description: "a skyline over a river, traffic on a highway, a blimp now and then" },
  { id: "megacity", name: "Megacity", description: "a canyon of towers over a neon avenue, motorbikes trailing red light" },
  { id: "dome", name: "Dome", description: "a black energy dome over a ruined city, a gunship crossing now and then" },
  { id: "rider", name: "Rider", description: "a red capsule bike on cracked concrete, its rider walking up to it" },
  { id: "space", name: "Space", description: "a ringed planet below a nebula and drifting stars" },
  { id: "pipes", name: "3D Pipes", description: "the old screensaver: glossy pipes growing through the dark" },
  { id: "mystify", name: "Mystify", description: "the old screensaver: polygons gliding and bouncing, trailing echoes" },
] as const

export const ACTIVITY_CHOICES: readonly Activity[] = ["calm", "lively", "teeming"]
export const TIME_CHOICES = ["auto", "day", "sunset", "night"] as const
export const BRIGHTNESS_CHOICES: readonly Brightness[] = ["subtle", "normal", "vivid"]

export type TimeChoice = (typeof TIME_CHOICES)[number]

/** The kv keys /background keeps its settings under. */
export const KEYS = {
  wallpaper: "background",
  activity: "background_activity",
  time: "background_time",
  brightness: "background_brightness",
  fish: "koi_enabled",
} as const

// Night from 8pm to 6am, sunset around dawn and dusk, day otherwise.
export function timeAt(date: Date): Time {
  const hour = date.getHours() + date.getMinutes() / 60
  if (hour >= 20 || hour < 6) return "night"
  if (hour < 7 || hour >= 18) return "sunset"
  return "day"
}

export function next<T>(options: readonly T[], value: T): T {
  return options[(options.indexOf(value) + 1) % options.length]!
}

/** A stored value if it is one of the options, otherwise the fallback: a hand-edited kv file must not break the scene. */
export function pick<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return options.find((option) => option === value) ?? fallback
}

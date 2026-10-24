import type { RGB } from "./math"

// A wallpaper's animation. Each frame the engine resizes the scene to the sub-pixel grid it needs, steps it by the
// elapsed seconds, renders it, and reads `pixels` (RGBA, W x H; only resize may replace the array). Extending Canvas
// provides everything but step and render. resize's cells is set when each pixel becomes one sub-pixel of a terminal
// character cell, fitted to two colors per cell, so the scene can draw bolder.
export interface Scene {
  readonly W: number
  readonly H: number
  readonly pixels: Uint8Array
  // Optional: boxes [x0, y0, x1, y1, ...] in pixels, inclusive, outside which this frame's pixels match the last
  // frame's (Canvas provides it). Without it the engine refits every cell every frame.
  readonly changed?: readonly number[]
  // Optional: boxes like changed's around what this frame drew over the still background, so the engine can let cells
  // where something moves follow it more closely (Canvas provides it).
  readonly touched?: readonly number[]
  // Optional: sun and moon discs [cx, cy, r, ...] in pixels, which the engine keeps smooth wedge glyphs off.
  readonly orbs?: readonly number[]
  // Optional: still points of light the last render left out of pixels, for the engine to draw as dot glyphs (see
  // src/points.ts; Canvas provides them).
  readonly points?: { readonly count: number; readonly data: Float32Array }
  resize(W: number, H: number, cells?: boolean): void
  step(dt: number): void
  render(): void
  // Optional: what the OpenCode agent is doing. Scenes bring on a rare visitor when a task is done and turn overcast
  // after an error until the next event (the engine sends idle a couple of minutes later); the engine itself speeds up
  // while busy and dims after an error.
  react?(event: AgentEvent): void
  // Optional reaction to a click on open background, in screen heights: x runs 0..W/H across and y 0..1 down.
  poke?(x: number, y: number): void
  // Optional: where OpenCode's text sits, sent when the scene starts and about once a second after that, so creatures
  // can keep to open ground and visitors can come on where they'll be seen.
  textMap?(map: TextMap): void
}

// A coarse grid over the whole screen, row-major: how much each cell is covered by text, its scrim or a panel, from 0
// (open) to 1 (hidden).
export interface TextMap {
  readonly cols: number
  readonly rows: number
  readonly cover: Float32Array
}

export const AGENT_EVENTS = ["busy", "idle", "done", "error"] as const
export type AgentEvent = (typeof AGENT_EVENTS)[number]

export interface Wallpaper {
  // Used by /wallpaper <id>; lowercase, no spaces.
  readonly id: string
  readonly name: string
  readonly description: string
  // For a wallpaper with one look: the time of day it always renders at, whatever the time setting. The menu hides
  // its time row.
  readonly fixedTime?: Time
  // For each time of day, colors (0-255) that text scrims fade the scene toward at the top, middle and bottom of the
  // screen. Darker, more saturated versions of the scene's own colors at those depths read better than black.
  readonly scrim: Readonly<Record<Time, Scrim>>
  // What each activity level shows, for the picker.
  readonly activity: Readonly<Record<Activity, string>>
  create(settings: Settings): Scene
}

export type Scrim = readonly [RGB, RGB, RGB]

// The settings a wallpaper renders with: one with a fixed time ignores the time setting.
export function settingsFor(wallpaper: Wallpaper, settings: Settings): Settings {
  return wallpaper.fixedTime ? { ...settings, time: wallpaper.fixedTime } : settings
}

export interface Settings {
  readonly activity: Activity
  readonly time: Time
  // Defaults to normal. The engine applies it, and changing only this restyles the running scene instead of
  // restarting it.
  readonly brightness?: Brightness
}

// How much is going on in the scene. calm is scenery with rare events; teeming is the full cast.
export const ACTIVITIES = ["calm", "lively", "teeming"] as const
export type Activity = (typeof ACTIVITIES)[number]

export const TIMES = ["day", "sunset", "night"] as const
export type Time = (typeof TIMES)[number]

export const BRIGHTNESSES = ["subtle", "normal", "vivid"] as const
export type Brightness = (typeof BRIGHTNESSES)[number]

// saver slows down when nobody is using OpenCode and stops while the terminal is in the background; smooth never does.
export const POWERS = ["saver", "smooth"] as const
export type Power = (typeof POWERS)[number]

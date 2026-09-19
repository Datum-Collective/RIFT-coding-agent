import { RGBA } from "@opentui/core"
import { For, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { banner, BANNER_WIDTH, type BannerFill, type BannerInk } from "../banner"
import { Logo } from "./logo"

// The banner is brand art, so its blues are fixed. The greys follow the theme so the artwork
// stays legible on a light terminal instead of washing out.
const BLUE = RGBA.fromInts(59, 120, 255, 255)
const AZURE = RGBA.fromInts(124, 160, 255, 255)
const BLUE_FILL = RGBA.fromInts(30, 64, 175, 255)

export function Banner() {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const fits = () => dimensions().width >= BANNER_WIDTH + 4

  const ink = (name: BannerInk) => {
    switch (name) {
      case "blue":
        return BLUE
      case "azure":
        return AZURE
      case "dim":
        return theme.textMuted
      case "white":
        return theme.text
      default:
        return theme.textMuted
    }
  }

  const fill = (name: BannerFill | undefined) => {
    if (!name) return undefined
    return name === "bluebg" ? BLUE_FILL : theme.backgroundElement
  }

  return (
    <Show when={fits()} fallback={<Logo />}>
      <box flexShrink={0}>
        <For each={banner}>
          {(row) => (
            <text selectable={false}>
              <For each={row}>{(run) => <span style={{ fg: ink(run.fg), bg: fill(run.bg) }}>{run.text}</span>}</For>
            </text>
          )}
        </For>
      </box>
    </Show>
  )
}

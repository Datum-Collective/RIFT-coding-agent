import { RGBA } from "@opentui/core"
import { For, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { banner, BANNER_FILL, BANNER_INK, BANNER_WIDTH, type BannerFill, type BannerInk } from "../banner"
import { Logo } from "./logo"

// The banner is a fixed-palette drawing, so its colours are reproduced exactly rather than
// mapped onto the theme: two of its five inks are greys that differ only in value, and
// collapsing them onto theme tokens turns the artwork into noise.
const INK = Object.fromEntries(Object.entries(BANNER_INK).map(([name, hex]) => [name, RGBA.fromHex(hex)])) as Record<
  BannerInk,
  RGBA
>

const FILL = Object.fromEntries(Object.entries(BANNER_FILL).map(([name, hex]) => [name, RGBA.fromHex(hex)])) as Record<
  BannerFill,
  RGBA
>

export function Banner() {
  const dimensions = useTerminalDimensions()
  const fits = () => dimensions().width >= BANNER_WIDTH + 4

  return (
    <Show when={fits()} fallback={<Logo />}>
      <box flexShrink={0}>
        <For each={banner}>
          {(row) => (
            <text selectable={false}>
              <For each={row}>
                {(run) => <span style={{ fg: INK[run.fg], bg: run.bg ? FILL[run.bg] : undefined }}>{run.text}</span>}
              </For>
            </text>
          )}
        </For>
      </box>
    </Show>
  )
}

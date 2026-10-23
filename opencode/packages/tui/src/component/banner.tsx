import { RGBA } from "@opentui/core"
import { For, onCleanup, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { banner, BANNER_FILL, BANNER_INK, BANNER_WIDTH, type BannerFill, type BannerInk } from "../banner"
import { Logo } from "./logo"
import { logoAnchor } from "./banner-anchor"

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

/** Whether the full banner fits, leaving room for the screen's side padding. */
export function bannerFits(terminalWidth: number) {
  return terminalWidth >= BANNER_WIDTH + 4
}

export function Banner() {
  const dimensions = useTerminalDimensions()
  const fits = () => bannerFits(dimensions().width)

  return (
    <Show when={fits()} fallback={<Logo />}>
      <box
        flexShrink={0}
        width={BANNER_WIDTH}
        height={banner.length}
        ref={(box) => {
          // The idle koi pond starts from where the banner really is.
          logoAnchor.set(box)
          onCleanup(() => logoAnchor.clear(box))
        }}
      >
        {/* Hidden, it keeps its size and draws nothing: the logo has become koi. */}
        <Show when={!logoAnchor.hidden()}>
          <For each={banner}>
            {(row) => (
              <text selectable={false}>
                <For each={row}>
                  {(run) => <span style={{ fg: INK[run.fg], bg: run.bg ? FILL[run.bg] : undefined }}>{run.text}</span>}
                </For>
              </text>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

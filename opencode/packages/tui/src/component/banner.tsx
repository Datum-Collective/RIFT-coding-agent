import { RGBA } from "@opentui/core"
import { createMemo, For, onCleanup, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { banner, bannerColours, BANNER_WIDTH } from "../banner"
import { useTheme } from "../context/theme"
import { Logo } from "./logo"
import { logoAnchor } from "./banner-anchor"

// The banner is a fixed drawing, so its colours are reproduced exactly rather than mapped onto
// theme tokens (two of its inks are greys that differ only in value). Only its two blues follow
// the theme: they become the theme's accent.
const rgba = (c: RGBA) => ({ r: c.r * 255, g: c.g * 255, b: c.b * 255 })
const toRgba = <K extends string>(colours: Record<K, string>) =>
  Object.fromEntries(Object.entries<string>(colours).map(([name, hex]) => [name, RGBA.fromHex(hex)])) as Record<K, RGBA>

/** Whether the full banner fits, leaving room for the screen's side padding. */
export function bannerFits(terminalWidth: number) {
  return terminalWidth >= BANNER_WIDTH + 4
}

export function Banner() {
  const dimensions = useTerminalDimensions()
  const fits = () => bannerFits(dimensions().width)
  const theme = useTheme()
  const colours = createMemo(() => bannerColours(rgba(theme.hue.accent[400])))
  const INK = createMemo(() => toRgba(colours().ink))
  const FILL = createMemo(() => toRgba(colours().fill))

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
                  {(run) => <span style={{ fg: INK()[run.fg], bg: run.bg ? FILL()[run.bg] : undefined }}>{run.text}</span>}
                </For>
              </text>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

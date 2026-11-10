import { RGBA } from "@opentui/core"
import { createMemo, For, onCleanup, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { banner, bannerColours, BANNER_WIDTH } from "../banner"
import { useTheme } from "../context/theme"
import { ditherBanner, logoRows, type Logo as DotLogo } from "../koi/logo"
import { Logo } from "./logo"
import { logoAnchor } from "./banner-anchor"

// The banner is a fixed drawing, so its colours are reproduced exactly rather than mapped onto
// theme tokens (two of its inks are greys that differ only in value). Only its two blues follow
// the theme: they become the theme's accent.
const rgba = (c: RGBA) => ({ r: c.r * 255, g: c.g * 255, b: c.b * 255 })

/** Whether the full banner fits, leaving room for the screen's side padding. */
export function bannerFits(terminalWidth: number) {
  return terminalWidth >= BANNER_WIDTH + 4
}

/** A logo drawn as its dots, one line of text for each row of cells. */
export function Dots(props: { logo: DotLogo }) {
  const rows = createMemo(() => logoRows(props.logo))
  return (
    <For each={rows()}>
      {(row) => (
        <text selectable={false} wrapMode="none">
          <For each={row}>{(run) => <span style={{ fg: run.fg ? RGBA.fromInts(run.fg.r, run.fg.g, run.fg.b) : undefined }}>{run.text}</span>}</For>
        </text>
      )}
    </For>
  )
}

export function Banner() {
  const dimensions = useTerminalDimensions()
  const fits = () => bannerFits(dimensions().width)
  const theme = useTheme()
  const logo = createMemo(() => ditherBanner(banner, bannerColours(rgba(theme.hue.accent[400]))))

  return (
    <Show when={fits()} fallback={<Logo />}>
      <box
        flexShrink={0}
        width={BANNER_WIDTH}
        height={banner.length}
        ref={(box) => {
          // The singularity starts from where the banner really is.
          logoAnchor.set(box)
          onCleanup(() => logoAnchor.clear(box))
        }}
        onMouseDown={(event) => {
          if (event.button === 0) logoAnchor.click()
        }}
      >
        {/* Hidden, it keeps its size and draws nothing: the singularity is drawing the logo. */}
        <Show when={!logoAnchor.hidden()}>
          <Dots logo={logo()} />
        </Show>
      </box>
    </Show>
  )
}

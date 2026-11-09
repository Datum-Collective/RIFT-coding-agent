/**
 * The middle of the home screen: the RIFT banner and the question it asks, floating above open water.
 *
 * It takes the rows the composer leaves and gives up detail as they run out (a long draft, a short
 * terminal), so the composer below never moves: banner, heading and promise; then banner and heading;
 * then a small wordmark and the heading; then the heading alone; then nothing.
 */
import path from "path"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, Match, Show, Switch, type JSX } from "solid-js"
import { BANNER_WIDTH, banner } from "../banner"
import { useTheme } from "../context/theme"
import { useLocation } from "../context/location"
import { useData } from "../context/data"
import { Locale } from "../util/locale"
import { dither } from "../koi/logo"
import { Banner, Dots } from "./banner"
import { logoAnchor } from "./banner-anchor"

/** RIFT in half blocks, for a terminal too narrow or short for the banner. It is shown as dots, like the banner. */
export const WORDMARK = ["█▀▀▄ █ █▀▀▀ ▀▀█▀▀", "█▀█  █ █▀▀    █  ", "█  █ █ █      █  "]

export type LandingDetail = "full" | "banner" | "wordmark" | "heading" | "none"

/**
 * How much of the landing fits in `rows` by `cols`. The banner needs four rows of water under it for
 * the typing koi, and the promise six; the wordmark and the heading get by with less.
 */
export function landingDetail(rows: number, cols: number): LandingDetail {
  const block = banner.length + 2
  if (cols >= BANNER_WIDTH + 4 && rows >= block + 1 + 3 + 6) return "full"
  if (cols >= BANNER_WIDTH + 4 && rows >= block + 1 + 4) return "banner"
  if (cols >= WORDMARK[0].length + 4 && rows >= WORDMARK.length + 2 + 3) return "wordmark"
  if (rows >= 3) return "heading"
  return "none"
}

/**
 * Fills the space above the composer and centres the brand in it. What sits under the brand (an update
 * notice) is passed as children.
 */
export function Landing(props: { onWidth?: (width: number) => void; children?: JSX.Element }) {
  const theme = useTheme()
  const [rows, setRows] = createSignal(0)
  const [brand, setBrand] = createSignal(0)
  const dimensions = useTerminalDimensions()
  const location = useLocation()
  const data = useData()
  const detail = createMemo(() => landingDetail(rows(), dimensions().width))
  const wordmark = createMemo(() => {
    const accent = theme.hue.accent[400]
    return dither(WORDMARK.map((row) => [{ text: row, fg: { r: accent.r * 255, g: accent.g * 255, b: accent.b * 255 } }]))
  })
  const project = createMemo(() => {
    const directory = (location.ref ?? data.location.default())?.directory
    const name = directory ? path.basename(directory) : ""
    return name ? Locale.truncate(name, Math.max(8, dimensions().width - 30)) : undefined
  })

  const question = () => (project() ? `What should change in ${project()}?` : "What should change?")
  const PROMISE = "RIFT makes the change, then runs your checks to prove it."

  /** While the black hole is out the words are gone, and an empty box the size of the words keeps everything where it was. */
  const heading = () => (
    <Show
      when={!logoAnchor.hidden()}
      fallback={<box width={question().length} height={1} flexShrink={0} />}
    >
      <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" flexShrink={0}>
        {project() ? "What should change in " : "What should change?"}
        {project() ? <span style={{ fg: theme.hue.accent[400] }}>{project()}</span> : undefined}
        {project() ? "?" : undefined}
      </text>
    </Show>
  )

  return (
    <box
      flexGrow={1}
      flexBasis={0}
      minHeight={0}
      width="100%"
      alignItems="center"
      overflow="hidden"
      onSizeChange={function () {
        // Its height is what the composer leaves, never its content's, so measuring it cannot loop.
        const height = this.height
        queueMicrotask(() => setRows(height))
      }}
    >
      {/* The same water above the brand as below it; an odd row goes below, where the typing koi swim. */}
      <box height={Math.max(0, Math.floor((rows() - brand()) / 2))} flexShrink={1} minHeight={0} />
      <box
        flexShrink={0}
        alignItems="center"
        onSizeChange={function () {
          props.onWidth?.(this.width)
          const height = this.height
          queueMicrotask(() => setBrand(height))
        }}
      >
        <Switch>
          <Match when={detail() === "full" || detail() === "banner"}>
            <Banner />
            <box height={1} flexShrink={0} />
          </Match>
          <Match when={detail() === "wordmark"}>
            <Dots logo={wordmark()} />
            <box height={1} flexShrink={0} />
          </Match>
        </Switch>
        {detail() === "none" ? null : heading()}
        {detail() === "full" ? (
          <Show when={!logoAnchor.hidden()} fallback={<box width={PROMISE.length} height={1} flexShrink={0} />}>
            <text fg={theme.text.muted} wrapMode="none" flexShrink={0}>
              {PROMISE}
            </text>
          </Show>
        ) : null}
      </box>
      {props.children}
      <box flexGrow={1} minHeight={0} />
    </box>
  )
}

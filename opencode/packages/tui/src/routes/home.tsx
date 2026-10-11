import { Prompt, type PromptRef } from "../component/prompt"
import { createEffect, createMemo, createSignal, onMount } from "solid-js"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useRouteData } from "../context/route"
import { usePromptRef } from "../context/prompt"
import { useLocal } from "../context/local"
import { usePluginRuntime } from "../plugin/runtime"
import { useEditorContext } from "../context/editor"
import { For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useRoute } from "../context/route"
import { useCommandShortcut } from "../keymap"
import { Locale } from "../util/locale"
import { HomeSessionDestinationProvider } from "./home/session-destination"
import { Banner, bannerFits } from "../component/banner"
import { BANNER_WIDTH } from "../banner"
import { useTerminalDimensions } from "@opentui/solid"

let once = false
const placeholder = {
  normal: ["fix a TODO in the codebase", "explain how this project is laid out", "fix the failing tests"],
  shell: ["ls -la", "git status", "pwd"],
}

export function Home() {
  const pluginRuntime = usePluginRuntime()
  const sync = useSync()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const [ref, setRef] = createSignal<PromptRef | undefined>()
  const args = useArgs()
  const local = useLocal()
  const editor = useEditorContext()
  const dimensions = useTerminalDimensions()
  // The composer and the card take the logo's width so the three line up exactly.
  const contentWidth = createMemo(() => (bannerFits(dimensions().width) ? BANNER_WIDTH : Math.min(80, dimensions().width - 4)))
  let sent = false

  onMount(() => {
    editor.clearSelection()
  })

  const bind = (r: PromptRef | undefined) => {
    setRef(r)
    promptRef.set(r)
    if (once || !r) return
    if (route.prompt) {
      r.set(route.prompt)
      once = true
      return
    }
    if (!args.prompt) return
    r.set({ input: args.prompt, parts: [] })
    once = true
  }

  // Wait for sync and model store to be ready before auto-submitting --prompt
  createEffect(() => {
    const r = ref()
    if (sent) return
    if (!r) return
    if (!sync.ready || !local.model.ready) return
    if (!args.prompt) return
    if (r.current.input !== args.prompt) return
    sent = true
    r.submit()
  })

  // The opening screen: RIFT's logo and name, the composer under it at the logo's width, and a
  // welcome card with the sessions worth returning to and the keys worth knowing.
  return (
    <HomeSessionDestinationProvider>
      <box flexGrow={1} minHeight={0} alignItems="center" paddingLeft={2} paddingRight={2}>
        <box flexGrow={1} minHeight={0} />
        <box width="100%" maxWidth={contentWidth()} flexShrink={0} alignItems="center">
          <pluginRuntime.Slot name="home_logo" mode="replace">
            <Banner />
            <Tagline />
          </pluginRuntime.Slot>
        </box>
        <box height={1} minHeight={0} flexShrink={1} />
        <box width="100%" maxWidth={contentWidth()} zIndex={1000} flexShrink={0}>
          <pluginRuntime.Slot name="home_prompt" mode="replace" ref={bind}>
            <Prompt ref={bind} right={<pluginRuntime.Slot name="home_prompt_right" />} placeholders={placeholder} />
          </pluginRuntime.Slot>
        </box>
        {/* The welcome card needs about a dozen rows; on a short terminal the composer wins. */}
        <Show when={dimensions().height >= 44}>
          <box width="100%" maxWidth={contentWidth()} flexShrink={0}>
            <Welcome width={contentWidth()} />
          </box>
        </Show>
        <pluginRuntime.Slot name="home_bottom" />
        <box flexGrow={1} minHeight={0} />
        <Toast />
      </box>
      <box width="100%" flexShrink={0}>
        <pluginRuntime.Slot name="home_footer" mode="single_winner" />
      </box>
    </HomeSessionDestinationProvider>
  )
}

/** The line under the logo: version, then what RIFT is, in one breath. */
function Tagline() {
  const { theme } = useTheme()
  return (
    <box paddingTop={1} flexShrink={0} alignItems="center">
      <text fg={theme.textMuted} attributes={TextAttributes.ITALIC}>
        the coding agent that checks its own work
      </text>
    </box>
  )
}

const RECENT_LIMIT = 4

function ago(time: number) {
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86_400)}d ago`
}

/**
 * Two columns in a soft card: where you left off, and how to drive RIFT. A first run gets the
 * second column alone, which is the one that matters then.
 */
function Welcome(props: { width: number }) {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const local = useLocal()
  const listKey = useCommandShortcut("session.list")
  const modelKey = useCommandShortcut("model.list")
  const paletteKey = useCommandShortcut("command.palette.show")
  const agentKey = useCommandShortcut("agent.cycle")
  // Left padding (2), the keys column (26) and the gap (4), the › and the age column.
  const titleMax = createMemo(() => Math.max(10, props.width - 2 - 1 - 27 - 4 - 2 - 10))
  const sessions = createMemo(() =>
    sync.data.session
      .filter((item) => !item.parentID)
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .slice(0, RECENT_LIMIT),
  )
  const keys = createMemo(() =>
    [
      { key: "/", label: "commands" },
      { key: "@", label: "attach a file" },
      { key: "!", label: "shell command" },
      { key: agentKey(), label: "switch agent" },
      { key: modelKey(), label: "choose a model" },
      { key: paletteKey(), label: "all commands" },
      { key: "?", label: "shortcuts" },
    ].filter((item) => item.key),
  )

  return (
    // No card: two quiet columns under the composer, aligned to its text.
    <box marginTop={2} paddingLeft={2} paddingRight={1} flexShrink={0} gap={1}>
      <box flexDirection="row" gap={4} flexShrink={1}>
        <Show when={sessions().length > 0}>
          <box flexGrow={1} flexShrink={1} minWidth={0}>
            <text fg={theme.border}>
              recent
              <Show when={listKey()}>
                {"  "}
                {listKey()}
              </Show>
            </text>
            <For each={sessions()}>
              {(item) => {
                const [hover, setHover] = createSignal(false)
                return (
                  <box
                    flexDirection="row"
                    onMouseOver={() => setHover(true)}
                    onMouseOut={() => setHover(false)}
                    onMouseUp={() => route.navigate({ type: "session", sessionID: item.id })}
                  >
                    <text width={2} flexShrink={0} fg={hover() ? theme.primary : theme.border}>
                      ›
                    </text>
                    <text flexGrow={1} fg={hover() ? theme.text : theme.textMuted} wrapMode="none">
                      {Locale.truncate(item.title, titleMax())}
                    </text>
                    <text flexShrink={0} width={10} fg={theme.border} wrapMode="none">
                      {ago(item.time.updated).padStart(10)}
                    </text>
                  </box>
                )
              }}
            </For>
          </box>
        </Show>
        <box flexShrink={0} width={27}>
          <text fg={theme.border}>keys</text>
          <For each={keys()}>
            {(item) => (
              <box flexDirection="row">
                <text width={10} flexShrink={0} fg={theme.text} wrapMode="none">
                  {item.key}
                </text>
                <text fg={theme.textMuted} wrapMode="none">
                  {item.label}
                </text>
              </box>
            )}
          </For>
        </box>
      </box>
    </box>
  )
}

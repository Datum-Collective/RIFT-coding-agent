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
import { TextAttributes, type BoxRenderable } from "@opentui/core"
import { useTheme } from "../context/theme"
import { HomeSessionDestinationProvider } from "./home/session-destination"
import { Banner, bannerFits } from "../component/banner"
import { BANNER_WIDTH } from "../banner"
import { useTerminalDimensions } from "@opentui/solid"
import { IdleKoi } from "../component/idle-koi"
import { TypingKoi } from "../component/typing-koi"

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
  const [composer, setComposer] = createSignal<BoxRenderable>()
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

  // The opening screen: the logo, one line saying what RIFT is, the composer at the logo's width,
  // and a single tip. Everything else is one keypress away (? for shortcuts, ctrl+x l for sessions).
  // After ten seconds without typing the logo turns into koi in a pond behind it; a key sends it away.
  // While the user types, small koi swim through a strip just above the composer.
  return (
    <HomeSessionDestinationProvider>
      <IdleKoi />
      <TypingKoi composer={composer} />
      <box flexGrow={1} minHeight={0} alignItems="center" paddingLeft={2} paddingRight={2}>
        <box flexGrow={1} minHeight={0} />
        <box width="100%" maxWidth={contentWidth()} flexShrink={0} alignItems="center">
          <pluginRuntime.Slot name="home_logo" mode="replace">
            <Banner />
            <Tagline />
          </pluginRuntime.Slot>
        </box>
        <box height={1} minHeight={0} flexShrink={1} />
        <box ref={setComposer} width="100%" maxWidth={contentWidth()} zIndex={1000} flexShrink={0}>
          <pluginRuntime.Slot name="home_prompt" mode="replace" ref={bind}>
            <Prompt ref={bind} right={<pluginRuntime.Slot name="home_prompt_right" />} placeholders={placeholder} />
          </pluginRuntime.Slot>
        </box>
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

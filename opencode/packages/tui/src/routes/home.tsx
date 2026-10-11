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
import { RiftVersion } from "@opencode-ai/core/installation/version"
import { useTheme } from "../context/theme"
import { useRoute } from "../context/route"
import { useDirectory } from "../context/directory"
import { useCommandShortcut } from "../keymap"
import { HomeSessionDestinationProvider } from "./home/session-destination"

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

  // Home is an empty session: the intro line where a transcript would start, the sessions worth
  // returning to, and the composer exactly where it sits in every session.
  return (
    <HomeSessionDestinationProvider>
      <box flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1}>
        <pluginRuntime.Slot name="home_logo" mode="replace">
          <HomeIntro />
        </pluginRuntime.Slot>
        <Recent />
        <pluginRuntime.Slot name="home_bottom" />
        <box flexGrow={1} minHeight={0} />
        <Toast />
        <box width="100%" zIndex={1000} flexShrink={0}>
          <pluginRuntime.Slot name="home_prompt" mode="replace" ref={bind}>
            <Prompt ref={bind} right={<pluginRuntime.Slot name="home_prompt_right" />} placeholders={placeholder} />
          </pluginRuntime.Slot>
        </box>
      </box>
      <box width="100%" flexShrink={0}>
        <pluginRuntime.Slot name="home_footer" mode="single_winner" />
      </box>
    </HomeSessionDestinationProvider>
  )
}

function HomeIntro() {
  const { theme } = useTheme()
  const local = useLocal()
  const directory = useDirectory()
  return (
    <box paddingTop={1} paddingBottom={1} flexShrink={0}>
      <text fg={theme.textMuted} wrapMode="none">
        <span style={{ fg: theme.primary, bold: true }}>◆ RIFT</span>
        <span style={{ fg: theme.border }}> {RiftVersion}</span>
        {"  "}
        {local.model.parsed().model}
        <span style={{ fg: theme.textMuted }}> {local.model.parsed().provider}</span>
        {"  "}
        <span style={{ fg: theme.border }}>{directory()}</span>
      </text>
    </box>
  )
}

const RECENT_LIMIT = 5

function ago(time: number) {
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (seconds < 60) return "now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86_400)}d`
}

/** The last few sessions, newest first; click to reopen, or open the full list. */
function Recent() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const listKey = useCommandShortcut("session.list")
  const sessions = createMemo(() =>
    sync.data.session
      .filter((item) => !item.parentID)
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .slice(0, RECENT_LIMIT),
  )
  return (
    <Show
      when={sessions().length > 0}
      fallback={
        <box flexShrink={0}>
          <text fg={theme.textMuted}>
            Describe a task, or type <span style={{ fg: theme.text }}>/</span> for commands,{" "}
            <span style={{ fg: theme.text }}>@</span> to attach a file, <span style={{ fg: theme.text }}>!</span> to run
            a shell command.
          </text>
        </box>
      }
    >
      <box flexShrink={0}>
        <text fg={theme.textMuted}>
          recent
          <Show when={listKey()}>
            <span style={{ fg: theme.border }}>
              {"  "}
              {listKey()} all sessions
            </span>
          </Show>
        </text>
        <For each={sessions()}>
          {(item) => {
            const [hover, setHover] = createSignal(false)
            return (
              <box
                flexDirection="row"
                backgroundColor={hover() ? theme.backgroundElement : undefined}
                onMouseOver={() => setHover(true)}
                onMouseOut={() => setHover(false)}
                onMouseUp={() => route.navigate({ type: "session", sessionID: item.id })}
              >
                <text width={2} flexShrink={0} fg={theme.border}>
                  ›
                </text>
                <text flexGrow={1} fg={hover() ? theme.text : theme.textMuted} wrapMode="none" attributes={hover() ? TextAttributes.BOLD : undefined}>
                  {item.title}
                </text>
                <text flexShrink={0} paddingLeft={2} fg={theme.border}>
                  {ago(item.time.updated)}
                </text>
              </box>
            )
          }}
        </For>
      </box>
    </Show>
  )
}

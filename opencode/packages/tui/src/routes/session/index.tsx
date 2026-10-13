import {
  batch,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
  useContext,
} from "solid-js"
import path from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import { useRoute, useRouteData } from "../../context/route"
import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { useEvent } from "../../context/event"
import { EmptyBorder, RoundedBorder } from "../../ui/border"
import { useTuiPaths, useTuiTerminalEnvironment } from "../../context/runtime"
import { Spinner, SPINNER_FRAMES } from "../../component/spinner"
import { createSyntaxStyleMemo, generateSubtleSyntax, selectedForeground, useTheme } from "../../context/theme"
import { BoxRenderable, ScrollBoxRenderable, addDefaultParsers, TextAttributes, RGBA } from "@opentui/core"
import { Prompt, type PromptRef } from "../../component/prompt"
import type {
  AssistantMessage,
  Part,
  Provider,
  ToolPart,
  UserMessage,
  TextPart,
  ReasoningPart,
  SessionStatus,
} from "@opencode-ai/sdk/v2"
import { useLocal } from "../../context/local"
import { Locale } from "../../util/locale"
import { webSearchProviderLabel } from "../../util/tool-display"
import { Dynamic, useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import { useSDK } from "../../context/sdk"
import { useEditorContext } from "../../context/editor"
import { openEditor } from "../../editor"
import { useDialog } from "../../ui/dialog"
import { DialogAlert } from "../../ui/dialog-alert"
import { TodoItem } from "../../component/todo-item"
import { DialogMessage } from "./dialog-message"
import type { PromptInfo } from "../../component/prompt/history"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { DialogTimeline } from "./dialog-timeline"
import { DialogForkFromTimeline } from "./dialog-fork-from-timeline"
import { DialogSessionRename } from "../../component/dialog-session-rename"
import { Sidebar } from "./sidebar"
import { TaskView } from "../../component/control/task-view"
import { useTask } from "../../component/control/use-task"
import { SubagentFooter } from "./subagent-footer.tsx"
import { filetype } from "../../util/filetype"
import parsers from "../../parsers-config"
import { errorMessage } from "../../util/error"
import { Toast, useToast } from "../../ui/toast"
import { useKV } from "../../context/kv.tsx"
import stripAnsi from "strip-ansi"
import { usePromptRef } from "../../context/prompt"
import { useEpilogue } from "../../context/epilogue"
import { normalizePath } from "../../util/path"
import { PermissionPrompt } from "./permission"
import { QuestionPrompt } from "./question"
import { DialogExportOptions } from "../../ui/dialog-export-options"
import * as Model from "../../util/model"
import { formatTranscript } from "../../util/transcript"
import { sessionEpilogue } from "../../util/presentation"
import { setPreLayoutSiblingMargin } from "../../util/layout"
import { useTuiConfig } from "../../config"
import { useClipboard } from "../../context/clipboard"
import { nextThinkingMode, reasoningSummary, useThinkingMode, type ThinkingMode } from "../../context/thinking"
import { getScrollAcceleration } from "../../util/scroll"
import { collapseToolOutput } from "../../util/collapse-tool-output"
import { usePluginRuntime } from "../../plugin/runtime"
import { DialogRetryAction } from "../../component/dialog-retry-action"
import { DialogVibeModels } from "../../component/dialog-vibe-models"
import { getRevertDiffFiles } from "../../util/revert-diff"
import { OPENCODE_BASE_MODE, useBindings, useCommandShortcut, useOpencodeKeymap } from "../../keymap"
import { usePathFormatter } from "../../context/path-format"
import { LocationProvider } from "../../context/location"
import { verification, VERIFICATION_METADATA_KEY } from "../../util/task"
import { useDirectory } from "../../context/directory"
import { RiftVersion } from "@opencode-ai/core/installation/version"

addDefaultParsers(parsers.parsers)

const GO_UPSELL_FREE_TIER_LAST_SEEN_AT = "go_upsell_last_seen_at"
const GO_UPSELL_FREE_TIER_DONT_SHOW = "go_upsell_dont_show"
const GO_UPSELL_ACCOUNT_RATE_LIMIT_LAST_SEEN_AT = "go_upsell_account_rate_limit_last_seen_at"
const GO_UPSELL_ACCOUNT_RATE_LIMIT_DONT_SHOW = "go_upsell_account_rate_limit_dont_show"
const GO_UPSELL_WINDOW = 86_400_000 // 24 hrs
const GO_UPSELL_PROVIDERS = new Set(["opencode", "opencode-go"])

export const alwaysSeparate = new WeakSet<BoxRenderable>()

type RetryAction = Extract<SessionStatus, { type: "retry" }>["action"]

function goUpsellKeys(action: RetryAction) {
  if (!action) return
  if (!GO_UPSELL_PROVIDERS.has(action.provider)) return
  if (action.reason === "free_tier_limit") {
    return {
      lastSeenAt: GO_UPSELL_FREE_TIER_LAST_SEEN_AT,
      dontShow: GO_UPSELL_FREE_TIER_DONT_SHOW,
    }
  }
  if (action.reason === "account_rate_limit") {
    return {
      lastSeenAt: GO_UPSELL_ACCOUNT_RATE_LIMIT_LAST_SEEN_AT,
      dontShow: GO_UPSELL_ACCOUNT_RATE_LIMIT_DONT_SHOW,
    }
  }
}

const sessionBindingCommands = [
  "session.share",
  "session.rename",
  "session.timeline",
  "session.fork",
  "session.compact",
  "session.unshare",
  "session.undo",
  "session.redo",
  "session.sidebar.toggle",
  "session.view.toggle",
  "session.toggle.conceal",
  "session.toggle.timestamps",
  "session.toggle.thinking",
  "session.toggle.actions",
  "session.toggle.scrollbar",
  "session.toggle.generic_tool_output",
  "session.first",
  "session.last",
  "session.messages_last_user",
  "session.message.next",
  "session.message.previous",
  "messages.copy",
  "session.copy",
  "session.export",
  "session.child.first",
  "session.parent",
  "session.child.next",
  "session.child.previous",
] as const

const sessionGlobalBindingCommands = [
  "session.page.up",
  "session.page.down",
  "session.line.up",
  "session.line.down",
  "session.half.page.up",
  "session.half.page.down",
] as const

const sessionGlobalUnfocusedBindingCommands = ["session.first", "session.last", "session.sidebar.close"] as const

const context = createContext<{
  width: number
  sessionID: string
  conceal: () => boolean
  thinkingMode: () => ThinkingMode
  showThinking: () => boolean
  showTimestamps: () => boolean
  showDetails: () => boolean
  showGenericToolOutput: () => boolean
  diffWrapMode: () => "word" | "none"
  providers: () => ReadonlyMap<string, Provider>
  sync: ReturnType<typeof useSync>
  tui: ReturnType<typeof useTuiConfig>
}>()

function use() {
  const ctx = useContext(context)
  if (!ctx) throw new Error("useContext must be used within a Session component")
  return ctx
}

/** Width of the context rail beside the transcript. */
const RAIL_WIDTH = 42

/** The top of every transcript: a small card saying what this is, which model, and where. */
function SessionIntro() {
  const { theme } = useTheme()
  const local = useLocal()
  const directory = useDirectory()
  return (
    <box paddingTop={1} paddingBottom={1} flexShrink={0} flexDirection="row">
      <box
        border
        customBorderChars={RoundedBorder}
        borderColor={theme.borderSubtle}
        paddingLeft={1}
        paddingRight={2}
        flexShrink={1}
      >
        <text fg={theme.textMuted} wrapMode="none">
          <span style={{ fg: theme.primary, bold: true }}>◆ RIFT</span>
          <span style={{ fg: theme.border }}> {RiftVersion}</span>
          <span style={{ fg: theme.textMuted }}>{"   "}the coding agent that checks its own work</span>
        </text>
        <text fg={theme.textMuted} wrapMode="none">
          {"  "}
          <span style={{ fg: theme.text }}>{local.model.parsed().model}</span>
          <span style={{ fg: theme.border }}> {local.model.parsed().provider}</span>
          {"   "}
          {directory()}
        </text>
      </box>
    </box>
  )
}

export function Session() {
  const setEpilogue = useEpilogue()
  const clipboard = useClipboard()
  const writeExport = async (file: string, content: string) => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  const pluginRuntime = usePluginRuntime()
  const route = useRouteData("session")
  const { navigate } = useRoute()
  const sync = useSync()
  const event = useEvent()
  const project = useProject()
  const paths = useTuiPaths()
  const tuiConfig = useTuiConfig()
  const kv = useKV()
  const { theme } = useTheme()
  const promptRef = usePromptRef()
  const session = createMemo(() => sync.session.get(route.sessionID))
  const location = createMemo(() => {
    const current = session()
    return current ? { directory: current.directory, workspaceID: current.workspaceID } : undefined
  })

  createEffect(() => {
    const title = Locale.truncate(session()?.title ?? "", 50)
    setEpilogue(sessionEpilogue({ title, sessionID: session()?.id }))
  })
  onCleanup(() => setEpilogue())
  const children = createMemo(() => {
    const parentID = session()?.parentID ?? session()?.id
    return sync.data.session
      .filter((x) => x.parentID === parentID || x.id === parentID)
      .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  })
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const messagesBeforeRevert = () => {
    const messageID = session()?.revert?.messageID
    if (!messageID) return messages()
    const index = messages().findIndex((message) => message.id === messageID)
    return index === -1 ? messages() : messages().slice(0, index)
  }
  const foregroundTasks = createMemo(() =>
    sync.data.capabilities.experimentalBackgroundSubagents
      ? messages().flatMap((message) =>
          (sync.data.part[message.id] ?? []).filter(
            (part): part is ToolPart =>
              part.type === "tool" &&
              part.tool === "task" &&
              part.state.status === "running" &&
              part.state.metadata?.background !== true,
          ),
        )
      : [],
  )
  const permissions = createMemo(() => {
    if (session()?.parentID) return []
    return children().flatMap((x) => sync.data.permission[x.id] ?? [])
  })
  const questions = createMemo(() => {
    if (session()?.parentID) return []
    return children().flatMap((x) => sync.data.question[x.id] ?? [])
  })
  const visible = createMemo(() => !session()?.parentID && permissions().length === 0 && questions().length === 0)
  const disabled = createMemo(() => permissions().length > 0 || questions().length > 0)

  const pending = createMemo(() => {
    const completed = messages().findLastIndex((message) => message.role === "assistant" && message.time.completed)
    const pending = messages().findLastIndex(
      (message, index) => index > completed && message.role === "assistant" && !message.time.completed,
    )
    return pending === -1 ? undefined : pending
  })

  const lastAssistant = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant")
  })

  const dimensions = useTerminalDimensions()
  const [sidebar, setSidebar] = kv.signal<"auto" | "hide">("sidebar", "auto")
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const [conceal, setConceal] = createSignal(true)
  const thinking = useThinkingMode()
  const thinkingMode = thinking.mode
  const showThinking = createMemo(() => true)
  const [timestamps, setTimestamps] = kv.signal<"hide" | "show">("timestamps", "hide")
  const [showDetails, setShowDetails] = kv.signal("tool_details_visibility", true)
  const [showAssistantMetadata, _setShowAssistantMetadata] = kv.signal("assistant_metadata_visibility", true)
  const [showScrollbar, setShowScrollbar] = kv.signal("scrollbar_visible", false)
  const [diffWrapMode] = kv.signal<"word" | "none">("diff_wrap_mode", "word")
  const [_animationsEnabled, _setAnimationsEnabled] = kv.signal("animations_enabled", true)
  const [showGenericToolOutput, setShowGenericToolOutput] = kv.signal("generic_tool_output_visibility", false)
  // The transcript is the primary view. The task view (status, plan, checks) is one keypress away,
  // and its essentials also live in the context rail, so whichever view was chosen is remembered.
  const [viewMode, setViewMode] = kv.signal<"task" | "log">("view_mode", "log")
  const task = useTask(() => route.sessionID)

  // The panel docks beside the transcript only when both still have room to breathe.
  const wide = createMemo(() => dimensions().width >= 130)
  const sidebarVisible = createMemo(() => {
    if (session()?.parentID) return false
    if (sidebarOpen()) return true
    if (sidebar() === "auto" && wide()) return true
    return false
  })
  const showTimestamps = createMemo(() => timestamps() === "show")
  const contentWidth = createMemo(() => dimensions().width - (sidebarVisible() && wide() ? RAIL_WIDTH : 0) - 4)
  const providers = createMemo(() => Model.index(sync.data.provider))

  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const toast = useToast()
  const sdk = useSDK()
  const editor = useEditorContext()

  createEffect(() => {
    const sessionID = route.sessionID
    void (async () => {
      const previousWorkspace = untrack(() => project.workspace.current())
      const result = await sdk.client.session.get({ sessionID }, { throwOnError: true })
      if (!result.data) {
        toast.show({
          message: `Session not found: ${sessionID}`,
          variant: "error",
          duration: 5000,
        })
        navigate({ type: "home" })
        return
      }

      if (result.data.workspaceID !== previousWorkspace) {
        project.workspace.set(result.data.workspaceID)

        // Sync all the data for this workspace. Note that this
        // workspace may not exist anymore which is why this is not
        // fatal. If it doesn't we still want to show the session
        // (which will be non-interactive)
        try {
          await sync.bootstrap({ fatal: false })
        } catch {}
      }
      editor.reconnect(result.data.directory)
      await sync.session.sync(sessionID)
      local.agent.set(
        result.data.metadata?.vibe_mode === true ? "vibe" : result.data.agent === "plan" ? "plan" : "build",
        { persist: false },
      )
      if (route.sessionID === sessionID && scroll) scroll.scrollBy(100_000)
    })().catch((error) => {
      if (route.sessionID !== sessionID) return
      toast.show({
        message: errorMessage(error),
        variant: "error",
        duration: 5000,
      })
      navigate({ type: "home" })
    })
  })

  let lastSwitch: string | undefined = undefined
  event.on("message.part.updated", (evt) => {
    const part = evt.properties.part
    if (part.type !== "tool") return
    if (part.sessionID !== route.sessionID) return
    if (part.state.status !== "completed") return
    if (part.id === lastSwitch) return

    if (part.tool === "plan_exit") {
      if (local.agent.current()?.name !== "vibe") local.agent.set("build")
      lastSwitch = part.id
    } else if (part.tool === "plan_enter") {
      if (local.agent.current()?.name !== "vibe") local.agent.set("plan")
      lastSwitch = part.id
    }
  })

  let seeded = false
  let scroll: ScrollBoxRenderable
  let prompt: PromptRef | undefined
  const bind = (r: PromptRef | undefined) => {
    prompt = r
    promptRef.set(r)
    if (seeded || !route.prompt || !r) return
    seeded = true
    r.set(route.prompt)
  }
  const keymap = useOpencodeKeymap()
  const dialog = useDialog()
  const renderer = useRenderer()

  event.on("session.status", (evt) => {
    if (evt.properties.sessionID !== route.sessionID) return
    if (evt.properties.status.type !== "retry") return
    if (!evt.properties.status.action) return
    if (dialog.stack.length > 0) return

    const keys = goUpsellKeys(evt.properties.status.action)
    if (!keys) return

    const seen = kv.get(keys.lastSeenAt)
    if (typeof seen === "number" && Date.now() - seen < GO_UPSELL_WINDOW) return

    if (kv.get(keys.dontShow)) return

    void DialogRetryAction.show(dialog, evt.properties.status.action).then((dontShowAgain) => {
      if (dontShowAgain) kv.set(keys.dontShow, true)
      kv.set(keys.lastSeenAt, Date.now())
    })
  })

  // Helper: Find next visible message boundary in direction
  const findNextVisibleMessage = (direction: "next" | "prev"): string | null => {
    const children = scroll.getChildren()
    const messagesList = messages()
    const scrollTop = scroll.y

    // Get visible messages sorted by position, filtering for valid non-synthetic, non-ignored content
    const visibleMessages = children
      .filter((c) => {
        if (!c.id) return false
        const message = messagesList.find((m) => m.id === c.id)
        if (!message) return false

        // Check if message has valid non-synthetic, non-ignored text parts
        const parts = sync.data.part[message.id]
        if (!parts || !Array.isArray(parts)) return false

        return parts.some((part) => part && part.type === "text" && !part.synthetic && !part.ignored)
      })
      .sort((a, b) => a.y - b.y)

    if (visibleMessages.length === 0) return null

    if (direction === "next") {
      // Find first message below current position
      return visibleMessages.find((c) => c.y > scrollTop + 10)?.id ?? null
    }
    // Find last message above current position
    return [...visibleMessages].reverse().find((c) => c.y < scrollTop - 10)?.id ?? null
  }

  // Helper: Scroll to message in direction or fallback to page scroll
  const scrollToMessage = (direction: "next" | "prev", dialog: ReturnType<typeof useDialog>) => {
    const targetID = findNextVisibleMessage(direction)

    if (!targetID) {
      scroll.scrollBy(direction === "next" ? scroll.height : -scroll.height)
      dialog.clear()
      return
    }

    const child = scroll.getChildren().find((c) => c.id === targetID)
    if (child) scroll.scrollBy(child.y - scroll.y - 1)
    dialog.clear()
  }

  function toBottom() {
    setTimeout(() => {
      if (!scroll || scroll.isDestroyed) return
      scroll.scrollTo(scroll.scrollHeight)
    }, 50)
  }

  const local = useLocal()
  let vibePickerShown = false

  createEffect(() => {
    const current = session()
    if (vibePickerShown || current?.metadata?.vibe_mode !== true || local.agent.vibe.configured()) return
    vibePickerShown = true
    dialog.replace(() => <DialogVibeModels />)
  })

  function enterChild(sessionID: string) {
    navigate({
      type: "session",
      sessionID,
    })
    const status = sync.data.session_status[sessionID]
    if (status?.type === "retry") void DialogAlert.show(dialog, "Retry Error", status.message)
  }

  function moveFirstChild() {
    if (children().length === 1) return
    const next = children().find((x) => !!x.parentID)
    if (next) enterChild(next.id)
  }

  function moveChild(direction: number) {
    if (children().length === 1) return

    const sessions = children().filter((x) => !!x.parentID)
    let next = sessions.findIndex((x) => x.id === session()?.id) - direction

    if (next >= sessions.length) next = 0
    if (next < 0) next = sessions.length - 1
    if (sessions[next]) enterChild(sessions[next].id)
  }

  function childSessionHandler(func: () => void) {
    return () => {
      if (!session()?.parentID || dialog.stack.length > 0) return
      func()
    }
  }

  const viewShortcut = useCommandShortcut("session.view.toggle")
  const sessionCommandList = createMemo(() => [
    {
      title: session()?.share?.url ? "Copy share link" : "Share session",
      value: "session.share",
      suggested: route.type === "session",
      category: "Session",
      enabled: sync.data.config.share !== "disabled",
      slash: {
        name: "share",
      },
      run: async () => {
        const copy = (url: string) =>
          clipboard
            .write?.(url)
            .then(() => toast.show({ message: "Share link copied. It opens in the RIFT viewer.", variant: "success" }))
            .catch(() => toast.show({ message: `Couldn't copy the link: ${url}`, variant: "error" }))
        const url = session()?.share?.url
        if (url) {
          await copy(url)
          dialog.clear()
          return
        }
        // A new key, so people who agreed to the old hosted share are asked again about gists.
        if (!kv.get("share_consent_gist", false)) {
          const ok = await DialogConfirm.show(
            dialog,
            "Share session",
            "RIFT saves this session as a secret GitHub Gist on your account, after removing the API keys, tokens and passwords it recognises. Anyone with the link can read the rest, code included.",
          )
          if (ok !== true) return
          kv.set("share_consent_gist", true)
        }
        // GitHub takes a second or two to create the gist; close the menu and say so right away.
        dialog.clear()
        toast.show({ message: "Creating share link…", variant: "info" })
        await sdk.client.session
          .share({ sessionID: route.sessionID }, { throwOnError: true })
          .then((res) => copy(res.data.share!.url))
          .catch(() => {
            toast.show({
              message:
                "Couldn't share this session. It's saved as a GitHub Gist, so if you're not signed in, run `gh auth login` or set GITHUB_TOKEN.",
              variant: "error",
            })
          })
      },
    },
    {
      title: "Rename session",
      value: "session.rename",
      category: "Session",
      slash: {
        name: "rename",
      },
      run: () => {
        dialog.replace(() => <DialogSessionRename session={route.sessionID} />)
      },
    },
    {
      title: "Jump to message",
      value: "session.timeline",
      category: "Session",
      slash: {
        name: "timeline",
      },
      run: () => {
        dialog.replace(() => (
          <DialogTimeline
            onMove={(messageID) => {
              const child = scroll.getChildren().find((child) => {
                return child.id === messageID
              })
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
            }}
            sessionID={route.sessionID}
            setPrompt={(promptInfo) => prompt?.set(promptInfo)}
          />
        ))
      },
    },
    {
      title: "Fork session",
      value: "session.fork",
      category: "Session",
      slash: {
        name: "fork",
      },
      run: () => {
        dialog.replace(() => (
          <DialogForkFromTimeline
            onMove={(messageID) => {
              if (!messageID) return
              const child = scroll.getChildren().find((child) => {
                return child.id === messageID
              })
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
            }}
            sessionID={route.sessionID}
          />
        ))
      },
    },
    {
      title: "Compact session",
      value: "session.compact",
      category: "Session",
      slash: {
        name: "compact",
        aliases: ["summarize"],
      },
      run: () => {
        const selectedModel = local.model.current()
        if (!selectedModel) {
          toast.show({
            variant: "warning",
            message: "Connect a provider to summarize this session",
            duration: 3000,
          })
          return
        }
        void sdk.client.session.summarize({
          sessionID: route.sessionID,
          modelID: selectedModel.modelID,
          providerID: selectedModel.providerID,
        })
        dialog.clear()
      },
    },
    {
      title: "Unshare session",
      value: "session.unshare",
      category: "Session",
      enabled: !!session()?.share?.url,
      slash: {
        name: "unshare",
      },
      run: async () => {
        await sdk.client.session
          .unshare({ sessionID: route.sessionID }, { throwOnError: true })
          .then(() => toast.show({ message: "Unshared. The gist is deleted.", variant: "success" }))
          .catch(() => {
            toast.show({
              message: "Couldn't unshare. Deleting the gist needs GitHub, so check you're signed in with `gh auth login`.",
              variant: "error",
            })
          })
        dialog.clear()
      },
    },
    {
      title: "Undo previous message",
      value: "session.undo",
      category: "Session",
      slash: {
        name: "undo",
      },
      run: async () => {
        const status = sync.data.session_status?.[route.sessionID]
        if (status?.type !== "idle") await sdk.client.session.abort({ sessionID: route.sessionID }).catch(() => {})
        const message = messagesBeforeRevert().findLast((item) => item.role === "user")
        if (!message) return
        void sdk.client.session
          .revert({
            sessionID: route.sessionID,
            messageID: message.id,
          })
          .then(() => {
            toBottom()
          })
        const parts = sync.data.part[message.id]
        prompt?.set(
          parts.reduce(
            (agg, part) => {
              if (part.type === "text") {
                if (!part.synthetic) agg.input += part.text
              }
              if (part.type === "file") agg.parts.push(part)
              return agg
            },
            { input: "", parts: [] as PromptInfo["parts"] },
          ),
        )
        dialog.clear()
      },
    },
    {
      title: "Redo",
      value: "session.redo",
      category: "Session",
      enabled: !!session()?.revert?.messageID,
      slash: {
        name: "redo",
      },
      run: () => {
        dialog.clear()
        const messageID = session()?.revert?.messageID
        if (!messageID) return
        const message = messages().find((x) => x.role === "user" && x.id > messageID)
        if (!message) {
          void sdk.client.session.unrevert({
            sessionID: route.sessionID,
          })
          prompt?.set({ input: "", parts: [] })
          return
        }
        void sdk.client.session.revert({
          sessionID: route.sessionID,
          messageID: message.id,
        })
      },
    },
    {
      title: viewMode() === "task" ? "Show full chat" : "Show task view",
      value: "session.view.toggle",
      category: "Session",
      run: () => {
        const next = viewMode() === "task" ? "log" : "task"
        setViewMode(() => next)
        // Say which view this is and how to get back, since the two look nothing alike.
        const key = viewShortcut()
        toast.show({
          message: next === "log" ? `Full chat${key ? ` · ${key} for the task view` : ""}` : `Task view${key ? ` · ${key} for the full chat` : ""}`,
          variant: "info",
          duration: 2000,
        })
        dialog.clear()
      },
    },
    {
      title: sidebarVisible() ? "Hide sidebar" : "Show sidebar",
      value: "session.sidebar.toggle",
      category: "Session",
      run: () => {
        batch(() => {
          const isVisible = sidebarVisible()
          setSidebar(() => (isVisible ? "hide" : "auto"))
          setSidebarOpen(!isVisible)
        })
        dialog.clear()
      },
    },
    {
      // Bare key, not leader-prefixed: a quick way to dismiss the sidebar without a chord.
      title: "Close sidebar",
      value: "session.sidebar.close",
      category: "Session",
      hidden: true,
      run: () => {
        if (!sidebarVisible()) return
        batch(() => {
          setSidebar(() => "hide")
          setSidebarOpen(false)
        })
        dialog.clear()
      },
    },
    {
      title: conceal() ? "Disable code concealment" : "Enable code concealment",
      value: "session.toggle.conceal",
      category: "Session",
      run: () => {
        setConceal((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: showTimestamps() ? "Hide timestamps" : "Show timestamps",
      value: "session.toggle.timestamps",
      category: "Session",
      slash: {
        name: "timestamps",
        aliases: ["toggle-timestamps"],
      },
      run: () => {
        setTimestamps((prev) => (prev === "show" ? "hide" : "show"))
        dialog.clear()
      },
    },
    {
      title: (() => {
        const next = nextThinkingMode(thinkingMode())
        if (next === "hide") return "Collapse thinking"
        return "Expand thinking"
      })(),
      value: "session.toggle.thinking",
      category: "Session",
      slash: {
        name: "thinking",
        aliases: ["toggle-thinking"],
      },
      run: () => {
        thinking.set(nextThinkingMode(thinkingMode()))
        dialog.clear()
      },
    },
    {
      title: showDetails() ? "Hide tool details" : "Show tool details",
      value: "session.toggle.actions",
      category: "Session",
      run: () => {
        setShowDetails((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: "Toggle session scrollbar",
      value: "session.toggle.scrollbar",
      category: "Session",
      run: () => {
        setShowScrollbar((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: showGenericToolOutput() ? "Hide generic tool output" : "Show generic tool output",
      value: "session.toggle.generic_tool_output",
      category: "Session",
      run: () => {
        setShowGenericToolOutput((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: "Page up",
      value: "session.page.up",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollBy(-scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: "Page down",
      value: "session.page.down",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollBy(scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: "Line up",
      value: "session.line.up",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollBy(-1)
        dialog.clear()
      },
    },
    {
      title: "Line down",
      value: "session.line.down",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollBy(1)
        dialog.clear()
      },
    },
    {
      title: "Half page up",
      value: "session.half.page.up",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollBy(-scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: "Half page down",
      value: "session.half.page.down",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollBy(scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: "First message",
      value: "session.first",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollTo(0)
        dialog.clear()
      },
    },
    {
      title: "Last message",
      value: "session.last",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollTo(scroll.scrollHeight)
        dialog.clear()
      },
    },
    {
      title: "Jump to last user message",
      value: "session.messages_last_user",
      category: "Session",
      hidden: true,
      run: () => {
        const messages = sync.data.message[route.sessionID]
        if (!messages || !messages.length) return

        // Find the most recent user message with non-ignored, non-synthetic text parts
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i]
          if (!message || message.role !== "user") continue

          const parts = sync.data.part[message.id]
          if (!parts || !Array.isArray(parts)) continue

          const hasValidTextPart = parts.some(
            (part) => part && part.type === "text" && !part.synthetic && !part.ignored,
          )

          if (hasValidTextPart) {
            const child = scroll.getChildren().find((child) => {
              return child.id === message.id
            })
            if (child) scroll.scrollBy(child.y - scroll.y - 1)
            break
          }
        }
      },
    },
    {
      title: "Next message",
      value: "session.message.next",
      category: "Session",
      hidden: true,
      run: () => scrollToMessage("next", dialog),
    },
    {
      title: "Previous message",
      value: "session.message.previous",
      category: "Session",
      hidden: true,
      run: () => scrollToMessage("prev", dialog),
    },
    {
      title: "Copy last assistant message",
      value: "messages.copy",
      category: "Session",
      run: () => {
        const lastAssistantMessage = messagesBeforeRevert().findLast((message) => message.role === "assistant")
        if (!lastAssistantMessage) {
          toast.show({ message: "No assistant messages found", variant: "error" })
          dialog.clear()
          return
        }

        const parts = sync.data.part[lastAssistantMessage.id] ?? []
        const textParts = parts.filter((part) => part.type === "text")
        if (textParts.length === 0) {
          toast.show({ message: "No text parts found in last assistant message", variant: "error" })
          dialog.clear()
          return
        }

        const text = textParts
          .map((part) => part.text)
          .join("\n")
          .trim()
        if (!text) {
          toast.show({
            message: "No text content found in last assistant message",
            variant: "error",
          })
          dialog.clear()
          return
        }

        clipboard
          .write?.(text)
          .then(() => toast.show({ message: "Message copied to clipboard!", variant: "success" }))
          .catch(() => toast.show({ message: "Failed to copy to clipboard", variant: "error" }))
        dialog.clear()
      },
    },
    {
      title: "Copy session transcript",
      value: "session.copy",
      category: "Session",
      slash: {
        name: "copy",
      },
      run: async () => {
        try {
          const sessionData = session()
          if (!sessionData) return
          const sessionMessages = messages()
          const transcript = formatTranscript(
            sessionData,
            sessionMessages.map((msg) => ({ info: msg, parts: sync.data.part[msg.id] ?? [] })),
            {
              thinking: showThinking(),
              toolDetails: showDetails(),
              assistantMetadata: showAssistantMetadata(),
              providers: sync.data.provider,
            },
          )
          await clipboard.write?.(transcript)
          toast.show({ message: "Session transcript copied to clipboard!", variant: "success" })
        } catch {
          toast.show({ message: "Failed to copy session transcript", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Export session transcript",
      value: "session.export",
      category: "Session",
      slash: {
        name: "export",
      },
      run: async () => {
        try {
          const sessionData = session()
          if (!sessionData) return
          const sessionMessages = messages()

          const defaultFilename = `session-${sessionData.id.slice(0, 8)}.md`

          const options = await DialogExportOptions.show(
            dialog,
            defaultFilename,
            showThinking(),
            showDetails(),
            showAssistantMetadata(),
            false,
          )

          if (options === null) return

          const transcript = formatTranscript(
            sessionData,
            sessionMessages.map((msg) => ({ info: msg, parts: sync.data.part[msg.id] ?? [] })),
            {
              thinking: options.thinking,
              toolDetails: options.toolDetails,
              assistantMetadata: options.assistantMetadata,
              providers: sync.data.provider,
            },
          )

          if (options.openWithoutSaving) {
            // Just open in editor without saving
            await openEditor({
              renderer,
              value: transcript,
              cwd:
                (project.instance.path().worktree === "/" ? undefined : project.instance.path().worktree) ||
                project.instance.directory() ||
                paths.cwd,
            })
          } else {
            const exportDir = paths.cwd
            const filename = options.filename.trim()
            const filepath = path.join(exportDir, filename)

            await writeExport(filepath, transcript)

            // Open with EDITOR if available
            const result = await openEditor({
              renderer,
              value: transcript,
              cwd:
                (project.instance.path().worktree === "/" ? undefined : project.instance.path().worktree) ||
                project.instance.directory() ||
                paths.cwd,
            })
            if (result !== undefined) {
              await writeExport(filepath, result)
            }

            toast.show({ message: `Session exported to ${filename}`, variant: "success" })
          }
        } catch {
          toast.show({ message: "Failed to export session", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Background subagents",
      value: "session.background",
      category: "Session",
      hidden: true,
      enabled: foregroundTasks().length > 0,
      run: () => {
        void sdk.client.experimental.session.background({
          sessionID: route.sessionID,
          workspace: project.workspace.current(),
        })
        dialog.clear()
      },
    },
    {
      title: "Go to child session",
      value: "session.child.first",
      category: "Session",
      hidden: true,
      run: () => {
        dialog.clear()
        moveFirstChild()
      },
    },
    {
      title: "Go to parent session",
      value: "session.parent",
      category: "Session",
      hidden: true,
      enabled: !!session()?.parentID,
      run: childSessionHandler(() => {
        const parentID = session()?.parentID
        if (parentID) {
          navigate({
            type: "session",
            sessionID: parentID,
          })
        }
        dialog.clear()
      }),
    },
    {
      title: "Next child session",
      value: "session.child.next",
      category: "Session",
      hidden: true,
      enabled: !!session()?.parentID,
      run: childSessionHandler(() => {
        dialog.clear()
        moveChild(1)
      }),
    },
    {
      title: "Previous child session",
      value: "session.child.previous",
      category: "Session",
      hidden: true,
      enabled: !!session()?.parentID,
      run: childSessionHandler(() => {
        dialog.clear()
        moveChild(-1)
      }),
    },
  ])

  const sessionCommands = createMemo(() =>
    sessionCommandList().map((command) => ({
      namespace: "palette",
      name: command.value,
      desc: "description" in command ? command.description : undefined,
      slashName: "slash" in command ? command.slash?.name : undefined,
      slashAliases: "slash" in command ? command.slash?.aliases : undefined,
      ...command,
    })),
  )

  useBindings(() => ({
    commands: sessionCommands(),
  }))

  useBindings(() => ({
    bindings: tuiConfig.keybinds.gather("session.global", sessionGlobalBindingCommands),
  }))

  useBindings(() => ({
    enabled: () => renderer.currentFocusedEditor === null,
    bindings: tuiConfig.keybinds.gather("session.global.unfocused", sessionGlobalUnfocusedBindingCommands),
  }))

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    bindings: tuiConfig.keybinds.gather("session", sessionBindingCommands),
  }))

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    enabled: foregroundTasks().length > 0,
    priority: 1,
    bindings: tuiConfig.keybinds.get("session.background"),
  }))

  const revertInfo = createMemo(() => session()?.revert)
  const revertMessageID = createMemo(() => revertInfo()?.messageID)
  const revertMessageIndex = createMemo(() => {
    const messageID = revertMessageID()
    if (!messageID) return -1
    return messages().findIndex((message) => message.id === messageID)
  })

  const revertDiffFiles = createMemo(() => getRevertDiffFiles(revertInfo()?.diff ?? ""))

  const revertRevertedMessages = createMemo(() => {
    const messageID = revertMessageID()
    if (!messageID) return []
    const index = revertMessageIndex()
    if (index === -1) return []
    return messages()
      .slice(index)
      .filter((message) => message.role === "user")
  })

  const revert = createMemo(() => {
    const info = revertInfo()
    if (!info) return
    if (!info.messageID) return
    return {
      messageID: info.messageID,
      reverted: revertRevertedMessages(),
      diff: info.diff,
      diffFiles: revertDiffFiles(),
    }
  })

  // snap to bottom when session changes
  createEffect(on(() => route.sessionID, toBottom))

  return (
    <LocationProvider location={location()}>
      <context.Provider
        value={{
          get width() {
            return contentWidth()
          },
          sessionID: route.sessionID,
          conceal,
          thinkingMode,
          showThinking,
          showTimestamps,
          showDetails,
          showGenericToolOutput,
          diffWrapMode,
          providers,
          sync,
          tui: tuiConfig,
        }}
      >
        <box flexDirection="row" flexGrow={1} minHeight={0}>
          <box flexGrow={1} minHeight={0} paddingLeft={2} paddingRight={2} paddingBottom={1}>
            <Show when={session()}>
              <scrollbox
                ref={(r) => (scroll = r)}
                viewportOptions={{
                  paddingRight: showScrollbar() ? 1 : 0,
                }}
                verticalScrollbarOptions={{
                  paddingLeft: 1,
                  visible: showScrollbar(),
                  trackOptions: {
                    backgroundColor: theme.backgroundElement,
                    foregroundColor: theme.border,
                  },
                }}
                stickyScroll={true}
                stickyStart="bottom"
                flexGrow={1}
                scrollAcceleration={scrollAcceleration()}
              >
                <SessionIntro />
                <Show when={viewMode() === "task"}>
                  <TaskView task={task()} width={contentWidth()} />
                </Show>
                <Show when={viewMode() === "log"}>
                  <For each={messages()}>
                    {(message, index) => (
                      <Switch>
                        <Match when={message.id === revert()?.messageID}>
                          {(function () {
                            const redoShortcut = useCommandShortcut("session.redo")
                            const [hover, setHover] = createSignal(false)
                            const dialog = useDialog()

                            const handleUnrevert = async () => {
                              const confirmed = await DialogConfirm.show(
                                dialog,
                                "Confirm Redo",
                                "Are you sure you want to restore the reverted messages?",
                              )
                              if (confirmed) {
                                keymap.dispatchCommand("session.redo")
                              }
                            }

                            return (
                              <box
                                onMouseOver={() => setHover(true)}
                                onMouseOut={() => setHover(false)}
                                onMouseUp={handleUnrevert}
                                marginTop={1}
                                flexShrink={0}
                                backgroundColor={hover() ? theme.backgroundElement : undefined}
                              >
                                <box flexDirection="row">
                                  <text width={2} flexShrink={0} fg={theme.warning}>
                                    ↺
                                  </text>
                                  <text fg={theme.textMuted}>
                                    <span style={{ fg: theme.text, bold: true }}>
                                      {revert()!.reverted.length} message{revert()!.reverted.length === 1 ? "" : "s"} undone
                                    </span>
                                    {"  "}
                                    <span style={{ fg: theme.text }}>{redoShortcut()}</span> or /redo to restore
                                  </text>
                                </box>
                                <Show when={revert()!.diffFiles?.length}>
                                  <box paddingLeft={2}>
                                    <For each={revert()!.diffFiles}>
                                      {(file) => (
                                        <text fg={theme.textMuted}>
                                          {file.filename}
                                          <Show when={file.additions > 0}>
                                            <span style={{ fg: theme.diffAdded }}> +{file.additions}</span>
                                          </Show>
                                          <Show when={file.deletions > 0}>
                                            <span style={{ fg: theme.diffRemoved }}> −{file.deletions}</span>
                                          </Show>
                                        </text>
                                      )}
                                    </For>
                                  </box>
                                </Show>
                              </box>
                            )
                          })()}
                        </Match>
                        <Match
                          when={revert()?.messageID && revertMessageIndex() !== -1 && index() >= revertMessageIndex()}
                        >
                          <></>
                        </Match>
                        <Match when={message.role === "user"}>
                          <UserMessage
                            index={index()}
                            onMouseUp={() => {
                              if (renderer.getSelection()?.getSelectedText()) return
                              dialog.replace(() => (
                                <DialogMessage
                                  messageID={message.id}
                                  sessionID={route.sessionID}
                                  setPrompt={(promptInfo) => prompt?.set(promptInfo)}
                                />
                              ))
                            }}
                            message={message as UserMessage}
                            parts={sync.data.part[message.id] ?? []}
                            pending={pending()}
                          />
                        </Match>
                        <Match when={message.role === "assistant"}>
                          <AssistantMessage
                            last={lastAssistant()?.id === message.id}
                            message={message as AssistantMessage}
                            parts={sync.data.part[message.id] ?? []}
                          />
                        </Match>
                      </Switch>
                    )}
                  </For>
                </Show>
              </scrollbox>
              <box flexShrink={0}>
                <Show when={permissions().length > 0}>
                  <PermissionPrompt
                    request={permissions()[0]}
                    directory={sync.session.get(permissions()[0].sessionID)?.directory}
                  />
                </Show>
                <Show when={permissions().length === 0 && questions().length > 0}>
                  <QuestionPrompt
                    request={questions()[0]}
                    directory={sync.session.get(questions()[0].sessionID)?.directory}
                  />
                </Show>
                <Show when={session()?.parentID}>
                  <SubagentFooter />
                </Show>
                <Show when={visible()}>
                  <pluginRuntime.Slot
                    name="session_prompt"
                    mode="replace"
                    session_id={route.sessionID}
                    visible={visible()}
                    disabled={disabled()}
                    on_submit={toBottom}
                    ref={bind}
                  >
                    <Prompt
                      visible={visible()}
                      ref={bind}
                      disabled={disabled()}
                      onSubmit={() => {
                        toBottom()
                      }}
                      sessionID={route.sessionID}
                      right={<pluginRuntime.Slot name="session_prompt_right" session_id={route.sessionID} />}
                    />
                  </pluginRuntime.Slot>
                </Show>
              </box>
            </Show>
            <Toast />
          </box>
          <Show when={sidebarVisible()}>
            <Switch>
              <Match when={wide()}>
                <Sidebar sessionID={route.sessionID} />
              </Match>
              <Match when={!wide()}>
                <box position="absolute" top={0} left={0} right={0} bottom={0} alignItems="flex-end">
                  <Sidebar sessionID={route.sessionID} overlay />
                </box>
              </Match>
            </Switch>
          </Show>
        </box>
      </context.Provider>
    </LocationProvider>
  )
}

function UserMessage(props: {
  message: UserMessage
  parts: Part[]
  onMouseUp: () => void
  index: number
  pending?: number
}) {
  const ctx = use()
  const text = createMemo(() =>
    props.parts
      .flatMap((x) => (x.type === "text" && !x.synthetic ? [x.text] : []))
      .join("\n\n"),
  )
  const files = createMemo(() => props.parts.flatMap((x) => (x.type === "file" ? [x] : [])))
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const queued = createMemo(() => props.pending !== undefined && props.index > props.pending)
  const compaction = createMemo(() => props.parts.find((x) => x.type === "compaction"))

  return (
    <>
      <Show when={text()}>
        {/* A user turn reads like the shell prompt it came from: ❯ and what was typed. */}
        <box
          id={props.message.id}
          ref={(el: BoxRenderable) => alwaysSeparate.add(el)}
          marginTop={props.index === 0 ? 0 : 1}
          flexShrink={0}
          onMouseOver={() => setHover(true)}
          onMouseOut={() => setHover(false)}
          onMouseUp={props.onMouseUp}
          backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
          paddingTop={1}
          paddingBottom={1}
          paddingRight={2}
        >
          <box flexDirection="row">
            <text width={2} flexShrink={0} fg={queued() ? theme.textMuted : theme.primary} attributes={TextAttributes.BOLD}>
              ❯
            </text>
            <text flexGrow={1} fg={queued() ? theme.textMuted : theme.text} attributes={TextAttributes.BOLD}>
              {text()}
            </text>
          </box>
          <Show when={files().length || queued() || ctx.showTimestamps()}>
            <box flexDirection="row" paddingLeft={2} gap={2} flexWrap="wrap">
              <For each={files()}>
                {(file) => (
                  <text fg={theme.textMuted}>
                    <span style={{ fg: theme.secondary }}>@</span>
                    {file.filename}
                    {file.mime === "application/x-directory" ? "/" : ""}
                  </text>
                )}
              </For>
              <Show when={queued()}>
                <text fg={theme.warning}>queued</text>
              </Show>
              <Show when={!queued() && ctx.showTimestamps()}>
                <text fg={theme.textMuted}>{Locale.todayTimeOrDateTime(props.message.time.created)}</text>
              </Show>
            </box>
          </Show>
        </box>
      </Show>
      <Show when={compaction()}>
        <box marginTop={1} flexShrink={0}>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.border }}>── </span>compacted · earlier turns summarised above this line
          </text>
        </box>
      </Show>
    </>
  )
}

/** Splits a message's parts into display runs, folding consecutive exploration calls into one group. */
const EXPLORE_TOOLS = new Set(["read", "glob", "grep", "list"])
type PartRun = { kind: "part"; part: Part } | { kind: "explore"; parts: ToolPart[] }
export function partRuns(parts: readonly Part[], showDetails: boolean): PartRun[] {
  const runs: PartRun[] = []
  for (const part of parts) {
    const explore = part.type === "tool" && EXPLORE_TOOLS.has(part.tool) && part.state.status !== "error"
    if (explore) {
      if (!showDetails && part.state.status === "completed") continue
      const last = runs.at(-1)
      if (last?.kind === "explore") last.parts.push(part as ToolPart)
      else runs.push({ kind: "explore", parts: [part as ToolPart] })
      continue
    }
    runs.push({ kind: "part", part })
  }
  return runs
}

function AssistantMessage(props: { message: AssistantMessage; parts: Part[]; last: boolean }) {
  const ctx = use()
  const { theme } = useTheme()
  const sync = useSync()
  const messages = createMemo(() => sync.data.message[props.message.sessionID] ?? [])
  const model = createMemo(() => Model.name(ctx.providers(), props.message.providerID, props.message.modelID))

  const final = createMemo(() => {
    return props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish)
  })

  const duration = createMemo(() => {
    if (!final()) return 0
    if (!props.message.time.completed) return 0
    const user = messages().find((x) => x.role === "user" && x.id === props.message.parentID)
    if (!user || !user.time) return 0
    return props.message.time.completed - user.time.created
  })

  const runs = createMemo(() => partRuns(props.parts, ctx.showDetails()))
  const interrupted = () => props.message.error?.name === "MessageAbortedError"
  const childShortcut = useCommandShortcut("session.child.first")
  const backgroundShortcut = useCommandShortcut("session.background")
  const mode = () =>
    props.message.mode === "vibe-planner"
      ? "planner"
      : props.message.mode === "vibe-executor"
        ? "executor"
        : props.message.mode === "build"
          ? undefined
          : props.message.mode

  return (
    <>
      <For each={runs()}>
        {(run, index) => (
          <Switch>
            <Match when={run.kind === "explore" && run}>
              {(item) => <Explored parts={item().parts} />}
            </Match>
            <Match when={run.kind === "part" && run}>
              {(item) => {
                const component = createMemo(() => PART_MAPPING[item().part.type as keyof typeof PART_MAPPING])
                return (
                  <Show when={component()}>
                    <Dynamic
                      last={index() === runs().length - 1}
                      component={component()}
                      part={item().part as any}
                      message={props.message}
                    />
                  </Show>
                )
              }}
            </Match>
          </Switch>
        )}
      </For>
      <Show when={props.parts.some((x) => x.type === "tool" && x.tool === "task")}>
        <box paddingLeft={2} flexShrink={0}>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.text }}>{childShortcut()}</span> subagents
            <Show
              when={
                sync.data.capabilities.experimentalBackgroundSubagents &&
                props.parts.some(
                  (x) =>
                    x.type === "tool" &&
                    x.tool === "task" &&
                    x.state.status === "running" &&
                    x.state.metadata?.background !== true,
                )
              }
            >
              {"  "}
              <span style={{ fg: theme.text }}>{backgroundShortcut()}</span> background
            </Show>
          </text>
        </box>
      </Show>
      <Show when={props.message.error && !interrupted()}>
        <box ref={(el: BoxRenderable) => alwaysSeparate.add(el)} marginTop={1} flexDirection="row" flexShrink={0}>
          <text width={2} flexShrink={0} fg={theme.error}>
            ✕
          </text>
          <text flexGrow={1} fg={theme.error}>
            {errorMessage(props.message.error)}
          </text>
        </box>
      </Show>
      <Show when={(props.last && props.message.time.completed) || final() || interrupted()}>
        {/* Turn footer: how long it took and who answered, in the faintest ink on screen. */}
        <box ref={(el: BoxRenderable) => alwaysSeparate.add(el)} paddingLeft={2} marginTop={1} flexShrink={0}>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.border }}>─ </span>
            <Show when={duration()}>{Locale.duration(duration())} · </Show>
            {model()}
            <Show when={mode()}>
              {(value) => <span style={{ fg: props.message.mode === "vibe-planner" ? theme.accent : theme.textMuted }}> · {value()}</span>}
            </Show>
            <Show when={interrupted()}>
              <span style={{ fg: theme.warning }}> · interrupted</span>
            </Show>
          </text>
        </box>
      </Show>
    </>
  )
}

const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
  reasoning: ReasoningPart,
}

const INLINE_TOOL_ICON_WIDTH = 2

/** Gutter glyph for a finished tool call. The verb after it carries the meaning. */
export const TOOL_BULLET = "·"

/** Collapsed tool output shows this many lines; a click shows all of it. */
const OUTPUT_PREVIEW_LINES = 6
/** Diffs taller than this collapse to it. */
const DIFF_PREVIEW_ROWS = 24

function ReasoningPart(props: { last: boolean; part: ReasoningPart; message: AssistantMessage }) {
  const { theme } = useTheme()
  const ctx = use()
  // Collapsed by default in hide mode: one line throughout, so the layout never shifts.
  const [expanded, setExpanded] = createSignal(false)

  const content = createMemo(() => {
    // OpenRouter encrypts some reasoning blocks; drop the placeholder.
    return props.part.text.replace("[REDACTED]", "").trim()
  })
  const opaque = createMemo(() => !content() && Boolean(props.part.metadata))
  // Reasoning is finalized when the server sets `time.end` (see processor.ts).
  const isDone = createMemo(() => props.part.time.end !== undefined)
  const inMinimal = createMemo(() => ctx.thinkingMode() === "hide")
  const duration = createMemo(() => {
    const end = props.part.time.end
    return end === undefined ? 0 : Math.max(0, end - props.part.time.start)
  })
  const summary = createMemo(() => reasoningSummary(content()))
  const syntax = createSyntaxStyleMemo(() => generateSubtleSyntax(theme))
  const open = () => !inMinimal() || expanded()

  const toggle = () => {
    if (!inMinimal() || opaque()) return
    setExpanded((prev) => !prev)
  }

  return (
    <Show when={content() || opaque()}>
      <box ref={(el: BoxRenderable) => alwaysSeparate.add(el)} marginTop={1} flexDirection="column" flexShrink={0}>
        <box onMouseUp={toggle}>
          <ReasoningHeader
            toggleable={inMinimal() && !opaque()}
            open={open()}
            done={isDone()}
            title={summary().title}
            duration={isDone() ? Locale.duration(duration()) : undefined}
            encrypted={opaque()}
          />
        </box>
        <Show when={!opaque() && open() && summary().body}>
          <box paddingLeft={INLINE_TOOL_ICON_WIDTH} marginTop={1}>
            <code
              filetype="markdown"
              drawUnstyledText={false}
              streaming={true}
              syntaxStyle={syntax()}
              content={summary().body}
              conceal={ctx.conceal()}
              fg={theme.textMuted}
            />
          </box>
        </Show>
      </box>
    </Show>
  )
}

function ReasoningHeader(props: {
  toggleable: boolean
  open: boolean
  done: boolean
  title: string | null
  duration?: string
  encrypted?: boolean
}) {
  const { theme } = useTheme()
  const detail = () => [props.duration, props.encrypted ? "encrypted" : props.title].filter(Boolean).join(" · ")

  return (
    <Switch>
      <Match when={!props.done}>
        <Spinner color={theme.textMuted}>{props.title ? "thinking · " + props.title : "thinking"}</Spinner>
      </Match>
      <Match when={true}>
        <box flexDirection="row">
          <text width={INLINE_TOOL_ICON_WIDTH} flexShrink={0} fg={theme.border}>
            ∴
          </text>
          <text fg={theme.textMuted} attributes={TextAttributes.ITALIC} wrapMode="none" flexGrow={1}>
            thought{detail() ? " " + detail() : ""}
            <Show when={props.toggleable}>
              <span style={{ fg: theme.border }}>{props.open ? "  ▾" : "  ▸"}</span>
            </Show>
          </text>
        </box>
      </Match>
    </Switch>
  )
}

function TextPart(props: { last: boolean; part: TextPart; message: AssistantMessage }) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  return (
    <Show when={!props.part.metadata?.[VERIFICATION_METADATA_KEY]} fallback={<ChecksPart part={props.part} message={props.message} />}>
    <Show when={props.part.text.trim()}>
      <box
        ref={(el: BoxRenderable) => alwaysSeparate.add(el)}
        paddingLeft={INLINE_TOOL_ICON_WIDTH}
        marginTop={1}
        flexShrink={0}
      >
        <markdown
          syntaxStyle={syntax()}
          streaming={true}
          internalBlockMode="top-level"
          content={props.part.text.trim()}
          tableOptions={{ style: "grid" }}
          conceal={ctx.conceal()}
          fg={theme.markdownText}
          bg={theme.background}
        />
      </box>
    </Show>
    </Show>
  )
}

/**
 * RIFT's verification report, rendered from its structured twin: one row per check with its real
 * outcome. The prose (with failing output) opens on click.
 */
function ChecksPart(props: { part: TextPart; message: AssistantMessage }) {
  const { theme, syntax } = useTheme()
  const ctx = use()
  const sync = useSync()
  const [open, setOpen] = createSignal(false)
  const busy = createMemo(() => (sync.data.session_status[props.message.sessionID]?.type ?? "idle") !== "idle")
  const result = createMemo(() =>
    verification({ messages: [{ id: props.message.id, role: "assistant" }], parts: () => [props.part], busy: busy() }),
  )
  const glyph = () => {
    const state = result().state
    if (state === "passed") return { text: "✓", color: theme.success }
    if (state === "failed") return { text: "✕", color: theme.error }
    if (state === "running") return { text: "…", color: theme.primary }
    return { text: "·", color: theme.warning }
  }
  const counts = createMemo(() => {
    const checks = result().checks
    const passed = checks.filter((check) => check.status === "passed").length
    const failed = checks.filter((check) => check.status === "failed" || check.status === "timed_out").length
    const notRun = checks.length - passed - failed
    return [passed && `${passed} passed`, failed && `${failed} failed`, notRun && `${notRun} not run`].filter(Boolean).join(" · ")
  })
  const checkGlyph = (status: string) =>
    status === "passed"
      ? { text: "✓", color: theme.success }
      : status === "failed" || status === "timed_out"
        ? { text: "✕", color: theme.error }
        : status === "queued"
          ? { text: "…", color: theme.primary }
          : { text: "·", color: theme.border }
  const claims = () => result().claims

  return (
    <box ref={(el: BoxRenderable) => alwaysSeparate.add(el)} marginTop={1} flexShrink={0} onMouseUp={() => setOpen((value) => !value)}>
      <box flexDirection="row">
        <text width={INLINE_TOOL_ICON_WIDTH} flexShrink={0} fg={glyph().color}>
          {glyph().text}
        </text>
        <text fg={theme.textMuted} flexGrow={1}>
          <span style={{ fg: theme.text, bold: true }}>Checks</span>
          <Show
            when={result().checks.length || result().browser || result().evidence?.length}
            fallback={<span style={{ fg: theme.textMuted }}>{"  "}not configured · set verify_commands to run tests after each task</span>}
          >
            <Show when={counts()}>
              <span style={{ fg: theme.textMuted }}>{"  "}{counts()}</span>
            </Show>
          </Show>
          <span style={{ fg: theme.border }}>{open() ? "  ▾" : "  ▸"}</span>
        </text>
      </box>
      <For each={result().checks}>
        {(check) => (
          <box paddingLeft={INLINE_TOOL_ICON_WIDTH} flexDirection="row">
            <text width={INLINE_TOOL_ICON_WIDTH} flexShrink={0} fg={checkGlyph(check.status).color}>
              {checkGlyph(check.status).text}
            </text>
            <text fg={theme.textMuted} flexGrow={1}>
              <span style={{ fg: theme.text }}>{check.command}</span>
              <Show when={check.where}> in {check.where}</Show>
              <Show when={check.ms >= 1000}>  {Locale.duration(check.ms)}</Show>
              <Show when={check.status === "timed_out"}>
                <span style={{ fg: theme.error }}>{"  "}timed out</span>
              </Show>
              <Show when={check.status === "not_run"}>{"  "}not run{check.reason ? ` (${check.reason})` : ""}</Show>
            </text>
          </box>
        )}
      </For>
      <Show when={result().browser}>
        {(browser) => (
          <box paddingLeft={INLINE_TOOL_ICON_WIDTH} flexDirection="row">
            <text width={INLINE_TOOL_ICON_WIDTH} flexShrink={0} fg={checkGlyph(browser().status).color}>
              {checkGlyph(browser().status).text}
            </text>
            <text fg={theme.textMuted} flexGrow={1}>
              <span style={{ fg: theme.text }}>{browser().url}</span>
              {browser().status === "passed"
                ? "  rendered, no console errors"
                : browser().status === "failed"
                  ? `  ${browser().errors.length} console error${browser().errors.length === 1 ? "" : "s"}`
                  : `  not checked${browser().reason ? ` (${browser().reason})` : ""}`}
            </text>
          </box>
        )}
      </Show>
      <Show when={claims() && claims()!.status !== "off"}>
        <box paddingLeft={INLINE_TOOL_ICON_WIDTH} flexDirection="row">
          <text width={INLINE_TOOL_ICON_WIDTH} flexShrink={0} fg={claims()!.status === "mismatch" ? theme.error : claims()!.status === "ok" ? theme.success : theme.border}>
            {claims()!.status === "mismatch" ? "✕" : claims()!.status === "ok" ? "✓" : "·"}
          </text>
          <text fg={theme.textMuted} flexGrow={1}>
            <span style={{ fg: theme.text }}>summary vs diff</span>
            {(() => {
              const value = claims()!
              if (value.status === "ok") return "  matches"
              if (value.status === "pending") return "  checking"
              if (value.status === "mismatch") return `  ${value.items.length} claim${value.items.length === 1 ? "" : "s"} not in the diff`
              if (value.status === "not_run") return `  not run (${value.reason})`
              return ""
            })()}
          </text>
        </box>
      </Show>
      <Show when={open()}>
        <box paddingLeft={INLINE_TOOL_ICON_WIDTH} marginTop={1}>
          <markdown syntaxStyle={syntax()} content={props.part.text.trim()} conceal={ctx.conceal()} fg={theme.textMuted} bg={theme.background} />
        </box>
      </Show>
    </box>
  )
}

function ToolPart(props: { last: boolean; part: ToolPart; message: AssistantMessage }) {
  const ctx = use()
  const display = createMemo(() => toolDisplay(props.part.tool))

  // Completed calls disappear when tool details are hidden.
  const shouldHide = createMemo(() => {
    if (ctx.showDetails()) return false
    if (props.part.state.status !== "completed") return false
    return true
  })

  const toolprops = {
    get metadata() {
      return props.part.state.status === "pending" ? {} : (props.part.state.metadata ?? {})
    },
    get input() {
      return props.part.state.input ?? {}
    },
    get output() {
      return props.part.state.status === "completed" ? props.part.state.output : undefined
    },
    get tool() {
      return props.part.tool
    },
    get part() {
      return props.part
    },
  }

  return (
    <Show when={!shouldHide()}>
      <Switch>
        <Match when={display() === "bash"}>
          <Shell {...toolprops} />
        </Match>
        <Match when={display() === "glob" || display() === "read" || display() === "grep"}>
          <Explored parts={[props.part]} />
        </Match>
        <Match when={display() === "webfetch"}>
          <WebFetch {...toolprops} />
        </Match>
        <Match when={display() === "browser_open"}>
          <BrowserOpen {...toolprops} />
        </Match>
        <Match when={display() === "websearch"}>
          <WebSearch {...toolprops} />
        </Match>
        <Match when={display() === "write"}>
          <Write {...toolprops} />
        </Match>
        <Match when={display() === "edit"}>
          <Edit {...toolprops} />
        </Match>
        <Match when={display() === "task"}>
          <Task {...toolprops} />
        </Match>
        <Match when={display() === "execute"}>
          <Execute {...toolprops} />
        </Match>
        <Match when={display() === "apply_patch"}>
          <ApplyPatch {...toolprops} />
        </Match>
        <Match when={display() === "todowrite"}>
          <TodoWrite {...toolprops} />
        </Match>
        <Match when={display() === "question"}>
          <Question {...toolprops} />
        </Match>
        <Match when={display() === "skill"}>
          <Skill {...toolprops} />
        </Match>
        <Match when={true}>
          <GenericTool {...toolprops} />
        </Match>
      </Switch>
    </Show>
  )
}

type ToolProps = {
  input: Record<string, unknown>
  metadata: Record<string, unknown>
  tool: string
  output?: string
  part: ToolPart
}

/** A tool's verb, in the strong ink; the rest of the row stays muted. */
function Verb(props: { children: JSX.Element }) {
  const { theme } = useTheme()
  return <span style={{ fg: theme.text, bold: true }}>{props.children}</span>
}

function elapsed(part: ToolPart) {
  if (part.state.status !== "completed" && part.state.status !== "error") return undefined
  const ms = part.state.time.end - part.state.time.start
  return ms >= 1000 ? Locale.duration(ms) : undefined
}

/** Output under a faint rule, collapsed to a few lines with a count of the rest. */
function OutputBlock(props: { text: string; color?: RGBA; lines?: number }) {
  const { theme } = useTheme()
  const ctx = use()
  const [expanded, setExpanded] = createSignal(false)
  const max = () => props.lines ?? OUTPUT_PREVIEW_LINES
  const lines = createMemo(() => props.text.split("\n"))
  const collapsed = createMemo(() => collapseToolOutput(props.text, max(), max() * Math.max(20, ctx.width - 8)))
  const hidden = () => Math.max(0, lines().length - max())
  return (
    <box flexShrink={0} onMouseUp={() => collapsed().overflow && setExpanded((value) => !value)}>
      <text fg={props.color ?? theme.textMuted}>
        {expanded() || !collapsed().overflow ? props.text : collapsed().output.replace(/\n…$/, "")}
      </text>
      <Show when={collapsed().overflow}>
        <text fg={theme.border}>
          {expanded() ? "▴ collapse" : hidden() > 0 ? `… ${hidden()} more line${hidden() === 1 ? "" : "s"}` : "… more"}
        </text>
      </Show>
    </box>
  )
}

function GenericTool(props: ToolProps) {
  const ctx = use()
  const output = createMemo(() => stripAnsi(props.output?.trim() ?? ""))
  return (
    <>
      <InlineTool icon={TOOL_BULLET} pending={`${props.tool}…`} complete={true} part={props.part}>
        <Verb>{props.tool}</Verb> {input(props.input)}
      </InlineTool>
      <Show when={output() && ctx.showGenericToolOutput()}>
        <OutputBlock text={output()} />
      </Show>
    </>
  )
}

function InlineTool(props: {
  icon: string
  iconColor?: RGBA
  color?: RGBA
  complete: unknown
  pending: string
  failure?: string
  spinner?: boolean
  separate?: boolean
  children: JSX.Element
  part: ToolPart
  onClick?: () => void
}) {
  const { theme } = useTheme()
  const ctx = use()
  const sync = useSync()
  const kv = useKV()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const [errorExpanded, setErrorExpanded] = createSignal(false)

  const permission = createMemo(() => {
    const callID = sync.data.permission[ctx.sessionID]?.at(0)?.tool?.callID
    if (!callID) return false
    return callID === props.part.callID
  })

  const error = createMemo(() => (props.part.state.status === "error" ? props.part.state.error : undefined))

  const denied = createMemo(
    () =>
      error()?.includes("QuestionRejectedError") ||
      error()?.includes("rejected permission") ||
      error()?.includes("specified a rule") ||
      error()?.includes("user dismissed"),
  )

  const failed = createMemo(() => Boolean(error() && !denied()))
  const clickable = createMemo(() => Boolean(props.onClick || failed()))
  const running = createMemo(() => props.part.state.status === "running" || props.part.state.status === "pending")
  const fg = createMemo(() => {
    if (props.color) return props.color
    if (permission()) return theme.warning
    if (failed()) return theme.error
    if (hover() && clickable()) return theme.text
    return theme.textMuted
  })

  return (
    <InlineToolRow
      icon={permission() ? "?" : props.icon}
      iconColor={permission() ? theme.warning : (props.iconColor ?? theme.border)}
      color={fg()}
      errorColor={theme.error}
      failed={failed()}
      denied={Boolean(denied())}
      error={error()}
      errorExpanded={errorExpanded()}
      complete={props.complete}
      pending={props.pending}
      failure={props.failure}
      spinner={props.spinner ?? (running() && !permission() && Boolean(props.complete))}
      spinnerColor={theme.primary}
      animate={kv.get("animations_enabled", true)}
      separate={props.separate}
      onMouseOver={() => clickable() && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        if (failed()) {
          setErrorExpanded((value) => !value)
          return
        }
        props.onClick?.()
      }}
    >
      {props.children}
    </InlineToolRow>
  )
}

export function InlineToolRow(props: {
  icon: string
  iconColor?: RGBA
  color?: RGBA
  errorColor?: RGBA
  failed?: boolean
  denied?: boolean
  error?: string
  errorExpanded?: boolean
  complete: unknown
  pending: string
  failure?: string
  spinner?: boolean
  spinnerColor?: RGBA
  /** Off when the user disabled animations; a static ellipsis replaces the spinner. */
  animate?: boolean
  separate?: boolean
  children: JSX.Element
  onMouseOver?: () => void
  onMouseOut?: () => void
  onMouseUp?: () => void
}) {
  const glyph = () => (props.failed ? "✕" : props.denied ? "⊘" : props.icon)
  const glyphColor = () => (props.failed ? props.errorColor : (props.iconColor ?? props.color))
  return (
    <box
      onMouseOver={props.onMouseOver}
      onMouseOut={props.onMouseOut}
      onMouseUp={props.onMouseUp}
      flexShrink={0}
      ref={(el: BoxRenderable) => {
        if (props.separate) alwaysSeparate.add(el)
        setPreLayoutSiblingMargin(el, (previous) => {
          return props.separate ||
            (previous instanceof BoxRenderable && (previous.height > 1 || alwaysSeparate.has(previous)))
            ? 1
            : 0
        })
      }}
    >
      <box flexDirection="row">
        <Show
          when={props.spinner || !(props.complete || props.failed)}
          fallback={
            <text width={INLINE_TOOL_ICON_WIDTH} flexShrink={0} fg={glyphColor()}>
              {glyph()}
            </text>
          }
        >
          <box width={INLINE_TOOL_ICON_WIDTH} flexShrink={0}>
            <Show when={props.animate !== false} fallback={<text fg={props.spinnerColor ?? props.color}>…</text>}>
              <spinner frames={SPINNER_FRAMES} interval={80} color={props.spinnerColor ?? props.color} />
            </Show>
          </box>
        </Show>
        <text
          flexGrow={1}
          fg={props.failed ? props.errorColor : props.color}
          attributes={props.denied ? TextAttributes.STRIKETHROUGH : undefined}
        >
          {props.complete || props.failed
            ? props.failed && !props.complete
              ? (props.failure ?? props.children)
              : props.children
            : props.pending}
        </text>
      </box>
      <Show when={props.failed && props.errorExpanded}>
        <box paddingLeft={INLINE_TOOL_ICON_WIDTH}>
          <text fg={props.errorColor}>{props.error}</text>
        </box>
      </Show>
    </box>
  )
}

/** A tool with a body (shell output, a diff, a plan): one header row, the body indented under it. */
function BlockTool(props: {
  glyph: string
  glyphColor?: RGBA
  header: JSX.Element
  children?: JSX.Element
  onClick?: () => void
  part?: ToolPart
  spinner?: boolean
  /** True when there is nothing to show yet (a command still waiting on its first output). */
  empty?: boolean
}) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const kv = useKV()
  const ctx = use()
  const sync = useSync()
  const [hover, setHover] = createSignal(false)
  const error = createMemo(() => (props.part?.state.status === "error" ? props.part.state.error : undefined))
  // Waiting on the user outranks "running": show the question, not a spinner.
  const waiting = createMemo(() => {
    const callID = sync.data.permission[ctx.sessionID]?.at(0)?.tool?.callID
    return Boolean(callID && props.part && callID === props.part.callID)
  })
  return (
    <box
      ref={(el: BoxRenderable) => alwaysSeparate.add(el)}
      marginTop={1}
      flexShrink={0}
      backgroundColor={hover() ? theme.backgroundElement : undefined}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
    >
      <box flexDirection="row">
        <Show
          when={props.spinner && !waiting()}
          fallback={
            <text
              width={INLINE_TOOL_ICON_WIDTH}
              flexShrink={0}
              fg={waiting() ? theme.warning : error() ? theme.error : (props.glyphColor ?? theme.primary)}
            >
              {waiting() ? "?" : error() ? "✕" : props.glyph}
            </text>
          }
        >
          <box width={INLINE_TOOL_ICON_WIDTH} flexShrink={0}>
            <Show when={kv.get("animations_enabled", true)} fallback={<text fg={theme.primary}>…</text>}>
              <spinner frames={SPINNER_FRAMES} interval={80} color={theme.primary} />
            </Show>
          </box>
        </Show>
        <text flexGrow={1} fg={theme.textMuted}>
          {props.header}
        </text>
      </box>
      <Show when={props.children && !props.empty}>
        {/* The body sits in a soft card under its header, like a code block in a document. */}
        <box
          marginLeft={INLINE_TOOL_ICON_WIDTH}
          marginTop={1}
          backgroundColor={theme.backgroundPanel}
          paddingLeft={1}
          paddingRight={1}
          flexShrink={0}
        >
          {props.children}
        </box>
      </Show>
      <Show when={error()}>
        <box paddingLeft={INLINE_TOOL_ICON_WIDTH}>
          <text fg={theme.error}>{error()}</text>
        </box>
      </Show>
    </box>
  )
}

function Shell(props: ToolProps) {
  const { theme } = useTheme()
  const pathFormatter = usePathFormatter()
  const isRunning = createMemo(() => props.part.state.status === "running" || props.part.state.status === "pending")
  const output = createMemo(() => stripAnsi(stringValue(props.metadata.output)?.trim() ?? ""))
  const exit = createMemo(() => numberValue(props.metadata.exit))
  const command = createMemo(() => stringValue(props.input.command) ?? "")

  const workdir = createMemo(() => {
    const value = stringValue(props.input.workdir)
    if (!value || value === ".") return undefined
    const formatted = pathFormatter.format(value)
    return formatted === "." ? undefined : formatted
  })

  return (
    <Show
      when={command()}
      fallback={
        <InlineTool icon="$" pending="writing command…" complete={false} part={props.part}>
          {""}
        </InlineTool>
      }
    >
      <BlockTool
        glyph="$"
        spinner={isRunning()}
        empty={!output()}
        part={props.part}
        header={
          <>
            <span style={{ fg: theme.text }}>{command()}</span>
            <Show when={workdir()}>{(dir) => <span style={{ fg: theme.textMuted }}>{"  "}in {dir()}</span>}</Show>
            <Show when={elapsed(props.part)}>{(time) => <span style={{ fg: theme.textMuted }}>{"  "}{time()}</span>}</Show>
            <Show when={exit() !== undefined && exit() !== 0}>
              <span style={{ fg: theme.error }}>{"  "}exit {exit()}</span>
            </Show>
          </>
        }
      >
        <Show when={output()}>
          <OutputBlock text={output()} />
        </Show>
      </BlockTool>
    </Show>
  )
}

/** Counts added and removed lines in a unified diff. */
export function diffStat(diff: string) {
  let added = 0
  let removed = 0
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue
    if (line.startsWith("+")) added++
    else if (line.startsWith("-")) removed++
  }
  return { added, removed }
}

function DiffStat(props: { added: number; removed: number }) {
  const { theme } = useTheme()
  return (
    <>
      <Show when={props.added}>
        <span style={{ fg: theme.diffAdded }}>{"  "}+{props.added}</span>
      </Show>
      <Show when={props.removed}>
        <span style={{ fg: theme.diffRemoved }}>{"  "}−{props.removed}</span>
      </Show>
    </>
  )
}

/** A unified (or, on very wide terminals, split) diff, collapsed past a screenful. */
function DiffBody(props: { diff: string; filePath: string }) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  const [expanded, setExpanded] = createSignal(false)
  const view = createMemo(() => {
    if (ctx.tui.diff_style === "stacked") return "unified"
    return ctx.width > 160 ? "split" : "unified"
  })
  const rows = createMemo(() => props.diff.split("\n").filter((line) => !/^(---|\+\+\+|Index:|=+$|diff )/.test(line)).length)
  const tall = () => rows() > DIFF_PREVIEW_ROWS
  return (
    <box flexShrink={0}>
      <box maxHeight={tall() && !expanded() ? DIFF_PREVIEW_ROWS : undefined} overflow="hidden">
        <diff
          diff={props.diff}
          view={view()}
          filetype={filetype(props.filePath)}
          syntaxStyle={syntax()}
          showLineNumbers={true}
          width="100%"
          wrapMode={ctx.diffWrapMode()}
          fg={theme.text}
          addedBg={theme.diffAddedBg}
          removedBg={theme.diffRemovedBg}
          contextBg={theme.diffContextBg}
          addedSignColor={theme.diffHighlightAdded}
          removedSignColor={theme.diffHighlightRemoved}
          lineNumberFg={theme.diffLineNumber}
          lineNumberBg={theme.diffContextBg}
          addedLineNumberBg={theme.diffAddedLineNumberBg}
          removedLineNumberBg={theme.diffRemovedLineNumberBg}
        />
      </box>
      <Show when={tall()}>
        <box onMouseUp={() => setExpanded((value) => !value)}>
          <text fg={theme.border}>{expanded() ? "▴ collapse" : `… ${rows() - DIFF_PREVIEW_ROWS} more lines`}</text>
        </box>
      </Show>
    </box>
  )
}

function Write(props: ToolProps) {
  const { theme, syntax } = useTheme()
  const pathFormatter = usePathFormatter()
  const [expanded, setExpanded] = createSignal(false)
  const code = createMemo(() => stringValue(props.input.content) ?? "")
  const lines = createMemo(() => (code() ? code().split("\n").length : 0))
  const shown = createMemo(() => (expanded() ? code() : code().split("\n").slice(0, 12).join("\n")))

  return (
    <Switch>
      <Match when={props.metadata.diagnostics !== undefined}>
        <BlockTool
          glyph="±"
          part={props.part}
          onClick={lines() > 12 ? () => setExpanded((value) => !value) : undefined}
          header={
            <>
              <span style={{ fg: theme.text, bold: true }}>{pathFormatter.format(stringValue(props.input.filePath))}</span>
              <span style={{ fg: theme.textMuted }}>{"  "}new file</span>
              <span style={{ fg: theme.diffAdded }}>{"  "}+{lines()}</span>
            </>
          }
        >
          <box>
            <line_number fg={theme.diffLineNumber} minWidth={3} paddingRight={1}>
              <code
                conceal={false}
                fg={theme.text}
                filetype={filetype(stringValue(props.input.filePath))}
                syntaxStyle={syntax()}
                content={shown()}
              />
            </line_number>
            <Show when={lines() > 12}>
              <text fg={theme.border}>{expanded() ? "▴ collapse" : `… ${lines() - 12} more lines`}</text>
            </Show>
          </box>
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={stringValue(props.input.filePath) ?? ""} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="±" pending="preparing write…" complete={stringValue(props.input.filePath)} part={props.part}>
          <Verb>Write</Verb> {pathFormatter.format(stringValue(props.input.filePath))}
        </InlineTool>
      </Match>
    </Switch>
  )
}

/** Consecutive reads, searches and listings as one entry: what the agent looked at. */
function Explored(props: { parts: ToolPart[] }) {
  const { theme } = useTheme()
  const kv = useKV()
  const pathFormatter = usePathFormatter()
  const running = createMemo(() => props.parts.some((part) => part.state.status === "running" || part.state.status === "pending"))
  const describe = (part: ToolPart) => {
    const input = part.state.input ?? {}
    const metadata = part.state.status === "pending" ? {} : (part.state.metadata ?? {})
    if (part.tool === "read") {
      const extra = [numberValue(input.offset) && `from ${numberValue(input.offset)}`, numberValue(input.limit) && `${numberValue(input.limit)} lines`]
        .filter(Boolean)
        .join(", ")
      return { verb: "Read", target: pathFormatter.format(stringValue(input.filePath)), detail: extra }
    }
    if (part.tool === "grep") {
      const count = numberValue(metadata.matches)
      return {
        verb: "Search",
        target: `${stringValue(input.pattern) ?? ""}${stringValue(input.path) ? " in " + pathFormatter.format(stringValue(input.path)) : ""}`,
        detail: count === undefined ? "" : `${count} ${count === 1 ? "match" : "matches"}`,
      }
    }
    if (part.tool === "glob") {
      const count = numberValue(metadata.count)
      return {
        verb: "Find",
        target: `${stringValue(input.pattern) ?? ""}${stringValue(input.path) ? " in " + pathFormatter.format(stringValue(input.path)) : ""}`,
        detail: count === undefined ? "" : `${count} ${count === 1 ? "file" : "files"}`,
      }
    }
    return { verb: "List", target: pathFormatter.format(stringValue(input.path) ?? "."), detail: "" }
  }
  const loaded = (part: ToolPart) => {
    if (part.state.status !== "completed" || part.state.time.compacted) return []
    const value = part.state.metadata?.loaded
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  }

  return (
    <Show
      when={props.parts.length > 1}
      fallback={
        <InlineTool icon={TOOL_BULLET} pending="exploring…" complete={true} part={props.parts[0]}>
          {(() => {
            const item = describe(props.parts[0])
            return (
              <>
                <Verb>{item.verb}</Verb> {item.target}
                <Show when={item.detail}>
                  <span style={{ fg: theme.border }}> · {item.detail}</span>
                </Show>
                <For each={loaded(props.parts[0])}>{(file) => <span style={{ fg: theme.border }}> · +{pathFormatter.format(file)}</span>}</For>
              </>
            )
          })()}
        </InlineTool>
      }
    >
      <box
        flexShrink={0}
        ref={(el: BoxRenderable) =>
          setPreLayoutSiblingMargin(el, (previous) =>
            previous instanceof BoxRenderable && (previous.height > 1 || alwaysSeparate.has(previous)) ? 1 : 0,
          )
        }
      >
        <InlineToolRow
          icon={TOOL_BULLET}
          iconColor={theme.border}
          color={theme.textMuted}
          complete={true}
          pending=""
          spinner={running()}
          spinnerColor={theme.primary}
          animate={kv.get("animations_enabled", true)}
        >
          <Verb>{running() ? "Exploring" : "Explored"}</Verb>
          <span style={{ fg: theme.border }}> · {props.parts.length} calls</span>
        </InlineToolRow>
        <For each={props.parts}>
          {(part) => {
            const item = createMemo(() => describe(part))
            return (
              <box paddingLeft={INLINE_TOOL_ICON_WIDTH} flexDirection="row">
                <text fg={theme.textMuted} flexGrow={1}>
                  <span style={{ fg: theme.text }}>{item().verb.toLowerCase()}</span> {item().target}
                  <Show when={item().detail}>
                    <span style={{ fg: theme.border }}> · {item().detail}</span>
                  </Show>
                </text>
              </box>
            )
          }}
        </For>
      </box>
    </Show>
  )
}

function WebFetch(props: ToolProps) {
  return (
    <InlineTool icon={TOOL_BULLET} pending="fetching…" complete={stringValue(props.input.url)} part={props.part}>
      <Verb>Fetch</Verb> {stringValue(props.input.url)}
    </InlineTool>
  )
}

function BrowserOpen(props: ToolProps) {
  return (
    <InlineTool icon={TOOL_BULLET} pending="opening browser…" complete={stringValue(props.input.url)} part={props.part}>
      <Verb>Open</Verb> {stringValue(props.input.url)}
    </InlineTool>
  )
}

function WebSearch(props: ToolProps) {
  const { theme } = useTheme()
  return (
    <InlineTool icon={TOOL_BULLET} pending="searching the web…" complete={stringValue(props.input.query)} part={props.part}>
      <Verb>Web</Verb> {stringValue(props.input.query)}
      <span style={{ fg: theme.border }}>
        {" "}
        · {webSearchProviderLabel(props.metadata.provider)}
        <Show when={numberValue(props.metadata.numResults)}> · {numberValue(props.metadata.numResults)} results</Show>
      </span>
    </InlineTool>
  )
}

function Task(props: ToolProps) {
  const { theme } = useTheme()
  const { navigate } = useRoute()
  const sync = useSync()
  const dialog = useDialog()

  onMount(() => {
    const sessionID = stringValue(props.metadata.sessionId)
    if (sessionID && !sync.data.message[sessionID]?.length) void sync.session.sync(sessionID)
  })

  const sessionID = createMemo(() => stringValue(props.metadata.sessionId))
  const messages = createMemo(() => sync.data.message[sessionID() ?? ""] ?? [])

  const tools = createMemo(() => {
    return messages().flatMap((msg) =>
      (sync.data.part[msg.id] ?? [])
        .filter((part): part is ToolPart => part.type === "tool")
        .map((part) => ({ tool: part.tool, state: part.state })),
    )
  })

  const current = createMemo(() =>
    tools().findLast((x) => (x.state.status === "running" || x.state.status === "completed") && x.state.title),
  )

  const status = createMemo(() => sync.data.session_status[sessionID() ?? ""])
  const isRunning = createMemo(() => {
    const value = status()
    return (
      props.part.state.status === "running" ||
      (props.metadata.background === true && value !== undefined && value.type !== "idle")
    )
  })
  const retry = createMemo(() => {
    const value = status()
    if (value?.type !== "retry") return
    return value
  })

  const duration = createMemo(() => {
    const first = messages().find((x) => x.role === "user")?.time.created
    const assistant = messages().findLast((x) => x.role === "assistant")?.time.completed
    if (!first || !assistant) return 0
    return assistant - first
  })

  const detail = createMemo(() => {
    const retrying = retry()
    if (isRunning() && retrying) return formatSubagentRetry(retrying.attempt, Locale.truncate(retrying.message, 80))
    if (isRunning() && tools().length > 0) {
      const item = current()
      if (!item) return formatSubagentToolcalls(tools().length)
      const title = item.state.status === "running" || item.state.status === "completed" ? item.state.title : undefined
      return `${Locale.titlecase(item.tool)} ${title}`
    }
    if (!isRunning() && props.part.state.status === "completed")
      return formatCompletedSubagentDetail(tools().length, Locale.duration(duration()))
    return ""
  })

  return (
    <InlineTool
      icon="⇢"
      iconColor={theme.primary}
      separate={true}
      color={retry() ? theme.error : undefined}
      spinner={isRunning()}
      complete={stringValue(props.input.description)}
      pending="delegating…"
      part={props.part}
      onClick={() => {
        if (sessionID()) {
          navigate({ type: "session", sessionID: sessionID()! })
        }
        const status = retry()
        if (status) void DialogAlert.show(dialog, "Retry Error", status.message)
      }}
    >
      <Verb>
        {formatSubagentTitle(
          Locale.titlecase(stringValue(props.input.subagent_type) ?? "General"),
          stringValue(props.input.description) ?? "",
          props.metadata.background === true,
        )}
      </Verb>
      <Show when={detail()}>
        <span style={{ fg: theme.textMuted }}>{"\n"}{detail()}</span>
      </Show>
    </InlineTool>
  )
}

export function formatSubagentToolcalls(count: number) {
  return `${count} toolcall${count === 1 ? "" : "s"}`
}

export function formatSubagentTitle(agent: string, description: string, background: boolean) {
  return `${agent} Task${background ? " (background)" : ""} — ${description}`
}

export function formatSubagentRetry(attempt: number, message: string) {
  return `Retrying (attempt ${attempt}) · ${message}`
}

export function formatCompletedSubagentDetail(toolcalls: number, duration: string) {
  if (toolcalls === 0) return duration
  return `${formatSubagentToolcalls(toolcalls)} · ${duration}`
}

type ExecuteCall = { tool: string; status: "running" | "completed" | "error"; input?: Record<string, unknown> }

function executeCalls(value: unknown): ExecuteCall[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((call) => {
    const item = recordValue(call)
    const tool = stringValue(item?.tool)
    const status = stringValue(item?.status)
    if (!tool || !status || !["running", "completed", "error"].includes(status)) return []
    return [{ tool, status: status as ExecuteCall["status"], input: recordValue(item?.input) }]
  })
}

// The `execute` tool streams child tool calls through metadata, not a child session like Task.
function Execute(props: ToolProps) {
  const { theme } = useTheme()
  const isLoading = createMemo(() => props.part.state.status === "pending" || props.part.state.status === "running")
  const calls = createMemo(() => executeCalls(props.metadata.toolCalls))
  const output = createMemo(() => stripAnsi(props.output?.trim() ?? ""))
  const hasRuntimeError = createMemo(() => props.metadata.error === true)

  return (
    <BlockTool
      glyph="›"
      spinner={isLoading()}
      glyphColor={hasRuntimeError() ? theme.error : theme.primary}
      part={props.part}
      header={<span style={{ fg: theme.text, bold: true }}>execute</span>}
    >
      <For each={calls()}>
        {(call) => (
          <box>
            <text fg={call.status === "error" ? theme.error : theme.textMuted}>
              {call.tool} {input(call.input ?? {})}
              {call.status === "error" ? " · failed" : ""}
            </text>
          </box>
        )}
      </For>
      <Show when={output() && hasRuntimeError()}>
        <OutputBlock text={output()} color={theme.error} lines={4} />
      </Show>
    </BlockTool>
  )
}

function Edit(props: ToolProps) {
  const { theme } = useTheme()
  const pathFormatter = usePathFormatter()
  const diffContent = createMemo(() => stringValue(props.metadata.diff) ?? "")
  const stat = createMemo(() => diffStat(diffContent()))

  return (
    <Switch>
      <Match when={stringValue(props.metadata.diff) !== undefined}>
        <BlockTool
          glyph="±"
          part={props.part}
          header={
            <>
              <span style={{ fg: theme.text, bold: true }}>{pathFormatter.format(stringValue(props.input.filePath))}</span>
              <DiffStat added={stat().added} removed={stat().removed} />
            </>
          }
        >
          <DiffBody diff={diffContent()} filePath={stringValue(props.input.filePath) ?? ""} />
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={stringValue(props.input.filePath) ?? ""} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="±" pending="preparing edit…" complete={stringValue(props.input.filePath)} part={props.part}>
          <Verb>Edit</Verb> {pathFormatter.format(stringValue(props.input.filePath))}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function ApplyPatch(props: ToolProps) {
  const { theme } = useTheme()
  const pathFormatter = usePathFormatter()
  const files = createMemo(() => parseApplyPatchFiles(props.metadata.files))

  function label(file: { type: string; relativePath: string; filePath: string }) {
    if (file.type === "delete") return "deleted"
    if (file.type === "add") return "new file"
    if (file.type === "move") return "moved from " + pathFormatter.format(file.filePath)
    return ""
  }

  return (
    <Switch>
      <Match when={files().length > 0}>
        <For each={files()}>
          {(file) => {
            const stat = createMemo(() => diffStat(file.patch))
            return (
              <BlockTool
                glyph="±"
                part={props.part}
                header={
                  <>
                    <span style={{ fg: theme.text, bold: true }}>{file.relativePath}</span>
                    <Show when={label(file)}>{(text) => <span style={{ fg: theme.textMuted }}>{"  "}{text()}</span>}</Show>
                    <Show when={file.type === "delete"} fallback={<DiffStat added={stat().added} removed={stat().removed} />}>
                      <span style={{ fg: theme.diffRemoved }}>{"  "}−{file.deletions}</span>
                    </Show>
                  </>
                }
              >
                <Show when={file.type !== "delete"}>
                  <DiffBody diff={file.patch} filePath={file.filePath} />
                  <Diagnostics diagnostics={props.metadata.diagnostics} filePath={file.movePath ?? file.filePath} />
                </Show>
              </BlockTool>
            )
          }}
        </For>
      </Match>
      <Match when={true}>
        <InlineTool icon="±" pending="preparing patch…" failure="Patch failed" complete={false} part={props.part}>
          <Verb>Patch</Verb>
        </InlineTool>
      </Match>
    </Switch>
  )
}

function TodoWrite(props: ToolProps) {
  const { theme } = useTheme()
  const todos = createMemo(() => parseTodos(props.input.todos))
  const done = createMemo(() => todos().filter((todo) => todo.status === "completed").length)
  return (
    <Switch>
      <Match when={parseTodos(props.metadata.todos).length}>
        <BlockTool
          glyph="≡"
          part={props.part}
          header={
            <>
              <span style={{ fg: theme.text, bold: true }}>Plan</span>
              <span style={{ fg: theme.textMuted }}>{"  "}{done()}/{todos().length}</span>
            </>
          }
        >
          <box>
            <For each={todos()}>{(todo) => <TodoItem status={todo.status} content={todo.content} />}</For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="≡" pending="updating plan…" failure="Plan update failed" complete={false} part={props.part}>
          <Verb>Plan</Verb>
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Question(props: ToolProps) {
  const { theme } = useTheme()
  const questions = createMemo(() => parseQuestions(props.input.questions))
  const answers = createMemo(() => parseQuestionAnswers(props.metadata.answers))
  const count = createMemo(() => questions().length)

  function format(answer?: ReadonlyArray<string>) {
    if (!answer?.length) return "(no answer)"
    return answer.join(", ")
  }

  return (
    <Switch>
      <Match when={answers()}>
        <BlockTool
          glyph="?"
          part={props.part}
          header={<span style={{ fg: theme.text, bold: true }}>Asked {count()} question{count() !== 1 ? "s" : ""}</span>}
        >
          <For each={questions()}>
            {(q, i) => (
              <box>
                <text fg={theme.textMuted}>{q.question}</text>
                <text fg={theme.text}>
                  <span style={{ fg: theme.primary }}>› </span>
                  {format(answers()?.[i()])}
                </text>
              </box>
            )}
          </For>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="?" pending="asking…" complete={count()} part={props.part}>
          <Verb>Asking</Verb> {count()} question{count() !== 1 ? "s" : ""}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Skill(props: ToolProps) {
  return (
    <InlineTool icon={TOOL_BULLET} pending="loading skill…" complete={stringValue(props.input.name)} part={props.part}>
      <Verb>Skill</Verb> {stringValue(props.input.name)}
    </InlineTool>
  )
}

function Diagnostics(props: { diagnostics: unknown; filePath: string }) {
  const { theme } = useTheme()
  const terminalEnvironment = useTuiTerminalEnvironment()
  const errors = createMemo(() => {
    const normalized = normalizePath(
      typeof props.filePath === "string" ? props.filePath : "",
      terminalEnvironment.platform,
    )
    return parseDiagnostics(props.diagnostics, normalized)
  })

  return (
    <Show when={errors().length}>
      <box>
        <For each={errors()}>
          {(diagnostic) => (
            <text fg={theme.error}>
              Error [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}] {diagnostic.message}
            </text>
          )}
        </For>
      </box>
    </Show>
  )
}

function input(input: Record<string, unknown>, omit?: string[]): string {
  const primitives = Object.entries(input).filter(([key, value]) => {
    if (omit?.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (primitives.length === 0) return ""
  return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

const toolDisplays = new Set([
  "bash",
  "glob",
  "read",
  "grep",
  "webfetch",
  "browser_open",
  "websearch",
  "write",
  "edit",
  "task",
  "apply_patch",
  "todowrite",
  "question",
  "skill",
  "execute",
])

export function toolDisplay(tool: string) {
  return toolDisplays.has(tool) ? tool : "generic"
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return
  return value as Record<string, unknown>
}

export function parseApplyPatchFiles(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const file = recordValue(item)
    if (!file) return []
    const type = stringValue(file.type)
    const relativePath = stringValue(file.relativePath)
    const filePath = stringValue(file.filePath)
    const patch = stringValue(file.patch)
    const deletions = numberValue(file.deletions)
    if (!type || !relativePath || !filePath || patch === undefined || deletions === undefined) return []
    return [{ type, relativePath, filePath, patch, deletions, movePath: stringValue(file.movePath) }]
  })
}

export function parseTodos(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const todo = recordValue(item)
    const status = stringValue(todo?.status)
    const content = stringValue(todo?.content)
    return status && content ? [{ status, content }] : []
  })
}

export function parseQuestions(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const question = stringValue(recordValue(item)?.question)
    return question ? [{ question }] : []
  })
}

export function parseQuestionAnswers(value: unknown) {
  if (!Array.isArray(value)) return
  return value.map((answer) =>
    Array.isArray(answer) ? answer.filter((item): item is string => typeof item === "string") : [],
  )
}

export function parseDiagnostics(value: unknown, filePath: string) {
  const diagnostics = recordValue(value)?.[filePath]
  if (!Array.isArray(diagnostics)) return []
  return diagnostics
    .flatMap((item) => {
      const diagnostic = recordValue(item)
      const start = recordValue(recordValue(diagnostic?.range)?.start)
      const line = numberValue(start?.line)
      const character = numberValue(start?.character)
      const message = stringValue(diagnostic?.message)
      if (diagnostic?.severity !== 1 || line === undefined || character === undefined || !message) return []
      return [{ range: { start: { line, character } }, message }]
    })
    .slice(0, 3)
}

import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createMemo, For, type Accessor } from "solid-js"
import { DEFAULT_THEMES, useTheme } from "../../context/theme"
import { useCommandShortcut } from "../../keymap"

const themeCount = Object.keys(DEFAULT_THEMES).length

type TipPart = { text: string; highlight: boolean }
type TipShortcut = Accessor<string>
type Shortcuts = {
  agentCycle: TipShortcut
  childFirst: TipShortcut
  childNext: TipShortcut
  childPrevious: TipShortcut
  commandList: TipShortcut
  diffOpen: TipShortcut
  editorOpen: TipShortcut
  helpShow: TipShortcut
  inputClear: TipShortcut
  inputNewline: TipShortcut
  inputPaste: TipShortcut
  inputUndo: TipShortcut
  leader: TipShortcut
  messagesCopy: TipShortcut
  messagesFirst: TipShortcut
  messagesLast: TipShortcut
  messagesPageDown: TipShortcut
  messagesPageUp: TipShortcut
  messagesToggleConceal: TipShortcut
  missionControl: TipShortcut
  modelCycleRecent: TipShortcut
  modelList: TipShortcut
  sessionBackground: TipShortcut
  sessionExport: TipShortcut
  sessionInterrupt: TipShortcut
  sessionList: TipShortcut
  sessionNew: TipShortcut
  sessionParent: TipShortcut
  sessionPinToggle: TipShortcut
  sessionQuickSwitch1: TipShortcut
  sessionQuickSwitch9: TipShortcut
  sessionRename: TipShortcut
  sessionSidebarClose: TipShortcut
  sessionSidebarToggle: TipShortcut
  sessionTimeline: TipShortcut
  statusView: TipShortcut
  terminalSuspend: TipShortcut
  themeList: TipShortcut
  viewToggle: TipShortcut
}
type Tip = string | ((shortcuts: Shortcuts) => string | undefined)

function parse(tip: string): TipPart[] {
  const parts: TipPart[] = []
  const regex = /\{highlight\}(.*?)\{\/highlight\}/g
  const found = Array.from(tip.matchAll(regex))
  const state = found.reduce(
    (acc, match) => {
      const start = match.index ?? 0
      if (start > acc.index) {
        acc.parts.push({ text: tip.slice(acc.index, start), highlight: false })
      }
      acc.parts.push({ text: match[1], highlight: true })
      acc.index = start + match[0].length
      return acc
    },
    { parts, index: 0 },
  )

  if (state.index < tip.length) {
    parts.push({ text: tip.slice(state.index), highlight: false })
  }

  return parts
}

const NO_MODELS_TIP = "Run {highlight}/connect{/highlight} to add an AI provider. RIFT is ready; it just needs a brain"
const NO_MODELS_PARTS = parse(NO_MODELS_TIP)

function shortcutText(value: string) {
  return `{highlight}${value}{/highlight}`
}

function commandText(command: string, shortcut: string) {
  if (!shortcut) return shortcutText(command)
  return `${shortcutText(command)} or ${shortcutText(shortcut)}`
}

function press(shortcut: string, text: string) {
  if (!shortcut) return undefined
  return `Press ${shortcutText(shortcut)} ${text}`
}

function configShortcut(api: TuiPluginApi, command: string): TipShortcut {
  return () =>
    api.tuiConfig.keybinds
      .get(command)
      .map((binding) => api.keys.formatSequence(Array.from(api.keymap.parseKeySequence(binding.key))))
      .filter(Boolean)
      .join(", ")
}

export function Tips(props: { api: TuiPluginApi; connected?: boolean }) {
  const theme = useTheme().theme
  const tipOffset = Math.random()
  const shortcuts: Shortcuts = {
    agentCycle: useCommandShortcut("agent.cycle"),
    childFirst: configShortcut(props.api, "session.child.first"),
    childNext: configShortcut(props.api, "session.child.next"),
    childPrevious: configShortcut(props.api, "session.child.previous"),
    commandList: useCommandShortcut("command.palette.show"),
    diffOpen: configShortcut(props.api, "diff.open"),
    editorOpen: useCommandShortcut("prompt.editor"),
    helpShow: useCommandShortcut("help.show"),
    inputClear: useCommandShortcut("prompt.clear"),
    inputNewline: useCommandShortcut("input.newline"),
    inputPaste: useCommandShortcut("prompt.paste"),
    inputUndo: useCommandShortcut("input.undo"),
    leader: configShortcut(props.api, "leader"),
    messagesCopy: configShortcut(props.api, "messages.copy"),
    messagesFirst: configShortcut(props.api, "session.first"),
    messagesLast: configShortcut(props.api, "session.last"),
    messagesPageDown: configShortcut(props.api, "session.page.down"),
    messagesPageUp: configShortcut(props.api, "session.page.up"),
    messagesToggleConceal: configShortcut(props.api, "session.toggle.conceal"),
    missionControl: configShortcut(props.api, "mission.control"),
    modelCycleRecent: useCommandShortcut("model.cycle_recent"),
    modelList: useCommandShortcut("model.list"),
    sessionBackground: configShortcut(props.api, "session.background"),
    sessionExport: configShortcut(props.api, "session.export"),
    sessionInterrupt: configShortcut(props.api, "session.interrupt"),
    sessionList: useCommandShortcut("session.list"),
    sessionNew: useCommandShortcut("session.new"),
    sessionParent: configShortcut(props.api, "session.parent"),
    sessionPinToggle: configShortcut(props.api, "session.pin.toggle"),
    sessionQuickSwitch1: useCommandShortcut("session.quick_switch.1"),
    sessionQuickSwitch9: useCommandShortcut("session.quick_switch.9"),
    sessionRename: configShortcut(props.api, "session.rename"),
    sessionSidebarClose: configShortcut(props.api, "session.sidebar.close"),
    sessionSidebarToggle: configShortcut(props.api, "session.sidebar.toggle"),
    sessionTimeline: configShortcut(props.api, "session.timeline"),
    statusView: useCommandShortcut("opencode.status"),
    terminalSuspend: useCommandShortcut("terminal.suspend"),
    themeList: useCommandShortcut("theme.switch"),
    viewToggle: configShortcut(props.api, "session.view.toggle"),
  }
  const tip = createMemo(() => {
    if (props.connected === false) return NO_MODELS_TIP
    const tips = [...TIPS, process.platform !== "win32" ? TERMINAL_SUSPEND_TIP : INPUT_UNDO_TIP].flatMap((item) => {
      const value = typeof item === "string" ? item : item(shortcuts)
      return value ? [value] : []
    })
    return tips[Math.floor(tipOffset * tips.length)] ?? NO_MODELS_TIP
  }, NO_MODELS_TIP)
  // Solid can expose a memo's initial value while a pure computation is pending.
  const parts = createMemo(() => {
    const value = tip()
    if (typeof value === "string") return parse(value)
    return NO_MODELS_PARTS
  }, NO_MODELS_PARTS)

  return (
    <box flexDirection="row" maxWidth="100%">
      <text flexShrink={0} style={{ fg: theme.warning }}>
        ● Tip{" "}
      </text>
      <text flexShrink={1} wrapMode="word">
        <For each={parts()}>
          {(part) => <span style={{ fg: part.highlight ? theme.text : theme.textMuted }}>{part.text}</span>}
        </For>
      </text>
    </box>
  )
}

// Each tip teaches one real feature first; the joke rides second. Keep them to about two lines.
const TIPS: Tip[] = [
  // RIFT itself
  "RIFT runs the checks before it says {highlight}done{/highlight}. Trust issues, but make it engineering",
  "The sidebar's engineering graph is the real plan. The chat is just vibes about the plan",
  (shortcuts) => press(shortcuts.viewToggle(), "to flip between the task view and the full chat. One shows the work, one shows the yapping"),
  (shortcuts) => press(shortcuts.missionControl(), "to open Mission Control. No NASA clearance required"),
  (shortcuts) => press(shortcuts.diffOpen(), "to review every change. Read the diff before the diff reads you"),
  (shortcuts) => press(shortcuts.sessionSidebarClose(), "to close the sidebar when you're not typing. Monk mode: on"),
  (shortcuts) => press(shortcuts.sessionSidebarToggle(), "to bring the sidebar back. It missed you"),
  (shortcuts) => press(shortcuts.agentCycle(), "to cycle Build, Plan and Vibe. Plan thinks, Build does, Vibe… vibes"),
  "Switch to {highlight}Plan{/highlight} to think it through before anything gets touched. Revolutionary, we know",
  "Mention {highlight}@agent-name{/highlight} to hand work to a specialist subagent. Delegation: the senior engineer's superpower",

  // /video
  "Type {highlight}/video{/highlight} and one sentence. RIFT storyboards it, checks every frame and renders the MP4",
  "{highlight}/video{/highlight} looks at every frame before it ships. More than most launch videos can say",

  // Prompting
  "Type {highlight}@{/highlight} and a filename to attach it. Faster than pasting 400 lines and apologizing",
  "Start a message with {highlight}!{/highlight} to run a shell command ({highlight}!git status{/highlight}). Muscle memory, respected",
  "Drag images or PDFs into the terminal. A screenshot of the bug beats a paragraph about the bug",
  (shortcuts) => press(shortcuts.inputPaste(), "to paste an image from your clipboard. A screenshot is worth a thousand tokens"),
  (shortcuts) => `Use ${commandText("/editor", shortcuts.editorOpen())} to write your prompt in your own editor. Your dotfiles deserve an audience`,
  (shortcuts) => press(shortcuts.inputNewline(), "for a newline. Enter sends; that's the deal"),
  (shortcuts) => press(shortcuts.inputClear(), "to clear the prompt. Some thoughts are better left unsent"),

  // Sessions
  "{highlight}/undo{/highlight} reverts the last message and its file changes. Time travel, minus the paradoxes",
  "{highlight}/redo{/highlight} brings back what you undid. Commitment issues are fully supported",
  "{highlight}/compact{/highlight} summarizes a long session before it hits the context limit. Marie Kondo for tokens",
  (shortcuts) => `Use ${commandText("/new", shortcuts.sessionNew())} for a fresh session. New context, who dis`,
  (shortcuts) => `Use ${commandText("/sessions", shortcuts.sessionList())} to list, pin and resume sessions. Yesterday's rabbit hole is still there`,
  (shortcuts) => press(shortcuts.sessionPinToggle(), "in the session list to pin one. Favorites, but for problems"),
  (shortcuts) =>
    shortcuts.sessionQuickSwitch1() && shortcuts.sessionQuickSwitch9()
      ? `Use ${shortcutText(shortcuts.sessionQuickSwitch1())} through ${shortcutText(shortcuts.sessionQuickSwitch9())} to jump between pinned sessions. Tab hoarding, perfected`
      : undefined,
  (shortcuts) => press(shortcuts.sessionRename(), `to rename a session. "fix stuff 7" is not a name`),
  (shortcuts) => press(shortcuts.sessionInterrupt(), "to stop the agent mid-thought. Rude, but sometimes necessary"),
  (shortcuts) => press(shortcuts.sessionBackground(), "to send running subagents to the background. They keep working, you keep scrolling"),
  (shortcuts) => `Use ${commandText("/export", shortcuts.sessionExport())} to save the conversation as Markdown. Receipts`,
  (shortcuts) => press(shortcuts.messagesCopy(), "to copy the last reply. Like Ctrl+C, but it understood you"),
  (shortcuts) => `Use ${commandText("/timeline", shortcuts.sessionTimeline())} to jump to any message. Scrolling is for amateurs`,
  (shortcuts) => press(shortcuts.messagesFirst(), "to jump to the start of the conversation, back when things were simple"),
  (shortcuts) => press(shortcuts.messagesLast(), "to jump back to the latest message. Welcome back to the present"),
  (shortcuts) =>
    shortcuts.messagesPageUp() && shortcuts.messagesPageDown()
      ? `Use ${shortcutText(shortcuts.messagesPageUp())}/${shortcutText(shortcuts.messagesPageDown())} to page through history. Speed-reading optional`
      : undefined,
  (shortcuts) => press(shortcuts.messagesToggleConceal(), "to fold code blocks away. Out of sight, out of context"),
  (shortcuts) => {
    const items = [
      shortcuts.sessionParent(),
      shortcuts.childFirst(),
      shortcuts.childPrevious(),
      shortcuts.childNext(),
    ].filter(Boolean)
    if (!items.length) return undefined
    return `Use ${items.map(shortcutText).join(" / ")} to move between parent and child sessions. Subagents have family trees now`
  },
  "{highlight}/review{/highlight} reviews uncommitted changes, branches or PRs. A second pair of eyes that never needs coffee",
  "{highlight}/share{/highlight} makes a public link to the session. Show your work, or your crimes",

  // Models, looks, navigation
  (shortcuts) => `Use ${commandText("/models", shortcuts.modelList())} to switch models. Commitment is optional`,
  (shortcuts) => press(shortcuts.modelCycleRecent(), "to bounce between recent models. The situationship of model selection"),
  (shortcuts) => `Use ${commandText("/themes", shortcuts.themeList())} to pick from ${themeCount} themes. Dark mode is a personality`,
  "{highlight}/connect{/highlight} adds keys for 75+ providers. Yes, that one too",
  (shortcuts) => press(shortcuts.commandList(), "for the command palette. Every action, zero memorization"),
  (shortcuts) => `The leader key is ${shortcutText(shortcuts.leader())}: press it, then one more key. Chords, but for shipping`,
  (shortcuts) => `Use ${commandText("/help", shortcuts.helpShow())} for help. Reading the manual remains undefeated`,
  (shortcuts) => `Use ${commandText("/status", shortcuts.statusView())} for system status. Everything's fine. Probably. Check anyway`,

  // Making RIFT yours
  "Run {highlight}/init{/highlight} so RIFT learns your codebase's rules. Onboarding in seconds, not sprints",
  "Commit {highlight}AGENTS.md{/highlight} so every agent on the team follows the same rules. Peer pressure, automated",
  "Drop {highlight}.md{/highlight} prompts in {highlight}.rift/commands/{/highlight} to make your own slash commands. Copy-paste is not a workflow",
  "Use {highlight}$ARGUMENTS{/highlight} in a custom command to take input. Templates with ambition",
  "Configure MCP servers in the {highlight}mcp{/highlight} config section to give RIFT new tools. Teach it tricks",
  "Set any keybind to {highlight}none{/highlight} to turn it off. Your fingers, your rules",
  'Set {highlight}"git push": "ask"{/highlight} in permissions and RIFT asks before pushing. Consent is cool',
  'Set {highlight}"rm -rf *": "deny"{/highlight} in permissions. Just in case. You know why',
  "{highlight}doom_loop{/highlight} protection stops an agent calling the same tool forever. Unlike your 2am debugging",

  // The CLI
  '{highlight}rift run "…"{/highlight} runs one prompt with no TUI. For scripts and cron jobs with ambition',
  "{highlight}rift --continue{/highlight} picks up your last session. Like you never left",
  "{highlight}rift pr 42{/highlight} checks out a PR and opens RIFT on it. Code review, but it reads the code first",
  "{highlight}rift stats{/highlight} shows your token spend. Sit down first",
  "{highlight}rift --mini{/highlight} starts the minimal interface. Same brain, fewer pixels",
  "{highlight}rift serve{/highlight} runs RIFT headless for API access. All brain, no face",
  "{highlight}rift upgrade{/highlight} gets the latest RIFT. New tricks, same agent",
]

const INPUT_UNDO_TIP: Tip = (shortcuts) => press(shortcuts.inputUndo(), "to undo edits in your prompt. Ctrl+Z for your words")
const TERMINAL_SUSPEND_TIP: Tip = (shortcuts) =>
  press(shortcuts.terminalSuspend(), "to suspend RIFT and drop to your shell. {highlight}fg{/highlight} brings it back, no hard feelings")

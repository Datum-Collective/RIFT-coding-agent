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

const NO_MODELS_TIP = "Run {highlight}/connect{/highlight} to add an AI provider. Until then, RIFT is a very nice text box"
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

// Voice: dry and specific, about what working with agents is actually like. About half the tips
// are plain; a joke only goes in when it's true. No memes, no "X, but for Y", no exclamation marks.
const TIPS: Tip[] = [
  // RIFT itself
  "RIFT runs the checks before it says {highlight}done{/highlight}. We had to build that on purpose, which says a lot about the industry",
  "The engineering graph shows what's actually done. The chat shows what the agent says is done. RIFT lives in the gap",
  (shortcuts) => press(shortcuts.viewToggle(), "to switch between the task view and the full chat. One is what happened, the other is how the agent felt about it"),
  (shortcuts) => press(shortcuts.missionControl(), "for Mission Control: every session at once. For people running five agents on one attention span"),
  (shortcuts) => press(shortcuts.diffOpen(), "to read the diff. The agent is confident. Confidence is not a test"),
  (shortcuts) =>
    shortcuts.sessionSidebarClose() && shortcuts.sessionSidebarToggle()
      ? `Press ${shortcutText(shortcuts.sessionSidebarClose())} to close the sidebar when you're not typing; ${shortcutText(shortcuts.sessionSidebarToggle())} brings it back`
      : undefined,
  (shortcuts) => press(shortcuts.agentCycle(), "to cycle between the Build, Plan and Vibe agents"),
  "The {highlight}Plan{/highlight} agent reads everything and changes nothing. Like a senior engineer in their last week",
  "Mention {highlight}@agent-name{/highlight} to hand a job to a subagent. Delegation works better when the delegate can't say no",
  "Type {highlight}/video{/highlight} and one sentence to get an MP4. It checks every frame first, which is more QA than most launch videos get",

  // Prompting
  "Type {highlight}@{/highlight} and a filename to attach it. Pasting 400 lines also works, the way shouting also works",
  "Start a message with {highlight}!{/highlight} to run a shell command, like {highlight}!git status{/highlight}. You were going to type it anyway",
  "Drag a screenshot or PDF into the terminal to attach it. It reads stack traces faster than you read Slack",
  (shortcuts) => press(shortcuts.inputPaste(), "to paste an image from the clipboard. The screenshot of the error, not a photo of your monitor"),
  (shortcuts) => `Use ${commandText("/editor", shortcuts.editorOpen())} to write long prompts in your own editor. Finally, a reason you configured it`,
  (shortcuts) => press(shortcuts.inputNewline(), "for a newline. Enter sends"),
  (shortcuts) => press(shortcuts.inputClear(), "to clear the prompt. Some messages are better as drafts"),

  // Sessions
  "{highlight}/undo{/highlight} reverts the last message and every file it touched. Nobody has to know",
  "{highlight}/redo{/highlight} restores what you undid. It was fine, actually",
  "{highlight}/compact{/highlight} summarizes a long session to free up context. It keeps the decisions and drops the arguing",
  (shortcuts) => `Use ${commandText("/new", shortcuts.sessionNew())} for a fresh session. Sometimes the context is the bug`,
  (shortcuts) => `Use ${commandText("/sessions", shortcuts.sessionList())} to list and resume sessions, including the "quick fix" from three days ago`,
  (shortcuts) => press(shortcuts.sessionPinToggle(), "in the session list to pin a session. For the bug that keeps coming back"),
  (shortcuts) =>
    shortcuts.sessionQuickSwitch1() && shortcuts.sessionQuickSwitch9()
      ? `Use ${shortcutText(shortcuts.sessionQuickSwitch1())} through ${shortcutText(shortcuts.sessionQuickSwitch9())} to jump between pinned sessions`
      : undefined,
  (shortcuts) => press(shortcuts.sessionRename(), `to rename a session. "untitled 14" helps nobody at the retro`),
  (shortcuts) => press(shortcuts.sessionInterrupt(), "to stop the agent mid-thought. It won't take it personally"),
  (shortcuts) => press(shortcuts.sessionBackground(), "to push running subagents to the background. They keep working. You can pretend you are too"),
  (shortcuts) => `Use ${commandText("/export", shortcuts.sessionExport())} to save the conversation as Markdown, for when someone asks why the migration did that`,
  (shortcuts) => press(shortcuts.messagesCopy(), "to copy the last reply"),
  (shortcuts) => `Use ${commandText("/timeline", shortcuts.sessionTimeline())} to jump to any message, like the one where it started going wrong`,
  (shortcuts) => press(shortcuts.messagesFirst(), "to jump to the first message, back when the plan was simple"),
  (shortcuts) => press(shortcuts.messagesLast(), "to jump to the latest message"),
  (shortcuts) =>
    shortcuts.messagesPageUp() && shortcuts.messagesPageDown()
      ? `Use ${shortcutText(shortcuts.messagesPageUp())}/${shortcutText(shortcuts.messagesPageDown())} to page through the conversation`
      : undefined,
  (shortcuts) => press(shortcuts.messagesToggleConceal(), "to hide code blocks and read just the conversation, like a manager"),
  (shortcuts) => {
    const items = [
      shortcuts.sessionParent(),
      shortcuts.childFirst(),
      shortcuts.childPrevious(),
      shortcuts.childNext(),
    ].filter(Boolean)
    if (!items.length) return undefined
    return `Use ${items.map(shortcutText).join(" / ")} to move between a session and its subagents`
  },
  "{highlight}/review{/highlight} reviews uncommitted changes, branches or PRs. It doesn't know it's 2am, and it doesn't care",
  "{highlight}/share{/highlight} makes a public link to this session. Read it once before sending",

  // Models, looks, navigation
  (shortcuts) => `Use ${commandText("/models", shortcuts.modelList())} to switch models. The bug will still be there`,
  (shortcuts) => press(shortcuts.modelCycleRecent(), "to switch between recently used models"),
  (shortcuts) => `Use ${commandText("/themes", shortcuts.themeList())} to pick from ${themeCount} themes. Choosing one counts as progress, briefly`,
  "{highlight}/connect{/highlight} adds an AI provider. 75+ supported. You'll use two",
  (shortcuts) => press(shortcuts.commandList(), "for the command palette. Every command, nothing to memorize"),
  (shortcuts) => `The leader key is ${shortcutText(shortcuts.leader())}: press it, then one more key. Emacs users, you're welcome`,
  (shortcuts) => `Use ${commandText("/help", shortcuts.helpShow())} to see everything RIFT can do. Nobody reads it, which is why tips exist`,
  (shortcuts) => `Use ${commandText("/status", shortcuts.statusView())} to see what's connected and what quietly isn't`,

  // Making RIFT yours
  "Run {highlight}/init{/highlight} and RIFT writes down your project's rules, including the weird build step only Dave knows about",
  "Commit {highlight}AGENTS.md{/highlight} so the whole team's agents share the same rules, instead of each one learning the codebase from scratch like each teammate did",
  "Save a prompt you keep retyping as a {highlight}.md{/highlight} file in {highlight}.rift/commands/{/highlight} and it becomes a slash command",
  "Use {highlight}$ARGUMENTS{/highlight} in a custom command to pass it input",
  "Add MCP servers in the {highlight}mcp{/highlight} config section to give RIFT new tools",
  "Set any keybind to {highlight}none{/highlight} to turn it off",
  'Set {highlight}"git push": "ask"{/highlight} in permissions and RIFT asks before pushing. Pushes to main are a group decision',
  'Set {highlight}"rm -rf *": "deny"{/highlight} in permissions. You will never need it, until the one time',
  "{highlight}doom_loop{/highlight} stops an agent calling the same tool forever. It does not cover you rerunning CI",

  // The CLI
  '{highlight}rift run "…"{/highlight} runs one prompt with no interface. Put it in cron and pretend you have a team',
  "{highlight}rift --continue{/highlight} picks up your last session exactly where you left it. The bug is also where you left it",
  "{highlight}rift pr 42{/highlight} checks out a pull request and opens RIFT on it. Reviewing before approving: a bold new workflow",
  "{highlight}rift stats{/highlight} shows your token spend. It's a business expense",
  "{highlight}rift --mini{/highlight} starts a minimal interface, for terminals split eight ways",
  "{highlight}rift serve{/highlight} runs RIFT headless over HTTP. Build your own front end; we won't be offended",
  "{highlight}rift upgrade{/highlight} installs the latest version. There usually is one",
]

const INPUT_UNDO_TIP: Tip = (shortcuts) => press(shortcuts.inputUndo(), "to undo edits in your prompt")
const TERMINAL_SUSPEND_TIP: Tip = (shortcuts) =>
  press(shortcuts.terminalSuspend(), "to drop to your shell. {highlight}fg{/highlight} brings RIFT back. It won't ask where you went")

/**
 * The one row under the composer bar. On the left, from the draft's column: who answers (agent, model), the key
 * hint, and the version on a wide terminal. On the right, ending on the mirror of that column: what needs attention
 * (the status), then the working folder and its branch.
 *
 * When the row runs short, the folder yields first: its middle segments fold into an ellipsis, down to its last two.
 * Then the version goes, then the hint's label (the key stays), then the status. Only then is the folder cut further.
 * The agent and model are the last to go. Nothing ever overlaps.
 */
import { TextRenderable, type BoxRenderable, type Renderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, Show, type JSX } from "solid-js"
import { useInteractivity } from "../../context/interactivity"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import { stringWidth } from "../../util/string-width"
import { BAR_PAD, TEXT_INSET } from "./frame"

/** Columns between the folder and the right group, and between items of the right group. */
const GAP = 2

/** The version only shows on a terminal at least this wide. */
export const VERSION_COLUMNS = 100

/** A folder squeezed narrower than this says nothing, so it goes. */
const MIN_FOLDER = 8

/** Where a dropped status waits: far enough left that no terminal shows it. */
const OFFSCREEN = -10_000

export type Folder = { directory: string; branch?: string }

/** Natural widths of what the row could show; the folder is the one item measured by its text. */
export type InfoParts = {
  row: number
  folder?: Folder
  lead: number
  status: number
  key: number
  label: number
  version: number
}

export type InfoFit = { folder?: string; status: boolean; label: boolean; version: boolean }

type Step = Omit<InfoFit, "folder">

/**
 * What the row keeps, from fullest to barest: the version goes first, then the hint's label, then the status. Once the
 * status has gone, the label and the version come back if they fit in what it leaves.
 */
const STEPS: Step[] = [
  { version: true, label: true, status: true },
  { version: false, label: true, status: true },
  { version: false, label: false, status: true },
  { version: true, label: true, status: false },
  { version: false, label: true, status: false },
  { version: false, label: false, status: false },
]

function right(parts: InfoParts, step: Step) {
  const widths = [
    parts.lead,
    step.status ? parts.status : 0,
    parts.key + (step.label && parts.label ? 1 + parts.label : 0),
    step.version ? parts.version : 0,
  ].filter((width) => width > 0)
  return widths.reduce((sum, width) => sum + width, 0) + GAP * Math.max(0, widths.length - 1)
}

/**
 * The folder's forms from longest to shortest: whole, then its middle segments folded into `…` one at a time, down
 * to its last two. The branch always stays.
 */
export function folderForms(folder: Folder) {
  const branch = folder.branch ? `:${folder.branch}` : ""
  const [root, ...segments] = folder.directory.split("/")
  const forms = [folder.directory + branch]
  for (let keep = segments.length - 1; keep >= 2; keep--) forms.push(`${root}/…/${segments.slice(-keep).join("/")}${branch}`)
  return forms
}

export function fitInfoRow(parts: InfoParts): InfoFit {
  if (!parts.folder) return STEPS.find((step) => right(parts, step) <= parts.row) ?? STEPS.at(-1)!
  const forms = folderForms(parts.folder)
  for (const step of STEPS) {
    const room = parts.row - right(parts, step) - GAP
    const folder = forms.find((form) => stringWidth(form) <= room)
    if (folder) return { ...step, folder }
  }
  const room = parts.row - right(parts, STEPS.at(-1)!) - GAP
  return { ...STEPS.at(-1)!, folder: room >= MIN_FOLDER ? Locale.truncateMiddle(forms.at(-1)!, room) : undefined }
}

function inked(node: Renderable): boolean {
  return node.getChildren().some((child) => child instanceof TextRenderable || inked(child))
}

export function InfoRow(props: {
  folder?: Folder
  folderActions: { hovered: () => boolean; onMouseOver: () => void; onMouseOut: () => void; onMouseUp: () => void }
  /** Who answers: the agent and the model. */
  lead: JSX.Element
  /** What needs attention: the footer slots. Shown whole or not at all. */
  status: JSX.Element
  hint: { key: string; label: string }
  version: string
}) {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const interactive = useInteractivity()
  // Each is measured on a box whose width never depends on the fit, so measuring cannot loop.
  const [row, setRow] = createSignal(0)
  const [lead, setLead] = createSignal(0)
  const [status, setStatus] = createSignal(0)
  const measure = (set: (width: number) => void) =>
    function (this: BoxRenderable) {
      // A box with no text in it still lays out one column wide.
      const width = inked(this) ? this.width : 0
      queueMicrotask(() => set(width))
    }
  const version = () => (dimensions().width >= VERSION_COLUMNS ? props.version : "")
  const fit = createMemo(() =>
    fitInfoRow({
      row: row(),
      folder: props.folder,
      lead: lead(),
      status: status(),
      key: stringWidth(props.hint.key),
      label: stringWidth(props.hint.label),
      version: stringWidth(version()),
    }),
  )

  const shown = () => fit().status && status() > 0

  return (
    <box flexDirection="row" height={1} flexShrink={0} paddingLeft={TEXT_INSET} paddingRight={BAR_PAD}>
      <box flexDirection="row" flexGrow={1} minWidth={0} onSizeChange={measure(setRow)}>
        <box flexShrink={0} onSizeChange={measure(setLead)}>
          {props.lead}
        </box>
        <text
          flexShrink={0}
          marginLeft={lead() > 0 ? GAP : 0}
          wrapMode="none"
          fg={interactive() ? theme.text.base : theme.text.action.primary.disabled}
        >
          <b>{props.hint.key}</b>
          <Show when={fit().label}>
            <span style={{ fg: theme.text.muted }}> {props.hint.label}</span>
          </Show>
        </text>
        <Show when={fit().version && version()}>
          <text flexShrink={0} marginLeft={GAP} fg={theme.text.muted} wrapMode="none">
            {version()}
          </text>
        </Show>
        <box flexGrow={1} minWidth={0} />
        {/* Dropped, it lies off-screen out of the flow rather than unmounting, so its natural width stays known. */}
        <box
          flexDirection="row"
          flexShrink={0}
          gap={GAP}
          position={shown() ? "relative" : "absolute"}
          left={shown() ? 0 : OFFSCREEN}
          onSizeChange={measure(setStatus)}
        >
          {props.status}
        </box>
        <Show when={fit().folder}>
          {(folder) => (
            <text
              id="prompt.footer.location"
              marginLeft={shown() ? GAP : 0}
              fg={props.folderActions.hovered() ? theme.text.base : theme.text.muted}
              wrapMode="none"
              flexShrink={0}
              onMouseOver={props.folderActions.onMouseOver}
              onMouseOut={props.folderActions.onMouseOut}
              onMouseUp={props.folderActions.onMouseUp}
            >
              {folder()}
            </text>
          )}
        </Show>
      </box>
    </box>
  )
}

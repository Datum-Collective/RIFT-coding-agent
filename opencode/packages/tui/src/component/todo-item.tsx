import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"

export interface TodoItemProps {
  status: string
  content: string
}

/** One plan step: ✓ done, ▸ in progress, · pending, ⊘ cancelled. */
export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()
  const glyph = () =>
    props.status === "completed" ? "✓" : props.status === "in_progress" ? "▸" : props.status === "cancelled" ? "⊘" : "·"
  const glyphColor = () =>
    props.status === "completed" ? theme.success : props.status === "in_progress" ? theme.primary : theme.border
  const textColor = () => (props.status === "in_progress" ? theme.text : theme.textMuted)

  return (
    <box flexDirection="row">
      <text flexShrink={0} width={2} fg={glyphColor()}>
        {glyph()}
      </text>
      <text
        flexGrow={1}
        wrapMode="word"
        fg={textColor()}
        attributes={props.status === "cancelled" ? TextAttributes.STRIKETHROUGH : undefined}
      >
        {props.content}
      </text>
    </box>
  )
}

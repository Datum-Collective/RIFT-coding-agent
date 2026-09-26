import { useVideo } from "../../lib/context";

/** A labelled token: tokenizer output, tags, IDs. The sub label sits under it in mono. */
export function Chip(props: { label: string; sub?: string; active?: boolean }) {
  const { theme, type, space, vertical } = useVideo();
  const scale = vertical ? 1.1 : 1.4;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: space(1),
      }}
    >
      <div
        style={{
          padding: `${space(1.5)}px ${space(2.5)}px`,
          borderRadius: theme.radius.sm,
          border: `${theme.hairline}px solid ${props.active ? theme.palette.accent : theme.palette.border}`,
          backgroundColor: props.active
            ? theme.palette.accentSoft
            : theme.palette.surface,
          fontFamily: theme.fonts.mono,
          fontSize: type("mono") * scale,
          color: theme.palette.text,
          whiteSpace: "pre",
        }}
      >
        {props.label}
      </div>
      {props.sub ? (
        <div
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: type("label") * (vertical ? 0.85 : 1),
            color: theme.palette.textMuted,
          }}
        >
          {props.sub}
        </div>
      ) : null}
    </div>
  );
}

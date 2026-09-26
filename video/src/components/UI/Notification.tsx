import { useVideo } from "../../lib/context";
import type { Status } from "../../spec/schema";
import { StatusGlyph } from "./Status";

/** A system notification or toast: a status, a title, one line of detail. */
export function Notification(props: {
  title: string;
  detail?: string;
  status?: Status;
}) {
  const { theme, type, space } = useVideo();
  return (
    <div
      style={{
        display: "flex",
        gap: space(2.5),
        alignItems: "flex-start",
        padding: `${space(2.5)}px ${space(3)}px`,
        borderRadius: theme.radius.md,
        backgroundColor: theme.palette.surfaceRaised,
        border: `${theme.hairline}px solid ${theme.palette.border}`,
        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.25)",
      }}
    >
      <StatusGlyph status={props.status ?? "active"} size={type("body")} />
      <div
        style={{ display: "flex", flexDirection: "column", gap: space(0.5) }}
      >
        <div
          style={{
            fontFamily: theme.fonts.sans,
            fontWeight: 600,
            fontSize: type("body"),
            color: theme.palette.text,
          }}
        >
          {props.title}
        </div>
        {props.detail ? (
          <div
            style={{
              fontFamily: theme.fonts.sans,
              fontSize: type("body") * 0.96,
              color: theme.palette.textMuted,
            }}
          >
            {props.detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

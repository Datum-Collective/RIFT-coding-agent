import { useVideo } from "../../lib/context";
import type { Status } from "../../spec/schema";

const GLYPH: Record<Status, string> = {
  done: "✓",
  active: "●",
  pending: "○",
  failed: "✗",
  warn: "!",
};

/** The status column used across lists and flows, so state reads the same everywhere. */
export function StatusGlyph(props: { status: Status; size?: number }) {
  const { theme, type } = useVideo();
  const color: Record<Status, string> = {
    done: theme.palette.success,
    active: theme.palette.accent,
    pending: theme.palette.textMuted,
    failed: theme.palette.danger,
    warn: theme.palette.warning,
  };
  return (
    <span
      style={{
        fontFamily: theme.fonts.mono,
        fontSize: props.size ?? type("body"),
        color: color[props.status],
        fontWeight: 700,
      }}
    >
      {GLYPH[props.status]}
    </span>
  );
}

import type { CSSProperties, ReactNode } from "react";
import { useVideo } from "../../lib/context";

/** Neutral window chrome shared by the terminal, browser and editor so they read as one family. */
export function Window(props: {
  title?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
}) {
  const { theme, space, type } = useVideo();
  const dot = space(1.5);
  return (
    <div
      style={{
        backgroundColor: theme.palette.surface,
        border: `${theme.hairline}px solid ${theme.palette.border}`,
        borderRadius: theme.radius.lg,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        ...props.style,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: space(1.5),
          padding: `${space(2.25)}px ${space(3)}px`,
          borderBottom: `${theme.hairline}px solid ${theme.palette.border}`,
          backgroundColor: theme.palette.surfaceRaised,
        }}
      >
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            style={{
              width: dot,
              height: dot,
              borderRadius: dot,
              backgroundColor: theme.palette.border,
            }}
          />
        ))}
        <div
          style={{
            flex: 1,
            textAlign: "center",
            marginRight: dot * 3 + space(3),
            fontFamily: theme.fonts.mono,
            fontSize: type("label") * 0.9,
            color: theme.palette.textMuted,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {props.title}
        </div>
      </div>
      <div style={{ padding: space(4), ...props.bodyStyle }}>
        {props.children}
      </div>
    </div>
  );
}

/**
 * A manga panel: ink frame, paper (or black) stage, optional narration box.
 * Panels are separated by paper gutters; one focal point per panel.
 */
import type { CSSProperties, ReactNode } from "react";

const INK = "#161616";

export function Panel(props: {
  children: ReactNode;
  invert?: boolean;
  label?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        backgroundColor: props.invert ? "#000000" : "#FFFFFF",
        border: `5px solid ${props.invert ? "#000000" : INK}`,
        ...props.style,
      }}
    >
      {props.children}
      {props.label ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            backgroundColor: INK,
            color: "#FFFFFF",
            fontFamily: "Inter, sans-serif",
            fontWeight: 700,
            fontSize: 26,
            padding: "8px 18px",
          }}
        >
          {props.label}
        </div>
      ) : null}
    </div>
  );
}

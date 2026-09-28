import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill } from "remotion";
import { useSafeArea, useVideo } from "../../lib/context";

/**
 * The canvas every scene draws on: theme background, content held inside the platform safe
 * area, and one alignment decision per scene instead of ad-hoc absolute positioning.
 */
export function SceneFrame(props: {
  children: ReactNode;
  align?: "center" | "start";
  justify?: "center" | "start" | "end" | "space-between";
  gap?: number;
  style?: CSSProperties;
}) {
  const { theme } = useVideo();
  const inset = useSafeArea();
  return (
    <AbsoluteFill style={{ backgroundColor: theme.palette.background }}>
      <AbsoluteFill
        style={{
          padding: `${inset.top}px ${inset.right}px ${inset.bottom}px ${inset.left}px`,
          display: "flex",
          flexDirection: "column",
          alignItems: props.align === "center" ? "center" : "stretch",
          justifyContent: props.justify ?? "center",
          textAlign: props.align === "center" ? "center" : "left",
          gap: props.gap,
          ...props.style,
        }}
      >
        {props.children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

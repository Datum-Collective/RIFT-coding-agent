import type { CSSProperties, ReactNode } from "react";

export function Stack(props: {
  children: ReactNode;
  direction?: "row" | "column";
  gap?: number;
  align?: CSSProperties["alignItems"];
  justify?: CSSProperties["justifyContent"];
  wrap?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: props.direction ?? "column",
        gap: props.gap,
        alignItems: props.align,
        justifyContent: props.justify,
        flexWrap: props.wrap ? "wrap" : undefined,
        ...props.style,
      }}
    >
      {props.children}
    </div>
  );
}

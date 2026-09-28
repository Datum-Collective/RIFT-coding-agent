import type { CSSProperties, ReactNode } from "react";
import { useVideo } from "../../lib/context";

export function Card(props: {
  children: ReactNode;
  active?: boolean;
  style?: CSSProperties;
}) {
  const { theme, space } = useVideo();
  return (
    <div
      style={{
        backgroundColor: theme.palette.surface,
        border: `${theme.hairline}px solid ${props.active ? theme.palette.accent : theme.palette.border}`,
        borderRadius: theme.radius.md,
        padding: space(4),
        ...props.style,
      }}
    >
      {props.children}
    </div>
  );
}

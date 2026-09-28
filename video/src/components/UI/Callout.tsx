import type { ReactNode } from "react";
import { useVideo } from "../../lib/context";

/** A short annotation with an accent rule, for pointing at part of a demo. */
export function Callout(props: { children: ReactNode }) {
  const { theme, type, space } = useVideo();
  return (
    <div
      style={{
        borderLeft: `${space(0.75)}px solid ${theme.palette.accent}`,
        paddingLeft: space(2.5),
        fontFamily: theme.fonts.sans,
        fontSize: type("body"),
        color: theme.palette.text,
      }}
    >
      {props.children}
    </div>
  );
}

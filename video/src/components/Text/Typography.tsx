/**
 * The type system. Every piece of copy uses one of these roles, so hierarchy is consistent and
 * sizes stay readable at the final output size.
 */
import type { CSSProperties, ReactNode } from "react";
import { useVideo } from "../../lib/context";
import { LINE_HEIGHT, type TypeRole } from "../../styles/scale";
import { Emphasis } from "./Emphasis";

type TextProps = {
  children?: ReactNode;
  text?: string;
  style?: CSSProperties;
  muted?: boolean;
};

function makeText(
  role: TypeRole,
  weight: number,
  tracking: string,
  mono = false,
) {
  return function Text(props: TextProps) {
    const { theme, type } = useVideo();
    const color = props.muted ? theme.palette.textMuted : theme.palette.text;
    return (
      <div
        style={{
          fontFamily: mono ? theme.fonts.mono : theme.fonts.sans,
          fontSize: type(role),
          fontWeight: weight,
          lineHeight: LINE_HEIGHT[role],
          letterSpacing: tracking,
          color,
          textWrap: "balance",
          ...props.style,
        }}
      >
        {props.text !== undefined ? (
          <Emphasis text={props.text} color={color} />
        ) : (
          props.children
        )}
      </div>
    );
  };
}

export const Display = makeText("display", 800, "-0.035em");
export const Headline = makeText("headline", 700, "-0.03em");
export const Subheadline = makeText("title", 500, "-0.015em");
export const Body = makeText("body", 400, "-0.005em");
export const Label = makeText("label", 600, "0.08em", true);
export const Code = makeText("mono", 400, "0", true);

/** Small uppercase mono marker above a headline. */
export function Eyebrow(props: { text: string }) {
  const { theme } = useVideo();
  return (
    <Label style={{ color: theme.palette.accent, textTransform: "uppercase" }}>
      {props.text}
    </Label>
  );
}

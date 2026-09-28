import { useVideo } from "../../lib/context";

/** The one action a video ends on: a quiet outlined pill, not a flashing button. */
export function Cta(props: { text: string }) {
  const { theme, type, space } = useVideo();
  return (
    <div
      style={{
        display: "inline-flex",
        padding: `${space(2.5)}px ${space(5)}px`,
        borderRadius: 999,
        border: `${theme.hairline}px solid ${theme.palette.accent}`,
        color: theme.palette.accent,
        fontFamily: theme.fonts.mono,
        fontSize: type("label") * 1.25,
        fontWeight: 500,
        letterSpacing: "0.02em",
      }}
    >
      {props.text}
    </div>
  );
}

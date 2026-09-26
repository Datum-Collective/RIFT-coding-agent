import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { useVideo } from "../../lib/context";

/**
 * Types text out at a steady rate with a block caret. Frame-driven, so it is identical on every
 * render; the caret blinks on a fixed half-second cycle once typing is done.
 */
export function TypeReveal(props: {
  text: string;
  delay?: number;
  charsPerSecond?: number;
  caret?: boolean;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { theme } = useVideo();
  const start = (props.delay ?? 0) * fps;
  const rate = props.charsPerSecond ?? 32;
  const shown = Math.floor(
    interpolate(
      frame,
      [start, start + (props.text.length / rate) * fps],
      [0, props.text.length],
      {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      },
    ),
  );
  const typing = shown < props.text.length && frame >= start;
  const caretOn =
    props.caret !== false &&
    frame >= start &&
    (typing || Math.floor(frame / (fps / 2)) % 2 === 0);
  return (
    <span>
      {props.text.slice(0, shown)}
      {caretOn ? (
        <span
          style={{
            backgroundColor: theme.palette.accent,
            color: theme.palette.background,
          }}
        >
          &nbsp;
        </span>
      ) : null}
    </span>
  );
}

/** Seconds TypeReveal needs for a string, for sequencing what comes after it. */
export function typeDuration(text: string, charsPerSecond = 32) {
  return text.length / charsPerSecond;
}

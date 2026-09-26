import { useCurrentFrame, useVideoConfig } from "remotion";
import { progress } from "../../lib/animation/reveal";
import { useVideo } from "../../lib/context";
import { terminalFontSize } from "../../styles/scale";
import type { SceneOf } from "../../spec/schema";
import { TypeReveal, typeDuration } from "../Effects/TypeReveal";
import { Window } from "./Window";

type Line = SceneOf<"terminal">["lines"][number];

const PREFIX: Record<Line["kind"], string> = {
  input: "$ ",
  output: "  ",
  success: "✓ ",
  error: "✗ ",
  muted: "  ",
};

/** Line timing for a terminal: inputs type out, output lines appear one after another. */
export function terminalSchedule(
  lines: readonly Line[],
  start = 0.3,
  gap = 0.28,
) {
  return lines.reduce<number[]>((times, line, index) => {
    const previous = lines[index - 1];
    const at =
      index === 0
        ? start
        : (times[index - 1] ?? start) +
          (previous?.kind === "input"
            ? typeDuration(previous.text) + 0.25
            : gap);
    return [...times, at];
  }, []);
}

/** A terminal that plays its session in order: commands type, results follow. */
export function Terminal(props: {
  title?: string;
  lines: readonly Line[];
  start?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { theme, frame: size } = useVideo();
  const times = terminalSchedule(props.lines, props.start);
  const color: Record<Line["kind"], string> = {
    input: theme.palette.text,
    output: theme.palette.textMuted,
    success: theme.palette.success,
    error: theme.palette.danger,
    muted: theme.palette.border,
  };
  return (
    <Window title={props.title ?? "terminal"}>
      <div
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: terminalFontSize(size),
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
        }}
      >
        {props.lines.map((line, index) => {
          const at = times[index] ?? 0;
          const visible = frame >= at * fps;
          const last = index === props.lines.length - 1;
          return (
            <div
              key={index}
              style={{
                color: color[line.kind],
                opacity: visible ? progress(frame, fps, at, 0.25) : 0,
              }}
            >
              <span
                style={{
                  color:
                    line.kind === "input"
                      ? theme.palette.accent
                      : color[line.kind],
                }}
              >
                {PREFIX[line.kind]}
              </span>
              {line.kind === "input" ? (
                <TypeReveal text={line.text} delay={at} caret={last} />
              ) : (
                line.text
              )}
            </div>
          );
        })}
      </div>
    </Window>
  );
}

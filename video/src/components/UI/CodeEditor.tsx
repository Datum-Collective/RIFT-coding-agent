import { useCurrentFrame, useVideoConfig } from "remotion";
import { progress } from "../../lib/animation/reveal";
import { useVideo } from "../../lib/context";
import { codeFontSize } from "../../styles/scale";
import { Window } from "./Window";

/**
 * Code with line numbers. Highlighted lines get an accent rule and background once the rest has
 * settled, pointing the eye at what matters instead of asking the viewer to read everything.
 */
export function CodeEditor(props: {
  code: string;
  filename?: string;
  highlight?: readonly number[];
  delay?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { theme, space, frame: size } = useVideo();
  const lines = props.code.split("\n");
  const fontSize = codeFontSize(size, lines.length);
  const emphasis = progress(frame, fps, (props.delay ?? 0) + 0.8, 0.5);
  return (
    <Window
      title={props.filename ?? "editor"}
      bodyStyle={{ padding: `${space(3)}px 0` }}
    >
      <div style={{ fontFamily: theme.fonts.mono, fontSize, lineHeight: 1.55 }}>
        {lines.map((line, index) => {
          const marked = props.highlight?.includes(index + 1) ?? false;
          return (
            <div
              key={index}
              style={{
                display: "flex",
                gap: space(3),
                padding: `0 ${space(4)}px 0 ${space(3)}px`,
                borderLeft: `${space(0.5)}px solid ${marked ? theme.palette.accent : "transparent"}`,
                backgroundColor: marked ? theme.palette.accentSoft : undefined,
                opacity: marked
                  ? 1
                  : 1 - emphasis * (props.highlight?.length ? 0.45 : 0),
              }}
            >
              <span
                style={{
                  color: theme.palette.border,
                  minWidth: fontSize * 1.4,
                  textAlign: "right",
                }}
              >
                {index + 1}
              </span>
              <span style={{ color: theme.palette.text, whiteSpace: "pre" }}>
                {line || " "}
              </span>
            </div>
          );
        })}
      </div>
    </Window>
  );
}

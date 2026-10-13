import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, HEAD_FONT } from "../theme";

export type HeadlineLine = {
  text: string;
  color?: string;
};

type HeadlineProps = {
  lines: HeadlineLine[];
  /** Frame within the scene at which the first line lands. */
  at?: number;
  size?: number;
  /** Frames between successive lines. */
  stagger?: number;
  font?: string;
  gap?: number;
  align?: "left" | "center";
  style?: React.CSSProperties;
};

/**
 * Big ALL-CAPS lines that punch in one at a time on a spring, the way
 * Kurtzgesagt lands its statements. Each line is inline-animated so its
 * keyframes stay editable in Studio.
 */
export const Headline: React.FC<HeadlineProps> = ({
  lines,
  at = 6,
  size = 104,
  stagger = 7,
  font = HEAD_FONT,
  gap = 14,
  align = "left",
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        gap,
        ...style,
      }}
    >
      {lines.map((line, i) => {
        const enter = spring({
          frame: frame - at - i * stagger,
          fps,
          config: { damping: 11, stiffness: 190, mass: 0.7 },
          durationInFrames: 20,
        });
        return (
          <div
            key={i}
            style={{
              fontFamily: font,
              fontWeight: 900,
              fontSize: size,
              lineHeight: 0.98,
              letterSpacing: -size * 0.028,
              textAlign: align,
              color: line.color ?? COLORS.cream,
              whiteSpace: "pre",
              opacity: interpolate(enter, [0, 0.25], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              scale: interpolate(enter, [0, 1], [0.68, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                output: "perceptual-scale",
              }),
              translate: `0 ${interpolate(enter, [0, 1], [52, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }).toFixed(2)}px`,
              rotate: `${interpolate(enter, [0, 1], [-2.4, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }).toFixed(2)}deg`,
            }}
          >
            {line.text}
          </div>
        );
      })}
    </div>
  );
};

/** Small all-caps label that sits above a headline. */
export const Kicker: React.FC<{
  text: string;
  at?: number;
  color?: string;
  style?: React.CSSProperties;
}> = ({ text, at = 0, color = COLORS.teal, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    frame: frame - at,
    fps,
    config: { damping: 200 },
    durationInFrames: 16,
  });

  return (
    <div
      style={{
        fontFamily: HEAD_FONT,
        fontWeight: 800,
        fontSize: 34,
        letterSpacing: 5,
        color,
        opacity: interpolate(enter, [0, 1], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
        translate: `${interpolate(enter, [0, 1], [-24, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }).toFixed(2)}px 0`,
        ...style,
      }}
    >
      {text}
    </div>
  );
};
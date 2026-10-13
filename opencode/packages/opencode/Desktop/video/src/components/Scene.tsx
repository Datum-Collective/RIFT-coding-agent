import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "./Backdrop";
import { COLORS, HEAD_FONT, SAFE } from "../theme";

/**
 * Two-column stage: typography on the left, character on the right. The right
 * column stops above the caption bar so nothing ever sits under a caption.
 */
export const Scene: React.FC<{
  left: React.ReactNode;
  right?: React.ReactNode;
  tint?: string;
  rightScale?: number;
  rightBottom?: number;
}> = ({ left, right, tint, rightScale = 1, rightBottom = 232 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({
    frame,
    fps,
    config: { damping: 13, stiffness: 150, mass: 0.9 },
    durationInFrames: 26,
  });

  return (
    <AbsoluteFill>
      <Backdrop tint={tint} />
      <div
        style={{
          position: "absolute",
          left: SAFE.side,
          top: 0,
          height: 1080,
          width: 1020,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 34,
        }}
      >
        {left}
      </div>
      {right && (
        <div
          style={{
            position: "absolute",
            right: 78,
            bottom: rightBottom,
            width: 720,
            height: 720,
            opacity: interpolate(pop, [0, 0.4], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            scale: interpolate(pop, [0, 1], [0.62, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              output: "perceptual-scale",
            }),
            rotate: `${interpolate(pop, [0, 1], [7, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }).toFixed(2)}deg`,
          }}
        >
          {right}
        </div>
      )}
    </AbsoluteFill>
  );
};

/** Rounded pill used for tags, code chips and the closing CTA. */
export const Chip: React.FC<{
  text: string;
  at?: number;
  color?: string;
  background?: string;
  border?: string;
  fontSize?: number;
  fontFamily?: string;
  style?: React.CSSProperties;
}> = ({
  text,
  at = 0,
  color = COLORS.cream,
  background = "rgba(12,12,20,0.8)",
  border = COLORS.slate,
  fontSize = 36,
  fontFamily = HEAD_FONT,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    frame: frame - at,
    fps,
    config: { damping: 14, stiffness: 200, mass: 0.7 },
    durationInFrames: 18,
  });

  return (
    <div
      style={{
        display: "inline-block",
        fontFamily,
        fontWeight: 800,
        fontSize,
        letterSpacing: 1.2,
        color,
        backgroundColor: background,
        border: `3px solid ${border}`,
        borderRadius: 999,
        padding: "16px 38px",
        whiteSpace: "pre",
        opacity: interpolate(enter, [0, 0.3], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
        scale: interpolate(enter, [0, 1], [0.7, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          output: "perceptual-scale",
        }),
        ...style,
      }}
    >
      {text}
    </div>
  );
};
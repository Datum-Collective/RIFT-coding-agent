import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { useVideo } from "../../lib/context";
import { motion } from "../../styles/theme";

export function ProgressBar(props: {
  to: number;
  delay?: number;
  duration?: number;
  color?: string;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { theme, space } = useVideo();
  const start = (props.delay ?? 0) * fps;
  const width = interpolate(
    frame,
    [start, start + (props.duration ?? 1) * fps],
    [0, props.to],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: motion.move,
    },
  );
  return (
    <div
      style={{
        height: space(1),
        borderRadius: space(1),
        backgroundColor: theme.palette.border,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${width * 100}%`,
          backgroundColor: props.color ?? theme.palette.accent,
        }}
      />
    </div>
  );
}

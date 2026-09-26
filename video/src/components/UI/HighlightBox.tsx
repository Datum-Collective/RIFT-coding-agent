import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { useVideo } from "../../lib/context";
import { motion } from "../../styles/theme";

/**
 * An accent outline drawn around a region of a demo, in pixels of its parent. It grows from its
 * centre so the eye is led to the spot rather than startled by it.
 */
export function HighlightBox(props: {
  x: number;
  y: number;
  width: number;
  height: number;
  delay?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { theme, space } = useVideo();
  const start = (props.delay ?? 0) * fps;
  const amount = interpolate(frame, [start, start + 0.45 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: motion.enter,
  });
  return (
    <div
      style={{
        position: "absolute",
        left: props.x,
        top: props.y,
        width: props.width,
        height: props.height,
        borderRadius: theme.radius.sm,
        border: `${space(0.5)}px solid ${theme.palette.accent}`,
        backgroundColor: theme.palette.accentSoft,
        opacity: amount,
        scale: String(interpolate(amount, [0, 1], [1.08, 1])),
      }}
    />
  );
}

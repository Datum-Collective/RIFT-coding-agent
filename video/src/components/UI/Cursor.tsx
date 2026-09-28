import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { useVideo } from "../../lib/context";
import { motion } from "../../styles/theme";

/**
 * A pointer that travels between points, then clicks. Points are in pixels of the parent,
 * so a demo can aim it at a real element.
 */
export function Cursor(props: {
  points: readonly { x: number; y: number; at: number }[];
  clickAt?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { theme, space } = useVideo();
  const times = props.points.map((point) => point.at * fps);
  const x = interpolate(
    frame,
    times,
    props.points.map((point) => point.x),
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: motion.move,
    },
  );
  const y = interpolate(
    frame,
    times,
    props.points.map((point) => point.y),
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: motion.move,
    },
  );
  const click =
    props.clickAt === undefined
      ? 1
      : interpolate(
          frame,
          [
            props.clickAt * fps,
            props.clickAt * fps + 4,
            props.clickAt * fps + 10,
          ],
          [1, 0.85, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
  const size = space(5);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ position: "absolute", left: x, top: y, scale: String(click) }}
    >
      <path
        d="M3 2l7 19 2.5-7.5L20 11z"
        fill={theme.palette.text}
        stroke={theme.palette.background}
        strokeWidth={1.5}
      />
    </svg>
  );
}

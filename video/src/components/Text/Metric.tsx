import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { useVideo } from "../../lib/context";
import { motion } from "../../styles/theme";
import { Label } from "./Typography";

/** A number that counts up to its value, then holds. The label never moves. */
export function Metric(props: {
  value: number;
  label: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  delay?: number;
  duration?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { theme, type } = useVideo();
  const start = (props.delay ?? 0) * fps;
  const shown = interpolate(
    frame,
    [start, start + (props.duration ?? 1.2) * fps],
    [0, props.value],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: motion.enter,
    },
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          fontFamily: theme.fonts.sans,
          fontSize: type("display"),
          fontWeight: 700,
          letterSpacing: "-0.04em",
          lineHeight: 1,
          color: theme.palette.text,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {props.prefix}
        {shown.toFixed(props.decimals ?? 0)}
        <span style={{ color: theme.palette.accent }}>{props.suffix}</span>
      </div>
      <Label muted text={props.label} />
    </div>
  );
}

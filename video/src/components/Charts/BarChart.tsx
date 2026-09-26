import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { stagger } from "../../lib/animation/stagger";
import { useVideo } from "../../lib/context";
import { motion } from "../../styles/theme";

/**
 * Horizontal bars scaled to the largest value, so lengths are honest comparisons. Values are
 * printed, not implied, and bars grow in reading order.
 */
export function BarChart(props: {
  data: readonly { label: string; value: number }[];
  unit?: string;
  highlight?: string;
  delay?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { theme, type, space, spec } = useVideo();
  const max = Math.max(...props.data.map((item) => item.value), 1);
  const rowGap = props.data.length > 7 ? space(2) : space(3.5);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: rowGap,
        width: "100%",
      }}
    >
      {props.data.map((item, index) => {
        const start =
          stagger(spec.style.pacing, index, props.delay ?? 0.3) * fps;
        const grown = interpolate(
          frame,
          [start, start + 0.9 * fps],
          [0, item.value / max],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: motion.enter,
          },
        );
        const accent = item.label === props.highlight;
        return (
          <div
            key={item.label}
            style={{ display: "flex", flexDirection: "column", gap: space(1) }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontFamily: theme.fonts.sans,
                fontSize: type("label") * 1.2,
              }}
            >
              <span
                style={{
                  color: accent ? theme.palette.text : theme.palette.textMuted,
                  fontWeight: accent ? 600 : 400,
                }}
              >
                {item.label}
              </span>
              <span
                style={{
                  color: accent
                    ? theme.palette.accent
                    : theme.palette.textMuted,
                  fontVariantNumeric: "tabular-nums",
                  fontFamily: theme.fonts.mono,
                }}
              >
                {(item.value * (grown / (item.value / max || 1))).toFixed(
                  item.value % 1 === 0 ? 0 : 1,
                )}
                {props.unit}
              </span>
            </div>
            <div
              style={{
                height: space(2.5),
                borderRadius: space(0.75),
                backgroundColor: theme.palette.surfaceRaised,
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${grown * 100}%`,
                  borderRadius: space(0.75),
                  backgroundColor: accent
                    ? theme.palette.accent
                    : theme.palette.textMuted,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

import { useCurrentFrame, useVideoConfig } from "remotion";
import { progress } from "../../lib/animation/reveal";
import { useVideo } from "../../lib/context";

/**
 * A vector as a strip of cells: positive values in the accent colour, negative in the danger
 * colour, magnitude as strength. Enough to show that tokens become numbers, without faking
 * precision.
 */
export function VectorStrip(props: {
  label: string;
  values: readonly number[];
  cell: number;
  delay?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { theme, type, space } = useVideo();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: space(3) }}>
      <div
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: type("body"),
          color: theme.palette.text,
          minWidth: props.cell * 4,
          textAlign: "right",
        }}
      >
        {props.label}
      </div>
      <div style={{ display: "flex", gap: Math.max(2, props.cell * 0.1) }}>
        {props.values.map((value, index) => {
          const shown = progress(
            frame,
            fps,
            (props.delay ?? 0) + index * 0.03,
            0.35,
          );
          return (
            <div
              key={index}
              style={{
                width: props.cell,
                height: props.cell,
                borderRadius: props.cell * 0.18,
                backgroundColor: theme.palette.surfaceRaised,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  backgroundColor:
                    value >= 0 ? theme.palette.accent : theme.palette.danger,
                  opacity: Math.abs(value) * shown,
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

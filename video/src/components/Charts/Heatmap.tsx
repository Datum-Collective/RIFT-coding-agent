import { useCurrentFrame, useVideoConfig } from "remotion";
import { progress } from "../../lib/animation/reveal";
import { useVideo } from "../../lib/context";
import type { Matrix } from "../../spec/schema";

/**
 * A labelled matrix where value is opacity of the accent colour: attention weights, similarity,
 * correlation. Rows fill in top to bottom so the eye follows one query at a time.
 */
export function Heatmap(props: {
  matrix: Matrix;
  cell: number;
  delay?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { theme, type, space } = useVideo();
  const label = type("label") * (props.cell < 70 ? 0.8 : 1);
  // Column labels need room; below that the rows carry the same tokens and the title explains.
  const showCols = props.cell >= 60;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: space(1.5),
        alignItems: "center",
      }}
    >
      {props.matrix.title ? (
        <div
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: label,
            color: theme.palette.textMuted,
          }}
        >
          {props.matrix.title}
        </div>
      ) : null}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `auto repeat(${props.matrix.cols.length}, ${props.cell}px)`,
          gap: Math.max(2, props.cell * 0.06),
          alignItems: "center",
        }}
      >
        {showCols ? <div /> : null}
        {(showCols ? props.matrix.cols : []).map((col, index) => (
          <div
            key={index}
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: label,
              color: theme.palette.textMuted,
              textAlign: "center",
              overflow: "hidden",
            }}
          >
            {col}
          </div>
        ))}
        {props.matrix.rows.map((row, r) => {
          const shown = progress(
            frame,
            fps,
            (props.delay ?? 0) + r * 0.12,
            0.4,
          );
          return [
            <div
              key={`r${r}`}
              style={{
                fontFamily: theme.fonts.mono,
                fontSize: label,
                color: theme.palette.textMuted,
                textAlign: "right",
                paddingRight: space(1),
              }}
            >
              {row}
            </div>,
            ...props.matrix.cols.map((_, c) => {
              const value = props.matrix.values[r]?.[c] ?? 0;
              return (
                <div
                  key={`${r}-${c}`}
                  style={{
                    width: props.cell,
                    height: props.cell,
                    borderRadius: Math.max(3, props.cell * 0.12),
                    backgroundColor: theme.palette.surfaceRaised,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      backgroundColor: theme.palette.accent,
                      opacity: value * shown,
                    }}
                  />
                </div>
              );
            }),
          ];
        })}
      </div>
    </div>
  );
}

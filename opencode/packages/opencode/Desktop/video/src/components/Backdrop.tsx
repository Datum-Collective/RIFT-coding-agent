import { AbsoluteFill, useCurrentFrame } from "remotion";
import { COLORS } from "../theme";

type Shape = {
  kind: "circle" | "ring" | "triangle" | "plus";
  x: number;
  y: number;
  size: number;
  color: string;
  opacity: number;
  /** Pixels per frame of drift. */
  drift: number;
};

/**
 * Kept to x < 1150 so drifting shapes never muddy the character, which owns
 * the right third of the frame.
 */
const SHAPES: Shape[] = [
  { kind: "ring", x: 250, y: 240, size: 210, color: COLORS.teal, opacity: 0.16, drift: 0.22 },
  { kind: "circle", x: 880, y: 1180, size: 300, color: COLORS.violet, opacity: 0.1, drift: -0.08 },
  { kind: "triangle", x: 1010, y: 150, size: 150, color: COLORS.amber, opacity: 0.14, drift: 0.19 },
  { kind: "circle", x: 140, y: 900, size: 110, color: COLORS.coral, opacity: 0.16, drift: -0.24 },
  { kind: "plus", x: 640, y: 880, size: 90, color: COLORS.teal, opacity: 0.14, drift: 0.14 },
  { kind: "ring", x: 380, y: 120, size: 120, color: COLORS.amber, opacity: 0.13, drift: -0.2 },
  { kind: "triangle", x: 120, y: 640, size: 110, color: COLORS.violet, opacity: 0.12, drift: 0.26 },
];

export const Backdrop: React.FC<{
  children?: React.ReactNode;
  tint?: string;
}> = ({ children, tint = COLORS.bg }) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ backgroundColor: tint }}>
      {SHAPES.map((shape, i) => {
        const y = ((shape.y + frame * shape.drift) % 1240) - 80;
        return (
          <svg
            key={i}
            width={shape.size * 2}
            height={shape.size * 2}
            viewBox={`0 0 ${shape.size * 2} ${shape.size * 2}`}
            style={{
              position: "absolute",
              left: shape.x - shape.size,
              top: y,
              opacity: shape.opacity,
            }}
          >
            {shape.kind === "circle" && (
              <circle
                cx={shape.size}
                cy={shape.size}
                r={shape.size}
                fill={shape.color}
              />
            )}
            {shape.kind === "ring" && (
              <circle
                cx={shape.size}
                cy={shape.size}
                r={shape.size - 10}
                fill="none"
                stroke={shape.color}
                strokeWidth={10}
              />
            )}
            {shape.kind === "triangle" && (
              <polygon
                points={`${shape.size},10 ${shape.size * 2 - 10},${
                  shape.size * 2 - 10
                } 10,${shape.size * 2 - 10}`}
                fill={shape.color}
              />
            )}
            {shape.kind === "plus" && (
              <path
                d={`M ${shape.size - 8},10 h 16 v ${shape.size - 18} h ${
                  shape.size - 8
                } v 16 h -${shape.size - 18} v ${shape.size - 8} h -16 v -${
                  shape.size - 18
                } h -${shape.size - 8} z`}
                fill={shape.color}
              />
            )}
          </svg>
        );
      })}

      {/* Vignette keeps the eye on the centre of the frame. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 50% 45%, transparent 35%, ${COLORS.bgDeep} 100%)`,
          opacity: 0.85,
        }}
      />

      {children}
    </AbsoluteFill>
  );
};
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { stagger } from "../../lib/animation/stagger";
import { progress } from "../../lib/animation/reveal";
import { useVideo } from "../../lib/context";
import { motion } from "../../styles/theme";

/**
 * A process as connected steps. Vertical frames stack it top to bottom; horizontal frames
 * wrap it into rows. The active step travels along the flow once everything is on screen, and
 * an optional loop draws the arc back (e.g. Attack → Repair returning to Verify).
 */
export function FlowSteps(props: {
  steps: readonly string[];
  loop?: { from: number; to: number; label?: string };
  delay?: number;
}) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { theme, type, space, spec, vertical } = useVideo();
  const start = props.delay ?? 0.2;
  const revealed = stagger(spec.style.pacing, props.steps.length, start);
  // After every step is in, a highlight walks the flow once, finishing before the scene ends.
  const walk = interpolate(
    frame,
    [
      (revealed + 0.3) * fps,
      Math.max((revealed + 0.4) * fps, durationInFrames - 0.6 * fps),
    ],
    [0, props.steps.length - 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: motion.move,
    },
  );
  const walking = frame >= (revealed + 0.3) * fps;
  // Long horizontal flows step down a size so they wrap into balanced rows, not an orphan.
  const size =
    type(vertical ? "title" : "body") *
    (props.steps.length > 8
      ? 0.85
      : !vertical && props.steps.length > 5
        ? 0.88
        : 1);
  const inLoop = (index: number) =>
    props.loop !== undefined &&
    index >= Math.min(props.loop.from, props.loop.to) &&
    index <= Math.max(props.loop.from, props.loop.to);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: vertical ? "column" : "row",
        flexWrap: vertical ? "nowrap" : "wrap",
        alignItems: vertical ? "flex-start" : "center",
        justifyContent: vertical ? "flex-start" : "center",
        rowGap: space(vertical ? 1.25 : 4),
        columnGap: space(1.5),
      }}
    >
      {props.steps.map((step, index) => {
        const amount = progress(
          frame,
          fps,
          stagger(spec.style.pacing, index, start),
          0.45,
        );
        const active = walking && Math.round(walk) === index;
        const passed = walking && walk > index + 0.5;
        const color = active
          ? theme.palette.accent
          : passed
            ? theme.palette.text
            : theme.palette.textMuted;
        return (
          <div
            key={index}
            style={{
              display: "flex",
              flexDirection: vertical ? "column" : "row",
              alignItems: vertical ? "flex-start" : "center",
              gap: space(2),
              opacity: amount,
            }}
          >
            <div
              style={{ display: "flex", alignItems: "center", gap: space(2.5) }}
            >
              {/* Vertical flows are read by their numbers; horizontal ones by their arrows. */}
              {vertical ? (
                <span
                  style={{
                    fontFamily: theme.fonts.mono,
                    fontSize: size * 0.55,
                    color: inLoop(index)
                      ? theme.palette.warning
                      : theme.palette.border,
                    minWidth: size * 0.9,
                  }}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
              ) : null}
              <span
                style={{
                  fontFamily: theme.fonts.sans,
                  fontWeight: active ? 700 : 500,
                  fontSize: size,
                  color,
                  letterSpacing: "-0.02em",
                }}
              >
                {step}
              </span>
            </div>
            {/* Vertical flows read top to bottom from the step numbers; arrows would cost a row each. */}
            {index < props.steps.length - 1 && !vertical ? (
              <span
                style={{
                  fontFamily: theme.fonts.mono,
                  fontSize: size * 0.7,
                  color: theme.palette.textMuted,
                }}
              >
                →
              </span>
            ) : null}
          </div>
        );
      })}
      {props.loop ? (
        <div
          style={{
            opacity: progress(frame, fps, revealed, 0.5),
            fontFamily: theme.fonts.mono,
            fontSize: type("label"),
            color: theme.palette.warning,
            marginTop: space(2),
            width: vertical ? undefined : "100%",
            textAlign: vertical ? "left" : "center",
          }}
        >
          ↺ {props.steps[props.loop.from]} → {props.steps[props.loop.to]}
          {props.loop.label ? ` · ${props.loop.label}` : ""}
        </div>
      ) : null}
    </div>
  );
}

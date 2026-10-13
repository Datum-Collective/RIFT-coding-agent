import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Kicker } from "../components/Headline";
import { Raccoon } from "../components/Raccoon";
import { Scene } from "../components/Scene";
import { CODE_FONT, COLORS } from "../theme";

const SOURCE = "> HELLO_WORLD()";

/** Terminal panel: the source line types itself in, then the error lands. */
const Terminal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const typed = Math.floor(
    interpolate(frame, [8, 8 + SOURCE.length * 1.6], [0, SOURCE.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );

  const errorAt = 54;
  const error = spring({
    frame: frame - errorAt,
    fps,
    config: { damping: 11, stiffness: 220, mass: 0.6 },
    durationInFrames: 16,
  });

  const cursorVisible = Math.floor(frame / 6) % 2 === 0;

  return (
    <div
      style={{
        backgroundColor: "rgba(12,12,20,0.86)",
        border: `3px solid ${COLORS.slate}`,
        borderRadius: 26,
        padding: "40px 44px",
        fontFamily: CODE_FONT,
        fontWeight: 700,
        display: "flex",
        flexDirection: "column",
        gap: 22,
      }}
    >
      <div style={{ fontSize: 68, color: COLORS.teal, whiteSpace: "pre" }}>
        {SOURCE.slice(0, typed)}
        <span
          style={{
            display: "inline-block",
            width: 34,
            height: 62,
            translate: "0 8px",
            backgroundColor: cursorVisible ? COLORS.teal : "transparent",
          }}
        />
      </div>

      {frame >= errorAt && (
        <>
          <div style={{ height: 3, backgroundColor: COLORS.slate, width: "100%" }} />
          <div
            style={{
              fontSize: 50,
              color: COLORS.coral,
              whiteSpace: "pre",
              opacity: interpolate(error, [0, 0.3], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              scale: interpolate(error, [0, 1], [0.82, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                output: "perceptual-scale",
              }),
            }}
          >
            SyntaxError
          </div>
          <div style={{ fontSize: 50, color: COLORS.cream, whiteSpace: "pre" }}>
            at line 1
          </div>
        </>
      )}
    </div>
  );
};

export const FirstLineScene: React.FC = () => (
  <Scene
    left={
      <>
        <Kicker text="DAY TWO · FIRST LINE" at={0} color={COLORS.violet} />
        <Terminal />
      </>
    }
    right={
      <Raccoon
        face="focus"
        paws="both"
        laptop
        headTilt={6}
        tailWag={4}
      />
    }
  />
);
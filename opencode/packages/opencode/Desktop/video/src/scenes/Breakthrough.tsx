import { interpolate, useCurrentFrame } from "remotion";
import { Headline, Kicker } from "../components/Headline";
import { Raccoon } from "../components/Raccoon";
import { Scene } from "../components/Scene";
import { CODE_FONT, COLORS } from "../theme";

const TRACE = [
  { text: "app.js:12", color: COLORS.cream },
  { text: "  ^ not a function", color: COLORS.coral },
  { text: "raccoon.js:4", color: COLORS.cream },
  { text: "  ~ 47 errors", color: COLORS.coral },
];

const TRACE_AT = 40;

/** The stack trace card; the highlighted error line gets "chewed". */
const StackTrace: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        backgroundColor: "rgba(12,12,20,0.86)",
        border: `3px solid ${COLORS.slate}`,
        borderRadius: 26,
        padding: "28px 36px",
        fontFamily: CODE_FONT,
        fontWeight: 700,
        fontSize: 40,
        display: "flex",
        flexDirection: "column",
        gap: 11,
      }}
    >
      {TRACE.map((line, i) => {
        const at = TRACE_AT + i * 9;
        const enter = interpolate(frame, [at, at + 6], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        // The last line collapses once the raccoon has "eaten" it.
        const eaten = i >= 2;
        const chew = eaten
          ? interpolate(
              frame,
              [TRACE_AT + 70, TRACE_AT + 96],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            )
          : 0;

        return (
          <div
            key={i}
            style={{
              color: line.color,
              whiteSpace: "pre",
              opacity: enter * (1 - chew * (eaten ? 1 : 0)),
              scale: `${(1 - chew * 0.06).toFixed(3)} ${(1 - chew * (eaten ? 0.8 : 0)).toFixed(3)}`,
              translate: `${(chew * 26).toFixed(2)}px 0`,
              transformOrigin: "left center",
            }}
          >
            {line.text}
          </div>
        );
      })}
      <div
        style={{
          fontFamily: "Poppins, sans-serif",
          fontWeight: 800,
          fontSize: 30,
          letterSpacing: 3,
          color: COLORS.slate,
          marginTop: 4,
        }}
      >
        &gt; PROCESS EXITED
      </div>
    </div>
  );
};

export const BreakthroughScene: React.FC = () => (
  <Scene
    left={
      <>
        <Kicker text="DAY NINE" at={0} color={COLORS.teal} />
        <Headline
          at={4}
          size={84}
          lines={[
            { text: "HE ATE THE", color: COLORS.cream },
            { text: "STACK TRACE", color: COLORS.coral },
          ]}
        />
        <StackTrace />
      </>
    }
    right={
      <Raccoon face="happy" laptop screen={COLORS.coral} headTilt={8} tailWag={14} />
    }
  />
);
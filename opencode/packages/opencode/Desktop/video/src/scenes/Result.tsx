import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Headline, Kicker } from "../components/Headline";
import { Raccoon } from "../components/Raccoon";
import { Scene } from "../components/Scene";
import { COLORS } from "../theme";

/** Radiating burst behind a passing test, drawn in a self-sized SVG. */
const PassBurst: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = 34;
  const enter = spring({
    frame: frame - at,
    fps,
    config: { damping: 12, stiffness: 170, mass: 0.8 },
    durationInFrames: 22,
  });

  return (
    <svg
      width={240}
      height={240}
      viewBox="0 0 300 300"
      style={{
        opacity: interpolate(enter, [0, 0.3], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
        scale: interpolate(enter, [0, 1], [0.3, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          output: "perceptual-scale",
        }),
      }}
    >
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i / 12) * Math.PI * 2;
        const inner = 96;
        const outer = 136 + Math.sin(frame / 6 + i) * 6;
        return (
          <line
            key={i}
            x1={150 + Math.cos(angle) * inner}
            y1={150 + Math.sin(angle) * inner}
            x2={150 + Math.cos(angle) * outer}
            y2={150 + Math.sin(angle) * outer}
            stroke={COLORS.teal}
            strokeWidth={14}
            strokeLinecap="round"
          />
        );
      })}
      <circle cx={150} cy={150} r={86} fill={COLORS.teal} />
      <path
        d="M 110 152 L 140 182 L 194 120"
        fill="none"
        stroke={COLORS.bgDeep}
        strokeWidth={20}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export const ResultScene: React.FC = () => (
  <Scene
    left={
      <>
        <Kicker text="DAY 60" at={0} color={COLORS.teal} />
        <Headline
          at={4}
          size={92}
          lines={[
            { text: "SHIPPED ON", color: COLORS.cream },
            { text: "A FRIDAY.", color: COLORS.teal },
          ]}
        />
        <div style={{ marginLeft: 120, marginTop: -4 }}>
          <PassBurst />
        </div>
      </>
    }
    right={
      <Raccoon
        face="happy"
        laptop
        screen={COLORS.teal}
        headTilt={-10}
        tailWag={16}
      />
    }
  />
);
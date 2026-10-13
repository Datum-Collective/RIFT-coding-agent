import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Headline, Kicker } from "../components/Headline";
import { Raccoon } from "../components/Raccoon";
import { Scene } from "../components/Scene";
import { COLORS, HEAD_FONT } from "../theme";

const STATS: { value: string; label: string; color: string }[] = [
  { value: "1", label: "RACCOON", color: COLORS.cream },
  { value: "0", label: "HOURS SLEEP", color: COLORS.coral },
  { value: "47", label: "BUGS OPENED", color: COLORS.violet },
];

const Stats: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div style={{ display: "flex", gap: 22 }}>
      {STATS.map((stat, i) => {
        const at = 30 + i * 9;
        const enter = spring({
          frame: frame - at,
          fps,
          config: { damping: 12, stiffness: 190, mass: 0.7 },
          durationInFrames: 20,
        });
        return (
          <div
            key={i}
            style={{
              flex: 1,
              backgroundColor: "rgba(12,12,20,0.82)",
              border: `3px solid ${stat.color}`,
              borderRadius: 24,
              padding: "26px 0 22px",
              textAlign: "center",
              opacity: interpolate(enter, [0, 0.3], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              scale: interpolate(enter, [0, 1], [0.7, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                output: "perceptual-scale",
              }),
            }}
          >
            <div
              style={{
                fontFamily: HEAD_FONT,
                fontWeight: 900,
                fontSize: 78,
                lineHeight: 1,
                color: stat.color,
              }}
            >
              {stat.value}
            </div>
            <div
              style={{
                fontFamily: HEAD_FONT,
                fontWeight: 800,
                fontSize: 27,
                letterSpacing: 3,
                color: COLORS.cream,
                marginTop: 10,
              }}
            >
              {stat.label}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const GrindScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Scene
      left={
        <>
          <Kicker text="THE GRIND" at={0} color={COLORS.amber} />
          <Headline
            at={4}
            size={84}
            lines={[
              { text: "0 SLEEP.", color: COLORS.coral },
              { text: "47 BUGS.", color: COLORS.violet },
            ]}
          />
          <Stats />
        </>
      }
      right={
        <Raccoon
          face="focus"
          paws="both"
          laptop
          headTilt={-7}
          tailWag={2}
          bob={Math.sin(frame / 5) * 3}
        />
      }
    />
  );
};
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { activeCaptionAt } from "../captions";
import { BODY_FONT, COLORS } from "../theme";

/** Frames each word stays highlighted. */
const WORD_BEAT = 5;

/**
 * Lives above the scene stack so it reads the stitched timeline, and sits in
 * the bottom safe area clear of the raccoon and headline.
 */
export const CaptionBar: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const frameMs = (frame / fps) * 1000;
  const caption = activeCaptionAt(frameMs);

  if (!caption) return null;

  const ageFrames = frame - (caption.startMs / 1000) * fps;
  const enter = interpolate(ageFrames, [0, 5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const words = caption.text.split(" ");
  const highlight = Math.min(
    words.length - 1,
    Math.floor(Math.max(0, ageFrames) / WORD_BEAT),
  );

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 96,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontFamily: BODY_FONT,
          fontWeight: 700,
          fontSize: 52,
          lineHeight: 1.15,
          letterSpacing: 0.4,
          textAlign: "center",
          maxWidth: 1360,
          padding: "20px 44px",
          borderRadius: 999,
          backgroundColor: "rgba(12,12,20,0.82)",
          border: `2px solid ${COLORS.slate}`,
          opacity: enter,
          translate: `0 ${interpolate(enter, [0, 1], [26, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }).toFixed(2)}px`,
          scale: interpolate(enter, [0, 1], [0.94, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            output: "perceptual-scale",
          }),
        }}
      >
        {words.map((word, i) => (
          <span
            key={i}
            style={{
              color: i === highlight ? COLORS.amber : COLORS.cream,
              display: "inline-block",
              scale: i === highlight ? "1.05" : "1",
            }}
          >
            {word}
            {i < words.length - 1 ? " " : ""}
          </span>
        ))}
      </div>
    </div>
  );
};
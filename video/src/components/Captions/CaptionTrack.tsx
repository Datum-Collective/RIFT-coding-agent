import { createTikTokStyleCaptions } from "@remotion/captions";
import { useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { buildCaptions, parseEmphasis } from "../../lib/captions/build";
import { useSafeArea, useVideo } from "../../lib/context";
import type { Caption, VideoSpec } from "../../spec/schema";
import { toFrames } from "../../spec/timing";
import { motion } from "../../styles/theme";

type CaptionSource = NonNullable<VideoSpec["captions"]>["source"];

// How much speech one caption page holds when captions arrive word by word.
const WORDS_PER_PAGE_MS = 1200;

type Page = {
  startMs: number;
  endMs: number;
  tokens: { text: string; fromMs: number; toMs: number }[];
};

/**
 * Timed captions over the whole video. Narration phrases are one page each; word-level captions
 * from a transcriber are grouped into pages with the word being spoken lit up. Captions sit above
 * the bottom safe inset, wrap instead of overflowing, and have a solid backing for contrast.
 */
export function CaptionTrack() {
  const { spec } = useVideo();
  const { fps } = useVideoConfig();
  const pages = useMemo(
    () => toPages(buildCaptions(spec), spec.captions?.source ?? "narration"),
    [spec],
  );
  if (pages.length === 0) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {pages.map((page, index) => {
        const from = toFrames(page.startMs / 1000, fps);
        const duration = Math.max(1, toFrames(page.endMs / 1000, fps) - from);
        return (
          <Sequence
            key={index}
            from={from}
            durationInFrames={duration}
            layout="none"
            name={`Caption ${index + 1}`}
          >
            <CaptionPage page={page} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

function CaptionPage(props: { page: Page }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { theme, type, space, spec } = useVideo();
  const inset = useSafeArea();
  const nowMs = props.page.startMs + (frame / fps) * 1000;
  const enter = interpolate(frame, [0, 0.18 * fps], [0, 1], {
    extrapolateRight: "clamp",
    easing: motion.enter,
  });
  const highlight = spec.captions?.highlight !== false;
  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        // Captions sit just above the platform UI on vertical, and never within 100px of the edge.
        padding: `0 ${inset.right}px ${Math.max(inset.bottom - space(8), space(12.5))}px ${inset.left}px`,
      }}
    >
      <div
        style={{
          maxWidth: "100%",
          padding: `${space(1.5)}px ${space(3)}px`,
          borderRadius: theme.radius.md,
          backgroundColor: "rgba(0, 0, 0, 0.72)",
          fontFamily: theme.fonts.sans,
          fontSize: type("caption"),
          fontWeight: 700,
          lineHeight: 1.2,
          letterSpacing: "-0.01em",
          color: "#FFFFFF",
          textAlign: "center",
          textWrap: "balance",
          opacity: enter,
          translate: `0px ${(1 - enter) * space(1.5)}px`,
        }}
      >
        {props.page.tokens.map((token, index) => {
          const segments = highlight
            ? parseEmphasis(token.text)
            : [{ text: token.text.replaceAll("*", ""), emphasis: false }];
          const speaking =
            props.page.tokens.length > 1 &&
            nowMs >= token.fromMs &&
            nowMs < token.toMs;
          return (
            <span
              key={index}
              style={{ color: speaking ? theme.palette.accent : undefined }}
            >
              {segments.map((segment, key) => (
                <span
                  key={key}
                  style={{
                    color: segment.emphasis ? theme.palette.accent : undefined,
                  }}
                >
                  {segment.text}
                </span>
              ))}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

function toPages(captions: Caption[], source: CaptionSource): Page[] {
  if (source === "narration")
    return captions.map((caption) => ({
      startMs: caption.startMs,
      endMs: caption.endMs,
      tokens: [
        { text: caption.text, fromMs: caption.startMs, toMs: caption.endMs },
      ],
    }));
  return createTikTokStyleCaptions({
    captions,
    combineTokensWithinMilliseconds: WORDS_PER_PAGE_MS,
  }).pages.map((page) => ({
    startMs: page.startMs,
    endMs: page.startMs + page.durationMs,
    tokens: page.tokens,
  }));
}

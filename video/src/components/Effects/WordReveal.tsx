import { useCurrentFrame, useVideoConfig } from "remotion";
import { progress, revealStyle } from "../../lib/animation/reveal";
import { parseEmphasis } from "../../lib/captions/build";
import { useVideo } from "../../lib/context";

/**
 * Reveals a line word by word in reading order. For headlines that should land as a phrase
 * rather than appear all at once; accented (*marked*) words keep their colour.
 */
export function WordReveal(props: {
  text: string;
  delay?: number;
  perWord?: number;
  color?: string;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { theme, space } = useVideo();
  // Spaces are kept as their own entries so wrapping is natural; only words get a reveal slot.
  const words = parseEmphasis(props.text)
    .flatMap((segment) =>
      segment.text
        .split(/(\s+)/)
        .filter(Boolean)
        .map((word) => ({ word, emphasis: segment.emphasis })),
    )
    .map((item, position, all) => ({
      ...item,
      space: /^\s+$/.test(item.word),
      slot: all.slice(0, position).filter((other) => !/^\s+$/.test(other.word))
        .length,
    }));
  return (
    <>
      {words.map((item, key) => {
        if (item.space) return <span key={key}>{item.word}</span>;
        const amount = progress(
          frame,
          fps,
          (props.delay ?? 0) + item.slot * (props.perWord ?? 0.07),
          0.5,
        );
        return (
          <span
            key={key}
            style={{
              display: "inline-block",
              ...revealStyle(amount, "up", space(2)),
              color: item.emphasis ? theme.palette.accent : props.color,
            }}
          >
            {item.word}
          </span>
        );
      })}
    </>
  );
}

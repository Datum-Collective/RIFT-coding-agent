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
  const words = parseEmphasis(props.text).flatMap((segment) =>
    segment.text
      .split(/(\s+)/)
      .filter(Boolean)
      .map((word) => ({ word, emphasis: segment.emphasis })),
  );
  let index = 0;
  return (
    <>
      {words.map((item, key) => {
        if (/^\s+$/.test(item.word)) return <span key={key}>{item.word}</span>;
        const amount = progress(
          frame,
          fps,
          (props.delay ?? 0) + index++ * (props.perWord ?? 0.07),
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

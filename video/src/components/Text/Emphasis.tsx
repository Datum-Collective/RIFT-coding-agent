import { parseEmphasis } from "../../lib/captions/build";
import { useVideo } from "../../lib/context";

/** Renders copy with *marked* words in the accent colour. */
export function Emphasis(props: { text: string; color?: string }) {
  const { theme } = useVideo();
  return (
    <>
      {parseEmphasis(props.text).map((segment, index) => (
        <span
          key={index}
          style={{
            color: segment.emphasis ? theme.palette.accent : props.color,
          }}
        >
          {segment.text}
        </span>
      ))}
    </>
  );
}

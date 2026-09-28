/**
 * Hand-drawn-style speech balloons with tails pointing at the speaker, plus
 * big graphic SFX lettering. HTML/CSS, ink on paper, no gradients or glow.
 */
import type { CSSProperties } from "react";

export type BalloonTail = "left" | "right" | "up" | "down" | "none";

const INK = "#161616";
const PAPER = "#FFFFFF";

function tailStyle(tail: BalloonTail, size: number): CSSProperties {
  const base: CSSProperties = {
    position: "absolute",
    width: size,
    height: size,
    backgroundColor: PAPER,
    borderRight: `4px solid ${INK}`,
    borderBottom: `4px solid ${INK}`,
  };
  if (tail === "down") return { ...base, left: "50%", bottom: -size / 2 - 2, transform: "translateX(-50%) rotate(45deg) skew(12deg, 12deg)" };
  if (tail === "up") return { ...base, left: "50%", top: -size / 2 - 2, transform: "translateX(-50%) rotate(225deg) skew(12deg, 12deg)" };
  if (tail === "left") return { ...base, left: -size / 2 - 2, top: "55%", transform: "translateY(-50%) rotate(135deg) skew(12deg, 12deg)" };
  return { ...base, right: -size / 2 - 2, top: "55%", transform: "translateY(-50%) rotate(-45deg) skew(12deg, 12deg)" };
}

export function Balloon(props: {
  text: string;
  tail?: BalloonTail;
  whisper?: boolean;
  fontPx: number;
  maxWidth?: number | string;
}) {
  const tail = props.tail ?? "down";
  return (
    <div style={{ position: "relative", maxWidth: props.maxWidth ?? "88%" }}>
      <div
        style={{
          backgroundColor: PAPER,
          border: props.whisper ? `3px dashed ${INK}` : `4px solid ${INK}`,
          borderRadius: "48% 52% 51% 49% / 58% 60% 40% 42%",
          padding: `${props.fontPx * 0.45}px ${props.fontPx * 0.7}px`,
          fontFamily: "Inter, sans-serif",
          fontWeight: 800,
          fontStyle: "italic",
          fontSize: props.fontPx,
          lineHeight: 1.25,
          color: INK,
          textAlign: "center",
          opacity: props.whisper ? 0.85 : 1,
        }}
      >
        {props.text}
      </div>
      {tail === "none" ? null : <div style={tailStyle(tail, props.fontPx * 0.55)} />}
    </div>
  );
}

/** Huge SFX lettering: heavy italic, tight, slightly tilted. White on black when inverted. */
export function Sfx(props: {
  text: string;
  fontPx: number;
  invert?: boolean;
  red?: boolean;
}) {
  return (
    <div
      style={{
        fontFamily: "Inter, sans-serif",
        fontWeight: 900,
        fontStyle: "italic",
        fontSize: props.fontPx,
        lineHeight: 1,
        letterSpacing: "-0.02em",
        color: props.red ? "#D42B1E" : props.invert ? PAPER : INK,
        transform: "rotate(-4deg) skewX(-6deg)",
        textAlign: "center",
        whiteSpace: "nowrap",
      }}
    >
      {props.text}
    </div>
  );
}

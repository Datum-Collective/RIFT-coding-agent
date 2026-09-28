import type { CSSProperties, ReactNode } from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { progress } from "../../lib/animation/reveal";

/**
 * Settles content from slightly larger to its size while fading in. The scale change is small
 * on purpose: it should read as arrival, not a zoom.
 */
export function ScaleIn(props: {
  children: ReactNode;
  delay?: number;
  from?: number;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const amount = progress(frame, fps, props.delay ?? 0, 0.8);
  return (
    <div
      style={{
        opacity: amount,
        scale: String(interpolate(amount, [0, 1], [props.from ?? 1.04, 1])),
        ...props.style,
      }}
    >
      {props.children}
    </div>
  );
}

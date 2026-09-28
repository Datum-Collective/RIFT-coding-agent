import type { CSSProperties, ReactNode } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import {
  progress,
  revealStyle,
  type RevealFrom,
} from "../../lib/animation/reveal";
import { useVideo } from "../../lib/context";

/** Brings a group of content in on the system's entrance curve. Also exported as FadeIn/SlideIn. */
export function Reveal(props: {
  children: ReactNode;
  delay?: number;
  from?: RevealFrom;
  distance?: number;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { space } = useVideo();
  const amount = progress(frame, fps, props.delay ?? 0);
  return (
    <div
      style={{
        ...revealStyle(amount, props.from ?? "up", props.distance ?? space(4)),
        ...props.style,
      }}
    >
      {props.children}
    </div>
  );
}

export function FadeIn(props: {
  children: ReactNode;
  delay?: number;
  style?: CSSProperties;
}) {
  return <Reveal {...props} from="none" />;
}

export function SlideIn(props: {
  children: ReactNode;
  delay?: number;
  from?: Exclude<RevealFrom, "none">;
  style?: CSSProperties;
}) {
  return <Reveal {...props} from={props.from ?? "left"} />;
}

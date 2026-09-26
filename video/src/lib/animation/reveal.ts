/**
 * The single entrance used across the system: a short rise and fade on one curve. Frame-driven
 * and pure, so every render of a frame is identical.
 */
import { interpolate } from "remotion";
import { motion } from "../../styles/theme";

export type RevealFrom = "up" | "down" | "left" | "right" | "none";

/** 0 → 1 over the entrance, starting `delay` seconds into the current sequence. */
export function progress(
  frame: number,
  fps: number,
  delay = 0,
  duration: number = motion.enterDuration,
) {
  return interpolate(frame, [delay * fps, (delay + duration) * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: motion.enter,
  });
}

export function revealStyle(
  amount: number,
  from: RevealFrom,
  distance: number,
) {
  const offset = (1 - amount) * distance;
  const translate =
    from === "up"
      ? `0px ${offset}px`
      : from === "down"
        ? `0px ${-offset}px`
        : from === "left"
          ? `${-offset}px 0px`
          : from === "right"
            ? `${offset}px 0px`
            : undefined;
  return { opacity: amount, translate };
}

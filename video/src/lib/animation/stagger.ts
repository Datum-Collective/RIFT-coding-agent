import type { VideoSpec } from "../../spec/schema";
import { motion } from "../../styles/theme";

/** Delay for the nth item in a group, paced by the spec. */
export function stagger(
  pacing: VideoSpec["style"]["pacing"],
  index: number,
  start = 0,
) {
  return start + index * motion.stagger[pacing];
}

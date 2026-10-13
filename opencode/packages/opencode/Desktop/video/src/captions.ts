import type { Caption } from "@remotion/captions";
import { VIDEO } from "./theme";

const FPS = VIDEO.fps;

/**
 * Authored in frames against the stitched timeline, then stored as the Caption
 * JSON the skill requires. `timestampMs`/`confidence` are null because these
 * captions are written, not transcribed.
 */
const cap = (startFrame: number, endFrame: number, text: string): Caption => ({
  text,
  startMs: (startFrame / FPS) * 1000,
  endMs: (endFrame / FPS) * 1000,
  timestampMs: null,
  confidence: null,
});

export const CAPTIONS: Caption[] = [
  // Hook — 0..105
  cap(4, 36, "ONE RACCOON."),
  cap(36, 70, "ZERO DEGREES."),
  cap(70, 104, "THEN HE TOOK A LAPTOP."),

  // Problem — 90..225
  cap(104, 140, "HIS FIRST PROGRAM?"),
  cap(140, 180, "OPEN TRASH CAN."),
  cap(180, 224, "THAT WAS THE WHOLE SPEC."),

  // FirstLine — 210..360
  cap(224, 262, "SO HE STARTED TYPING."),
  cap(262, 302, "SOMETHING LIKE THIS."),
  cap(302, 359, "IT DID NOT WORK."),

  // Breakthrough — 345..525
  cap(359, 400, "FORTY-SEVEN ERRORS."),
  cap(400, 445, "HE ATE THE STACK TRACE."),
  cap(445, 492, "AND SUDDENLY HE UNDERSTOOD IT."),
  cap(492, 524, "STRANGE, BUT TRUE."),

  // Grind — 510..690
  cap(524, 564, "THEN CAME THE GRIND."),
  cap(564, 604, "NO SLEEP."),
  cap(604, 646, "NO MOONLIGHT."),
  cap(646, 689, "JUST LOOP."),

  // Result — 675..825
  cap(689, 728, "AND THEN ONE MORNING."),
  cap(728, 768, "THE TESTS PASSED."),
  cap(768, 806, "HE SHIPPED IT."),
  cap(806, 824, "ON A FRIDAY."),

  // Outro — 810..915
  cap(824, 866, "YOU CAN DEBUG ANYTHING."),
  cap(866, 914, "EVEN RACCOONS."),
];

export const activeCaptionAt = (frameMs: number) =>
  CAPTIONS.find((c) => frameMs >= c.startMs && frameMs < c.endMs) ?? null;
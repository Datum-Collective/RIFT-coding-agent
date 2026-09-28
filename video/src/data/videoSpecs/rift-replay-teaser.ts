import { defineVideo, FORMATS } from "../../spec/schema";

/**
 * Storyboard — about 11s, 9:16, midnight theme. A teaser: claim, proof in a terminal, close.
 */
export const riftReplayTeaser = defineVideo({
  id: "rift-replay-teaser",
  title: "RIFT Replay — teaser",
  description: "Short vertical teaser for RIFT's replay and time travel.",
  format: FORMATS.vertical,
  style: { theme: "midnight", pacing: "fast" },
  scenes: [
    {
      id: "claim",
      type: "statement",
      durationInSeconds: 3.4,
      lines: ["Every edit RIFT makes", "is *kept.*"],
    },
    {
      id: "proof",
      type: "terminal",
      durationInSeconds: 5,
      transition: { type: "fade", durationInSeconds: 0.4 },
      title: "~/api",
      lines: [
        { kind: "input", text: "rift replay ses_f2bc" },
        { kind: "output", text: "18 steps · 2 files · 1 test" },
        { kind: "error", text: "bun test (exit 1)" },
        { kind: "success", text: "bun test  ↺ repaired" },
      ],
    },
    {
      id: "close",
      type: "cta",
      durationInSeconds: 3.4,
      transition: { type: "fade", durationInSeconds: 0.4 },
      wordmark: "RIFT",
      headline: "Travel back to any turn.",
      url: "/replay",
    },
  ],
});

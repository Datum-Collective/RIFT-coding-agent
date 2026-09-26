import { defineVideo, FORMATS } from "../../spec/schema";

/**
 * Storyboard — 30s, 9:16, terminal theme, captions for sound-off viewing.
 *   0–4s    Hook: the claim, in two beats.
 *   4–10s   Problem: an agent says tests pass; the real run says otherwise.
 *   10–13s  Solution: RIFT, one line.
 *   13–20s  How: Engineering Graph, Evidence Graph, Adversarial Loop.
 *   20–26s  Workflow: Intent → … → Ship, with the repair loop.
 *   26–30s  CTA.
 * Every scene after the first fades in over 0.4s, which overlaps the scene before it.
 */
export const riftLaunch = defineVideo({
  id: "rift-launch",
  title: "RIFT — product launch",
  description:
    "30-second vertical launch video for RIFT, the open-source coding agent.",
  brief:
    "Create a 30-second product launch video for RIFT. RIFT is an open-source coding agent that operates the software engineering process rather than simply generating code. Audience: developers, technical founders, and AI engineers. Format: 9:16 vertical. Style: dark, minimal, technical, premium. Terminal-inspired but not stereotypically cyberpunk.",
  format: FORMATS.vertical,
  targetDurationInSeconds: 30,
  style: {
    theme: "terminal",
    pacing: "fast",
    visualDirection:
      "Dark, minimal, technical. Terminal typography, one green accent.",
  },
  captions: { enabled: true },
  scenes: [
    {
      id: "hook",
      type: "statement",
      durationInSeconds: 4.4,
      lines: ["Coding agents write code.", "*RIFT operates engineering.*"],
    },
    {
      id: "problem",
      type: "terminal",
      durationInSeconds: 6.4,
      transition: { type: "fade", durationInSeconds: 0.4 },
      heading: "The agent says it works.",
      title: "~/api",
      narration: "The agent says the tests pass. Nobody ran them.",
      lines: [
        { kind: "input", text: 'agent "add rate limiting"' },
        { kind: "success", text: "wrote 4 files" },
        { kind: "success", text: "all tests pass" },
        { kind: "input", text: "npm test" },
        { kind: "error", text: "3 tests failing" },
      ],
    },
    {
      id: "introduce",
      type: "title",
      durationInSeconds: 3.4,
      transition: { type: "fade", durationInSeconds: 0.4 },
      eyebrow: "Introducing RIFT",
      headline: "An agent that *proves* its work.",
    },
    {
      id: "graphs",
      type: "cards",
      durationInSeconds: 7.4,
      transition: { type: "fade", durationInSeconds: 0.4 },
      heading: "Engineering, not autocomplete.",
      narration:
        "It maps the system, keeps the evidence, and attacks its own build.",
      cards: [
        {
          glyph: "◇",
          title: "Engineering Graph",
          body: "Requirements, decisions, files — linked.",
        },
        {
          glyph: "✓",
          title: "Evidence Graph",
          body: "Every claim backed by a real run.",
        },
        {
          glyph: "↺",
          title: "Adversarial Loop",
          body: "A second agent attacks the build.",
        },
      ],
    },
    {
      id: "workflow",
      type: "flow",
      durationInSeconds: 6.2,
      transition: { type: "fade", durationInSeconds: 0.4 },
      heading: "One loop, end to end.",
      narration: "Plan it, build it, attack it, prove it.",
      steps: [
        "Intent",
        "Plan",
        "Build",
        "Verify",
        "Attack",
        "Repair",
        "Prove",
        "Ship",
      ],
      loop: { from: 5, to: 3, label: "until it holds" },
    },
    {
      id: "cta",
      type: "cta",
      durationInSeconds: 4.2,
      transition: { type: "fade", durationInSeconds: 0.4 },
      wordmark: "RIFT",
      headline: "Ship code that holds up.",
      url: "Star it on GitHub",
      subline: "Open source · MIT",
    },
  ],
});

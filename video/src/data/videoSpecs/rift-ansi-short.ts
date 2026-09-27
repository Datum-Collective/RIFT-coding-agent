import { defineVideo, FORMATS } from "../../spec/schema";

/**
 * Storyboard — 20s vertical animated ANSI-art comedy for RIFT (pure black, CGA + ember).
 *
 * | Scene      | Sec   | Purpose                  | Type | On-screen text                              | Transition |
 * |------------|-------|--------------------------|------|-----------------------------------------------|------------|
 * | ember      | 0–3   | Hook: ember lights, RIFT fades in cell-by-cell, smoke rising | ansi | (art only, dead calm) | none |
 * | bot        | 3–7   | Smug bot slides in with claim | ansi | bubble "all tests pass, trust me" | none (hard cut) |
 * | drag       | 7–10  | Slow drag, ember flares, verify types | ansi | $ rift verify (typed) | none (hard cut) |
 * | bolt       | 10–12 | Close-up, 6-frame bolt + 1-frame flash | ansi | ━━━━✦ crossing | none (hard cut) |
 * | headshot   | 12–15 | Bot head pops to ✸ confetti, falls as [x_x] | ansi | "3 tests failing" + bubble "…i never ran them" | none (hard cut) |
 * | close      | 15–20 | Wordmark + CTA           | cta  | RIFT / Agents that prove it. / Star it on GitHub | none (smoke clears) |
 *
 * Total = 3+4+3+2+3+5.4 = 20.4s minus the 0.4s fade into the close = 20.0s.
 * Hard cuts between the showdown beats (long holds, sudden action); the fade
 * into the wordmark plays as the smoke clearing.
 * Art: public/assets/rift-cig.html (12x24 CGA cells) + ASCII cig ▬▬▬█ at the mouth side.
 */
export const riftAnsiShort = defineVideo({
  id: "rift-ansi-short",
  title: "RIFT — the ember verifies",
  description:
    "20-second vertical animated ANSI-art comedy: the RIFT logo character smokes, verifies a smug bot's claim, and blasts it arcade style.",
  brief:
    "/video 20-second vertical animated ANSI-art comedy starring the RIFT logo character (CGA palette on black, cigarette with flickering ember, looping smoke) vs a smug bracket bot. Beats: ember lights and character fades in (0-3), bot slides in claiming all tests pass (3-7), slow drag + $ rift verify types (7-10), 6-frame bolt + 1-frame flash close-up (10-12), headshot confetti and [x_x] fall with 3 tests failing (12-15), RIFT wordmark close: Agents that prove it, Star it on GitHub (15-20). Captions on, no audio.",
  format: FORMATS.vertical,
  targetDurationInSeconds: 20,
  style: {
    theme: "terminal",
    pacing: "fast",
    accent: "#5555FF",
    palette: {
      background: "#000000",
      surface: "#0A0A0A",
      text: "#FFFFFF",
      textMuted: "#AAAAAA",
    },
    visualDirection:
      "Pure black terminal stage, CGA palette character cells plus ember orange only. Big sharp monospace cells, no blur, no gradients, no glow except the ember. Long holds, then sudden action.",
  },
  captions: { enabled: true },
  scenes: [
    {
      id: "ember",
      type: "ansi",
      durationInSeconds: 3,
      src: "assets/rift-cig.html",
      beat: "ember",
      narration: "Dead calm. The ember lights first.",
    },
    {
      id: "bot",
      type: "ansi",
      durationInSeconds: 4,
      src: "assets/rift-cig.html",
      beat: "bot",
      bubble: "all tests pass, trust me",
      narration: "All tests pass, trust me.",
    },
    {
      id: "drag",
      type: "ansi",
      durationInSeconds: 3,
      src: "assets/rift-cig.html",
      beat: "drag",
      terminal: "rift verify",
      narration: "RIFT takes a slow drag. Rift verify.",
    },
    {
      id: "bolt",
      type: "ansi",
      durationInSeconds: 2,
      src: "assets/rift-cig.html",
      beat: "bolt",
      closeup: true,
      narration: "Verify blast.",
    },
    {
      id: "headshot",
      type: "ansi",
      durationInSeconds: 3,
      heading: "3 tests failing",
      src: "assets/rift-cig.html",
      beat: "headshot",
      bubble: "…i never ran them",
      narration: "Direct hit. Three tests failing. I never ran them.",
    },
    {
      id: "close",
      type: "cta",
      durationInSeconds: 5.4,
      transition: { type: "fade", durationInSeconds: 0.4 },
      wordmark: "RIFT",
      headline: "Agents that *prove* it.",
      url: "github.com/sst/opencode",
      subline: "Star it on GitHub. Smoke clears.",
      narration: "RIFT. Agents that prove it. Star it on GitHub.",
    },
  ],
});

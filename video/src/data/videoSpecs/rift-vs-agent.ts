import { defineVideo, FORMATS } from "../../spec/schema";

/**
 * Storyboard — 20s vertical comparison: a generic coding agent vs RIFT. Pure black, one grey
 * for the other agent, the banner's own blue/grey for RIFT. Split screen, one claim per round.
 *
 * | Scene         | Sec        | Purpose                  | Type             | On-screen text                                                  | Transition |
 * |---------------|------------|--------------------------|------------------|------------------------------------------------------------------|------------|
 * | intro         | 0–2.9      | Hook: set up the duel    | versus (intro)   | "Two agents. Same task." bot glyph + R, both grey, same task card | —          |
 * | says-it-works | 2.5–7.2    | Round 1: claim vs proof  | versus (check)   | "Says it works." ✓ Tests passing ×2 → $ bun test → ✓ 42 passed    | fade 0.4   |
 * | remembers     | 6.8–11.5   | Round 2: memory          | versus (memory)  | "Remembers what it did." flat bubble vs activity grid + replay    | fade 0.4   |
 * | when-wrong    | 11.1–15.8  | Round 3: failure         | versus (alert)   | "When it's wrong." faded vs bold amber "3 tests failing", ✓ → ✗   | fade 0.4   |
 * | close         | 15.4–20    | Sign-off                 | versus (close)   | banner + tagline + "Open source." + GitHub URL                    | fade 0.4   |
 *
 * The R is the left 196 units of assets/banner.svg (cropped, never redrawn); the close grows it
 * back into the whole banner. The bot is plain geometry, not any product's mascot.
 */
const mark = {
  // assets/banner.svg with only its #0d1117 canvas made transparent, for a pure black frame.
  mark: "images/rift-banner.svg",
  markAspect: 576 / 192,
  monogram: 196 / 192,
} as const;

export const riftVsAgent = defineVideo({
  id: "rift-vs-agent",
  title: "RIFT vs. a generic coding agent",
  description:
    "20-second vertical split-screen comparison: a generic coding agent claims, RIFT proves.",
  brief:
    "/video 20-second vertical comparison video: a generic coding agent vs RIFT. Super clean, minimal, graphic. No characters, no mascots — just typography, the RIFT R logo, and a plain geometric bot glyph (a simple rounded-rect head with two dot eyes, built in SVG, not any real product's mascot). Look: pure black background, one weight of grey for \"the other agent\", RIFT's own blue/grey palette for RIFT (from assets/banner.svg — use the real logo, not a redrawn one). No gradients, no glow, no clutter. Generous whitespace. Big confident type. Structure: a split-screen comparison, generic agent on the left, RIFT on the right, revealed one claim at a time. Each round: state the claim, hold, reveal the real check underneath it. 0–3s Title: \"Two agents. Same task.\" 3–8s Round 1 — \"Says it works.\" Left: \"✓ Tests passing\" static. Right: \"✓ Tests passing\" with $ bun test → ✓ 42 passed running underneath. 8–13s Round 2 — \"Remembers what it did.\" Left: a single greyed-out message bubble. Right: an activity graph filling in, RIFT's replay timeline ticking across real steps. 14–18s Round 3 — \"When it's wrong.\" Left: \"3 tests failing\" faded, low-contrast. Right: the same line in RIFT's warning color, bold, with a small red check-mark turning into an X. 18–20s Close: RIFT wordmark (from assets/banner.svg), \"The agent that runs your tests instead of telling you they passed.\" Small: \"Open source. github.com/Datum-Collective/RIFT-coding-agent\". No stage directions or scene labels on screen. Captions on, no audio.",
  format: FORMATS.vertical,
  targetDurationInSeconds: 20,
  style: {
    theme: "midnight",
    pacing: "medium",
    palette: {
      background: "#000000",
      surface: "#0A0A0C",
      surfaceRaised: "#161618",
      border: "#232326",
      text: "#F2F2F4",
      // The one grey the other agent gets.
      textMuted: "#6E6E73",
      // The banner's ANSI blue and bright blue; RIFT's TUI warning amber; ANSI bright red.
      accent: "#5555FF",
      success: "#5555FF",
      warning: "#F59E0B",
      danger: "#FF5555",
    },
    visualDirection:
      "Apple-restrained split screen on pure black. Grey for the other agent, banner blue for RIFT. Hairline divider, big tight Inter, pixel cells that echo the ANSI banner. No gradients, no glow.",
  },
  // Every word is already primary on-screen type and there is no audio, so burned-in captions
  // would only repeat each headline. Narration stays in the spec: flip this on to caption it.
  captions: { enabled: false },
  scenes: [
    {
      id: "intro",
      type: "versus",
      beat: "intro",
      durationInSeconds: 2.9,
      ...mark,
      headline: "Two agents. Same task.",
      narration: "Two agents. Same task.",
    },
    {
      id: "says-it-works",
      type: "versus",
      beat: "check",
      durationInSeconds: 4.7,
      transition: { type: "fade", durationInSeconds: 0.4 },
      ...mark,
      headline: "Says it works.",
      claim: "✓ Tests passing",
      run: [
        { kind: "input", text: "bun test" },
        { kind: "success", text: "42 passed" },
      ],
      narration: "Says it works.",
    },
    {
      id: "remembers",
      type: "versus",
      beat: "memory",
      durationInSeconds: 4.7,
      transition: { type: "fade", durationInSeconds: 0.4 },
      ...mark,
      headline: "Remembers what it did.",
      narration: "Remembers what it did.",
    },
    {
      id: "when-wrong",
      type: "versus",
      beat: "alert",
      durationInSeconds: 4.7,
      transition: { type: "fade", durationInSeconds: 0.4 },
      ...mark,
      headline: "When it’s wrong.",
      claim: "3 tests failing",
      narration: "When it’s wrong.",
    },
    {
      id: "close",
      type: "versus",
      beat: "close",
      durationInSeconds: 4.6,
      transition: { type: "fade", durationInSeconds: 0.4 },
      ...mark,
      headline:
        "The agent that\n*runs your tests*\ninstead of telling you\nthey passed.",
      subline: "Open source.",
      url: "github.com/Datum-Collective/RIFT-coding-agent",
      narration:
        "The agent that runs your tests instead of telling you they passed.",
    },
  ],
});

import { defineVideo, FORMATS } from "../../spec/schema";

/**
 * Storyboard — 30s square retro-90s-cel anime for X (terminal theme, captions on, no audio).
 *
 * | Scene  | Sec   | Purpose                  | Type     | On-screen text                              | Transition |
 * |--------|-------|--------------------------|----------|---------------------------------------------|------------|
 * | night  | 0–6   | Alone at the terminal, rain, 2:47 AM | manga | "2:47 AM" label / "one bug left." | none |
 * | spiral | 6–14  | Errors multiply, duck debated | manga | ERROR! popups / "no no no—" / "it's the cache. it's always the cache." | none, hard cut |
 * | verify | 14–19 | The turnaround keystroke | terminal | $ rift verify → 412 checks passed | none, hard cut |
 * | dawn   | 19–26 | Verified blaze + sunrise | manga | ドーン / "there you are."                  | none, hard cut |
 * | tag    | 26–30 | Asleep at the keyboard, sign-off | manga | Zzz / "Ship it before sunrise." / — RIFT | none, hard cut |
 *
 * Total = 6+8+5+7+4 = 30.0s, all hard cuts (calm, spiral, sunrise).
 * Look: 90s cel — film grain, halftone, night navy + phosphor green + dawn amber,
 * original ant cast, no web images. Locked with the user A/A/A/A/B + build approval.
 */
export const antAllNighter = defineVideo({
  id: "ant-all-nighter",
  title: "An Ant Who Codes: The All-Nighter",
  description:
    "30-second square retro anime: one ant, one bug, all night — until rift verify ends it at dawn.",
  brief:
    "Retro 90s cel anime about An Ant Who Codes: the all-nighter (calm, spiral, sunrise) in square 30s for X. Night nest, error spiral, rift verify turnaround, dawn blast, asleep-at-keyboard tag 'Ship it before sunrise. — RIFT'. Captions on, no audio.",
  format: FORMATS.square,
  targetDurationInSeconds: 30,
  style: {
    theme: "terminal",
    pacing: "medium",
    visualDirection:
      "Retro 90s cel anime: film grain and halftone over ink linework, night-navy panels with phosphor-green terminal glow, dawn amber bands, limited held poses, snappy hard cuts, deterministic motion only. No gradients, no glow filters.",
  },
  captions: { enabled: true },
  scenes: [
    {
      id: "night",
      type: "manga",
      durationInSeconds: 6,
      camera: "push",
      narration: "Two forty-seven AM. One bug left.",
      panels: [
        {
          art: "nightdesk",
          label: "2:47 AM",
          balloons: [{ text: "one bug left.", tail: "down" }],
        },
      ],
    },
    {
      id: "spiral",
      type: "manga",
      durationInSeconds: 8,
      camera: "pan",
      narration: "The errors multiply. It is always the cache. Probably.",
      panels: [
        {
          art: "errors",
          balloons: [{ text: "no no no—", tail: "down" }],
        },
        {
          art: "duck",
          balloons: [{ text: "it's the cache. it's always the cache.", tail: "up" }],
        },
      ],
    },
    {
      id: "verify",
      type: "terminal",
      durationInSeconds: 5,
      title: "nest — zsh",
      narration: "Then, one keystroke: rift verify.",
      lines: [
        { kind: "input", text: "rift verify" },
        { kind: "output", text: "checking 412 claims..." },
        { kind: "success", text: "412 checks passed" },
      ],
    },
    {
      id: "dawn",
      type: "manga",
      durationInSeconds: 7,
      camera: "push",
      narration: "Verified in a blaze. There you are, sunrise.",
      panels: [
        { art: "blast", sfx: "ドーン" },
        {
          art: "sunrise",
          balloons: [{ text: "there you are.", tail: "down" }],
        },
      ],
    },
    {
      id: "tag",
      type: "manga",
      durationInSeconds: 4,
      camera: "still",
      narration: "Ship it before sunrise. RIFT.",
      panels: [{ art: "sleep" }],
    },
  ],
});

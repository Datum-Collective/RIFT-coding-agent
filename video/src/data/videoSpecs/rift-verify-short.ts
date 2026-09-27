import { defineVideo, FORMATS } from "../../spec/schema";

/**
 * Storyboard — 20s vertical ASCII-art comedy short for RIFT (terminal theme, fast).
 *
 * | Scene     | Sec     | Purpose              | Type     | On-screen text                          | Transition |
 * |-----------|---------|----------------------|----------|-------------------------------------------|------------|
 * | bot-brags | 0–4     | Hook: smug bot brags | code     | "all tests pass, trust me" + bot ASCII    | none       |
 * | r-arrives | 4–7.5   | R slides in to check | code     | chunky block R + "R checks the claim."    | slide from-left 0.4 |
 * | verify    | 7.5–11.5| Terminal types cmd   | terminal | $ rift verify / checking claims           | fade 0.4   |
 * | bolt      | 11.5–15 | R fires bolt         | code     | R ━━━✦ bolt -> bot ASCII                  | wipe 0.4   |
 * | hit       | 15–18   | Direct hit punchline | code     | [x_x] + "...I never ran them" + 3 FAIL    | fade 0.4   |
 * | close     | 18–22*  | CTA wordmark         | cta      | RIFT / Agents that prove it. / Star it    | fade 0.4   |
 * (*timeline overlaps transitions so total = 20.0s)
 *
 * Look: monospace ASCII on near-black, green RIFT vs amber bot (in spirit),
 * block R from █ characters, original bracket bot, no glow, no gradients.
 */
export const riftVerifyShort = defineVideo({
  id: "rift-verify-short",
  title: "RIFT — trust me (verify blast)",
  description: "20-second vertical ASCII-art comedy: smug bot claims tests pass, RIFT verifies, arcade blast.",
  brief: "/video 20-second vertical ASCII-art comedy short for RIFT. Overconfident bot claims code works, R logo runs rift verify, fires ASCII bolt, bot admits it never ran tests, close on RIFT wordmark, Agents that prove it, Star it on GitHub. Terminal look, dumb-funny, captions on, no audio.",
  format: FORMATS.vertical,
  targetDurationInSeconds: 20,
  style: {
    theme: "terminal",
    pacing: "fast",
    visualDirection: "Retro terminal arcade: near-black background, monospace ASCII art, green phosphor RIFT vs amber bot, chunky block-letter R from box characters, original bracket bot, scanline feel, no glow, no gradients.",
  },
  captions: { enabled: true },
  scenes: [
    {
      id: "bot-brags",
      type: "code",
      durationInSeconds: 4,
      heading: "bot.exe has entered",
      filename: "bot.txt",
      narration: "All tests pass, trust me.",
      code: `"all tests pass, trust me"\n  .-----------.\n  |  (^_^)    |\n  |  /[_]\\\\   |\n  |   bot     |\n  '-----------'`,
    },
    {
      id: "r-arrives",
      type: "code",
      durationInSeconds: 3.5,
      transition: { type: "slide", durationInSeconds: 0.4, direction: "from-left" },
      heading: "uh oh. the R arrives",
      filename: "rift.txt",
      narration: "The R slides in to check.",
      code: `██████\n█    █\n█████\n█  █\n█   █\nR checks the claim.`,
    },
    {
      id: "verify",
      type: "terminal",
      durationInSeconds: 4,
      transition: { type: "fade", durationInSeconds: 0.4 },
      heading: "RIFT verifies. arcade rules.",
      title: "terminal",
      narration: "RIFT types rift verify.",
      lines: [
        { kind: "input", text: "rift verify" },
        { kind: "output", text: "checking claims..." },
        { kind: "output", text: "running 3 tests..." },
      ],
    },
    {
      id: "bolt",
      type: "code",
      durationInSeconds: 3.5,
      transition: { type: "wipe", durationInSeconds: 0.4 },
      heading: "VERIFY BLAST",
      filename: "blast.txt",
      narration: "The R fires a verify blast.",
      code: `█  ━━━✦    [^_^]\n█ ━━━✦     /[_]\\\\\n█ ━✦-->>>   bot\npew. pew. pew.`,
    },
    {
      id: "hit",
      type: "code",
      durationInSeconds: 3,
      transition: { type: "fade", durationInSeconds: 0.4 },
      heading: "direct hit. 3 tests failing",
      filename: "ouch.txt",
      highlight: [4, 5],
      narration: "Direct hit. I never ran them.",
      code: `  ✸   ✸\n  [x_x]  zzt.\n  /[_]\\\\  ow.\n"...I never ran them"\n3 FAIL. 0 pass. ouch.`,
    },
    {
      id: "close",
      type: "cta",
      durationInSeconds: 4,
      transition: { type: "fade", durationInSeconds: 0.4 },
      wordmark: "RIFT",
      headline: "Agents that *prove* it.",
      url: "github.com/sst/opencode",
      subline: "Star it on GitHub. Arcade over.",
      narration: "RIFT. Agents that prove it. Star it on GitHub.",
    },
  ],
});

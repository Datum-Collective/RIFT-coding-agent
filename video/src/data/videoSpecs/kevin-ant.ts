import { defineVideo, FORMATS } from "../../spec/schema";

/**
 * Storyboard — 30s square manga parody for X/Twitter (paper theme, no captions, no audio).
 *
 * | Scene    | Sec   | Purpose                  | Type  | On-screen text                                    | Transition |
 * |----------|-------|--------------------------|-------|-----------------------------------------------------|------------|
 * | standup  | 0–4   | Colony standup + Kevin's glint | manga | "Just fix the button colour." / SFX キラッ | none |
 * | sprint   | 4–9   | Kevin sprints off, whisper inset | manga | REFACTOR leaf / "that's not the ticket…" | none, hard cut |
 * | montage  | 9–15  | 3-panel refactor spree   | manga | pantry→cache, nursery→pods, legacy pillar / "works on my anthill." | none, hard cut |
 * | cavein   | 15–20 | Full-bleed collapse      | manga | SFX ドドドド, shake, falling dirt                   | none, hard cut |
 * | aftermath| 20–26 | Dusty stare + deadpan verdict | manga | "…the button is still blue." / "it's… more scalable now?" | none, hard cut |
 * | ship     | 26–30 | Clean close              | manga | "Ship the ticket." / — RIFT                          | none, hard cut |
 *
 * Total = 4+5+6+5+6+4 = 30.0s, all hard cuts (calm, calm, SNAP).
 * Look: black ink on white paper, halftone screentone, one red spot colour
 * (REFACTOR leaf + final line). Original ant cast, no web images.
 */
export const kevinAnt = defineVideo({
  id: "kevin-ant",
  title: "The Ant That Didn't Follow the Ticket",
  description:
    "30-second square manga parody: Kevin the ant ignores the ticket, refactors the colony, and learns why you ship the ticket.",
  brief:
    "30-second square (1080x1080) manga-style dev parody for X/Twitter: an ant colony is a dev team, the Queen is tech lead, Kevin ignores the ticket to REFACTOR everything, the colony caves in (ドドドド), aftermath verdict, close on 'Ship the ticket.' / RIFT. Black ink on white paper, screentone, one red spot colour, original SVG ants, panel layouts with manga-order camera, balloons + Japanese SFX, no captions, no audio.",
  format: FORMATS.square,
  targetDurationInSeconds: 30,
  style: {
    theme: "paper",
    pacing: "medium",
    palette: {
      background: "#FFFFFF",
      surface: "#FFFFFF",
      text: "#161616",
      textMuted: "#5A5A5A",
    },
    visualDirection:
      "Real manga page: black ink line art on white paper, halftone screentone shading, speed and impact lines, hand-drawn balloons, big Japanese SFX. One red spot colour only. Limited animation, snappy hard cuts, deterministic shake. No gradients, no glow.",
  },
  scenes: [
    {
      id: "standup",
      type: "manga",
      durationInSeconds: 4,
      camera: "push",
      panels: [
        {
          art: "standup",
          label: "morning standup",
          balloons: [{ text: "Just fix the button colour.", tail: "left" }],
        },
        { art: "glint", sfx: "キラッ" },
      ],
    },
    {
      id: "sprint",
      type: "manga",
      durationInSeconds: 5,
      camera: "pan",
      panels: [
        { art: "sprint" },
        {
          art: "whisper",
          balloons: [{ text: "that's not the ticket…", tail: "left", whisper: true }],
        },
      ],
    },
    {
      id: "montage",
      type: "manga",
      durationInSeconds: 6,
      camera: "pan",
      panels: [
        { art: "rewire" },
        { art: "rename" },
        {
          art: "pillar",
          balloons: [{ text: "works on my anthill.", tail: "up" }],
        },
      ],
    },
    {
      id: "cavein",
      type: "manga",
      durationInSeconds: 5,
      camera: "shake",
      panels: [{ art: "cavein", invert: true, sfx: "ドドドド" }],
    },
    {
      id: "aftermath",
      type: "manga",
      durationInSeconds: 6,
      camera: "push",
      panels: [
        { art: "aftermath" },
        {
          art: "verdict",
          balloons: [
            { text: "…the button is still blue.", tail: "down" },
            { text: "it's… more scalable now?", tail: "up" },
          ],
        },
      ],
    },
    {
      id: "ship",
      type: "manga",
      durationInSeconds: 4,
      camera: "still",
      panels: [{ art: "ship" }],
    },
  ],
});

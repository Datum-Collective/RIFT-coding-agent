/**
 * The visual language. A video uses one theme end to end so it reads as one piece; scenes pick
 * roles ("accent", "surface") and never raw colours.
 */
import { Easing } from "remotion";
import type { VideoSpec } from "../spec/schema";

export type Palette = {
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  /** The accent at low strength, for fills behind accent text and subtle emphasis. */
  accentSoft: string;
  danger: string;
  warning: string;
  success: string;
};

export type Theme = {
  name: VideoSpec["style"]["theme"];
  palette: Palette;
  fonts: { sans: string; mono: string };
  radius: { sm: number; md: number; lg: number };
  /** Rules and window chrome are 1px hairlines scaled to the frame, never heavy strokes. */
  hairline: number;
};

const PALETTES: Record<Theme["name"], Palette> = {
  // Dark, quiet, green used sparingly: a terminal, not a hacker movie.
  terminal: {
    background: "#0B0D0C",
    surface: "#121513",
    surfaceRaised: "#191D1B",
    border: "#262C29",
    text: "#E9EDEA",
    textMuted: "#8B948F",
    accent: "#62D39A",
    accentSoft: "rgba(98, 211, 154, 0.14)",
    danger: "#F07171",
    warning: "#E6B450",
    success: "#62D39A",
  },
  // Light and calm for teaching: diagrams need contrast more than mood.
  paper: {
    background: "#F6F5F1",
    surface: "#FFFFFF",
    surfaceRaised: "#EEECE6",
    border: "#DAD7CF",
    text: "#18191C",
    textMuted: "#66686E",
    accent: "#2F64D6",
    accentSoft: "rgba(47, 100, 214, 0.12)",
    danger: "#C8413F",
    warning: "#B7800D",
    success: "#23865A",
  },
  // Cinematic typography: near-black with one warm accent.
  midnight: {
    background: "#0C0C10",
    surface: "#15151B",
    surfaceRaised: "#1C1C24",
    border: "#2A2A35",
    text: "#F3F3F6",
    textMuted: "#9C9CAA",
    accent: "#F2A541",
    accentSoft: "rgba(242, 165, 65, 0.14)",
    danger: "#EF6B6B",
    warning: "#F2A541",
    success: "#5CC795",
  },
};

export function themeFor(spec: VideoSpec): Theme {
  const base = PALETTES[spec.style.theme];
  const brand = Object.fromEntries(
    Object.entries(spec.style.palette ?? {}).filter(
      (entry) => entry[1] !== undefined,
    ),
  );
  const accent = spec.style.palette?.accent ?? spec.style.accent;
  const palette: Palette = {
    ...base,
    // A brand accent also drives success, so "done" states stay on brand.
    ...(accent ? { accent, accentSoft: soften(accent), success: accent } : {}),
    ...brand,
  };
  return {
    name: spec.style.theme,
    palette,
    fonts: { sans: "Inter", mono: "JetBrains Mono" },
    radius: { sm: 8, md: 16, lg: 28 },
    hairline: 2,
  };
}

function soften(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, 0.14)`;
}

/**
 * Motion curves. One entrance curve for the whole system: fast out of the gate, long settle.
 * No bounce or elastic curves; motion should feel designed, not springy.
 */
export const motion = {
  enter: Easing.bezier(0.16, 1, 0.3, 1),
  exit: Easing.bezier(0.7, 0, 0.84, 0),
  move: Easing.bezier(0.65, 0, 0.35, 1),
  /** Seconds. */
  enterDuration: 0.6,
  stagger: { slow: 0.22, medium: 0.14, fast: 0.09 },
} as const;

import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadCascadia } from "@remotion/google-fonts/CascadiaCode";
import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";

export const HEAD_FONT = "Poppins";
export const BODY_FONT = "Inter";
export const CODE_FONT = "Cascadia Code";

export const VIDEO = {
  width: 1920,
  height: 1080,
  fps: 30,
} as const;

/**
 * Kurtzgesagt-style ground: deep desaturated navy so flat accent colours pop,
 * with a slightly lighter panel tone for cards.
 */
export const COLORS = {
  bg: "#15151f",
  bgDeep: "#0c0c14",
  panel: "#21212f",
  slate: "#3a3a52",
  cream: "#f6f3ea",
  fur: "#8f93ad",
  furLight: "#b7bbd0",
  mask: "#23233a",
  ink: "#101018",
  teal: "#2ee6c5",
  amber: "#ffc247",
  coral: "#ff6b6b",
  violet: "#a98bff",
  pink: "#ff9ec4",
} as const;

/** Keep key content inside these bounds (video-layout rules). */
export const SAFE = {
  side: 110,
  top: 100,
  bottom: 100,
} as const;

export const loadFonts = () => {
  loadPoppins("normal", { weights: ["800", "900"], subsets: ["latin"] });
  loadInter("normal", { weights: ["600", "700"], subsets: ["latin"] });
  loadCascadia("normal", { weights: ["700"], subsets: ["latin"] });
};

loadFonts();
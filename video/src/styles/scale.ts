/**
 * Sizes derived from the frame, never hard-coded per scene. Everything scales from the short
 * edge, so a 1080×1920 vertical and a 1920×1080 horizontal share one readable type scale.
 * Pure, so validation scripts can use it without loading React.
 */

export type Frame = { width: number; height: number };

export type TypeRole =
  | "display"
  | "headline"
  | "title"
  | "body"
  | "label"
  | "caption"
  | "mono";

// At a 1080px short edge. The skill's floor for 1080-wide video is 84px headlines and 44px
// supporting text; phones are the default viewing surface.
const TYPE_AT_1080: Record<TypeRole, number> = {
  display: 132,
  headline: 96,
  title: 64,
  body: 46,
  label: 32,
  caption: 54,
  mono: 36,
};

export const LINE_HEIGHT: Record<TypeRole, number> = {
  display: 1.02,
  headline: 1.08,
  title: 1.15,
  body: 1.35,
  label: 1.3,
  caption: 1.2,
  mono: 1.5,
};

export function unit(frame: Frame) {
  return Math.min(frame.width, frame.height) / 1080;
}

export function typeSize(frame: Frame, role: TypeRole) {
  return Math.round(TYPE_AT_1080[role] * unit(frame));
}

/** Spacing on an 8px grid at 1080. */
export function space(frame: Frame, steps: number) {
  return Math.round(8 * steps * unit(frame));
}

export type Insets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/**
 * Where important content may go. Vertical video reserves the bottom and right edges that
 * TikTok, Reels and Shorts cover with their own UI.
 */
export function safeArea(frame: Frame): Insets {
  const u = unit(frame);
  if (frame.height > frame.width) {
    return {
      top: Math.round(200 * u),
      right: Math.round(120 * u),
      bottom: Math.round(420 * u),
      left: Math.round(100 * u),
    };
  }
  return {
    top: Math.round(96 * u),
    right: Math.round(120 * u),
    bottom: Math.round(110 * u),
    left: Math.round(120 * u),
  };
}

export function contentBox(frame: Frame) {
  const inset = safeArea(frame);
  return {
    width: frame.width - inset.left - inset.right,
    height: frame.height - inset.top - inset.bottom,
  };
}

// Average advance width as a share of font size. Inter's is about 0.52 for mixed-case text;
// mono is fixed at 0.6. Deliberately a little generous so estimates err toward "too long".
const ADVANCE = { sans: 0.55, mono: 0.6 } as const;

/**
 * Lines a text block will wrap to at a width. An estimate, used by validation to catch copy
 * that cannot fit before anything renders; the frames step is the real check.
 */
export function estimateLines(
  text: string,
  fontSize: number,
  width: number,
  family: keyof typeof ADVANCE = "sans",
) {
  const perLine = Math.max(1, Math.floor(width / (fontSize * ADVANCE[family])));
  const words = text.replaceAll("*", "").split(/\s+/).filter(Boolean);
  return words.reduce(
    (state, word) => {
      const length =
        state.current === 0 ? word.length : state.current + 1 + word.length;
      if (length <= perLine || state.current === 0)
        return { lines: state.lines, current: Math.min(length, perLine) };
      return { lines: state.lines + 1, current: word.length };
    },
    { lines: words.length ? 1 : 0, current: 0 },
  ).lines;
}

/** Terminal text: a little larger on vertical, where the window is the whole story. */
export function terminalFontSize(frame: Frame) {
  return typeSize(frame, "mono") * (frame.height > frame.width ? 1.2 : 1);
}

/** Code text shrinks slightly for longer listings. */
export function codeFontSize(frame: Frame, lines: number) {
  return typeSize(frame, "mono") * (lines > 10 ? 0.85 : 1);
}

/** Characters of mono text that fit on one line inside a window drawn in the content box. */
export function monoCharsPerLine(frame: Frame, fontSize: number, gutter = 0) {
  const inner = contentBox(frame).width - 2 * space(frame, 4) - gutter;
  return Math.floor(inner / (fontSize * ADVANCE.mono));
}

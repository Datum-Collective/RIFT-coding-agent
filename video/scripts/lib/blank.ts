import { spawnSync } from "node:child_process";

export type Blank = { start: number; end: number };

/**
 * Stretches of near-black video. Every theme's darkest colour sits well above ffmpeg's pixel
 * threshold, so a hit means nothing was drawn, not that the design is dark.
 */
export function blankStretches(file: string): Blank[] {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-i",
      file,
      "-vf",
      "blackdetect=d=0.3:pix_th=0.02",
      "-an",
      "-f",
      "null",
      "-",
    ],
    {
      encoding: "utf8",
    },
  );
  return parseBlackFrames(result.stderr ?? "");
}

export function parseBlackFrames(log: string): Blank[] {
  return [...log.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)].map(
    (match) => ({
      start: Number(match[1]),
      end: Number(match[2]),
    }),
  );
}

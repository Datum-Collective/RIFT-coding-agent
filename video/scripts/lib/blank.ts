import { spawnSync } from "node:child_process";

export type Blank = { start: number; end: number };

/**
 * Stretches of near-black video. A frame counts only when 99.8% of its pixels are black: a spec
 * can set a pure #000 background, where one headline alone lights ~2%, so anything looser flags
 * sparse, deliberate frames. A hit still means nothing was drawn. Uses the system
 * ffmpeg, else the one bundled with Remotion; throws if neither runs, so the check can never be
 * skipped silently.
 */
export function blankStretches(file: string): Blank[] {
  const args = [
    "-hide_banner",
    "-i",
    file,
    "-vf",
    "blackdetect=d=0.3:pix_th=0.02:pic_th=0.998",
    "-an",
    "-f",
    "null",
    "-",
  ];
  const system = spawnSync("ffmpeg", args, { encoding: "utf8" });
  const result =
    system.status === 0
      ? system
      : spawnSync("npx", ["remotion", "ffmpeg", ...args], { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(
      `blank-frame check could not run ffmpeg on ${file}: ${result.stderr || result.error}`,
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

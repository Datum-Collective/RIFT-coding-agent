import path from "node:path";
import { bundle } from "@remotion/bundler";
import { findVideo, templates, videos } from "../../src/data/videoSpecs";
import type { VideoSpec } from "../../src/spec/schema";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const PUBLIC_DIR = path.join(ROOT, "public");

/** A video by id, or a template by composition name (ProductLaunch, ExplainerVideo, ShortVideo). */
export function loadVideo(id: string): VideoSpec {
  const spec = findVideo(id) ?? (templates as Record<string, VideoSpec>)[id];
  if (spec) return spec;
  const known = [
    ...videos.map((video) => video.id),
    ...Object.keys(templates),
  ].join(", ");
  throw new Error(`No video "${id}". Known: ${known}`);
}

export async function bundleProject() {
  return bundle({
    entryPoint: path.join(ROOT, "src/index.ts"),
    onProgress: () => undefined,
  });
}

export const color = {
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  dim: (text: string) => `\x1b[2m${text}\x1b[0m`,
};

/**
 * npm run render -- <composition> [--output out/file.mp4]
 * Validate, render with fixed settings, then check the file against the spec. Exits non-zero
 * if anything is off, so a broken video never looks like a success.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { timeline } from "../src/spec/timing";
import { renderArgs } from "./lib/args";
import { blankStretches } from "./lib/blank";
import { checkOutput, probe } from "./lib/probe";
import { bundleProject, color, loadVideo, ROOT } from "./lib/project";
import { report } from "./validate";

const args = renderArgs(process.argv.slice(2));
const spec = loadVideo(args.composition);
if (!report(spec)) {
  console.log(color.red("\nFix the errors above before rendering."));
  process.exit(1);
}

const output = path.resolve(ROOT, args.output);
mkdirSync(path.dirname(output), { recursive: true });
const serveUrl = await bundleProject();
const inputProps = { spec };
const composition = await selectComposition({
  serveUrl,
  id: args.composition,
  inputProps,
});

const printed = new Set<number>();
await renderMedia({
  composition,
  serveUrl,
  inputProps,
  codec: "h264",
  outputLocation: output,
  // Fixed encode settings: the same spec renders to the same video.
  crf: 18,
  pixelFormat: "yuv420p",
  imageFormat: "jpeg",
  jpegQuality: 92,
  onProgress: ({ progress }) => {
    const step = Math.floor(progress * 10);
    if (printed.has(step)) return;
    printed.add(step);
    process.stdout.write(`\r  rendering ${step * 10}%`);
  },
});
process.stdout.write("\n");

const actual = probe(output);
const blanks = blankStretches(output).map(
  (blank) => `blank frames from ${blank.start}s to ${blank.end}s`,
);
const problems = [
  ...checkOutput(actual, {
    width: spec.format.width,
    height: spec.format.height,
    fps: spec.format.fps,
    durationInSeconds: timeline(spec).durationInFrames / spec.format.fps,
    audio: Boolean(
      spec.audio?.music || spec.audio?.voiceover || spec.audio?.effects.length,
    ),
  }),
  ...blanks,
];
if (problems.length) {
  problems.forEach((problem) => console.log(`  ${color.red("✗")} ${problem}`));
  process.exit(1);
}
console.log(
  `${color.green("✓")} ${path.relative(ROOT, output)} ${color.dim(`${actual.width}×${actual.height} · ${actual.fps}fps · ${actual.durationInSeconds.toFixed(2)}s · ${actual.codec}${actual.audio ? " + audio" : ""}`)}`,
);

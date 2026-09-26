/**
 * npm run frames -- <id>
 * Renders one still per scene, taken once the scene has settled, plus a contact sheet of all of
 * them. This is the visual check: look at every frame before rendering the video.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { renderStill, selectComposition } from "@remotion/renderer";
import { timeline } from "../src/spec/timing";
import { bundleProject, color, loadVideo, ROOT } from "./lib/project";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { at: { type: "string" } },
});
const id = positionals[0];
if (!id) throw new Error("which video? e.g. npm run frames -- rift-launch");
const spec = loadVideo(id);
const dir = path.join(ROOT, "out", "frames", spec.id);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const serveUrl = await bundleProject();
const inputProps = { spec };
const composition = await selectComposition({
  serveUrl,
  id: spec.id,
  inputProps,
});
// Where in each scene to look: after entrances finish, before the next transition starts.
const at = values.at ? Number(values.at) : 0.8;

const files: string[] = [];
for (const entry of timeline(spec).entries) {
  const frame =
    entry.from +
    Math.max(
      entry.transitionIn,
      Math.min(
        Math.round(entry.durationInFrames * at),
        entry.durationInFrames - 1,
      ),
    );
  const file = path.join(
    dir,
    `${String(entry.index + 1).padStart(2, "0")}-${entry.scene.id}.png`,
  );
  await renderStill({
    composition,
    serveUrl,
    inputProps,
    frame,
    output: file,
    imageFormat: "png",
  });
  files.push(file);
  console.log(
    `${color.green("✓")} ${path.relative(ROOT, file)} ${color.dim(`frame ${frame}`)}`,
  );
}

const columns = Math.min(
  files.length,
  spec.format.height > spec.format.width ? 6 : 3,
);
const sheet = path.join(dir, "contact-sheet.png");
const tile = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-pattern_type",
    "glob",
    "-i",
    path.join(dir, "[0-9]*.png"),
    "-vf",
    `scale=iw/3:-1,tile=${columns}x${Math.ceil(files.length / columns)}:padding=12:color=0x333333`,
    "-frames:v",
    "1",
    sheet,
  ],
  { encoding: "utf8" },
);
console.log(
  tile.status === 0
    ? `${color.green("✓")} ${path.relative(ROOT, sheet)}`
    : color.yellow(
        `contact sheet skipped (ffmpeg: ${tile.stderr.trim() || "not found"})`,
      ),
);

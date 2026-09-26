/**
 * npm run validate [-- <id>] [--deep]
 * Checks every video (or one): spec rules, referenced assets, bundled fonts. --deep also bundles
 * the project and confirms each video is registered as a composition.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { getCompositions } from "@remotion/renderer";
import { templates, videos } from "../src/data/videoSpecs";
import type { VideoSpec } from "../src/spec/schema";
import { timeline } from "../src/spec/timing";
import { validate } from "../src/spec/validate";
import { missingAssets } from "./lib/assets";
import { bundleProject, color, loadVideo, PUBLIC_DIR } from "./lib/project";

const FONTS = [
  "Inter-400",
  "Inter-500",
  "Inter-600",
  "Inter-700",
  "Inter-800",
  "JetBrainsMono-400",
  "JetBrainsMono-500",
  "JetBrainsMono-700",
];

export function report(spec: VideoSpec) {
  const result = validate(spec);
  const missing = missingAssets(spec, PUBLIC_DIR).map((ref) => ({
    path: ref.path,
    message: `missing file public/${ref.src}`,
  }));
  const errors = [...result.errors, ...missing];
  const seconds = timeline(spec).durationInFrames / spec.format.fps;
  const status = errors.length
    ? color.red("✗")
    : result.warnings.length
      ? color.yellow("!")
      : color.green("✓");
  console.log(
    `${status} ${spec.id} ${color.dim(`${spec.format.width}×${spec.format.height} · ${spec.format.fps}fps · ${seconds.toFixed(2)}s · ${spec.scenes.length} scenes`)}`,
  );
  for (const issue of errors)
    console.log(`    ${color.red("error")} ${issue.path}: ${issue.message}`);
  for (const issue of result.warnings)
    console.log(`    ${color.yellow("warn")}  ${issue.path}: ${issue.message}`);
  return errors.length === 0;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { deep: { type: "boolean" } },
  });
  const specs = positionals.length ? positionals.map(loadVideo) : videos;
  const fontsOk = FONTS.every((font) =>
    existsSync(path.join(PUBLIC_DIR, "fonts", `${font}.woff2`)),
  );
  if (!fontsOk)
    console.log(
      `${color.red("✗")} fonts missing from public/fonts; renders would fall back to system fonts`,
    );
  const specsOk = specs.map(report).every(Boolean);

  let registered = true;
  if (values.deep) {
    const compositions = await getCompositions(await bundleProject());
    const ids = new Set(compositions.map((composition) => composition.id));
    const expected = [
      ...specs.map((spec) => spec.id),
      ...Object.keys(templates),
    ];
    const absent = expected.filter((id) => !ids.has(id));
    registered = absent.length === 0;
    console.log(
      registered
        ? `${color.green("✓")} ${expected.length} compositions registered`
        : `${color.red("✗")} not registered: ${absent.join(", ")}`,
    );
  }
  if (!fontsOk || !specsOk || !registered) process.exit(1);
}

// Paths with spaces are percent-encoded in URLs, so compare real file URLs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();

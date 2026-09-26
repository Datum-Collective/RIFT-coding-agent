/**
 * npm run new -- <id> [--template ProductLaunch|ExplainerVideo|ShortVideo] [--format vertical|horizontal|square] [--title "..."]
 * Starts a video from a template's spec and registers it. Then edit the scenes.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { templates } from "../src/data/videoSpecs";
import { FORMATS, VideoSpec } from "../src/spec/schema";
import { registerInIndex, specSource } from "./lib/codegen";
import { color, ROOT } from "./lib/project";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    template: { type: "string", default: "ProductLaunch" },
    format: { type: "string" },
    title: { type: "string" },
  },
});
const id = positionals[0];
if (!id || !/^[a-z0-9-]+$/.test(id))
  throw new Error("give a kebab-case id, e.g. npm run new -- acme-launch");
const template = (templates as Record<string, VideoSpec>)[values.template];
if (!template)
  throw new Error(
    `unknown template "${values.template}"; use ${Object.keys(templates).join(", ")}`,
  );
const format = values.format
  ? FORMATS[values.format as keyof typeof FORMATS]
  : template.format;
if (!format)
  throw new Error(
    `unknown format "${values.format}"; use ${Object.keys(FORMATS).join(", ")}`,
  );

const dir = path.join(ROOT, "src/data/videoSpecs");
const file = path.join(dir, `${id}.ts`);
if (existsSync(file))
  throw new Error(`${path.relative(ROOT, file)} already exists`);

const name = id.replace(/-([a-z0-9])/g, (_, char: string) =>
  char.toUpperCase(),
);
const spec = VideoSpec.parse({
  ...template,
  id,
  title: values.title ?? id,
  brief: undefined,
  format,
});
writeFileSync(file, specSource(name, spec));
const index = path.join(dir, "index.ts");
writeFileSync(index, registerInIndex(readFileSync(index, "utf8"), id, name));
console.log(
  `${color.green("✓")} src/data/videoSpecs/${id}.ts from ${values.template}, registered as "${id}"`,
);
console.log(
  color.dim(
    `  next: edit its scenes, then npm run validate -- ${id} && npm run frames -- ${id}`,
  ),
);

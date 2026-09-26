import type { VideoSpec } from "../../src/spec/schema";

/** A spec file for `npm run new`: plain data, so it reads and diffs like any other spec. */
export function specSource(name: string, spec: VideoSpec) {
  return [
    'import { defineVideo } from "../../spec/schema";',
    "",
    "/**",
    ` * ${spec.title}`,
    " * Storyboard: replace with the scene-by-scene plan (time, purpose, visual, text, transition).",
    " */",
    `export const ${name} = defineVideo(${JSON.stringify(spec, null, 2)});`,
    "",
  ].join("\n");
}

const IMPORTS = "// @new-video-imports";
const ENTRIES = "  // @new-video-entries";

/** Adds a video to src/data/videoSpecs/index.ts at the markers. */
export function registerInIndex(source: string, file: string, name: string) {
  if (!source.includes(IMPORTS) || !source.includes(ENTRIES))
    throw new Error(
      "src/data/videoSpecs/index.ts is missing the @new-video markers",
    );
  return source
    .replace(IMPORTS, `import { ${name} } from "./${file}";\n${IMPORTS}`)
    .replace(ENTRIES, `  ${name},\n${ENTRIES}`);
}

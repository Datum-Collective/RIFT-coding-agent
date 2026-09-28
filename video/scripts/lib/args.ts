import { parseArgs } from "node:util";

/** What a bare `npm run render` renders. */
export const DEFAULT_COMPOSITION = "ProductLaunch";

/** `npm run render -- <composition> [--output file]`, or `--composition <id>`. */
export function renderArgs(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { composition: { type: "string" }, output: { type: "string" } },
  });
  const composition =
    values.composition ?? positionals[0] ?? DEFAULT_COMPOSITION;
  return { composition, output: values.output ?? `out/${composition}.mp4` };
}

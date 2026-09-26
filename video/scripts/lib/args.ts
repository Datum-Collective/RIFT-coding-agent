import { parseArgs } from "node:util";

/** `npm run render -- <composition> [--output file]`, or `--composition <id>`. */
export function renderArgs(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { composition: { type: "string" }, output: { type: "string" } },
  });
  const composition = values.composition ?? positionals[0];
  if (!composition)
    throw new Error("which composition? e.g. npm run render -- rift-launch");
  return { composition, output: values.output ?? `out/${composition}.mp4` };
}

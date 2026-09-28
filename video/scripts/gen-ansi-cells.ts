/**
 * Regenerates src/data/ansiArt/riftCig.ts from public/assets/rift-cig.html.
 * Run after editing the art: `npx tsx scripts/gen-ansi-cells.ts`
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ansiCols, parseAnsiHtml } from "./lib/ansi";
import { ROOT } from "./lib/project";

const html = readFileSync(
  path.join(ROOT, "public/assets/rift-cig.html"),
  "utf8",
);
const rows = parseAnsiHtml(html);
const cols = ansiCols(rows);
const palette = [...new Set(rows.flat().flatMap((cell) => [cell.fg, cell.bg ?? "none"]))];
console.log(`rift-cig: ${rows.length} rows x ${cols} cols, palette: ${palette.join(" ")}`);

const out = [
  `import type { AnsiCell } from "../../../scripts/lib/ansi";`,
  "",
  "/** Character cells parsed from public/assets/rift-cig.html. Regenerate, don't edit. */",
  `export const RIFT_CIG_ROWS = ${rows.length};`,
  `export const RIFT_CIG_COLS = ${cols};`,
  "export const riftCig: AnsiCell[][] = " +
    JSON.stringify(rows, null, 2) +
    ";",
  "",
].join("\n");
writeFileSync(
  path.join(ROOT, "src/data/ansiArt/riftCig.ts"),
  out,
);
console.log("wrote src/data/ansiArt/riftCig.ts");

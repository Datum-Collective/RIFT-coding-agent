/**
 * ANSI span art: parses `<span style="color/bg">…</span>` rows (as saved in
 * public/assets/*.html) into per-character cells with their own foreground
 * and background colour. Pure, so both the codegen step and tests use it.
 */
export type AnsiCell = { ch: string; fg: string; bg?: string };

const DEFAULT_FG = "#FFFFFF";

function styleColor(style: string, prop: "color" | "background-color") {
  const match = new RegExp(`${prop}:\\s*(#[0-9a-fA-F]{6})`).exec(style);
  return match ? match[1]?.toUpperCase() : undefined;
}

function decodeEntities(text: string) {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&nbsp;", " ");
}

/** Cells for one line: spans in order, unstyled text keeps the default fg. */
export function parseAnsiLine(line: string): AnsiCell[] {
  const cells: AnsiCell[] = [];
  const token =
    /<span\s+style="([^"]*)">([\s\S]*?)<\/span>|([^<]+)/g;
  for (const match of line.matchAll(token)) {
    const style = match[1];
    const body = style !== undefined ? (match[2] ?? "") : (match[3] ?? "");
    const fg = style ? (styleColor(style, "color") ?? DEFAULT_FG) : DEFAULT_FG;
    const bg = style ? styleColor(style, "background-color") : undefined;
    for (const ch of decodeEntities(body)) {
      if (ch === "\n" || ch === "\r") continue;
      cells.push(bg ? { ch, fg, bg } : { ch, fg });
    }
  }
  return cells;
}

/** Full art block: the lines inside the outer <pre>, each a row of cells. */
export function parseAnsiHtml(html: string): AnsiCell[][] {
  const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/.exec(html)?.[1] ?? html;
  return pre.split("\n").map(parseAnsiLine);
}

/** Widest row; the grid is padded to this so every row has the same columns. */
export function ansiCols(rows: AnsiCell[][]) {
  return rows.reduce((max, row) => Math.max(max, row.length), 0);
}

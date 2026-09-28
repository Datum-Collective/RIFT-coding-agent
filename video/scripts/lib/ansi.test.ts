import assert from "node:assert/strict";
import { test } from "node:test";
import { ansiCols, parseAnsiHtml, parseAnsiLine } from "./ansi";
import { defineVideo } from "../../src/spec/schema";
import { assetRefs, validate } from "../../src/spec/validate";

test("spans become one cell per character with their own colours", () => {
  const cells = parseAnsiLine(
    '<span style="color:#0000AA">░░</span><span style="color:#FFFFFF;background-color:#AAAAAA">▄▌</span> ',
  );
  assert.deepEqual(cells, [
    { ch: "░", fg: "#0000AA" },
    { ch: "░", fg: "#0000AA" },
    { ch: "▄", fg: "#FFFFFF", bg: "#AAAAAA" },
    { ch: "▌", fg: "#FFFFFF", bg: "#AAAAAA" },
    { ch: " ", fg: "#FFFFFF" },
  ]);
});

test("a pre block parses to one row per line", () => {
  const rows = parseAnsiHtml("<pre>a\nb</pre>");
  assert.equal(rows.length, 2);
  assert.equal(ansiCols(rows), 1);
});

test("ansi scenes validate overlays and expose their art file", () => {
  const spec = defineVideo({
    id: "v",
    title: "v",
    format: { width: 1080, height: 1920, fps: 30 },
    style: {},
    scenes: [
      {
        id: "a",
        type: "ansi",
        durationInSeconds: 3,
        src: "assets/rift-cig.html",
        beat: "bot",
        bubble: "all tests pass, trust me",
        terminal: "rift verify",
      },
    ],
  });
  assert.deepEqual(validate(spec), { errors: [], warnings: [] });
  assert.deepEqual(assetRefs(spec), [
    { src: "assets/rift-cig.html", path: "scenes[0].src", kind: "image" },
  ]);
});

test("an overlong bubble is an error, not a silent clip", () => {
  const spec = defineVideo({
    id: "v",
    title: "v",
    format: { width: 1080, height: 1920, fps: 30 },
    style: {},
    scenes: [
      {
        id: "a",
        type: "ansi",
        durationInSeconds: 5,
        src: "assets/rift-cig.html",
        bubble: "x".repeat(41),
      },
    ],
  });
  assert.match(
    validate(spec).errors.map((issue) => issue.message).join("\n"),
    /bubble/,
  );
});

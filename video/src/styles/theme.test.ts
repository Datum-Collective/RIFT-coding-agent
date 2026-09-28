import assert from "node:assert/strict";
import { test } from "node:test";
import { defineVideo } from "../spec/schema";
import { themeFor } from "./theme";

const spec = (style: Record<string, unknown>) =>
  defineVideo({
    id: "t",
    title: "t",
    format: { width: 1080, height: 1920 },
    style,
    scenes: [{ id: "a", type: "title", headline: "A", durationInSeconds: 2 }],
  });

test("a brand palette overrides the theme's colours and nothing else", () => {
  const theme = themeFor(
    spec({
      theme: "terminal",
      palette: { background: "#101820", accent: "#FEE715" },
    }),
  );
  assert.equal(theme.palette.background, "#101820");
  assert.equal(theme.palette.accent, "#FEE715");
  assert.equal(theme.palette.accentSoft, "rgba(254, 231, 21, 0.14)");
  assert.equal(
    theme.palette.text,
    themeFor(spec({ theme: "terminal" })).palette.text,
  );
});

test("the accent shorthand still works and palette wins over it", () => {
  assert.equal(themeFor(spec({ accent: "#FF0000" })).palette.accent, "#FF0000");
  assert.equal(
    themeFor(spec({ accent: "#FF0000", palette: { accent: "#00FF00" } }))
      .palette.accent,
    "#00FF00",
  );
});

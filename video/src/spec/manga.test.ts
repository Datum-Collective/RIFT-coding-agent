import assert from "node:assert/strict";
import { test } from "node:test";
import { defineVideo, type VideoSpecInput } from "./schema";
import { validate } from "./validate";

type MangaPanels = Extract<
  VideoSpecInput["scenes"][number],
  { type?: "manga" }
>["panels"];

const mangaScene = (panels: MangaPanels) => ({
  id: "m",
  type: "manga" as const,
  durationInSeconds: 5,
  camera: "push" as const,
  panels,
});

test("a manga scene reads its balloons and labels for timing", () => {
  const spec = defineVideo({
    id: "v",
    title: "v",
    format: { width: 1080, height: 1080, fps: 30 },
    style: {},
    scenes: [
      mangaScene([
        {
          art: "standup",
          label: "morning standup",
          balloons: [{ text: "Just fix the button colour.", tail: "down" }],
        },
      ]),
    ],
  });
  assert.deepEqual(validate(spec), { errors: [], warnings: [] });
});

test("a fourth panel is rejected", () => {
  assert.throws(() =>
    defineVideo({
      id: "v",
      title: "v",
      format: { width: 1080, height: 1080, fps: 30 },
      style: {},
      scenes: [
        mangaScene([
          { art: "rewire" },
          { art: "rename" },
          { art: "pillar" },
          { art: "ship" },
        ]),
      ],
    }),
  );
});

test("an overlong balloon is rejected at the schema", () => {
  assert.throws(() =>
    defineVideo({
      id: "v",
      title: "v",
      format: { width: 1080, height: 1080, fps: 30 },
      style: {},
      scenes: [
        mangaScene([
          { art: "verdict", balloons: [{ text: "x".repeat(49), tail: "up" }] },
        ]),
      ],
    }),
  );
});

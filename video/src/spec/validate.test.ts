import assert from "node:assert/strict";
import { test } from "node:test";
import { defineVideo, type VideoSpecInput } from "./schema";
import { assetRefs, validate } from "./validate";

const make = (
  patch: Partial<VideoSpecInput> = {},
  scenes?: VideoSpecInput["scenes"],
) =>
  defineVideo({
    id: "v",
    title: "v",
    format: { width: 1080, height: 1920, fps: 30 },
    style: {},
    scenes: scenes ?? [
      { id: "a", type: "title", headline: "Hello", durationInSeconds: 3 },
    ],
    ...patch,
  });

const messages = (list: { path: string; message: string }[]) =>
  list.map((issue) => `${issue.path}: ${issue.message}`);

test("a clean spec has no issues", () => {
  const result = validate(make());
  assert.deepEqual(result, { errors: [], warnings: [] });
});

test("odd dimensions and silly frame rates are errors", () => {
  const result = validate(
    make({ format: { width: 1081, height: 1920, fps: 240 } }),
  );
  assert.match(messages(result.errors).join("\n"), /format.width: .*even/);
  assert.match(messages(result.errors).join("\n"), /format.fps/);
});

test("duplicate scene ids are errors", () => {
  const result = validate(
    make({}, [
      { id: "a", type: "title", headline: "A", durationInSeconds: 2 },
      { id: "a", type: "title", headline: "B", durationInSeconds: 2 },
    ]),
  );
  assert.match(messages(result.errors).join("\n"), /scenes\[1\].id: duplicate/);
});

test("a transition longer than a neighbouring scene is an error", () => {
  const result = validate(
    make({}, [
      { id: "a", type: "title", headline: "A", durationInSeconds: 0.8 },
      {
        id: "b",
        type: "title",
        headline: "B",
        durationInSeconds: 3,
        transition: { type: "fade", durationInSeconds: 1 },
      },
    ]),
  );
  assert.match(
    messages(result.errors).join("\n"),
    /scenes\[1\].transition: .*longer than/,
  );
});

test("missing the target duration is an error that says by how much", () => {
  const result = validate(make({ targetDurationInSeconds: 30 }));
  assert.match(
    messages(result.errors).join("\n"),
    /targetDurationInSeconds: scenes add up to 3s, brief asks for 30s/,
  );
});

test("a headline too long to fit the frame is an error", () => {
  const long =
    "This headline keeps going and going with far too many words to ever fit on a phone screen at headline size";
  const result = validate(
    make({}, [
      { id: "a", type: "title", headline: long, durationInSeconds: 6 },
    ]),
  );
  assert.match(
    messages(result.errors).join("\n"),
    /scenes\[0\].headline: wraps to \d+ lines/,
  );
});

test("a scene too short to read and narration too fast to caption are warnings", () => {
  const result = validate(
    make({ captions: { enabled: true } }, [
      {
        id: "a",
        type: "list",
        heading: "Everything the agent must understand before it ships",
        items: [
          { label: "Verification history" },
          { label: "System state" },
          { label: "Test evidence" },
        ],
        durationInSeconds: 1.5,
        narration:
          "This narration has far too many words to be read comfortably in such a short scene at all.",
      },
    ]),
  );
  const text = messages(result.warnings).join("\n");
  assert.match(text, /scenes\[0\]: on screen for 1.5s, needs about \d/);
  assert.match(text, /scenes\[0\].narration: \d+\.\d words\/s/);
  assert.equal(result.errors.length, 0);
});

test("terminal and code lines too long for their window are errors", () => {
  const result = validate(
    make({}, [
      {
        id: "t",
        type: "terminal",
        lines: [
          {
            kind: "error",
            text: "3 failing · src/server/middleware/rate-limit.test.ts",
          },
        ],
        durationInSeconds: 5,
      },
      {
        id: "c",
        type: "code",
        code: "const x = 1;\n" + "x".repeat(80),
        durationInSeconds: 5,
      },
    ]),
  );
  const text = messages(result.errors).join("\n");
  assert.match(
    text,
    /scenes\[0\].lines\[0\]: \d+ characters, but \d+ fit on a terminal line/,
  );
  assert.match(text, /scenes\[1\].code: line 2 has 80 characters/);
});

test("scene data that cannot be drawn is an error", () => {
  const result = validate(
    make({}, [
      {
        id: "h",
        type: "heatmap",
        matrices: [
          { rows: ["a", "b"], cols: ["x", "y"], values: [[0.1, 0.2]] },
        ],
        durationInSeconds: 4,
      },
      {
        id: "f",
        type: "flow",
        steps: ["A", "B"],
        loop: { from: 1, to: 5 },
        durationInSeconds: 4,
      },
      {
        id: "c",
        type: "chart",
        data: [{ label: "x", value: 1 }],
        highlight: "nope",
        durationInSeconds: 4,
      },
    ]),
  );
  const text = messages(result.errors).join("\n");
  assert.match(text, /scenes\[0\].matrices\[0\].values: expected 2 rows of 2/);
  assert.match(text, /scenes\[1\].loop: step 5 does not exist/);
  assert.match(text, /scenes\[2\].highlight: no bar labelled "nope"/);
});

test("timed captions must end inside the video", () => {
  const result = validate(
    make({
      captions: {
        enabled: true,
        source: "items",
        items: [
          {
            text: "late",
            startMs: 2500,
            endMs: 9000,
            timestampMs: null,
            confidence: null,
          },
        ],
      },
    }),
  );
  assert.match(
    messages(result.errors).join("\n"),
    /captions.items\[0\]: ends at 9s, after the video ends at 3s/,
  );
});

test("asset references are collected from every scene and audio track", () => {
  const spec = make(
    {
      audio: {
        music: { src: "audio/bed.mp3" },
        effects: [{ src: "audio/hit.wav" }],
      },
    },
    [
      {
        id: "b",
        type: "browser",
        url: "rift.dev",
        image: "images/shot.png",
        durationInSeconds: 3,
      },
      {
        id: "c",
        type: "cta",
        headline: "Try it",
        logo: "images/logo.svg",
        durationInSeconds: 3,
      },
    ],
  );
  assert.deepEqual(
    assetRefs(spec)
      .map((ref) => ref.src)
      .sort(),
    ["audio/bed.mp3", "audio/hit.wav", "images/logo.svg", "images/shot.png"],
  );
});

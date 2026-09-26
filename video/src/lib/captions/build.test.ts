import assert from "node:assert/strict";
import { test } from "node:test";
import { defineVideo, type VideoSpecInput } from "../../spec/schema";
import { buildCaptions, parseEmphasis, splitPhrases } from "./build";

const spec = (
  extra: Partial<VideoSpecInput>,
  scenes: VideoSpecInput["scenes"],
) =>
  defineVideo({
    id: "c",
    title: "c",
    format: { width: 1080, height: 1920, fps: 30 },
    style: {},
    scenes,
    ...extra,
  });

test("phrases break at punctuation and never run past five words", () => {
  assert.deepEqual(
    splitPhrases("Coding agents write code. RIFT operates engineering."),
    ["Coding agents write code.", "RIFT operates engineering."],
  );
  assert.deepEqual(
    splitPhrases("one two three four five six seven eight nine"),
    ["one two three four five", "six seven eight nine"],
  );
  assert.deepEqual(splitPhrases("It plans, builds, and verifies"), [
    "It plans,",
    "builds, and verifies",
  ]);
  // A lone word left by the cap joins the phrase before it instead of flashing on its own.
  assert.deepEqual(
    splitPhrases("The agent says the tests pass. Nobody ran them."),
    ["The agent says the tests pass.", "Nobody ran them."],
  );
});

test("emphasis markers can span words and are stripped from the text", () => {
  assert.deepEqual(parseEmphasis("Meet the *Engineering Graph* today"), [
    { text: "Meet the ", emphasis: false },
    { text: "Engineering Graph", emphasis: true },
    { text: " today", emphasis: false },
  ]);
  assert.deepEqual(parseEmphasis("plain"), [
    { text: "plain", emphasis: false },
  ]);
});

test("narration is timed inside its own scene, proportional to words, in order", () => {
  const captions = buildCaptions(
    spec({ captions: { enabled: true } }, [
      {
        id: "a",
        type: "title",
        headline: "A",
        durationInSeconds: 4,
        narration: "Short one. And a longer phrase here.",
      },
      { id: "b", type: "title", headline: "B", durationInSeconds: 2 },
      {
        id: "c",
        type: "title",
        headline: "C",
        durationInSeconds: 3,
        narration: "Last words.",
      },
    ]),
  );
  assert.deepEqual(
    captions.map((caption) => caption.text),
    ["Short one.", "And a longer phrase here.", "Last words."],
  );
  const [first, second, third] = captions;
  assert.ok(first && second && third);
  assert.ok(first.startMs >= 0 && first.endMs <= second.startMs);
  assert.ok(second.endMs <= 4000, "stays inside scene a");
  assert.ok(
    second.endMs - second.startMs > first.endMs - first.startMs,
    "longer phrase gets longer",
  );
  assert.ok(
    third.startMs >= 6000 && third.endMs <= 9000,
    "stays inside scene c",
  );
  assert.equal(first.timestampMs, first.startMs);
});

test("a transition's overlap is not narrated over", () => {
  const captions = buildCaptions(
    spec({ captions: { enabled: true } }, [
      { id: "a", type: "title", headline: "A", durationInSeconds: 2 },
      {
        id: "b",
        type: "title",
        headline: "B",
        durationInSeconds: 2,
        narration: "Hello there.",
        transition: { type: "fade", durationInSeconds: 0.5 },
      },
    ]),
  );
  assert.ok(
    (captions[0]?.startMs ?? 0) >= 2000,
    "starts after the fade into b finishes",
  );
});

test("timed items pass straight through, and disabled captions produce none", () => {
  const items = [
    { text: "hi", startMs: 0, endMs: 500, timestampMs: 250, confidence: 0.9 },
  ];
  const scenes: VideoSpecInput["scenes"] = [
    {
      id: "a",
      type: "title",
      headline: "A",
      durationInSeconds: 2,
      narration: "x",
    },
  ];
  assert.deepEqual(
    buildCaptions(
      spec({ captions: { enabled: true, source: "items", items } }, scenes),
    ),
    items,
  );
  assert.deepEqual(
    buildCaptions(spec({ captions: { enabled: false } }, scenes)),
    [],
  );
  assert.deepEqual(buildCaptions(spec({}, scenes)), []);
});

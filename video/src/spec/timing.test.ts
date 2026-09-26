import assert from "node:assert/strict";
import { test } from "node:test";
import { defineVideo, type VideoSpecInput } from "./schema";
import { sceneAt, timeline, toFrames } from "./timing";

const base = (scenes: VideoSpecInput["scenes"], fps = 30) =>
  defineVideo({
    id: "t",
    title: "t",
    format: { width: 1080, height: 1920, fps },
    style: {},
    scenes,
  });

test("seconds become whole frames", () => {
  assert.equal(toFrames(1, 30), 30);
  assert.equal(toFrames(0.5, 30), 15);
  assert.equal(toFrames(1.01, 30), 30);
  assert.equal(toFrames(2, 24), 48);
});

test("scenes without transitions play back to back", () => {
  const result = timeline(
    base([
      { id: "a", type: "title", headline: "A", durationInSeconds: 2 },
      { id: "b", type: "title", headline: "B", durationInSeconds: 3 },
    ]),
  );
  assert.deepEqual(
    result.entries.map((entry) => [
      entry.scene.id,
      entry.from,
      entry.durationInFrames,
      entry.transitionIn,
    ]),
    [
      ["a", 0, 60, 0],
      ["b", 60, 90, 0],
    ],
  );
  assert.equal(result.durationInFrames, 150);
});

test("a transition overlaps the previous scene and shortens the video", () => {
  const result = timeline(
    base([
      { id: "a", type: "title", headline: "A", durationInSeconds: 2 },
      {
        id: "b",
        type: "title",
        headline: "B",
        durationInSeconds: 3,
        transition: { type: "fade", durationInSeconds: 0.5 },
      },
      {
        id: "c",
        type: "title",
        headline: "C",
        durationInSeconds: 1,
        transition: { type: "none" },
      },
    ]),
  );
  assert.deepEqual(
    result.entries.map((entry) => [
      entry.scene.id,
      entry.from,
      entry.transitionIn,
    ]),
    [
      ["a", 0, 0],
      ["b", 45, 15],
      ["c", 135, 0],
    ],
  );
  assert.equal(result.durationInFrames, 60 + 90 + 30 - 15);
});

test("a transition into the first scene is ignored", () => {
  const result = timeline(
    base([
      {
        id: "a",
        type: "title",
        headline: "A",
        durationInSeconds: 2,
        transition: { type: "fade" },
      },
    ]),
  );
  assert.equal(result.entries[0]?.transitionIn, 0);
  assert.equal(result.durationInFrames, 60);
});

test("sceneAt finds the scene on screen at a frame, preferring the incoming one during a transition", () => {
  const spec = base([
    { id: "a", type: "title", headline: "A", durationInSeconds: 2 },
    {
      id: "b",
      type: "title",
      headline: "B",
      durationInSeconds: 2,
      transition: { type: "fade", durationInSeconds: 0.5 },
    },
  ]);
  assert.equal(sceneAt(spec, 0)?.scene.id, "a");
  assert.equal(sceneAt(spec, 44)?.scene.id, "a");
  assert.equal(sceneAt(spec, 45)?.scene.id, "b");
  assert.equal(sceneAt(spec, 104)?.scene.id, "b");
  assert.equal(sceneAt(spec, 105), undefined);
});

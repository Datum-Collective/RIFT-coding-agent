import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { defineVideo } from "../../src/spec/schema";
import { renderArgs } from "./args";
import { missingAssets } from "./assets";
import { parseBlackFrames } from "./blank";
import { registerInIndex, specSource } from "./codegen";
import { checkOutput } from "./probe";

test("render args take the composition by flag or position, and default the output into out/", () => {
  assert.deepEqual(renderArgs(["--composition", "rift-launch"]), {
    composition: "rift-launch",
    output: "out/rift-launch.mp4",
  });
  assert.deepEqual(renderArgs(["rift-launch", "--output", "out/x.mp4"]), {
    composition: "rift-launch",
    output: "out/x.mp4",
  });
  assert.throws(() => renderArgs([]), /which composition/);
});

test("the rendered file is checked against what the spec promised", () => {
  const expected = {
    width: 1080,
    height: 1920,
    fps: 30,
    durationInSeconds: 30,
    audio: false,
  };
  assert.deepEqual(
    checkOutput(
      {
        width: 1080,
        height: 1920,
        fps: 30,
        durationInSeconds: 30.03,
        audio: false,
        codec: "h264",
      },
      expected,
    ),
    [],
  );
  const problems = checkOutput(
    {
      width: 1920,
      height: 1080,
      fps: 25,
      durationInSeconds: 12,
      audio: false,
      codec: "hevc",
    },
    { ...expected, audio: true },
  );
  assert.deepEqual(problems, [
    "resolution is 1920×1080, expected 1080×1920",
    "frame rate is 25, expected 30",
    "duration is 12s, expected 30s",
    "no audio stream, but the spec has audio",
    "codec is hevc, expected h264",
  ]);
});

test("blank stretches are read out of ffmpeg's blackdetect log", () => {
  const log = [
    "[blackdetect @ 0x1] black_start:0 black_end:0.8 black_duration:0.8",
    "frame= 900 fps=0.0",
    "[blackdetect @ 0x1] black_start:12.5 black_end:14 black_duration:1.5",
  ].join("\n");
  assert.deepEqual(parseBlackFrames(log), [
    { start: 0, end: 0.8 },
    { start: 12.5, end: 14 },
  ]);
});

test("assets the spec needs but public/ lacks are reported with where they are used", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "assets-"));
  mkdirSync(path.join(dir, "images"));
  writeFileSync(path.join(dir, "images", "logo.svg"), "<svg/>");
  const spec = defineVideo({
    id: "a",
    title: "a",
    format: { width: 1080, height: 1920 },
    style: {},
    scenes: [
      {
        id: "c",
        type: "cta",
        headline: "x",
        logo: "images/logo.svg",
        durationInSeconds: 2,
      },
      {
        id: "b",
        type: "browser",
        url: "x",
        image: "images/shot.png",
        durationInSeconds: 2,
      },
    ],
  });
  assert.deepEqual(missingAssets(spec, dir), [
    { src: "images/shot.png", path: "scenes[1].image", kind: "image" },
  ]);
});

test("a new video is written as a typed spec and registered between the markers", () => {
  const spec = defineVideo({
    id: "my-launch",
    title: "My launch",
    format: { width: 1080, height: 1920, fps: 30 },
    style: {},
    scenes: [{ id: "a", type: "title", headline: "Hi", durationInSeconds: 3 }],
  });
  const source = specSource("myLaunch", spec);
  assert.match(source, /export const myLaunch = defineVideo\(/);
  assert.match(source, /"id": "my-launch"/);

  const index = [
    "import x from './x';",
    "// @new-video-imports",
    "",
    "export const videos = [",
    "  x,",
    "  // @new-video-entries",
    "];",
  ].join("\n");
  const updated = registerInIndex(index, "my-launch", "myLaunch");
  assert.match(
    updated,
    /import \{ myLaunch \} from "\.\/my-launch";\n\/\/ @new-video-imports/,
  );
  assert.match(updated, / {2}myLaunch,\n {2}\/\/ @new-video-entries/);
  assert.throws(() => registerInIndex("no markers", "a", "a"), /markers/);
});

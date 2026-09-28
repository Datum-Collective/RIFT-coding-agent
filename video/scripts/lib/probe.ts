import { spawnSync } from "node:child_process";

export type Probe = {
  width: number;
  height: number;
  fps: number;
  durationInSeconds: number;
  audio: boolean;
  codec: string;
};
export type Expected = {
  width: number;
  height: number;
  fps: number;
  durationInSeconds: number;
  audio: boolean;
};

/** Reads a rendered file with ffprobe: the system one, else the copy bundled with Remotion. */
export function probe(file: string): Probe {
  const args = [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    file,
  ];
  const system = spawnSync("ffprobe", args, { encoding: "utf8" });
  const result =
    system.status === 0
      ? system
      : spawnSync("npx", ["remotion", "ffprobe", ...args], {
          encoding: "utf8",
        });
  if (result.status !== 0)
    throw new Error(`ffprobe could not read ${file}: ${result.stderr}`);
  const data = JSON.parse(result.stdout) as {
    streams: {
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
    }[];
    format: { duration: string };
  };
  const video = data.streams.find((stream) => stream.codec_type === "video");
  if (!video) throw new Error(`${file} has no video stream`);
  const [num, den] = (video.r_frame_rate ?? "0/1").split("/").map(Number);
  return {
    width: video.width ?? 0,
    height: video.height ?? 0,
    fps: Math.round(((num ?? 0) / (den || 1)) * 100) / 100,
    durationInSeconds: Number(data.format.duration),
    audio: data.streams.some((stream) => stream.codec_type === "audio"),
    codec: video.codec_name,
  };
}

/** What differs between the file and what the spec promised. Empty means the render is right. */
export function checkOutput(actual: Probe, expected: Expected) {
  const problems: string[] = [];
  if (actual.width !== expected.width || actual.height !== expected.height)
    problems.push(
      `resolution is ${actual.width}×${actual.height}, expected ${expected.width}×${expected.height}`,
    );
  if (Math.abs(actual.fps - expected.fps) > 0.01)
    problems.push(`frame rate is ${actual.fps}, expected ${expected.fps}`);
  // One frame of container rounding is normal.
  if (
    Math.abs(actual.durationInSeconds - expected.durationInSeconds) >
    1 / expected.fps + 0.05
  )
    problems.push(
      `duration is ${actual.durationInSeconds}s, expected ${expected.durationInSeconds}s`,
    );
  if (expected.audio && !actual.audio)
    problems.push("no audio stream, but the spec has audio");
  if (actual.codec !== "h264")
    problems.push(`codec is ${actual.codec}, expected h264`);
  return problems;
}

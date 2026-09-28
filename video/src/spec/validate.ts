/**
 * Catches what would make a render wrong or unwatchable before anything renders. Errors block
 * rendering; warnings are worth a look but can be right on purpose. Pure: file checks live in
 * scripts/lib/assets.ts because the browser bundle cannot touch the disk.
 */
import {
  codeCharsPerLine,
  contentBox,
  estimateLines,
  monoCharsPerLine,
  space,
  terminalFontSize,
  typeSize,
  versusSideWidth,
  type Frame,
} from "../styles/scale";
import type { Scene, VideoSpec } from "./schema";
import { timeline } from "./timing";

export type Issue = { path: string; message: string };
export type Validation = { errors: Issue[]; warnings: Issue[] };

// Average silent reading is about 240 words a minute. The lead-in covers finding the text.
const READ_WORDS_PER_SECOND = 4;
const NARRATION_WORDS_PER_SECOND = 3.3;
const READ_LEAD_IN_SECONDS = 0.8;
// Two lines at caption size across a phone.
const MAX_CAPTION_CHARS = 42;
// Past this a code listing is a wall, not a point.
const MAX_CODE_LINES = 14;

export const VIDEO_FILE = /\.(mp4|webm|mov|mkv)$/i;

export function validate(spec: VideoSpec): Validation {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const frame = { width: spec.format.width, height: spec.format.height };
  const plan = timeline(spec);
  const totalSeconds = plan.durationInFrames / spec.format.fps;

  checkFormat(spec, errors);

  spec.scenes.forEach((scene, index) => {
    const path = `scenes[${index}]`;
    if (spec.scenes.findIndex((other) => other.id === scene.id) !== index)
      errors.push({
        path: `${path}.id`,
        message: `duplicate scene id "${scene.id}"`,
      });

    const previous = spec.scenes[index - 1];
    const overlap = plan.entries[index]?.transitionIn ?? 0;
    if (previous && overlap > 0) {
      const seconds = overlap / spec.format.fps;
      const shortest = Math.min(
        previous.durationInSeconds,
        scene.durationInSeconds,
      );
      if (seconds >= shortest)
        errors.push({
          path: `${path}.transition`,
          message: `${seconds}s transition is longer than the ${shortest}s scene it joins`,
        });
    }

    const words = visibleWords(scene);
    const needed = READ_LEAD_IN_SECONDS + words / READ_WORDS_PER_SECOND;
    if (words > 0 && scene.durationInSeconds < needed)
      warnings.push({
        path,
        message: `on screen for ${scene.durationInSeconds}s, needs about ${needed.toFixed(1)}s to read ${words} words`,
      });

    if (
      scene.narration &&
      spec.captions?.enabled &&
      spec.captions.source === "narration"
    ) {
      const rate = countWords(scene.narration) / scene.durationInSeconds;
      if (rate > NARRATION_WORDS_PER_SECOND)
        warnings.push({
          path: `${path}.narration`,
          message: `${rate.toFixed(1)} words/s is too fast to read as captions; aim for under ${NARRATION_WORDS_PER_SECOND}`,
        });
    }

    checkFit(scene, path, frame, errors);
    checkData(scene, path, errors);
  });

  if (
    spec.targetDurationInSeconds !== undefined &&
    Math.abs(totalSeconds - spec.targetDurationInSeconds) > 0.25
  )
    errors.push({
      path: "targetDurationInSeconds",
      message: `scenes add up to ${round(totalSeconds)}s, brief asks for ${spec.targetDurationInSeconds}s (${totalSeconds > spec.targetDurationInSeconds ? "cut" : "add"} ${round(Math.abs(totalSeconds - spec.targetDurationInSeconds))}s; transitions overlap scenes)`,
    });

  checkCaptions(spec, totalSeconds, errors, warnings);
  return { errors, warnings };
}

export type AssetRef = {
  src: string;
  path: string;
  kind: "image" | "video" | "audio";
};

/** Every file in public/ the spec depends on. */
export function assetRefs(spec: VideoSpec): AssetRef[] {
  const scenes = spec.scenes.flatMap((scene, index): AssetRef[] => {
    if (scene.type === "browser" && scene.image)
      return [
        { src: scene.image, path: `scenes[${index}].image`, kind: "image" },
      ];
    if (scene.type === "media")
      return [
        {
          src: scene.src,
          path: `scenes[${index}].src`,
          kind: VIDEO_FILE.test(scene.src) ? "video" : "image",
        },
      ];
    if (scene.type === "ansi")
      return [{ src: scene.src, path: `scenes[${index}].src`, kind: "image" }];
    if (scene.type === "versus")
      return [{ src: scene.mark, path: `scenes[${index}].mark`, kind: "image" }];
    if (scene.type === "cta" && scene.logo)
      return [
        { src: scene.logo, path: `scenes[${index}].logo`, kind: "image" },
      ];
    return [];
  });
  const audio = spec.audio;
  const tracks: AssetRef[] = [
    ...(audio?.music
      ? [{ src: audio.music.src, path: "audio.music", kind: "audio" as const }]
      : []),
    ...(audio?.voiceover
      ? [
          {
            src: audio.voiceover.src,
            path: "audio.voiceover",
            kind: "audio" as const,
          },
        ]
      : []),
    ...(audio?.effects ?? []).map((track, index) => ({
      src: track.src,
      path: `audio.effects[${index}]`,
      kind: "audio" as const,
    })),
  ];
  return [...scenes, ...tracks];
}

function checkFormat(spec: VideoSpec, errors: Issue[]) {
  const { width, height, fps } = spec.format;
  (
    [
      ["width", width],
      ["height", height],
    ] as const
  ).forEach(([name, value]) => {
    if (value % 2 !== 0)
      errors.push({
        path: `format.${name}`,
        message: `${value} must be even for H.264 MP4 output`,
      });
    if (value < 240 || value > 4096)
      errors.push({
        path: `format.${name}`,
        message: `${value} is outside 240–4096`,
      });
  });
  if (fps < 12 || fps > 120)
    errors.push({
      path: "format.fps",
      message: `${fps} fps is outside 12–120`,
    });
}

/** The copy that has to fit, at the size its scene sets it. */
function checkFit(scene: Scene, path: string, frame: Frame, errors: Issue[]) {
  const box = contentBox(frame);
  const vertical = frame.height > frame.width;
  const fit = (
    field: string,
    text: string | undefined,
    role: "display" | "headline" | "title",
    maxLines: number,
  ) => {
    if (!text) return;
    const lines = estimateLines(text, typeSize(frame, role), box.width);
    if (lines > maxLines)
      errors.push({
        path: `${path}.${field}`,
        message: `wraps to ${lines} lines at ${role} size, more than the ${maxLines} that fit; shorten it`,
      });
  };
  if (scene.type === "title")
    fit("headline", scene.headline, "display", vertical ? 6 : 3);
  if (scene.type === "statement")
    scene.lines.forEach((line, index) =>
      fit(`lines[${index}]`, line, "headline", vertical ? 3 : 2),
    );
  if (scene.type === "cta") fit("headline", scene.headline, "headline", 3);
  if (scene.type === "versus") checkVersus(scene, path, frame, errors);
  if (scene.type === "quote")
    fit("quote", scene.quote, "title", vertical ? 8 : 5);
  if ("heading" in scene && scene.heading)
    fit("heading", scene.heading, "title", vertical ? 3 : 2);
  // Mono text in a window cannot rewrap gracefully; a long line breaks mid-token.
  if (scene.type === "terminal") {
    const max = monoCharsPerLine(frame, terminalFontSize(frame)) - 2;
    scene.lines.forEach((line, index) => {
      if (line.text.length > max)
        errors.push({
          path: `${path}.lines[${index}]`,
          message: `${line.text.length} characters, but ${max} fit on a terminal line; shorten it`,
        });
    });
  }
  if (scene.type === "code") {
    const lines = scene.code.split("\n");
    const max = codeCharsPerLine(frame, lines.length);
    lines.forEach((line, index) => {
      if (line.length > max)
        errors.push({
          path: `${path}.code`,
          message: `line ${index + 1} has ${line.length} characters, but ${max} fit; wrap or shorten it`,
        });
    });
  }
  // ANSI art scales to the frame by construction; the overlays must still read.
  if (scene.type === "ansi") {
    if (scene.bubble && scene.bubble.length > 40)
      errors.push({
        path: `${path}.bubble`,
        message: `${scene.bubble.length} characters, but 40 fit in a bot bubble; shorten it`,
      });
    if (scene.terminal && scene.terminal.length > 32)
      errors.push({
        path: `${path}.terminal`,
        message: `${scene.terminal.length} characters, but 32 fit on an ANSI terminal line; shorten it`,
      });
  }
}

/**
 * A versus round sets its claim above the split at headline size (two lines at most, so the
 * split never moves between rounds) and each side's copy inside half the frame.
 */
function checkVersus(
  scene: Extract<Scene, { type: "versus" }>,
  path: string,
  frame: Frame,
  errors: Issue[],
) {
  const box = contentBox(frame);
  const close = scene.beat === "close";
  // The close sets its tagline at 0.7 of headline size; "\n" forces a break.
  const size = typeSize(frame, "headline") * (close ? 0.7 : 1);
  const maxLines = close ? 4 : 2;
  const lines = scene.headline
    .split("\n")
    .reduce((sum, line) => sum + estimateLines(line, size, box.width), 0);
  if (lines > maxLines)
    errors.push({
      path: `${path}.headline`,
      message: `wraps to ${lines} lines, more than the ${maxLines} a ${scene.beat} beat holds; shorten it`,
    });
  // Each side is half the frame less its padding; mono run lines cannot rewrap.
  const side = versusSideWidth(frame);
  if (scene.claim && estimateLines(scene.claim, typeSize(frame, "body"), side) > 1)
    errors.push({
      path: `${path}.claim`,
      message: `does not fit on one line in half the frame; shorten it`,
    });
  const monoMax = Math.floor(
    (side - 2 * space(frame, 3)) / (typeSize(frame, "mono") * 0.6),
  );
  scene.run.forEach((line, index) => {
    if (line.text.length + 2 > monoMax)
      errors.push({
        path: `${path}.run[${index}]`,
        message: `${line.text.length} characters, but ${monoMax - 2} fit in half the frame; shorten it`,
      });
  });
  if (scene.beat === "check" && (!scene.claim || scene.run.length === 0))
    errors.push({
      path,
      message: "a check beat needs a claim and the run that proves it",
    });
  if (scene.beat === "alert" && !scene.claim)
    errors.push({ path, message: "an alert beat needs the claim both sides show" });
  if (scene.url && scene.url.length * typeSize(frame, "label") * 0.55 > box.width)
    errors.push({
      path: `${path}.url`,
      message: "too long for one line at label size; shorten it",
    });
}

function checkData(scene: Scene, path: string, errors: Issue[]) {
  if (scene.type === "heatmap")
    scene.matrices.forEach((matrix, index) => {
      const shaped =
        matrix.values.length === matrix.rows.length &&
        matrix.values.every((row) => row.length === matrix.cols.length);
      if (!shaped)
        errors.push({
          path: `${path}.matrices[${index}].values`,
          message: `expected ${matrix.rows.length} rows of ${matrix.cols.length} values`,
        });
    });
  if (scene.type === "flow" && scene.loop) {
    const missing = [scene.loop.from, scene.loop.to].find(
      (step) => step < 0 || step >= scene.steps.length,
    );
    if (missing !== undefined)
      errors.push({
        path: `${path}.loop`,
        message: `step ${missing} does not exist`,
      });
  }
  if (
    scene.type === "chart" &&
    scene.highlight &&
    !scene.data.some((item) => item.label === scene.highlight)
  )
    errors.push({
      path: `${path}.highlight`,
      message: `no bar labelled "${scene.highlight}"`,
    });
  if (
    scene.type === "vectors" &&
    new Set(scene.rows.map((row) => row.values.length)).size > 1
  )
    errors.push({
      path: `${path}.rows`,
      message: "every vector needs the same number of values",
    });
  if (scene.type === "code" && scene.code.split("\n").length > MAX_CODE_LINES)
    errors.push({
      path: `${path}.code`,
      message: `more than ${MAX_CODE_LINES} lines will not be readable; show the part that matters`,
    });
}

function checkCaptions(
  spec: VideoSpec,
  totalSeconds: number,
  errors: Issue[],
  warnings: Issue[],
) {
  const captions = spec.captions;
  if (!captions?.enabled) return;
  if (captions.source === "items" && !captions.items?.length)
    errors.push({
      path: "captions.items",
      message: 'source is "items" but no captions were given',
    });
  (captions.source === "items" ? (captions.items ?? []) : []).forEach(
    (item, index) => {
      if (item.endMs / 1000 > totalSeconds + 0.01)
        errors.push({
          path: `captions.items[${index}]`,
          message: `ends at ${round(item.endMs / 1000)}s, after the video ends at ${round(totalSeconds)}s`,
        });
      if (item.text.length > MAX_CAPTION_CHARS)
        warnings.push({
          path: `captions.items[${index}]`,
          message: `over ${MAX_CAPTION_CHARS} characters wraps past two caption lines`,
        });
    },
  );
}

function visibleWords(scene: Scene) {
  const parts: (string | undefined)[] = (() => {
    switch (scene.type) {
      case "title":
        return [scene.eyebrow, scene.headline, scene.subheadline];
      case "statement":
        return scene.lines;
      case "terminal":
        return [scene.heading, ...scene.lines.map((line) => line.text)];
      case "list":
        return [
          scene.heading,
          ...scene.items.flatMap((item) => [item.label, item.detail]),
        ];
      case "cards":
        return [
          scene.heading,
          ...scene.cards.flatMap((card) => [card.title, card.body]),
        ];
      case "flow":
        return [scene.heading, ...scene.steps, scene.loop?.label];
      case "metrics":
        return [scene.heading, ...scene.metrics.map((metric) => metric.label)];
      case "chart":
        return [scene.heading, ...scene.data.map((item) => item.label)];
      case "chips":
        return [
          scene.heading,
          ...scene.chips.map((chip) => chip.label),
          scene.note,
        ];
      case "vectors":
        return [
          scene.heading,
          ...scene.rows.map((row) => row.label),
          scene.note,
        ];
      case "heatmap":
        return [scene.heading, scene.note];
      case "code":
        return [scene.heading];
      case "browser":
        return [scene.heading, scene.page?.title, ...(scene.page?.lines ?? [])];
      case "media":
        return [scene.heading, scene.caption];
      case "ansi":
        return [scene.heading, scene.bubble, scene.terminal];
      case "manga":
        return scene.panels.flatMap((panel) => [
          panel.label,
          ...panel.balloons.map((balloon) => balloon.text),
        ]);
      case "versus":
        // The claim is shown on both sides, but it is the same line: read once.
        return [
          scene.headline,
          scene.claim,
          ...scene.run.map((line) => line.text),
          scene.subline,
          scene.url,
        ];
      case "quote":
        return [scene.quote, scene.author, scene.role];
      case "cta":
        return [scene.headline, scene.subline, scene.url];
      default:
        return unhandled(scene);
    }
  })();
  return countWords(parts.filter(Boolean).join(" "));
}

/** Words a viewer reads; separators such as "·" and "→" are not words. */
function countWords(text: string) {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

/** Compile-time guard: a new scene type fails here until validation knows its words. */
function unhandled(scene: never): never {
  throw new Error(`Unknown scene ${JSON.stringify(scene)}`);
}

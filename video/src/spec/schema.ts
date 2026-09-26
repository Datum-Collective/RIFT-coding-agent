/**
 * The video specification: the creative contract between a brief and the renderer.
 *
 * A spec says what the video contains and when. It never says how a scene is drawn; scene
 * components own that. Keeping the two apart is what lets a natural-language brief become a
 * spec reliably, and lets the same spec re-render when the visual system improves.
 */
import { z } from "zod";

const text = z.string().min(1);
/** Relative to public/, e.g. "images/logo.svg". Validated against disk before rendering. */
const assetPath = z
  .string()
  .regex(
    /^[\w./-]+$/,
    "asset paths are relative to public/, e.g. images/logo.svg",
  )
  .refine(
    (value) => !value.startsWith("/") && !value.includes(".."),
    "asset paths must stay inside public/",
  );
const status = z.enum(["done", "active", "pending", "failed", "warn"]);

export const Transition = z.object({
  type: z.enum(["fade", "slide", "wipe", "none"]),
  durationInSeconds: z.number().positive().max(2).default(0.5),
  direction: z
    .enum(["from-left", "from-right", "from-top", "from-bottom"])
    .optional(),
});

const sceneBase = {
  /** Stable id, used for the scene's own Studio composition and in validation messages. */
  id: z.string().regex(/^[a-z0-9-]+$/, "scene ids are kebab-case"),
  durationInSeconds: z.number().min(0.5).max(120),
  /** What a narrator would say over this scene. Drives captions when captions.source is "narration". */
  narration: z.string().optional(),
  /** The transition into this scene from the previous one. */
  transition: Transition.optional(),
};

export const TitleScene = z.object({
  ...sceneBase,
  type: z.literal("title"),
  eyebrow: z.string().optional(),
  headline: text,
  subheadline: z.string().optional(),
});

export const StatementScene = z.object({
  ...sceneBase,
  type: z.literal("statement"),
  /** Revealed one line at a time. Wrap words in *asterisks* to set them in the accent colour. */
  lines: z.array(text).min(1).max(5),
});

export const TerminalLine = z.object({
  kind: z
    .enum(["input", "output", "success", "error", "muted"])
    .default("output"),
  text: z.string(),
});

export const TerminalScene = z.object({
  ...sceneBase,
  type: z.literal("terminal"),
  heading: z.string().optional(),
  title: z.string().default("terminal"),
  lines: z.array(TerminalLine).min(1).max(14),
});

export const ListScene = z.object({
  ...sceneBase,
  type: z.literal("list"),
  heading: text,
  items: z
    .array(
      z.object({
        label: text,
        detail: z.string().optional(),
        status: status.optional(),
      }),
    )
    .min(1)
    .max(7),
});

export const CardsScene = z.object({
  ...sceneBase,
  type: z.literal("cards"),
  heading: z.string().optional(),
  cards: z
    .array(
      z.object({
        title: text,
        body: z.string().optional(),
        glyph: z.string().max(3).optional(),
      }),
    )
    .min(1)
    .max(6),
});

export const FlowScene = z.object({
  ...sceneBase,
  type: z.literal("flow"),
  heading: z.string().optional(),
  steps: z.array(text).min(2).max(10),
  /** Step indexes to mark as a loop back, e.g. "Attack → Repair" returning to "Verify". */
  loop: z
    .object({
      from: z.number().int(),
      to: z.number().int(),
      label: z.string().optional(),
    })
    .optional(),
});

export const MetricsScene = z.object({
  ...sceneBase,
  type: z.literal("metrics"),
  heading: z.string().optional(),
  metrics: z
    .array(
      z.object({
        value: z.number(),
        label: text,
        prefix: z.string().optional(),
        suffix: z.string().optional(),
        decimals: z.number().int().min(0).max(3).default(0),
      }),
    )
    .min(1)
    .max(4),
});

export const ChartScene = z.object({
  ...sceneBase,
  type: z.literal("chart"),
  heading: z.string().optional(),
  unit: z.string().optional(),
  data: z
    .array(z.object({ label: text, value: z.number().min(0) }))
    .min(1)
    .max(12),
  /** Label of the bar to set in the accent colour. */
  highlight: z.string().optional(),
  source: z.string().optional(),
});

export const ChipsScene = z.object({
  ...sceneBase,
  type: z.literal("chips"),
  heading: z.string().optional(),
  chips: z
    .array(z.object({ label: text, sub: z.string().optional() }))
    .min(1)
    .max(16),
  note: z.string().optional(),
});

export const VectorsScene = z.object({
  ...sceneBase,
  type: z.literal("vectors"),
  heading: z.string().optional(),
  /** Values in [-1, 1], drawn as a strip of cells per row. */
  rows: z
    .array(
      z.object({
        label: text,
        values: z.array(z.number().min(-1).max(1)).min(2).max(16),
      }),
    )
    .min(1)
    .max(8),
  note: z.string().optional(),
});

export const Matrix = z.object({
  title: z.string().optional(),
  rows: z.array(z.string()).min(1).max(10),
  cols: z.array(z.string()).min(1).max(10),
  /** values[row][col] in [0, 1]. */
  values: z.array(z.array(z.number().min(0).max(1))),
});

export const HeatmapScene = z.object({
  ...sceneBase,
  type: z.literal("heatmap"),
  heading: z.string().optional(),
  matrices: z.array(Matrix).min(1).max(4),
  note: z.string().optional(),
});

export const CodeScene = z.object({
  ...sceneBase,
  type: z.literal("code"),
  heading: z.string().optional(),
  filename: z.string().optional(),
  code: text,
  /** 1-based line numbers to emphasise. */
  highlight: z.array(z.number().int().positive()).optional(),
});

export const BrowserScene = z.object({
  ...sceneBase,
  type: z.literal("browser"),
  heading: z.string().optional(),
  url: text,
  /** A screenshot in public/. Without one, a clean placeholder page is drawn from `page`. */
  image: assetPath.optional(),
  page: z
    .object({ title: text, lines: z.array(z.string()).max(6).default([]) })
    .optional(),
});

export const MediaScene = z.object({
  ...sceneBase,
  type: z.literal("media"),
  heading: z.string().optional(),
  /** An image (png, jpg, svg, webp) or video clip (mp4, webm, mov) in public/. */
  src: assetPath,
  caption: z.string().optional(),
  fit: z.enum(["contain", "cover"]).default("contain"),
});

export const QuoteScene = z.object({
  ...sceneBase,
  type: z.literal("quote"),
  quote: text,
  author: text,
  role: z.string().optional(),
});

export const CtaScene = z.object({
  ...sceneBase,
  type: z.literal("cta"),
  /** A logo in public/. Without one, `wordmark` is set in type. */
  logo: assetPath.optional(),
  wordmark: z.string().optional(),
  headline: text,
  url: z.string().optional(),
  subline: z.string().optional(),
});

export const Scene = z.discriminatedUnion("type", [
  TitleScene,
  StatementScene,
  TerminalScene,
  ListScene,
  CardsScene,
  FlowScene,
  MetricsScene,
  ChartScene,
  ChipsScene,
  VectorsScene,
  HeatmapScene,
  CodeScene,
  BrowserScene,
  MediaScene,
  QuoteScene,
  CtaScene,
]);

export const Caption = z.object({
  text: z.string(),
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  timestampMs: z.number().nullable(),
  confidence: z.number().nullable(),
});

export const Captions = z.object({
  enabled: z.boolean(),
  /**
   * "narration" times each scene's narration across the scene. "items" uses timed captions,
   * e.g. from Whisper or AssemblyAI, in @remotion/captions' Caption format.
   */
  source: z.enum(["narration", "items"]).default("narration"),
  items: z.array(Caption).optional(),
  /** Set words wrapped in *asterisks* in the accent colour. */
  highlight: z.boolean().default(true),
});

export const AudioTrack = z.object({
  src: assetPath,
  volume: z.number().min(0).max(1).default(1),
  startAtSeconds: z.number().min(0).default(0),
});

export const Audio = z.object({
  music: AudioTrack.optional(),
  /** A rendered voiceover file. Any TTS provider can produce it; see src/lib/audio/provider.ts. */
  voiceover: AudioTrack.optional(),
  effects: z.array(AudioTrack).default([]),
});

export const Theme = z.enum(["terminal", "paper", "midnight"]);

type PaletteRole =
  | "background"
  | "surface"
  | "surfaceRaised"
  | "border"
  | "text"
  | "textMuted"
  | "accent"
  | "danger"
  | "warning"
  | "success";

export const VideoSpec = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "video ids are kebab-case"),
  title: text,
  description: z.string().optional(),
  /** The brief this spec was made from, kept so the video can be regenerated or audited. */
  brief: z.string().optional(),
  format: z.object({
    width: z.number().int(),
    height: z.number().int(),
    fps: z.number().int().default(30),
  }),
  /** The duration the brief asked for. Validation fails if the scenes do not add up to it. */
  targetDurationInSeconds: z.number().positive().optional(),
  style: z.object({
    theme: Theme.default("terminal"),
    /** Overrides the theme's accent colour, e.g. a brand colour. */
    accent: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    /** Brand colours by role; anything not given comes from the theme. */
    palette: z
      .object(
        Object.fromEntries(
          [
            "background",
            "surface",
            "surfaceRaised",
            "border",
            "text",
            "textMuted",
            "accent",
            "danger",
            "warning",
            "success",
          ].map((role) => [
            role,
            z
              .string()
              .regex(/^#[0-9a-fA-F]{6}$/)
              .optional(),
          ]),
        ) as Record<PaletteRole, z.ZodOptional<z.ZodString>>,
      )
      .optional(),
    pacing: z.enum(["slow", "medium", "fast"]).default("medium"),
    visualDirection: z.string().optional(),
  }),
  scenes: z.array(Scene).min(1),
  captions: Captions.optional(),
  audio: Audio.optional(),
});

export type VideoSpec = z.infer<typeof VideoSpec>;
export type VideoSpecInput = z.input<typeof VideoSpec>;
export type Scene = z.infer<typeof Scene>;
export type SceneType = Scene["type"];
export type SceneOf<T extends SceneType> = Extract<Scene, { type: T }>;
export type Transition = z.infer<typeof Transition>;
export type Caption = z.infer<typeof Caption>;
export type Matrix = z.infer<typeof Matrix>;
export type Status = z.infer<typeof status>;

/** Parses and applies defaults. Throws a readable error for a malformed spec. */
export function defineVideo(input: VideoSpecInput): VideoSpec {
  const result = VideoSpec.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues.map(
    (issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`,
  );
  throw new Error(`Invalid video spec "${input.id}":\n${issues.join("\n")}`);
}

export const FORMATS = {
  vertical: { width: 1080, height: 1920, fps: 30 },
  horizontal: { width: 1920, height: 1080, fps: 30 },
  square: { width: 1080, height: 1080, fps: 30 },
} as const;

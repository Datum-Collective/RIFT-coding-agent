# RIFT Video — a code-driven video engine

Turn a sentence into a rendered MP4. In Claude Code, from the repo root:

```
/video 30-second vertical launch video for Acme, a Postgres backup tool, for developers
```

Claude writes a storyboard, turns it into a typed spec, validates it, looks at every scene, and
renders `video/out/<id>.mp4`. Everything below is what that command drives, and how to use or
extend it by hand.

## What it is

A video here is **data**: a `VideoSpec` in `src/data/videoSpecs/` that says what each scene
shows and for how long. Scene components decide how things look. That split is what makes
natural-language generation reliable. A model only has to produce a small, validated data
structure, never a pile of bespoke animation code, and every video inherits improvements to the
visual system.

```
brief → storyboard → VideoSpec (typed, validated) → scene components → Remotion → MP4
```

**Why Remotion:** videos are React components rendered frame by frame from `useCurrentFrame()`.
The same frame always renders the same pixels, it runs locally, it needs no paid service, and a
video lives in git like any other code.

## Install

Needs Node 20+ (tested on 24). FFmpeg is optional; it's used for contact sheets and blank-frame
checks, and Remotion ships its own for rendering.

```bash
cd video
npm install
```

The first render downloads Chrome Headless Shell (~90 MB) once.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Remotion Studio: live preview, scrubbing, and the spec as an editable form |
| `npm run validate [-- <id>] [--deep]` | Spec rules, assets on disk, fonts; `--deep` also bundles and checks registration |
| `npm run frames -- <id>` | One PNG per scene plus `contact-sheet.png` in `out/frames/<id>/` |
| `npm run render [-- <id>] [--output out/x.mp4]` | Validate → render H.264 → verify the file (default: `ProductLaunch`) |
| `npm run new -- <id> [--template T] [--format F]` | Start a video from a template and register it |
| `npm test` | Unit tests for timing, captions, validation and the scripts |
| `npm run lint` | ESLint (Remotion's config) and TypeScript |
| `npm run build` | Typecheck and bundle for deployment |

Examples:

```bash
npm run render -- rift-launch                                     # 30s, 9:16
npm run render -- transformer-explainer                           # 90s, 16:9
npm run render -- ProductLaunch --output out/product-launch.mp4   # a template
```

## Preview

`npm run dev` opens Studio. The sidebar has three kinds of entry:

- **Templates**: `ProductLaunch`, `ExplainerVideo`, `ShortVideo`, the starting points for `npm run new`.
- **Videos**: every spec in `src/data/videoSpecs/index.ts`.
- **`<id>-scenes`**: each scene of a video on its own timeline, for tuning one scene without
  scrubbing the rest.

For agent-driven work, `npm run frames` is the preview. Stills are taken once each scene has
settled, so they show what a viewer actually reads.

## Render

`npm run render` refuses to start if validation has errors. It renders with fixed settings
(H.264, CRF 18, yuv420p), then checks the file with ffprobe against the spec: resolution, frame
rate, duration within one frame, codec, audio present if the spec has audio, and no blank
stretches. Any mismatch exits non-zero. Output goes to `out/`, which is git-ignored.

## Writing a spec

```ts
import { defineVideo, FORMATS } from "../../spec/schema";

export const acmeLaunch = defineVideo({
  id: "acme-launch",
  title: "Acme — launch",
  format: FORMATS.vertical,            // or FORMATS.horizontal / FORMATS.square, 30 fps
  targetDurationInSeconds: 30,         // validation fails if the scenes don't add up
  style: { theme: "terminal", pacing: "fast", accent: "#7C9CFF" },
  captions: { enabled: true },         // captions from each scene's `narration`
  scenes: [
    { id: "hook", type: "statement", durationInSeconds: 4, lines: ["Backups fail *silently.*"] },
    {
      id: "proof", type: "terminal", durationInSeconds: 6,
      transition: { type: "fade", durationInSeconds: 0.4 },
      narration: "Acme restores every backup, every night.",
      lines: [{ kind: "input", text: "acme verify --all" }, { kind: "success", text: "412 restores passed" }],
    },
    { id: "cta", type: "cta", durationInSeconds: 4, wordmark: "ACME", headline: "Know your backups work.", url: "acme.dev" },
  ],
});
```

Rules the engine enforces:

- **Time.** A transition belongs to the scene it leads into and overlaps the scene before it,
  so total = sum of durations − transitions. `targetDurationInSeconds` errors say exactly how
  much to cut or add.
- **Emphasis.** Wrap words in `*asterisks*` to set them in the accent colour, in scenes and captions.
- **Assets.** Paths are relative to `public/` (e.g. `images/logo.svg`). Missing files fail validation.
- **Fit.** Headlines, terminal lines and code lines are measured against the frame; copy that
  would clip is an error.
- **Reading time.** A scene shorter than it takes to read its words (about 4 words/s) is a
  warning, and so is narration too fast to caption.

### Themes

| Theme | Use for | Look |
| --- | --- | --- |
| `terminal` | dev tools, launches, demos | near-black, quiet green accent, mono details |
| `paper` | teaching, explainers, diagrams | warm off-white, blue accent |
| `midnight` | cinematic typography, announcements | near-black, warm amber accent |

`style.accent` sets a brand accent. `style.palette` overrides any role (`background`, `surface`,
`surfaceRaised`, `border`, `text`, `textMuted`, `accent`, `danger`, `warning`, `success`) with a
hex colour; roles you leave out come from the theme.

### Scene catalog

| Type | Use for | Fields |
| --- | --- | --- |
| `title` | hook, section opener | `eyebrow?`, `headline`, `subheadline?` |
| `statement` | typographic beats, one line at a time | `lines[]` (max 5) |
| `quote` | testimonial | `quote`, `author`, `role?` |
| `terminal` | CLI demo; inputs type out, results follow | `heading?`, `title`, `lines[{kind: input\|output\|success\|error\|muted, text}]` |
| `code` | a snippet with highlighted lines | `heading?`, `filename?`, `code`, `highlight?[]` (1-based) |
| `browser` | a product page or screenshot in a browser frame | `heading?`, `url`, `image?` or `page{title, lines[]}` |
| `list` | checklist, status list | `heading`, `items[{label, detail?, status?}]` |
| `cards` | features, concepts (up to 6) | `heading?`, `cards[{title, body?, glyph?}]` |
| `flow` | a process, with an optional loop back | `heading?`, `steps[]`, `loop?{from, to, label?}` |
| `metrics` | numbers that count up | `heading?`, `metrics[{value, label, prefix?, suffix?, decimals?}]` |
| `chart` | bar chart from data | `heading?`, `data[{label, value}]`, `unit?`, `highlight?`, `source?` |
| `chips` | tokens, tags, IDs | `heading?`, `chips[{label, sub?}]`, `note?` |
| `vectors` | embeddings, feature vectors (−1..1) | `heading?`, `rows[{label, values[]}]`, `note?` |
| `heatmap` | attention, similarity (0..1), up to 4 matrices | `heading?`, `matrices[{title?, rows[], cols[], values[][]}]`, `note?` |
| `media` | an image or video clip from `public/` | `heading?`, `src`, `caption?`, `fit?` (`contain`/`cover`) |
| `cta` | the close | `logo?` or `wordmark?`, `headline`, `url?`, `subline?` |

Every scene also takes `id`, `durationInSeconds`, `narration?` and `transition?` (`fade`,
`slide`, `wipe`, `none`; `durationInSeconds`; `direction?`).

## Giving it a brief

`/video` accepts anything from one line to a full brief with structure and timings. Useful
things to include: audience, platform or aspect ratio, length, tone, the one thing a viewer
should remember, the CTA, and any assets (drop them in `public/` first). Anything you leave out
gets a sensible default, and the storyboard Claude shows you first is where to correct course.

## Project layout

```
video/
├── src/
│   ├── spec/            schema.ts (VideoSpec), timing.ts, validate.ts — pure, tested
│   ├── data/videoSpecs/ one file per video + index.ts registry and template map
│   ├── scenes/          one component per scene type + registry.tsx
│   ├── components/      Text, Effects, Layout, UI, Charts, Media, Captions — props only, no content
│   ├── compositions/    SpecVideo (renders any spec), AudioTracks
│   ├── lib/             animation, captions, typography (fonts), audio provider interface, context
│   ├── styles/          theme.ts (palettes, motion), scale.ts (type scale, safe areas, fit)
│   └── Root.tsx         registers compositions from the registry; never needs editing
├── scripts/             validate, frames, render, new (+ lib/ with tests)
└── public/              fonts/ (bundled, OFL), images/, audio/, assets/
```

## Reusable pieces

Components take props, never content, and read theme and sizes from context:

- **Text:** `Display`, `Headline`, `Subheadline`, `Body`, `Label`, `Code`, `Eyebrow`, `Cta`, `Metric`, `Emphasis`
- **Motion:** `Reveal` / `FadeIn` / `SlideIn`, `ScaleIn`, `WordReveal`, `TypeReveal`. One entrance curve
  (`motion.enter`) and a pacing-aware `stagger()`, with no springs or bounce by design.
- **UI:** `Window`, `Terminal`, `BrowserWindow`, `CodeEditor`, `Card`, `StatusGlyph`, `Cursor`, `Callout`, `ProgressBar`, `Notification`, `HighlightBox`
- **Media:** `AssetImage`, `ImageReveal`, `VideoClip`
- **Charts:** `BarChart`, `FlowSteps`, `Heatmap`, `VectorStrip`, `Chip`
- **Captions:** `CaptionTrack`, in `@remotion/captions` format
- **Layout:** `SceneFrame` (background plus platform safe area), `Stack`

## Extending

**A new scene type:** add its schema to `src/spec/schema.ts` (and to the `Scene` union), draw it
in `src/scenes/`, map it in `scenes/registry.tsx`, and teach `validate.ts` what has to fit and
what counts as reading time. Exhaustive `never` guards make TypeScript fail in both places until
you do.

**Voiceover (ElevenLabs, Kokoro, local TTS):** implement `VoiceoverProvider` in
`src/lib/audio/provider.ts`. It writes a file to `public/audio/` and returns its path, which goes
in `spec.audio.voiceover`. The renderer only ever plays files, so it never depends on a provider.

**Transcription (Whisper, AssemblyAI):** produce `Caption[]` and set
`captions: { enabled: true, source: "items", items }`. Word-level captions are paged
automatically, with the spoken word highlighted.

**Screenshots (Claude in Chrome or other browser automation):** capture to `public/images/` and
use a `browser` scene's `image`. Capture is a step before rendering, never part of it.

**FFmpeg post-processing** (compression, loudness, burn-in, format conversion): run on
`out/*.mp4` after `npm run render`. Remotion already handles encoding and audio mixing, so reach
for FFmpeg only for what it adds.

**Manim, avatars (HeyGen), publishing, MCP tools:** render or fetch into `public/` as assets, or
publish from `out/`. The core renderer stays independent of all of them.

## Known limitations

- **Fit is estimated.** Validation estimates text width from character counts; `npm run frames`
  is the real check for clipping and overlap, and `/video` makes Claude look at every frame.
- **No line charts or dashboards yet.** Bar charts, heatmaps, vectors and metrics exist. Add a
  scene type for anything else (see Extending).
- **Per-scene timing is duration plus transition.** Entrance timing comes from the pacing, not
  from per-element keyframes in the spec; fine-tune in Studio or in the scene component.
- **Two font families.** Inter and JetBrains Mono ship in `public/fonts`. A brand font means
  adding its files and a `loadFont` entry in `src/lib/typography/fonts.ts`.
- **No voice, transcription or capture providers ship.** The interfaces are there; pick a provider
  when a video needs one.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Text renders in a serif font | The font loader was tree-shaken. `package.json` `sideEffects` must list `src/lib/typography/fonts.ts`. |
| `scenes add up to Xs, brief asks for Ys` | Adjust durations by the amount given; remember transitions overlap. |
| `wraps to N lines` / `characters, but N fit` | Shorten the copy; don't shrink the type below the scale. |
| `missing file public/...` | Add the asset, or fix the path (relative to `public/`, no leading slash). |
| Render exits with `blank frames` | A scene drew nothing for that stretch; check it with `npm run frames`. |
| `blank-frame check could not run ffmpeg` | Neither system ffmpeg nor Remotion's bundled one ran; reinstall with `npm install`. |
| First render hangs at "Downloading Chrome" | One-time ~90 MB download; needs network once. |

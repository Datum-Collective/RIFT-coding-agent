---
description: Make an animated video from a brief — storyboard, spec, check the frames, render an MP4
argument-hint: <what the video is about — one sentence is enough>
---

Make this video: $ARGUMENTS

Work in `video/`. It is a Remotion engine where a video is a typed spec, not hand-written JSX.
Read `video/README.md` (Scene catalog, Writing a spec) before starting.

1. **Interpret.** Pull out subject, audience, platform, duration, aspect ratio, tone, required
   content, CTA. Decide anything unspecified yourself; don't ask about trivia. Defaults: social
   or "short" → 9:16 vertical, 30s, captions on; explainer, demo or YouTube → 16:9 horizontal.
   Theme: `terminal` for dev tools, `paper` for teaching, `midnight` for cinematic typography.

2. **Storyboard first.** Show the user a compact table — scene, seconds, purpose, scene type,
   on-screen text, transition — before writing code. One idea per scene. The first 3 seconds
   must say why to keep watching. Pick scene types from the catalog; prefer strong typography
   and real product visuals (terminal, code, browser) over decoration.

3. **Write the spec.** `cd video && npm run new -- <kebab-id> --template <ProductLaunch|ExplainerVideo|ShortVideo> --format <vertical|horizontal|square>`,
   then replace the scenes in `src/data/videoSpecs/<id>.ts` with the storyboard. Put the
   storyboard in the file's top comment and the brief in `brief`. Set
   `targetDurationInSeconds` when a length was asked for. Mark accent words with `*asterisks*`.
   Only add a new scene type or component when no existing one can express the idea.

4. **Validate.** `npm run validate -- <id>`. Fix every error. Treat warnings (reading time,
   narration speed) as real unless there's a reason not to. Transitions overlap the previous
   scene, so durations must add up with that in mind — the error message says by how much.

5. **Look at it.** `npm run frames -- <id>`, then Read `out/frames/<id>/contact-sheet.png` and
   any scene that looks off at full size. Check: text clipped or crowded, hierarchy unclear,
   things too small for a phone, captions over content, empty or lopsided frames. Fix and
   re-run until every frame is one you'd ship. Compiling is not done; looking is.

6. **Render.** `npm run render -- <id>` → `out/<id>.mp4`. It re-validates, then checks the file's
   resolution, fps, duration, codec and blank frames, and exits non-zero if anything is off.

7. **Report** the MP4 path, the storyboard, and anything you decided on the user's behalf.
   Offer `npm run dev` to open Remotion Studio for hand-tuning.

If the brief needs assets (logo, screenshots, music), put them in `video/public/` and reference
them by path relative to `public/`; validation fails on missing files. No paid services are
needed; voiceover and transcription are extension points (see the README), not requirements.

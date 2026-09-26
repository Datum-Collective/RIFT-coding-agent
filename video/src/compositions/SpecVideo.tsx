/**
 * Renders any VideoSpec. The spec decides what happens and when; this only arranges scenes on
 * the timeline, joins them with their transitions, and layers captions and audio on top.
 */
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { Fragment } from "react";
import { AbsoluteFill, type CalculateMetadataFunction } from "remotion";
import { z } from "zod";
import { CaptionTrack } from "../components/Captions/CaptionTrack";
import { VideoProvider } from "../lib/context";
import "../lib/typography/fonts";
import { SceneRenderer } from "../scenes/registry";
import { VideoSpec, type Transition } from "../spec/schema";
import { timeline, transitionFrames } from "../spec/timing";
import { themeFor } from "../styles/theme";
import { AudioTracks } from "./AudioTracks";

export const specProps = z.object({ spec: VideoSpec });
export type SpecProps = z.infer<typeof specProps>;

export function SpecVideo(props: SpecProps) {
  const spec = props.spec;
  const fps = spec.format.fps;
  return (
    <VideoProvider spec={spec}>
      <AbsoluteFill
        style={{ backgroundColor: themeFor(spec).palette.background }}
      >
        <TransitionSeries>
          {spec.scenes.map((scene, index) => {
            const overlap = transitionFrames(scene, index, fps);
            return (
              <Fragment key={scene.id}>
                {overlap > 0 && scene.transition
                  ? transitionInto(scene.transition, overlap)
                  : null}
                <TransitionSeries.Sequence
                  name={scene.id}
                  durationInFrames={Math.round(scene.durationInSeconds * fps)}
                >
                  <SceneRenderer scene={scene} />
                </TransitionSeries.Sequence>
              </Fragment>
            );
          })}
        </TransitionSeries>
        <CaptionTrack />
        <AudioTracks />
      </AbsoluteFill>
    </VideoProvider>
  );
}

/** One scene on its own timeline, for editing it in Studio without scrubbing the whole video. */
export function SpecScene(props: SpecProps & { sceneId: string }) {
  const scene = props.spec.scenes.find((item) => item.id === props.sceneId);
  if (!scene)
    throw new Error(`Scene "${props.sceneId}" is not in "${props.spec.id}"`);
  return (
    <VideoProvider spec={props.spec}>
      <SceneRenderer scene={scene} />
    </VideoProvider>
  );
}

export const calculateSpecMetadata: CalculateMetadataFunction<SpecProps> = ({
  props,
}) => ({
  width: props.spec.format.width,
  height: props.spec.format.height,
  fps: props.spec.format.fps,
  durationInFrames: timeline(props.spec).durationInFrames,
  defaultOutName: props.spec.id,
});

// Transitions stay quiet: a fade by default, slides and wipes only where a spec asks. Built as
// elements, not a wrapper component, because TransitionSeries reads its direct children.
function transitionInto(transition: Transition, durationInFrames: number) {
  const timing = linearTiming({ durationInFrames });
  if (transition.type === "slide")
    return (
      <TransitionSeries.Transition
        presentation={slide({
          direction: transition.direction ?? "from-right",
        })}
        timing={timing}
      />
    );
  if (transition.type === "wipe")
    return (
      <TransitionSeries.Transition
        presentation={wipe({ direction: transition.direction ?? "from-left" })}
        timing={timing}
      />
    );
  return <TransitionSeries.Transition presentation={fade()} timing={timing} />;
}

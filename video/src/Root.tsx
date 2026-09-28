/**
 * Registers compositions and nothing else. Videos are data in src/data/videoSpecs; this file
 * never needs editing when one is added.
 */
import { Composition, Folder } from "remotion";
import {
  calculateSpecMetadata,
  SpecScene,
  SpecVideo,
  specProps,
} from "./compositions/SpecVideo";
import { templates, videos } from "./data/videoSpecs";
import { timeline } from "./spec/timing";
import type { VideoSpec } from "./spec/schema";

export function RemotionRoot() {
  return (
    <>
      <Folder name="Templates">
        {Object.entries(templates).map(([id, spec]) => (
          <SpecComposition key={id} id={id} spec={spec} />
        ))}
      </Folder>
      <Folder name="Videos">
        {videos.map((spec) => (
          <SpecComposition key={spec.id} id={spec.id} spec={spec} />
        ))}
      </Folder>
      {videos.map((spec) => (
        <Folder key={spec.id} name={`${spec.id}-scenes`}>
          {timeline(spec).entries.map((entry) => (
            <Composition
              key={entry.scene.id}
              id={`${spec.id}--${entry.scene.id}`}
              component={SpecScene}
              width={spec.format.width}
              height={spec.format.height}
              fps={spec.format.fps}
              durationInFrames={entry.durationInFrames}
              defaultProps={{ spec, sceneId: entry.scene.id }}
            />
          ))}
        </Folder>
      ))}
    </>
  );
}

function SpecComposition(props: { id: string; spec: VideoSpec }) {
  return (
    <Composition
      id={props.id}
      component={SpecVideo}
      schema={specProps}
      defaultProps={{ spec: props.spec }}
      calculateMetadata={calculateSpecMetadata}
      width={props.spec.format.width}
      height={props.spec.format.height}
      fps={props.spec.format.fps}
      durationInFrames={timeline(props.spec).durationInFrames}
    />
  );
}

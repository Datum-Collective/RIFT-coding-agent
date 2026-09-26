/**
 * Time is a design parameter, so it is computed in one place. A transition belongs to the
 * scene it leads into and overlaps the end of the scene before it, matching TransitionSeries.
 */
import type { Scene, VideoSpec } from "./schema";

export type TimelineEntry = {
  scene: Scene;
  index: number;
  /** First frame of the scene, including any transition into it. */
  from: number;
  durationInFrames: number;
  /** Frames shared with the previous scene while the transition plays. */
  transitionIn: number;
};

export type Timeline = { entries: TimelineEntry[]; durationInFrames: number };

export function toFrames(seconds: number, fps: number) {
  return Math.round(seconds * fps);
}

export function transitionFrames(scene: Scene, index: number, fps: number) {
  if (index === 0 || !scene.transition || scene.transition.type === "none")
    return 0;
  return toFrames(scene.transition.durationInSeconds, fps);
}

export function timeline(spec: VideoSpec): Timeline {
  const fps = spec.format.fps;
  const entries = spec.scenes.reduce<TimelineEntry[]>((list, scene, index) => {
    const previous = list[list.length - 1];
    const transitionIn = transitionFrames(scene, index, fps);
    const from = previous
      ? previous.from + previous.durationInFrames - transitionIn
      : 0;
    return [
      ...list,
      {
        scene,
        index,
        from,
        durationInFrames: toFrames(scene.durationInSeconds, fps),
        transitionIn,
      },
    ];
  }, []);
  const last = entries[entries.length - 1];
  return {
    entries,
    durationInFrames: last ? last.from + last.durationInFrames : 0,
  };
}

/** The scene on screen at `frame`. During a transition that is the incoming scene. */
export function sceneAt(spec: VideoSpec, frame: number) {
  return timeline(spec).entries.findLast(
    (entry) =>
      frame >= entry.from && frame < entry.from + entry.durationInFrames,
  );
}

import { VIDEO } from "./theme";

export const TRANSITION_FRAMES = 15;

export const SCENES = [
  { id: "Hook", durationInFrames: 105 },
  { id: "Problem", durationInFrames: 135 },
  { id: "FirstLine", durationInFrames: 150 },
  { id: "Breakthrough", durationInFrames: 180 },
  { id: "Grind", durationInFrames: 180 },
  { id: "Result", durationInFrames: 150 },
  { id: "Outro", durationInFrames: 105 },
] as const;

/**
 * Transitions overlap the adjacent scenes, so the timeline is the sum of all
 * scene lengths minus one transition per cut.
 */
export const TOTAL_FRAMES =
  SCENES.reduce((sum, scene) => sum + scene.durationInFrames, 0) -
  TRANSITION_FRAMES * (SCENES.length - 1);

export const SCENE_STARTS: number[] = (() => {
  const starts: number[] = [];
  let cursor = 0;
  for (const scene of SCENES) {
    starts.push(cursor);
    cursor += scene.durationInFrames - TRANSITION_FRAMES;
  }
  return starts;
})();

export const midpointOf = (index: number) =>
  Math.round(SCENE_STARTS[index] + SCENES[index].durationInFrames / 2);

export const fps = VIDEO.fps;
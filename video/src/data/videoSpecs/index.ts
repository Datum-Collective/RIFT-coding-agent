/**
 * Every video in the project. `npm run new` adds entries between the markers; keep them.
 */
import type { VideoSpec } from "../../spec/schema";
import { riftLaunch } from "./rift-launch";
import { riftReplayTeaser } from "./rift-replay-teaser";
import { transformerExplainer } from "./transformer-explainer";
import { riftVerifyShort } from "./rift-verify-short";
import { riftAnsiShort } from "./rift-ansi-short";
import { kevinAnt } from "./kevin-ant";
import { antAllNighter } from "./ant-all-nighter";
import { riftVsAgent } from "./rift-vs-agent";
// @new-video-imports

export const videos: VideoSpec[] = [
  riftLaunch,
  transformerExplainer,
  riftReplayTeaser,
  riftVerifyShort,
  riftAnsiShort,
  kevinAnt,
  antAllNighter,
  riftVsAgent,
  // @new-video-entries
];

/** The starting point for each template composition, and for `npm run new --template`. */
export const templates = {
  ProductLaunch: riftLaunch,
  ExplainerVideo: transformerExplainer,
  ShortVideo: riftReplayTeaser,
} satisfies Record<string, VideoSpec>;

export function findVideo(id: string) {
  return videos.find((video) => video.id === id);
}

/**
 * Everything a component needs to look right in this video: the theme, the frame it is drawn
 * into, and the pacing. Components read it instead of taking colours or sizes as props.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { VideoSpec } from "../spec/schema";
import {
  safeArea,
  space,
  typeSize,
  type Frame,
  type TypeRole,
} from "../styles/scale";
import { themeFor, type Theme } from "../styles/theme";

export type VideoContextValue = {
  spec: VideoSpec;
  theme: Theme;
  frame: Frame;
  vertical: boolean;
  type: (role: TypeRole) => number;
  space: (steps: number) => number;
};

const VideoContext = createContext<VideoContextValue | null>(null);

export function VideoProvider(props: { spec: VideoSpec; children: ReactNode }) {
  const value = useMemo(() => {
    const frame = {
      width: props.spec.format.width,
      height: props.spec.format.height,
    };
    return {
      spec: props.spec,
      theme: themeFor(props.spec),
      frame,
      vertical: frame.height > frame.width,
      type: (role: TypeRole) => typeSize(frame, role),
      space: (steps: number) => space(frame, steps),
    };
  }, [props.spec]);
  return (
    <VideoContext.Provider value={value}>
      {props.children}
    </VideoContext.Provider>
  );
}

export function useVideo() {
  const value = useContext(VideoContext);
  if (!value) throw new Error("useVideo() must be used inside <VideoProvider>");
  return value;
}

export function useSafeArea() {
  return safeArea(useVideo().frame);
}

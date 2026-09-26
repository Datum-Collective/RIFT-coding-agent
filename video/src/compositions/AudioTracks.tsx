import { Audio } from "@remotion/media";
import { interpolate, Sequence, staticFile, useVideoConfig } from "remotion";
import { useVideo } from "../lib/context";

/** Music, voiceover and effects, each placed on the timeline in frames so sync is exact. */
export function AudioTracks() {
  const { spec } = useVideo();
  const { fps } = useVideoConfig();
  const audio = spec.audio;
  if (!audio) return null;
  const tracks = [
    ...(audio.music ? [{ name: "Music", ...audio.music }] : []),
    ...(audio.voiceover ? [{ name: "Voiceover", ...audio.voiceover }] : []),
    ...audio.effects.map((effect, index) => ({
      name: `Effect ${index + 1}`,
      ...effect,
    })),
  ];
  return (
    <>
      {tracks.map((track) => (
        <Sequence
          key={track.name}
          name={track.name}
          from={Math.round(track.startAtSeconds * fps)}
          layout="none"
        >
          <Audio
            src={staticFile(track.src)}
            // Music eases in over half a second instead of starting at full level.
            volume={(frame) =>
              track.name === "Music"
                ? interpolate(frame, [0, fps / 2], [0, track.volume], {
                    extrapolateRight: "clamp",
                  })
                : track.volume
            }
          />
        </Sequence>
      ))}
    </>
  );
}

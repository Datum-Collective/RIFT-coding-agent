import { Video } from "@remotion/media";
import { staticFile } from "remotion";
import { useVideo } from "../../lib/context";

/** A clip from public/, muted by default so it never fights the voiceover or music. */
export function VideoClip(props: {
  src: string;
  fit?: "contain" | "cover";
  muted?: boolean;
}) {
  const { theme } = useVideo();
  return (
    <Video
      src={staticFile(props.src)}
      muted={props.muted ?? true}
      objectFit={props.fit ?? "contain"}
      style={{
        width: "100%",
        height: "100%",
        borderRadius: theme.radius.md,
      }}
    />
  );
}

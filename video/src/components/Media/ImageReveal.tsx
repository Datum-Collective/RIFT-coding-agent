import type { CSSProperties } from "react";
import { useVideo } from "../../lib/context";
import { ScaleIn } from "../Effects/ScaleIn";
import { AssetImage } from "./AssetImage";

/** An image from public/ that settles into place, framed with the theme's border and radius. */
export function ImageReveal(props: {
  src: string;
  fit?: "contain" | "cover";
  delay?: number;
  style?: CSSProperties;
}) {
  const { theme } = useVideo();
  return (
    <ScaleIn
      delay={props.delay}
      style={{
        minHeight: 0,
        display: "flex",
        justifyContent: "center",
        ...props.style,
      }}
    >
      <AssetImage
        src={props.src}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: props.fit ?? "contain",
          borderRadius: theme.radius.md,
          border: `${theme.hairline}px solid ${theme.palette.border}`,
        }}
      />
    </ScaleIn>
  );
}

import type { CSSProperties } from "react";
import { Img, staticFile } from "remotion";

/**
 * An image from public/. Paths are checked on disk by `npm run validate` before rendering, so
 * a missing file fails loudly there instead of rendering a broken frame.
 */
export function AssetImage(props: { src: string; style?: CSSProperties }) {
  return (
    <Img
      src={staticFile(props.src)}
      style={{ objectFit: "contain", ...props.style }}
    />
  );
}

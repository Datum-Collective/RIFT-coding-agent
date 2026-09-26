import { useVideo } from "../../lib/context";
import { AssetImage } from "../Media/AssetImage";
import { Window } from "./Window";

/** A browser showing a real screenshot, or a clean stand-in page when there is none yet. */
export function BrowserWindow(props: {
  url: string;
  image?: string;
  page?: { title: string; lines: readonly string[] };
}) {
  const { theme, type, space } = useVideo();
  return (
    <Window
      title={props.url}
      bodyStyle={{ padding: props.image ? 0 : space(5) }}
    >
      {props.image ? (
        <AssetImage
          src={props.image}
          style={{ width: "100%", display: "block" }}
        />
      ) : (
        <div
          style={{ display: "flex", flexDirection: "column", gap: space(2.5) }}
        >
          <div
            style={{
              fontFamily: theme.fonts.sans,
              fontSize: type("title"),
              fontWeight: 700,
              color: theme.palette.text,
              letterSpacing: "-0.02em",
            }}
          >
            {props.page?.title}
          </div>
          {(props.page?.lines ?? []).map((line, index) => (
            <div
              key={index}
              style={{
                fontFamily: theme.fonts.sans,
                fontSize: type("body") * 0.8,
                color: theme.palette.textMuted,
              }}
            >
              {line}
            </div>
          ))}
        </div>
      )}
    </Window>
  );
}

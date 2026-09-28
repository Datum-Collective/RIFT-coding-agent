import { useVideoConfig } from "remotion";
import { Reveal } from "../components/Effects/Reveal";
import { WordReveal } from "../components/Effects/WordReveal";
import { SceneFrame } from "../components/Layout/SceneFrame";
import { Eyebrow, Headline, Subheadline } from "../components/Text/Typography";
import { useVideo } from "../lib/context";
import type { SceneOf } from "../spec/schema";

/** A hook or section title: one headline, landed word by word, with optional context around it. */
export function TitleScene(props: { scene: SceneOf<"title"> }) {
  const { space, type, theme } = useVideo();
  const words = props.scene.headline.split(/\s+/).length;
  return (
    <SceneFrame gap={space(4)}>
      {props.scene.eyebrow ? (
        <Reveal>
          <Eyebrow text={props.scene.eyebrow} />
        </Reveal>
      ) : null}
      <Headline style={{ fontSize: type("display") }}>
        <WordReveal
          text={props.scene.headline}
          delay={0.15}
          color={theme.palette.text}
        />
      </Headline>
      {props.scene.subheadline ? (
        <Reveal delay={0.35 + words * 0.07}>
          <Subheadline text={props.scene.subheadline} muted />
        </Reveal>
      ) : null}
    </SceneFrame>
  );
}

/**
 * Cinematic statements: each line arrives on its own beat, spread over the first half of the
 * scene so the last line still gets time to be read.
 */
export function StatementScene(props: { scene: SceneOf<"statement"> }) {
  const { space } = useVideo();
  const { durationInFrames, fps } = useVideoConfig();
  const beat = Math.min(
    1.1,
    ((durationInFrames / fps) * 0.5) /
      Math.max(1, props.scene.lines.length - 1),
  );
  return (
    <SceneFrame gap={space(3)}>
      {props.scene.lines.map((line, index) => (
        <Reveal key={index} delay={0.1 + index * beat}>
          <Headline text={line} />
        </Reveal>
      ))}
    </SceneFrame>
  );
}

export function QuoteScene(props: { scene: SceneOf<"quote"> }) {
  const { space, theme, type } = useVideo();
  return (
    <SceneFrame gap={space(5)}>
      <Reveal>
        <div
          style={{
            fontFamily: theme.fonts.sans,
            fontSize: type("display"),
            color: theme.palette.accent,
            lineHeight: 0.6,
          }}
        >
          “
        </div>
      </Reveal>
      <Reveal delay={0.15}>
        <Subheadline
          text={props.scene.quote}
          style={{ fontSize: type("title") * 1.1, fontWeight: 500 }}
        />
      </Reveal>
      <Reveal delay={0.6}>
        <div
          style={{
            fontFamily: theme.fonts.sans,
            fontSize: type("body"),
            color: theme.palette.text,
            fontWeight: 600,
          }}
        >
          {props.scene.author}
          {props.scene.role ? (
            <span style={{ color: theme.palette.textMuted, fontWeight: 400 }}>
              {" "}
              · {props.scene.role}
            </span>
          ) : null}
        </div>
      </Reveal>
    </SceneFrame>
  );
}

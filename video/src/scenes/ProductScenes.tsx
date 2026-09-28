import { Reveal } from "../components/Effects/Reveal";
import { SceneFrame } from "../components/Layout/SceneFrame";
import { Stack } from "../components/Layout/Stack";
import { AssetImage } from "../components/Media/AssetImage";
import { Cta } from "../components/Text/Cta";
import { Body, Headline, Subheadline } from "../components/Text/Typography";
import { BrowserWindow } from "../components/UI/BrowserWindow";
import { Card } from "../components/UI/Card";
import { CodeEditor } from "../components/UI/CodeEditor";
import { StatusGlyph } from "../components/UI/Status";
import { Terminal } from "../components/UI/Terminal";
import { stagger } from "../lib/animation/stagger";
import { useVideo } from "../lib/context";
import type { SceneOf } from "../spec/schema";
import { SceneHeading, SceneNote } from "./parts";
import { ImageReveal } from "../components/Media/ImageReveal";
import { VideoClip } from "../components/Media/VideoClip";
import { VIDEO_FILE } from "../spec/validate";

export function TerminalScene(props: { scene: SceneOf<"terminal"> }) {
  const { space } = useVideo();
  return (
    <SceneFrame gap={space(5)}>
      <SceneHeading text={props.scene.heading} />
      <Reveal delay={props.scene.heading ? 0.25 : 0}>
        <Terminal
          title={props.scene.title}
          lines={props.scene.lines}
          start={props.scene.heading ? 0.6 : 0.35}
        />
      </Reveal>
    </SceneFrame>
  );
}

export function ListScene(props: { scene: SceneOf<"list"> }) {
  const { space, spec, theme, type } = useVideo();
  return (
    <SceneFrame gap={space(6)}>
      <SceneHeading text={props.scene.heading} />
      <Stack gap={space(3.5)}>
        {props.scene.items.map((item, index) => (
          <Reveal
            key={index}
            delay={stagger(spec.style.pacing, index, 0.4)}
            from="left"
          >
            <Stack direction="row" gap={space(3)} align="baseline">
              <div style={{ minWidth: type("body") }}>
                <StatusGlyph status={item.status ?? "pending"} />
              </div>
              <Stack gap={space(0.5)}>
                <Body
                  text={item.label}
                  style={{ fontWeight: 600, color: theme.palette.text }}
                />
                {item.detail ? <Body text={item.detail} muted /> : null}
              </Stack>
            </Stack>
          </Reveal>
        ))}
      </Stack>
    </SceneFrame>
  );
}

export function CardsScene(props: { scene: SceneOf<"cards"> }) {
  const { space, spec, theme, type, vertical } = useVideo();
  const count = props.scene.cards.length;
  const columns = vertical
    ? count > 3
      ? 2
      : 1
    : Math.min(count, count === 4 ? 2 : 3);
  return (
    <SceneFrame gap={space(6)}>
      <SceneHeading text={props.scene.heading} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: space(3),
        }}
      >
        {props.scene.cards.map((card, index) => (
          <Reveal key={index} delay={stagger(spec.style.pacing, index, 0.35)}>
            <Card style={{ height: "100%", boxSizing: "border-box" }}>
              <Stack gap={space(1.5)}>
                {card.glyph ? (
                  <div
                    style={{
                      fontFamily: theme.fonts.mono,
                      fontSize: type("title"),
                      color: theme.palette.accent,
                      lineHeight: 1,
                    }}
                  >
                    {card.glyph}
                  </div>
                ) : null}
                <Subheadline
                  text={card.title}
                  style={{ fontWeight: 700, fontSize: type("title") * 0.85 }}
                />
                {card.body ? <Body text={card.body} muted /> : null}
              </Stack>
            </Card>
          </Reveal>
        ))}
      </div>
    </SceneFrame>
  );
}

export function CodeScene(props: { scene: SceneOf<"code"> }) {
  const { space } = useVideo();
  return (
    <SceneFrame gap={space(5)}>
      <SceneHeading text={props.scene.heading} />
      <Reveal delay={props.scene.heading ? 0.25 : 0}>
        <CodeEditor
          code={props.scene.code}
          filename={props.scene.filename}
          highlight={props.scene.highlight}
          delay={0.4}
        />
      </Reveal>
    </SceneFrame>
  );
}

export function BrowserScene(props: { scene: SceneOf<"browser"> }) {
  const { space } = useVideo();
  return (
    <SceneFrame gap={space(5)}>
      <SceneHeading text={props.scene.heading} />
      <Reveal delay={props.scene.heading ? 0.25 : 0}>
        <BrowserWindow
          url={props.scene.url}
          image={props.scene.image}
          page={props.scene.page}
        />
      </Reveal>
    </SceneFrame>
  );
}

/** The close: identity, one line, one action. Centred, and nothing else competing with it. */
export function CtaScene(props: { scene: SceneOf<"cta"> }) {
  const { space, theme, type } = useVideo();
  return (
    <SceneFrame align="center" gap={space(5)}>
      <Reveal from="none">
        {props.scene.logo ? (
          <AssetImage
            src={props.scene.logo}
            style={{ height: type("display") * 1.2 }}
          />
        ) : props.scene.wordmark ? (
          <div
            style={{
              fontFamily: theme.fonts.mono,
              fontWeight: 700,
              fontSize: type("display"),
              color: theme.palette.text,
              letterSpacing: "0.04em",
            }}
          >
            {props.scene.wordmark}
          </div>
        ) : null}
      </Reveal>
      <Reveal delay={0.3}>
        <Headline text={props.scene.headline} />
      </Reveal>
      {props.scene.url ? (
        <Reveal delay={0.6}>
          <Cta text={props.scene.url} />
        </Reveal>
      ) : null}
      {props.scene.subline ? (
        <Reveal delay={0.8}>
          <Body text={props.scene.subline} muted />
        </Reveal>
      ) : null}
    </SceneFrame>
  );
}

/** An image or clip as the subject of the scene, with an optional heading and caption. */
export function MediaScene(props: { scene: SceneOf<"media"> }) {
  const { space } = useVideo();
  const video = VIDEO_FILE.test(props.scene.src);
  return (
    <SceneFrame gap={space(4)}>
      <SceneHeading text={props.scene.heading} />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        {video ? (
          <VideoClip src={props.scene.src} fit={props.scene.fit} />
        ) : (
          <ImageReveal
            src={props.scene.src}
            fit={props.scene.fit}
            delay={props.scene.heading ? 0.25 : 0}
          />
        )}
      </div>
      <SceneNote text={props.scene.caption} delay={0.6} />
    </SceneFrame>
  );
}

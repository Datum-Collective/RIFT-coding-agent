/** Pieces every scene shares, so headings and notes look and move the same everywhere. */
import { Reveal } from "../components/Effects/Reveal";
import { Body, Subheadline } from "../components/Text/Typography";

export function SceneHeading(props: { text?: string; delay?: number }) {
  if (!props.text) return null;
  return (
    <Reveal delay={props.delay ?? 0}>
      <Subheadline text={props.text} style={{ fontWeight: 700 }} />
    </Reveal>
  );
}

export function SceneNote(props: { text?: string; delay: number }) {
  if (!props.text) return null;
  return (
    <Reveal delay={props.delay}>
      <Body text={props.text} muted style={{ maxWidth: "80%" }} />
    </Reveal>
  );
}

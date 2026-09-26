import { BarChart } from "../components/Charts/BarChart";
import { Chip } from "../components/Charts/Chip";
import { FlowSteps } from "../components/Charts/FlowSteps";
import { Heatmap } from "../components/Charts/Heatmap";
import { VectorStrip } from "../components/Charts/VectorStrip";
import { Reveal } from "../components/Effects/Reveal";
import { SceneFrame } from "../components/Layout/SceneFrame";
import { Stack } from "../components/Layout/Stack";
import { Label } from "../components/Text/Typography";
import { Metric } from "../components/Text/Metric";
import { stagger } from "../lib/animation/stagger";
import { useVideo } from "../lib/context";
import { contentBox } from "../styles/scale";
import type { SceneOf } from "../spec/schema";
import { SceneHeading, SceneNote } from "./parts";

export function FlowScene(props: { scene: SceneOf<"flow"> }) {
  const { space } = useVideo();
  return (
    <SceneFrame gap={space(6)}>
      <SceneHeading text={props.scene.heading} />
      <FlowSteps
        steps={props.scene.steps}
        loop={props.scene.loop}
        delay={props.scene.heading ? 0.35 : 0.1}
      />
    </SceneFrame>
  );
}

export function MetricsScene(props: { scene: SceneOf<"metrics"> }) {
  const { space, spec, vertical } = useVideo();
  return (
    <SceneFrame gap={space(7)}>
      <SceneHeading text={props.scene.heading} />
      <Stack
        direction={vertical ? "column" : "row"}
        gap={space(vertical ? 6 : 10)}
      >
        {props.scene.metrics.map((metric, index) => (
          <Reveal key={index} delay={stagger(spec.style.pacing, index, 0.3)}>
            <Metric
              {...metric}
              delay={stagger(spec.style.pacing, index, 0.3)}
            />
          </Reveal>
        ))}
      </Stack>
    </SceneFrame>
  );
}

export function ChartScene(props: { scene: SceneOf<"chart"> }) {
  const { space } = useVideo();
  return (
    <SceneFrame gap={space(6)}>
      <SceneHeading text={props.scene.heading} />
      <BarChart
        data={props.scene.data}
        unit={props.scene.unit}
        highlight={props.scene.highlight}
        delay={0.4}
      />
      {props.scene.source ? (
        <Reveal delay={1.2}>
          <Label
            muted
            text={`Source: ${props.scene.source}`}
            style={{ letterSpacing: "0.02em" }}
          />
        </Reveal>
      ) : null}
    </SceneFrame>
  );
}

export function ChipsScene(props: { scene: SceneOf<"chips"> }) {
  const { space, spec } = useVideo();
  return (
    <SceneFrame gap={space(6)}>
      <SceneHeading text={props.scene.heading} />
      <Stack direction="row" wrap gap={space(2)}>
        {props.scene.chips.map((chip, index) => (
          <Reveal
            key={index}
            delay={stagger(spec.style.pacing, index, 0.35)}
            distance={space(2)}
          >
            <Chip label={chip.label} sub={chip.sub} />
          </Reveal>
        ))}
      </Stack>
      <SceneNote
        text={props.scene.note}
        delay={stagger(spec.style.pacing, props.scene.chips.length, 0.6)}
      />
    </SceneFrame>
  );
}

export function VectorsScene(props: { scene: SceneOf<"vectors"> }) {
  const { space, frame } = useVideo();
  const columns = props.scene.rows[0]?.values.length ?? 8;
  const cell = Math.min(
    space(8),
    Math.floor((contentBox(frame).width * 0.62) / (columns * 1.12)),
  );
  return (
    <SceneFrame gap={space(6)}>
      <SceneHeading text={props.scene.heading} />
      <Stack gap={space(2)}>
        {props.scene.rows.map((row, index) => (
          <VectorStrip
            key={index}
            label={row.label}
            values={row.values}
            cell={cell}
            delay={0.35 + index * 0.25}
          />
        ))}
      </Stack>
      <SceneNote
        text={props.scene.note}
        delay={0.6 + props.scene.rows.length * 0.25}
      />
    </SceneFrame>
  );
}

export function HeatmapScene(props: { scene: SceneOf<"heatmap"> }) {
  const { space, frame, vertical } = useVideo();
  const box = contentBox(frame);
  const count = props.scene.matrices.length;
  const perRow = vertical ? Math.min(count, 2) : count;
  const cols = Math.max(
    ...props.scene.matrices.map((matrix) => matrix.cols.length),
  );
  const rowsOfMatrices = Math.ceil(count / perRow);
  const byWidth = (box.width / perRow - space(14)) / (cols * 1.08);
  const byHeight = (box.height * 0.62) / rowsOfMatrices / (cols * 1.15);
  const cell = Math.floor(Math.min(byWidth, byHeight, space(12)));
  return (
    <SceneFrame gap={space(5)}>
      <SceneHeading text={props.scene.heading} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${perRow}, auto)`,
          justifyContent: "center",
          gap: space(6),
        }}
      >
        {props.scene.matrices.map((matrix, index) => (
          <Reveal key={index} delay={0.3 + index * 0.3} from="none">
            <Heatmap matrix={matrix} cell={cell} delay={0.4 + index * 0.3} />
          </Reveal>
        ))}
      </div>
      <SceneNote text={props.scene.note} delay={0.8 + count * 0.3} />
    </SceneFrame>
  );
}

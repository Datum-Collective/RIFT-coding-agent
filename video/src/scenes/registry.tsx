/**
 * One component per scene type. Adding a scene type means adding it to the schema, drawing it
 * here, and teaching validation how much of it has to fit; nothing else changes.
 */
import type { Scene } from "../spec/schema";
import {
  ChartScene,
  ChipsScene,
  FlowScene,
  HeatmapScene,
  MetricsScene,
  VectorsScene,
} from "./DataScenes";
import {
  BrowserScene,
  CardsScene,
  CodeScene,
  CtaScene,
  ListScene,
  MediaScene,
  TerminalScene,
} from "./ProductScenes";
import { QuoteScene, StatementScene, TitleScene } from "./TypographyScenes";

export function SceneRenderer(props: { scene: Scene }) {
  const scene = props.scene;
  switch (scene.type) {
    case "title":
      return <TitleScene scene={scene} />;
    case "statement":
      return <StatementScene scene={scene} />;
    case "quote":
      return <QuoteScene scene={scene} />;
    case "terminal":
      return <TerminalScene scene={scene} />;
    case "list":
      return <ListScene scene={scene} />;
    case "cards":
      return <CardsScene scene={scene} />;
    case "code":
      return <CodeScene scene={scene} />;
    case "browser":
      return <BrowserScene scene={scene} />;
    case "media":
      return <MediaScene scene={scene} />;
    case "cta":
      return <CtaScene scene={scene} />;
    case "flow":
      return <FlowScene scene={scene} />;
    case "metrics":
      return <MetricsScene scene={scene} />;
    case "chart":
      return <ChartScene scene={scene} />;
    case "chips":
      return <ChipsScene scene={scene} />;
    case "vectors":
      return <VectorsScene scene={scene} />;
    case "heatmap":
      return <HeatmapScene scene={scene} />;
    default:
      return unhandled(scene);
  }
}

/** Compile-time guard: adding a scene type to the schema fails here until it is drawn. */
function unhandled(scene: never): never {
  throw new Error(`No component for scene ${JSON.stringify(scene)}`);
}

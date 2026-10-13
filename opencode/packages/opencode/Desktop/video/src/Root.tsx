import { Composition, Folder } from "remotion";
import { BreakthroughScene } from "./scenes/Breakthrough";
import { FirstLineScene } from "./scenes/FirstLine";
import { GrindScene } from "./scenes/Grind";
import { HookScene } from "./scenes/Hook";
import { OutroScene } from "./scenes/Outro";
import { ProblemScene } from "./scenes/Problem";
import { ResultScene } from "./scenes/Result";
import { SCENES, TOTAL_FRAMES } from "./timeline";
import { VIDEO } from "./theme";
import { RaccoonCode } from "./Video";

const SCENE_COMPONENTS = [
  HookScene,
  ProblemScene,
  FirstLineScene,
  BreakthroughScene,
  GrindScene,
  ResultScene,
  OutroScene,
];

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="RaccoonCode"
      component={RaccoonCode}
      durationInFrames={TOTAL_FRAMES}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />

    <Folder name="Scenes">
      {SCENES.map((scene, i) => (
        <Composition
          key={scene.id}
          id={scene.id}
          component={SCENE_COMPONENTS[i]}
          durationInFrames={scene.durationInFrames}
          fps={VIDEO.fps}
          width={VIDEO.width}
          height={VIDEO.height}
        />
      ))}
    </Folder>
  </>
);
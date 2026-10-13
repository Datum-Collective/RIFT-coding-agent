import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming, springTiming } from "@remotion/transitions";
import { clockWipe } from "@remotion/transitions/clock-wipe";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { CaptionBar } from "./components/CaptionBar";
import { BreakthroughScene } from "./scenes/Breakthrough";
import { FirstLineScene } from "./scenes/FirstLine";
import { GrindScene } from "./scenes/Grind";
import { HookScene } from "./scenes/Hook";
import { OutroScene } from "./scenes/Outro";
import { ProblemScene } from "./scenes/Problem";
import { ResultScene } from "./scenes/Result";
import { TRANSITION_FRAMES } from "./timeline";
import { COLORS } from "./theme";

const cut = () => linearTiming({ durationInFrames: TRANSITION_FRAMES });

export const RaccoonCode: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
    <TransitionSeries>
      <TransitionSeries.Sequence name="Hook" durationInFrames={105}>
        <HookScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={cut()}
      />

      <TransitionSeries.Sequence name="Problem" durationInFrames={135}>
        <ProblemScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={wipe({ direction: "from-bottom" })}
        timing={cut()}
      />

      <TransitionSeries.Sequence name="FirstLine" durationInFrames={150}>
        <FirstLineScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={clockWipe({ width: 420, height: 420 })}
        timing={springTiming({
          config: { damping: 200 },
          durationInFrames: TRANSITION_FRAMES,
        })}
      />

      <TransitionSeries.Sequence name="Breakthrough" durationInFrames={180}>
        <BreakthroughScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition presentation={fade()} timing={cut()} />

      <TransitionSeries.Sequence name="Grind" durationInFrames={180}>
        <GrindScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={slide({ direction: "from-bottom" })}
        timing={cut()}
      />

      <TransitionSeries.Sequence name="Result" durationInFrames={150}>
        <ResultScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition presentation={fade()} timing={cut()} />

      <TransitionSeries.Sequence name="Outro" durationInFrames={105}>
        <OutroScene />
      </TransitionSeries.Sequence>
    </TransitionSeries>

    <CaptionBar />
  </AbsoluteFill>
);
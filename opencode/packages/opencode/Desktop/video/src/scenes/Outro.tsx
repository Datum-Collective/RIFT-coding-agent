import { Headline, Kicker } from "../components/Headline";
import { Raccoon } from "../components/Raccoon";
import { Chip, Scene } from "../components/Scene";
import { COLORS } from "../theme";

export const OutroScene: React.FC = () => (
  <Scene
    left={
      <>
        <Kicker text="MORAL OF THE STORY" at={0} color={COLORS.amber} />
        <Headline
          at={4}
          size={92}
          lines={[
            { text: "DEBUG", color: COLORS.cream },
            { text: "ANYTHING.", color: COLORS.teal },
          ]}
        />
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <Chip
            text="EVEN RACCOONS"
            at={30}
            fontSize={40}
            color={COLORS.bg}
            background={COLORS.cream}
            border={COLORS.cream}
          />
          <Chip
            text="START CODING →"
            at={40}
            fontSize={40}
            color={COLORS.bg}
            background={COLORS.amber}
            border={COLORS.amber}
          />
        </div>
      </>
    }
    right={
      <Raccoon
        face="happy"
        laptop
        screen={COLORS.amber}
        headTilt={12}
        tailWag={18}
      />
    }
  />
);
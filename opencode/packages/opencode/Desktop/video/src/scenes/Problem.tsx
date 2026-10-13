import { Headline, Kicker } from "../components/Headline";
import { Raccoon } from "../components/Raccoon";
import { Chip, Scene } from "../components/Scene";
import { CODE_FONT, COLORS } from "../theme";

export const ProblemScene: React.FC = () => (
  <Scene
    left={
      <>
        <Kicker text="DAY ONE" at={0} color={COLORS.coral} />
        <Headline
          at={4}
          size={92}
          lines={[
            { text: "OPEN", color: COLORS.cream },
            { text: "TRASH CAN", color: COLORS.amber },
          ]}
        />
        <Chip
          text="trash.can.open()"
          at={26}
          fontFamily={CODE_FONT}
          fontSize={42}
          color={COLORS.teal}
          border={COLORS.teal}
        />
      </>
    }
    right={
      <Raccoon
        face="neutral"
        laptop
        screen={COLORS.amber}
        headTilt={-12}
        tailWag={3}
      />
    }
  />
);
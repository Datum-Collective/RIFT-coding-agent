import { Headline, Kicker } from "../components/Headline";
import { Raccoon } from "../components/Raccoon";
import { Scene } from "../components/Scene";
import { COLORS } from "../theme";

export const HookScene: React.FC = () => (
  <Scene
    left={
      <>
        <Kicker text="CASE FILE #001" at={0} />
        <Headline
          at={4}
          size={92}
          lines={[
            { text: "A RACCOON", color: COLORS.cream },
            { text: "LEARNED", color: COLORS.teal },
            { text: "TO CODE.", color: COLORS.amber },
          ]}
        />
      </>
    }
    right={<Raccoon face="neutral" laptop tailWag={9} headTilt={-4} />}
  />
);
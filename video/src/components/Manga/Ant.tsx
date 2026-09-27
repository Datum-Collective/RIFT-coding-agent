/**
 * The ant rig: an original ant drawn as SVG with clean, even line weight.
 * Head, thorax, abdomen, antennae and legs are separate groups so panels can
 * pose, flip and expression-swap the same character. All ink, no fills except
 * paper white and eye white.
 */
import { useCurrentFrame } from "remotion";

export type AntPose = "stand" | "run" | "proud" | "prone";
export type AntExpression =
  | "normal"
  | "happy"
  | "narrow"
  | "determined"
  | "deadpan"
  | "dazed"
  | "knocked";

export function Ant(props: {
  pose?: AntPose;
  expression?: AntExpression;
  queen?: boolean;
  kevin?: boolean;
  sweat?: boolean;
  dusty?: boolean;
  flip?: boolean;
  blink?: boolean;
  ink?: string;
  paper?: string;
}) {
  const frame = useCurrentFrame();
  const ink = props.ink ?? "#161616";
  const paper = props.paper ?? "#FFFFFF";
  const pose = props.pose ?? "stand";
  const expression = props.expression ?? "normal";
  const stroke = {
    stroke: ink,
    strokeWidth: 7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none" as const,
  };
  // A held blink: lids shut for 4 frames out of every 100. Deterministic.
  const blinking =
    (props.blink ?? true) && expression === "normal" && frame % 100 > 92;

  const bodyTilt = pose === "run" ? -14 : pose === "proud" ? 4 : 0;
  const bodyDy = pose === "run" ? 10 : pose === "prone" ? 26 : 0;

  return (
    <g
      transform={`translate(100 112) rotate(${bodyTilt}) translate(-100 -112) translate(0 ${bodyDy})${props.flip ? " translate(200 0) scale(-1 1)" : ""}`}
    >
      {pose === "run" ? <RunLegs ink={ink} /> : <StandLegs ink={ink} prone={pose === "prone"} />}
      {/* abdomen */}
      <ellipse cx="100" cy="168" rx="46" ry="40" fill={paper} stroke={ink} strokeWidth={7} />
      {props.dusty ? (
        <g fill={ink} opacity={0.55}>
          <circle cx="82" cy="158" r="3" />
          <circle cx="104" cy="176" r="3" />
          <circle cx="118" cy="160" r="3" />
          <circle cx="92" cy="188" r="3" />
        </g>
      ) : null}
      {/* thorax */}
      <ellipse cx="100" cy="114" rx="24" ry="22" fill={paper} stroke={ink} strokeWidth={7} />
      {/* arms (front legs) */}
      <Arms ink={ink} pose={pose} />
      {/* antennae */}
      <g {...stroke}>
        {props.kevin ? (
          <>
            <path d="M84 26 Q70 8 52 12 Q60 18 58 26" />
            <path d="M116 26 Q128 6 148 10" />
          </>
        ) : (
          <>
            <path d="M84 26 Q72 6 54 8" />
            <path d="M116 26 Q128 6 146 8" />
          </>
        )}
      </g>
      <circle cx={props.kevin ? 58 : 54} cy={props.kevin ? 26 : 8} r="4.5" fill={ink} />
      <circle cx={props.kevin ? 148 : 146} cy={props.kevin ? 10 : 8} r="4.5" fill={ink} />
      {/* head */}
      <ellipse cx="100" cy="62" rx="40" ry="36" fill={paper} stroke={ink} strokeWidth={7} />
      {props.queen ? (
        <polygon
          points="72,32 80,12 90,28 100,8 110,28 120,12 128,32"
          fill={paper}
          stroke={ink}
          strokeWidth={6}
          strokeLinejoin="round"
        />
      ) : null}
      {props.kevin ? (
        <path d="M64 44 Q100 34 136 44" {...stroke} strokeWidth={5} />
      ) : null}
      <Eyes
        ink={ink}
        paper={paper}
        expression={expression}
        blinking={blinking}
        queen={props.queen}
      />
      <Mouth ink={ink} expression={expression} kevin={props.kevin} />
      {/* mandibles */}
      <g {...stroke} strokeWidth={5}>
        <path d="M74 84 Q66 92 70 100" />
        <path d="M126 84 Q134 92 130 100" />
      </g>
      {props.sweat ? (
        <g transform="translate(148 44)">
          <path
            d="M0 -16 C8 -4 12 2 12 8 A12 12 0 1 1 -12 8 C-12 2 -8 -4 0 -16 Z"
            fill={paper}
            stroke={ink}
            strokeWidth={5}
          />
        </g>
      ) : null}
    </g>
  );
}

function StandLegs(props: { ink: string; prone: boolean }) {
  const s = {
    stroke: props.ink,
    strokeWidth: 7,
    strokeLinecap: "round" as const,
    fill: "none" as const,
  };
  if (props.prone) {
    return (
      <g {...s}>
        <path d="M66 150 L34 178 L18 174" />
        <path d="M134 150 L166 178 L182 174" />
        <path d="M70 120 L40 128 L26 142" />
        <path d="M130 120 L160 128 L174 142" />
      </g>
    );
  }
  return (
    <g {...s}>
      <path d="M72 128 L48 152 L44 178" />
      <path d="M128 128 L152 152 L156 178" />
      <path d="M70 150 L50 168 L48 190" />
      <path d="M130 150 L150 168 L152 190" />
      <path d="M78 108 L58 118 L54 140" />
      <path d="M122 108 L142 118 L146 140" />
    </g>
  );
}

function RunLegs(props: { ink: string }) {
  const s = {
    stroke: props.ink,
    strokeWidth: 7,
    strokeLinecap: "round" as const,
    fill: "none" as const,
  };
  return (
    <g {...s}>
      <path d="M72 126 L36 128 L14 142" />
      <path d="M128 126 L164 128 L186 142" />
      <path d="M70 150 L34 166 L12 168" />
      <path d="M130 150 L166 166 L188 168" />
      <path d="M76 108 L48 100 L30 106" />
      <path d="M124 108 L152 100 L170 106" />
    </g>
  );
}

function Arms(props: { ink: string; pose: AntPose }) {
  const s = {
    stroke: props.ink,
    strokeWidth: 6,
    strokeLinecap: "round" as const,
    fill: "none" as const,
  };
  if (props.pose === "proud") {
    return (
      <g {...s}>
        <path d="M84 116 L100 132 L116 116" />
      </g>
    );
  }
  if (props.pose === "run") {
    return (
      <g {...s}>
        <path d="M84 112 L60 96 L44 98" />
        <path d="M116 112 L140 96 L156 98" />
      </g>
    );
  }
  return (
    <g {...s}>
      <path d="M84 114 L70 132 L68 148" />
      <path d="M116 114 L130 132 L132 148" />
    </g>
  );
}

function Eyes(props: {
  ink: string;
  paper: string;
  expression: AntExpression;
  blinking: boolean;
  queen?: boolean;
}) {
  const { ink, paper, expression } = props;
  if (props.blinking) {
    return (
      <g stroke={ink} strokeWidth={5} strokeLinecap="round">
        <path d="M68 62 Q78 66 88 62" fill="none" />
        <path d="M112 62 Q122 66 132 62" fill="none" />
      </g>
    );
  }
  switch (expression) {
    case "happy":
      return (
        <g stroke={ink} strokeWidth={6} strokeLinecap="round" fill="none">
          <path d="M66 64 Q78 50 90 64" />
          <path d="M110 64 Q122 50 134 64" />
        </g>
      );
    case "narrow":
      return (
        <g>
          <path d="M64 56 L92 62 L66 68 Z" fill={ink} />
          <path d="M136 56 L108 62 L134 68 Z" fill={ink} />
          <path d="M150 44 L158 52 L150 60 L142 52 Z" fill={paper} stroke={ink} strokeWidth={3} />
        </g>
      );
    case "determined":
      return (
        <g>
          <ellipse cx="79" cy="62" rx="13" ry="15" fill={paper} stroke={ink} strokeWidth={5} />
          <ellipse cx="121" cy="62" rx="13" ry="15" fill={paper} stroke={ink} strokeWidth={5} />
          <circle cx="82" cy="65" r="5.5" fill={ink} />
          <circle cx="124" cy="65" r="5.5" fill={ink} />
          <g stroke={ink} strokeWidth={6} strokeLinecap="round">
            <path d="M62 44 L92 52" />
            <path d="M138 44 L108 52" />
          </g>
        </g>
      );
    case "deadpan":
      return (
        <g>
          <ellipse cx="79" cy="64" rx="13" ry="12" fill={paper} stroke={ink} strokeWidth={5} />
          <ellipse cx="121" cy="64" rx="13" ry="12" fill={paper} stroke={ink} strokeWidth={5} />
          <circle cx="79" cy="66" r="4" fill={ink} />
          <circle cx="121" cy="66" r="4" fill={ink} />
          <g stroke={ink} strokeWidth={6} strokeLinecap="round">
            <path d="M64 52 L94 54" />
            <path d="M136 52 L106 54" />
          </g>
        </g>
      );
    case "dazed":
      return (
        <g>
          <ellipse cx="79" cy="62" rx="12" ry="14" fill={paper} stroke={ink} strokeWidth={5} />
          <ellipse cx="121" cy="62" rx="12" ry="14" fill={paper} stroke={ink} strokeWidth={5} />
          <circle cx="79" cy="62" r="3.5" fill={ink} />
          <circle cx="121" cy="62" r="3.5" fill={ink} />
        </g>
      );
    case "knocked":
      return (
        <g stroke={ink} strokeWidth={6} strokeLinecap="round">
          <path d="M70 54 L88 70 M88 54 L70 70" />
          <path d="M112 54 L130 70 M130 54 L112 70" />
        </g>
      );
    default:
      return (
        <g>
          <ellipse cx="79" cy="60" rx="14" ry="16" fill={paper} stroke={ink} strokeWidth={5} />
          <ellipse cx="121" cy="60" rx="14" ry="16" fill={paper} stroke={ink} strokeWidth={5} />
          <circle cx="81" cy="62" r="6" fill={ink} />
          <circle cx="123" cy="62" r="6" fill={ink} />
          <circle cx="83" cy="60" r="2" fill={paper} />
          <circle cx="125" cy="60" r="2" fill={paper} />
          {props.queen ? (
            <g stroke={ink} strokeWidth={4} strokeLinecap="round">
              <path d="M62 44 L66 38 M138 44 L134 38" />
            </g>
          ) : null}
        </g>
      );
  }
}

function Mouth(props: { ink: string; expression: AntExpression; kevin?: boolean }) {
  const s = {
    stroke: props.ink,
    strokeWidth: 5,
    strokeLinecap: "round" as const,
    fill: "none" as const,
  };
  switch (props.expression) {
    case "happy":
      return <path d="M86 86 Q100 98 114 86" {...s} />;
    case "narrow":
      return <path d="M88 88 Q102 92 114 84" {...s} />;
    case "determined":
      return <path d="M88 88 L112 88" {...s} strokeWidth={6} />;
    case "deadpan":
      return <path d="M90 90 L110 90" {...s} />;
    case "dazed":
      return <path d="M88 88 Q94 84 100 88 Q106 92 112 88" {...s} />;
    case "knocked":
      return <ellipse cx="100" cy="90" rx="7" ry="9" {...s} />;
    default:
      return props.kevin ? (
        <path d="M90 88 Q104 92 112 84" {...s} />
      ) : (
        <path d="M90 87 Q100 93 110 87" {...s} />
      );
  }
}
